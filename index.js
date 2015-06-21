var request = require("request"),
    cheerio = require("cheerio"),
    fs      = require("fs"),
    repl    = require("repl");

var levelup = require('levelup');
var leveldown = require('leveldown');
var url = require('url');

var storeDB;
var productDB;
var joinDB;

var storeList = { };
var productList = { };
var productStoreJoin = { };

var seeds   = [ ],
    visited = { },
    seen    = { },
    current,
    retry   = 0;

function rekick () {
  console.log("rekicking");
  current = seeds.shift();

  console.log("starting with", current);
  request(base + current, processPage);

}

repl.start("> ").context.internal = {
  storeList: storeList,
  productList: productList,
  productStoreJoin: productStoreJoin,
  seeds: seeds,
  rekick: rekick,
  current: current
};

var base = 'http://oregonliquorsearch.com/';


function updateDatabases ( ) {
  leveldown.destroy("./database/stores.old", function (err) {
    if (err) {
      console.log("error", err);
    }
    leveldown.destroy("./database/products.old", function (err) {
      if (err) {
        console.log("error", err);
      }
      leveldown.destroy("./database/joins.old", function (err) {
        if (err) {
          console.log("error", err);
        }

        storeDB = new levelup("./database/stores.new");
        productDB = new levelup("./database/products.new");
        joinDB = new levelup("./database/joins.new");

        validateBirthday(processPage);
      });

    });
  });
}

function validateBirthday (callback) {
  var month = Math.floor(Math.random() * 12) + 1,
      day   = Math.floor(Math.random() * 27) + 1,
      year  = Math.floor(Math.random() * 10) + 1960;

  request.post(
    base + "servlet/WelcomeController",
    function (err, response, body) {
      if (body.match("moved")) {
        if (current === undefined) {
          console.log("no current");
          request(base + "servlet/FrontController?view=home&action=categoriesdisplay", callback);
        } else {
          console.log("current = " + current);
          request(base + current, callback);
        }
      }
    }
  ).form({ selMonth: month, selDay: day, selYear: year });

}

updateDatabases();

function processPage (err, response, body) {
  if (err) {
    console.log("error", err);

    request(base + current, processPage);
    return;
  }

  if (body.match("Error |")) {
    console.log("error on page " + response.request.href);
    //seeds = [ ];
    //return validateBirthday(processPage);
  }

  if (body.match("selMonth")) {
    if (current) {
      seeds.unshift(current);
    }

    console.log("validating");
    return validateBirthday(processPage);
  }

  var $ = cheerio.load(body);
  var i, href;

  // check for categories
  var categories = $("li a").find();

  if (categories.length) {
    for (i = 0; i < categories.length; i++) {
      href = $(categories[i]).attr("href");
      if (seen[href] !== true) {
        seen[href] = true;
        seeds.unshift(href);
      }
    }
  }

  // check for pagination
  var pagination = $("#pagination a").find();

  if (pagination.length) {
    for (i = 0; i < pagination.length; i++) {
      href = $(categories[i]).attr("href");
      if (seen[href] !== true) {
        seen[href] = true;
        seeds.unshift(href);
      }
    }
  }

  // check for links
  var links = $("table.list").children();

  if (links.length) {
    for (i = 1; i < links.length; i++) {
      var td = $(links[i]).children();

      var a = $(td).find("a");

      href = $(a).attr("href");

      if (seen[href] !== true) {
        seen[href] = true;
        seeds.unshift(href);
      }
    }
  }

  var product = $("#product-desc h2").find().text();
  var productParts = product.split(": ");
  var productId = productParts[0].split(" ")[1];
  var productName = productParts[1];

  if (product && product !== '') {
    // product information
    var details = $("table#product-details").find("tr");
    var parts = $(details[2]).find("td");

    var category = $(parts[0]).text();
    var age = Number($(parts[1]).text()) ? Number($(parts[1]).text()) : undefined;

    parts = $(details[3]).find("td");

    var size = $(parts[0]).text();

    parts = $(details[4]).find("td");

    var proof = $(parts[0]).text();
    var price = $(parts[1]).text();

    productList[productId] = {
      productId: productId.trim(),
      name: productName.trim(),
      category: category.trim(),
      age: age,
      size: size,
      proof: Number(proof),
      price: Number(price.substring(1))
    };

    productDB.put(productId, JSON.stringify(productList[productId]));

    // store information
    var list = $("table.list").find("tr");

    for (i = 1; i < list.length; i++) {
      parts = $(list[i]).find("td");

      var storeNo = $(parts[0]).find("span").text();
      var city = $(parts[1]).text();
      var address = $(parts[2]).text();
      var zip = $(parts[3]).text();
      var phone = $(parts[4]).text();
      var hours = $(parts[5]).text();
      var qty = $(parts[6]).text();

      storeList[storeNo] = {
        storeNo: storeNo.trim(),
        address: address.trim(),
        city: city.trim(),
        zip: zip.trim(),
        phone: phone.trim(),
        hours: hours.trim()
      };

      storeDB.put(storeNo, JSON.stringify(storeList[storeNo]));
      joinDB.put(productId + ":" + storeNo, qty);
      productStoreJoin[productId + ":" + storeNo] = qty;
    }
  }

  // check for the end of the queue
  if (seeds.length === 0) {
    function checkend () {
      retry++;
      if (retry < 5) {
        setTimeout(function () {
          current = seeds.shift();
          if (current) {
            request(base + current, processPage);
          } else {
            checkend();
          }
        }, 5000);

      } else {
        console.log("Done!");
        setTimeout(function () {
          fs.writeFileSync("stores.json", JSON.stringify(storeList), "utf8");
          fs.writeFileSync("products.json", JSON.stringify(productList), "utf8");
          fs.writeFileSync("product_store.json", JSON.stringify(productStoreJoin), "utf8");
          storeDB.close();
          productDB.close();
          joinDB.close();

          try {
            fs.renameSync("./database/stores", "./database/stores.old");
            fs.renameSync("./database/products", "./database/products.old");
            fs.renameSync("./database/joins", "./database/joins.old");
          } catch(err) {
            console.log("error", err);
          }

          try {
            fs.renameSync("./database/stores.new", "./database/stores");
            fs.renameSync("./database/products.new", "./database/products");
            fs.renameSync("./database/joins.new", "./database/joins");
          } catch(err) {
            console.log("error", err);
          }
          process.exit(1);
        }, 30000);
      }
    }
    return;
  }

  if (current) {
    visited[current] = true;
  }

  current = seeds.shift();

  request(base + current, processPage);
}
