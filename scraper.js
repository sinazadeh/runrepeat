import axios from "axios";
import * as fs from "fs";
import * as path from "path";
import { pathToFileURL } from "url";
import * as cheerio from "cheerio";

const SITE = "https://runrepeat.com";
// RunRepeat's sitemaps have been broken since late 2025, so the shoe list comes
// from its catalogs, whose pages each link about 30 shoes to their reviews.
const CATALOGS = [
  "running-shoes",
  "training-shoes",
  "track-spikes",
  "tennis-shoes",
  "sneakers",
  "hiking-shoes",
  "hiking-sandals",
  "hiking-boots",
  "cross-country-shoes",
  "basketball-shoes",
].map((category) => `${SITE}/catalog/${category}`);

const OUTPUT_FILE = path.resolve("./runrepeat-shoes.json");
const REQUEST_TIMEOUT_MS = 30000;
const MAX_ATTEMPTS = 3;
// Refuse to overwrite the database if it would lose more than this share of
// its entries, which usually means RunRepeat changed or blocked something.
const MAX_SHRINK_RATIO = 0.1;

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

export async function get(url) {
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

// Returns the shoes listed on one catalog page and the highest page number
// it links to.
export function parseCatalogPage(html, pageUrl) {
  const $ = cheerio.load(html);
  const shoes = $("li.product_list .product-name a")
    .map((_, a) => ({
      url: new URL($(a).attr("href"), SITE).href,
      title: $(a).text().replace(/\s+/g, " ").trim(),
    }))
    .get()
    .filter((shoe) => shoe.title);

  const { pathname } = new URL(pageUrl);
  const pages = $("a[href*='page=']")
    .map((_, a) => new URL($(a).attr("href"), pageUrl))
    .get()
    .filter((link) => link.pathname === pathname) // not other languages
    .map((link) => Number(link.searchParams.get("page")) || 1);
  return { shoes, lastPage: Math.max(1, ...pages) };
}

async function fetchCatalog(catalogUrl) {
  const shoes = [];
  for (let page = 1, lastPage = 1; page <= lastPage; page++) {
    const pageUrl = page === 1 ? catalogUrl : `${catalogUrl}?page=${page}`;
    console.log(`Fetching ${pageUrl}`);
    const result = parseCatalogPage(await get(pageUrl), pageUrl);
    if (!result.shoes.length) {
      throw new Error(`No shoes on ${pageUrl}; did the catalog layout change?`);
    }
    shoes.push(...result.shoes);
    lastPage = Math.max(lastPage, result.lastPage);
    await delay(); // random delay between 2–4 sec
  }
  return shoes;
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

  const byUrl = new Map();
  for (const catalog of CATALOGS) {
    for (const { url, title } of await fetchCatalog(catalog)) {
      if (!byUrl.has(url)) byUrl.set(url, toEntry(url, title));
    }
  }
  // Sorted so the weekly diff shows real changes, not catalog reshuffles.
  const results = [...byUrl.values()].sort((a, b) =>
    a.url.localeCompare(b.url)
  );

  const minimum = Math.ceil(previous.length * (1 - MAX_SHRINK_RATIO));
  if (results.length < minimum) {
    throw new Error(
      `Only ${results.length} entries (previously ${previous.length}); ` +
        `not overwriting ${OUTPUT_FILE}.`
    );
  }

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  console.log(`Database built: ${OUTPUT_FILE} with ${results.length} entries.`);
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  buildDatabase().catch((err) => {
    console.error(err);
    process.exitCode = 1;
  });
}
