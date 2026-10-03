import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { detectBrand, slugify as scraperSlugify } from "../scraper.js";
import { loadUserscript } from "./helpers.js";

const userscript = loadUserscript();
const shoes = JSON.parse(
  fs.readFileSync(new URL("../runrepeat-shoes.json", import.meta.url), "utf8")
);
const database = userscript.prepareDatabase(shoes);

// The product name as a shop would show it: the title minus the brand,
// e.g. "New Balance FuelCell Rebel v5" -> "FuelCell Rebel v5".
function withoutBrand(shoe) {
  const words = shoe.title.split(/\s+/);
  const brandWords = shoe.brand.split("-").length;
  const prefix = words.slice(0, brandWords).join(" ");
  return userscript.slugify(prefix) === shoe.brand
    ? words.slice(brandWords).join(" ")
    : null;
}

test("slugify normalizes punctuation, '+' and version suffixes", () => {
  const { slugify } = userscript;
  assert.equal(slugify("ASICS Metaspeed Sky+"), "asics-metaspeed-sky-plus");
  assert.equal(slugify("Nike G.T. Cut 3"), "nike-g-t-cut-3");
  assert.equal(slugify("On Cloudflow 3.0"), "on-cloudflow-3-0");
  assert.equal(slugify("Fresh Foam X 1080v14"), "fresh-foam-x-1080-v14");
  assert.equal(slugify("Fresh Foam X 1080 v14"), "fresh-foam-x-1080-v14");
});

test("productKey drops gender prefixes and shoe-type suffixes", () => {
  const { productKey } = userscript;
  assert.equal(productKey("Men's Endorphin Speed 4"), "endorphin-speed-4");
  assert.equal(productKey("Women’s Lone Peak 9"), "lone-peak-9");
  assert.equal(productKey("Ultraboost 5 Running Shoes"), "ultraboost-5");
  assert.equal(productKey("  Speedgoat 6 Running Shoe "), "speedgoat-6");
  assert.equal(productKey("Endorphin Trail Running Shoes"), "endorphin-trail");
});

test("scraper and userscript slugify agree on every database title", () => {
  for (const shoe of shoes) {
    assert.equal(scraperSlugify(shoe.title), userscript.slugify(shoe.title));
  }
});

test("no two shoes of the same brand share a product key", () => {
  const seen = new Map();
  for (const shoe of database) {
    const id = `${shoe.brand}/${shoe.key}`;
    assert.ok(!seen.has(id), `${shoe.url} collides with ${seen.get(id)}`);
    seen.set(id, shoe.url);
  }
});

for (const [host, config] of Object.entries(userscript.siteConfigs)) {
  test(`every ${host} shoe in the database can be matched`, () => {
    const siteShoes = database.filter((shoe) =>
      config.brands.includes(shoe.brand)
    );
    assert.ok(siteShoes.length > 0, `no shoes for ${config.brands}`);

    for (const shoe of siteShoes) {
      const model = withoutBrand(shoe);
      const shownTitles = [shoe.title];
      if (model) shownTitles.push(model, `Men's ${model} Running Shoes`);

      for (const title of shownTitles) {
        const key = userscript.productKey(title);
        const match = userscript.findMatchingShoe(database, config.brands, key);
        assert.equal(match?.url, shoe.url, `"${title}" on ${host}`);
      }
    }
  });
}

test("guessed URLs add the brand only when it is missing", () => {
  const { guessRunRepeatUrls } = userscript;
  assert.deepEqual(
    [...guessRunRepeatUrls(["altra"], "lone-peak-9")],
    [
      "https://runrepeat.com/altra-lone-peak-9",
      "https://runrepeat.com/altra-lone-peak-9-shoes",
    ]
  );
  assert.equal(
    guessRunRepeatUrls(["nike", "jordan"], "jordan-luka-3")[0],
    "https://runrepeat.com/jordan-luka-3"
  );
});

test("detectBrand reads whole hyphenated brands and aliases", () => {
  const brandOf = (slug) => detectBrand(`https://runrepeat.com/${slug}`);
  assert.equal(brandOf("new-balance-fresh-foam-x-1080-v14"), "new-balance");
  assert.equal(brandOf("under-armour-hovr-machina-3"), "under-armour");
  assert.equal(brandOf("air-jordan-1-low"), "air-jordan");
  assert.equal(brandOf("topo-athletic-atmos"), "topo-athletic");
  assert.equal(brandOf("topo-ultraventure-4"), "topo-athletic");
  assert.equal(brandOf("inov8-trailfly"), "inov-8");
  assert.equal(brandOf("nike-pegasus-41"), "nike");
  assert.equal(brandOf("on-cloudmonster-2"), "on");
});
