import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { parseCatalogPage } from "../scraper.js";

const PAGE_URL = "https://runrepeat.com/catalog/running-shoes";
const html = fs.readFileSync(
  new URL("./fixtures/catalog-running-shoes.html", import.meta.url),
  "utf8"
);

test("reads each shoe's review URL and title from a catalog page", () => {
  const { shoes } = parseCatalogPage(html, PAGE_URL);
  assert.deepEqual(shoes, [
    {
      url: "https://runrepeat.com/nike-vomero-plus",
      title: "Nike Vomero Plus",
    },
    { url: "https://runrepeat.com/hoka-bondi-9", title: "HOKA Bondi 9" },
    {
      url: "https://runrepeat.com/adidas-adizero-evo-sl",
      title: "adidas Adizero EVO SL",
    },
  ]);
});

test("finds the last page, ignoring other languages' catalogs", () => {
  assert.equal(parseCatalogPage(html, PAGE_URL).lastPage, 22);
});

test("a page without pagination is a single page", () => {
  assert.equal(parseCatalogPage("<html></html>", PAGE_URL).lastPage, 1);
});
