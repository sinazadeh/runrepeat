import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
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
const REQUEST_TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 3;
// Refuse to overwrite the database if it would lose more than this share of
// its entries, which usually means RunRepeat blocked or rate-limited the run.
const MAX_SHRINK_RATIO = 0.1;
// Give up early instead of crawling for hours if every request is failing.
const MAX_CONSECUTIVE_FAILURES = 20;

// RunRepeat review URLs start with the brand, e.g. runrepeat.com/new-balance-…
// Brands with a hyphen in their slug must be listed here to be read whole.
const HYPHENATED_BRANDS = [
  "air-jordan",
  "hey-dude",
  "inov-8",
  "k-swiss",
  "la-sportiva",
  "n-normal",
  "new-balance",
  "the-north-face",
  "topo-athletic",
  "under-armour",
  "xero-shoes",
];

// Other spellings of a brand seen at the start of review URLs.
const BRAND_ALIASES = {
  heydude: "hey-dude",
  inov8: "inov-8",
  nnormal: "n-normal",
  newbalance: "new-balance",
  topo: "topo-athletic",
  underarmour: "under-armour",
  xero: "xero-shoes",
};

const http = axios.create({ timeout: REQUEST_TIMEOUT_MS });

export function detectBrand(url) {
  const slug = new URL(url).pathname.split("/")[1].toLowerCase();
  const hyphenated = HYPHENATED_BRANDS.find((brand) =>
    slug.startsWith(`${brand}-`)
  );
  if (hyphenated) return hyphenated;
  const first = slug.split("-")[0];
  return BRAND_ALIASES[first] || first;
}

// Must stay in sync with slugify() in the userscript.
export function slugify(text) {
  return text
    .toLowerCase()
    .replace(/\+/g, " plus ") // "Metaspeed Sky+" -> "metaspeed-sky-plus"
    .replace(/(\d)\s*v(\d)/g, "$1 v$2") // "1080v14" -> "1080-v14"
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

function toEntry(url, title) {
  return { brand: detectBrand(url), name: slugify(title), url, title };
}

async function get(url) {
  for (let attempt = 1; ; attempt++) {
    try {
      const { data } = await http.get(url);
      return data;
    } catch (err) {
      const status = err.response?.status;
      const retryable = !status || status === 429 || status >= 500;
      if (!retryable || attempt >= MAX_ATTEMPTS) throw err;
      console.warn(`Retrying ${url} (attempt ${attempt}): ${err.message}`);
      await delay(5000 * attempt, 10000 * attempt);
    }
  }
}

async function fetchSitemap(url) {
  console.log(`Fetching sitemap: ${url}`);
  const data = await get(url);
  return [...data.matchAll(/<loc>(.*?)<\/loc>/g)].map((m) => m[1]);
}

// Returns null for pages without a review title; throws if the page can't be
// fetched.
async function fetchShoeData(url) {
  const $ = cheerio.load(await get(url));
  const title = $("#product-title h1 span")
    .text()
    .trim()
    .replace(/\s*review$/i, "")
    .trim();
  return title ? toEntry(url, title) : null;
}

function delay(min = 2000, max = 4000) {
  const ms = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise((res) => setTimeout(res, ms));
}

function readPreviousDatabase() {
  try {
    return JSON.parse(fs.readFileSync(OUTPUT_FILE, "utf8"));
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
}

async function buildDatabase() {
  const previous = readPreviousDatabase();
  const previousByUrl = new Map(previous.map((shoe) => [shoe.url, shoe]));

  const allUrls = [];
  for (const sitemap of SITEMAPS) {
    const urls = await fetchSitemap(sitemap);
    allUrls.push(...urls);
  }

  const uniqueUrls = [...new Set(allUrls)];
  console.log(`Found ${uniqueUrls.length} unique URLs to process.`);

  const results = [];
  let failures = 0;
  let consecutiveFailures = 0;
  for (let i = 0; i < uniqueUrls.length; i++) {
    const url = uniqueUrls[i];
    console.log(`[${i + 1}/${uniqueUrls.length}] Fetching: ${url}`);
    try {
      const data = await fetchShoeData(url);
      if (data) results.push(data);
      consecutiveFailures = 0;
    } catch (err) {
      failures++;
      if (++consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        throw new Error(
          `${consecutiveFailures} requests in a row failed; giving up.`
        );
      }
      // Keep last week's entry rather than dropping the shoe over a blip,
      // unless the page is gone.
      const old = err.response?.status !== 404 && previousByUrl.get(url);
      console.warn(
        `Failed to fetch ${url}: ${err.message}` +
          (old ? " (keeping previous entry)" : "")
      );
      if (old) results.push(toEntry(url, old.title));
    }

    await delay(); // random delay between 2–4 sec
  }

  const minimum = Math.ceil(previous.length * (1 - MAX_SHRINK_RATIO));
  if (results.length < minimum) {
    throw new Error(
      `Only ${results.length} entries (previously ${previous.length}, ` +
        `${failures} failed requests); not overwriting ${OUTPUT_FILE}.`
    );
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(
    `Database built: ${OUTPUT_FILE} with ${results.length} entries ` +
      `(${failures} failed requests).`
  );
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  buildDatabase().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
