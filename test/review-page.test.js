import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { JSDOM } from "jsdom";
import { loadUserscript } from "./helpers.js";

const { document } = new JSDOM().window;
const userscript = loadUserscript({ document });

// Fixtures are trimmed copies of real RunRepeat review pages.
function parseFixture(slug) {
  const file = new URL(`./fixtures/${slug}.html`, import.meta.url);
  const page = new JSDOM(fs.readFileSync(file, "utf8")).window.document;
  return userscript.parseRunRepeat(page);
}

// Plain copies, since objects created inside the sandbox fail strict
// deep-equality against objects created here.
const plain = (value) => JSON.parse(JSON.stringify(value));

test("parses the product title without the trailing 'review'", () => {
  assert.equal(parseFixture("on-cloudmonster-3").title, "On Cloudmonster 3");
});

test("rejects a page about a different shoe, e.g. after a redirect", () => {
  // runrepeat.com/nike-quest-4 redirects to the Quest 6 review.
  const review = parseFixture("nike-quest-6");
  assert.equal(userscript.isReviewFor(review, "nike-quest-6"), true);
  assert.equal(userscript.isReviewFor(review, "nike-quest-4"), false);
  assert.equal(userscript.isReviewFor({ title: "" }, "nike-quest-4"), true);
});

test("parses the verdict, not the score widget before it", () => {
  const review = parseFixture("on-cloudmonster-3");
  assert.match(review.verdict, /^The Cloudmonster 3 holds onto what defines/);
  assert.doesNotMatch(review.verdict, /Daily running|Tempo/);
});

test("parses the overall score and the per-use scores", () => {
  const review = parseFixture("on-cloudmonster-3");
  assert.equal(review.score, 82);
  assert.equal(review.scoreText, "Great");
  assert.equal(review.scoreTone, "green");
  assert.deepEqual(plain(review.subScores), [
    { name: "Daily running", value: "84", tone: "green" },
    { name: "Tempo", value: "42", tone: "red" },
    { name: "Race", value: "29", tone: "red" },
    { name: "Stability", value: "82", tone: "green" },
  ]);
});

test("parses pros, cons and awards", () => {
  const review = parseFixture("on-cloudmonster-3");
  assert.equal(review.pros[0], "Updated three-layer CloudTec system");
  assert.equal(review.pros.length, 9);
  assert.equal(review.cons.length, 4);
  assert.deepEqual(plain(review.awards), [
    "Top 13% most popular running shoes",
  ]);
});

test("every fixture yields a complete review", () => {
  for (const file of fs.readdirSync(new URL("./fixtures/", import.meta.url))) {
    const review = parseFixture(file.replace(/\.html$/, ""));
    assert.ok(review.verdict.length > 50, `${file}: verdict`);
    assert.ok(review.score > 0, `${file}: score`);
    assert.match(review.scoreText, /^(Superb|Great|Good|Decent|Bad)$/);
    assert.ok(review.subScores.length >= 3, `${file}: per-use scores`);
    assert.ok(review.pros.length && review.cons.length, `${file}: pros/cons`);
  }
});

test("pages without awards parse with an empty list", () => {
  assert.deepEqual(plain(parseFixture("brooks-launch-10").awards), []);
});

test("renders scores and awards, and never parses review text as HTML", () => {
  const review = parseFixture("on-cloudmonster-3");
  review.pros.push('<img src=x onerror="alert(1)">');
  review.url = "https://runrepeat.com/on-cloudmonster-3";

  const section = userscript.createRunRepeatSection(review);
  const text = section.textContent;
  for (const expected of ["82", "Great", "Daily running84", "Top 13%"]) {
    assert.ok(text.includes(expected), `missing "${expected}"`);
  }
  assert.ok(text.includes('<img src=x onerror="alert(1)">'));
  assert.equal(section.querySelectorAll("img").length, 0);
  assert.equal(
    section.querySelector("a").href,
    "https://runrepeat.com/on-cloudmonster-3"
  );
});
