// Fetches a few live RunRepeat review pages and checks that the userscript
// can still read them, so a RunRepeat redesign fails the weekly workflow
// instead of silently breaking the userscript.
import fs from "node:fs";
import { JSDOM } from "jsdom";
import { get } from "../scraper.js";
import { loadUserscript } from "../test/helpers.js";

const BRANDS = ["nike", "on", "brooks"];

const userscript = loadUserscript({ document: new JSDOM().window.document });
const database = userscript.prepareDatabase(
  JSON.parse(fs.readFileSync("runrepeat-shoes.json", "utf8"))
);

const problems = [];
for (const brand of BRANDS) {
  const shoe = database.find((entry) => entry.brand === brand);
  const page = new JSDOM(await get(shoe.url)).window.document;
  const review = userscript.parseRunRepeat(page);
  const missing = Object.entries({
    "matching title": review.title && userscript.isReviewFor(review, shoe.key),
    verdict: review.verdict.length > 50,
    score: review.score > 0,
    "per-use scores": review.subScores.length > 0,
    pros: review.pros.length > 0,
    cons: review.cons.length > 0,
  })
    .filter(([, ok]) => !ok)
    .map(([part]) => part);
  console.log(
    `${shoe.url}: ${missing.length ? `missing ${missing.join(", ")}` : "OK"}`
  );
  if (missing.length) problems.push(shoe.url);
}

if (problems.length) {
  console.error(
    "The userscript could not fully read these RunRepeat pages; " +
      "the page layout has probably changed."
  );
  process.exitCode = 1;
}
