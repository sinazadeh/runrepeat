import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import * as cheerio from "cheerio";

const SITEMAPS = [
  "https://runrepeat.com/sitemaps/training-shoes/en-review-sitemap.xml",
  "https://runrepeat.com/sitemaps/track-spikes/en-review-sitemap.xml",
  "https://runrepeat.com/sitemaps/tennis-shoes/en-review-sitemap.xml",
  "https://runrepeat.com/sitemaps/sneakers/en-review-sitemap.xml",
  "https://runrepeat.com/sitemaps/running-shoes/en-review-sitemap.xml",
  "https://runrepeat.com/sitemaps/hiking-shoes/en-review-sitemap.xml",
  "https://runrepeat.com/sitemaps/hiking-sandals/en-review-sitemap.xml",
  "https://runrepeat.com/sitemaps/hiking-boots/en-review-sitemap.xml",
  "https://runrepeat.com/sitemaps/cross-country-shoes/en-review-sitemap.xml",
  "https://runrepeat.com/sitemaps/basketball-shoes/en-review-sitemap.xml",
];

const OUTPUT_FILE = path.resolve("./runrepeat-shoes.json");

const BRAND_MAP = {
  newbalance: "new-balance",
  asics: "asics",
  adidas: "adidas",
  nike: "nike",
  mizuno: "mizuno",
  hoka: "hoka",
  brooks: "brooks",
  puma: "puma",
  saucony: "saucony",
  reebok: "reebok",
  skechers: "skechers",
  topoathletic: "topo-athletic",
  merrell: "merrell",
  on: "on",
  underarmour: "under-armour",
  altra: "altra",
  allbirds: "allbirds",
  inov8: "inov-8",
  jordan: "jordan",
  kailas: "kailas",
  lasportiva: "la-sportiva",
  nobull: "nobull",
  nnormal: "n-normal",
  salomon: "salomon",
  scarpa: "scarpa",
  xeroshoes: "xero-shoes",
};

function normalizeBrand(brandFromURL) {
  const clean = brandFromURL.toLowerCase().replace(/[^a-z]/g, "");
  return BRAND_MAP[clean] || clean;
}

async function fetchSitemap(url) {
  console.log(`Fetching sitemap: ${url}`);
  const { data } = await axios.get(url);
  return [...data.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
}

async function fetchShoeData(url) {
  try {
    const { data } = await axios.get(url);
    const $ = cheerio.load(data);
    let rawTitle = $("#product-title h1 span").text().trim();
    rawTitle = rawTitle.replace(/\s*review$/i, "").trim();
    if (!rawTitle) return null;

    const brandMatch = url.match(/runrepeat\.com\/([^\/-]+)/);
    const brand = brandMatch ? normalizeBrand(brandMatch[1]) : "";

    const name = rawTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    return { brand, name, url, title: rawTitle };
  } catch (err) {
    console.warn(`Failed to fetch ${url}: ${err.message}`);
    return null;
  }
}

async function delay(min = 2000, max = 4000) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((res) => setTimeout(res, ms));
}

async function buildDatabase() {
  const allUrls = [];
  for (const sitemap of SITEMAPS) {
    const urls = await fetchSitemap(sitemap);
    allUrls.push(...urls);
  }

  const uniqueUrls = [...new Set(allUrls)];
  console.log(`Found ${uniqueUrls.length} unique URLs.`);

  const results = [];
  for (let i = 0; i < uniqueUrls.length; i++) {
    const url = uniqueUrls[i];
    console.log(`[${i + 1}/${uniqueUrls.length}] Fetching: ${url}`);
    const data = await fetchShoeData(url);
    if (data) results.push(data);

    await delay(); // random delay between 2–4 sec
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`Database built: ${OUTPUT_FILE} with ${results.length} entries.`);
}

buildDatabase().catch(console.error);
