// ==UserScript==
// @name         RunRepeat Review Summaries on Shoe Sites
// @namespace    https://github.com/sinazadeh/runrepeat
// @version      1.3.3
// @description  Injects RunRepeat reviews onto product pages of major shoe brands.
// @author       TheSina
// @match        https://www.nike.com/*
// @match        https://www.adidas.com/*
// @match        https://www.newbalance.com/*
// @match        https://www.asics.com/*
// @match        https://www.brooksrunning.com/*
// @match        https://www.hoka.com/*
// @match        https://www.saucony.com/*
// @match        https://www.altrarunning.com/*
// @match        https://www.on.com/*
// @grant        GM_xmlhttpRequest
// @connect      runrepeat.com
// @connect      raw.githubusercontent.com
// @noframes
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/sinazadeh/runrepeat/refs/heads/main/RunRepeat_Review_Summaries_on_Shoe_Sites.user.js
// @updateURL    https://raw.githubusercontent.com/sinazadeh/runrepeat/refs/heads/main/RunRepeat_Review_Summaries_on_Shoe_Sites.meta.js
// ==/UserScript==
/* jshint esversion: 11 */
(function () {
  "use strict";

  const DATABASE_URL =
    "https://raw.githubusercontent.com/sinazadeh/runrepeat/refs/heads/main/runrepeat-shoes.json";
  const REQUEST_TIMEOUT_MS = 15000;
  // Give up if the page removes the review this many times in quick succession.
  const MAX_REINJECTIONS = 5;
  // A review that stayed on the page this long was removed by a normal
  // re-render (e.g. picking a colour), not by a loop fighting with the page.
  const STABLE_INJECTION_MS = 5000;
  // "Trail" is left alone: it is often part of the model name ("Endorphin Trail").
  const SHOE_SUFFIX =
    /-(?:running-|training-|golf-|basketball-|tennis-|walking-|hiking-)?shoes?$/;
  // Shop stylesheets often restyle headings (fonts, uppercase); undo that.
  const HEADING_RESET =
    "font-family:inherit; text-transform:none; letter-spacing:normal; line-height:1.3;";
  // Colours for RunRepeat's score_* classes (e.g. "score_light_green").
  const SCORE_TONE_COLORS = {
    green: "#098040",
    light_green: "#54cb62",
    yellow: "#ffb717",
    red: "#eb1c24",
  };

  // brands: RunRepeat brand slugs (as stored in the database) sold on the site.
  // titleSelector: element holding the product name.
  // getTitle: optional, extracts the product name from that element.
  // injectionTarget: the review is inserted right after this element.
  const siteConfigs = {
    "www.adidas.com": {
      brands: ["adidas"],
      titleSelector: 'h1[data-testid="product-title"]',
      injectionTarget: '[data-testid="buy-section"], .product-description',
    },
    "www.brooksrunning.com": {
      brands: ["brooks"],
      titleSelector: "h1.m-buy-box-header__name",
      injectionTarget: ".m-buy-box .js-pdp-add-cart-btn",
    },
    "www.hoka.com": {
      brands: ["hoka"],
      titleSelector: 'h1[data-qa="productName"]',
      injectionTarget: "div.product-primary-attributes",
    },
    "www.on.com": {
      brands: ["on"],
      titleSelector: 'h1[data-test-id="productNameTitle"]',
      // Ignore the extra labels the heading wraps in <span>s.
      getTitle: (el) => {
        const clone = el.cloneNode(true);
        clone.querySelectorAll("span").forEach((span) => span.remove());
        return clone.textContent;
      },
      injectionTarget: '[data-test-id="cartButton"]',
    },
    "www.newbalance.com": {
      brands: ["new-balance"],
      titleSelector: "#productDetails h1, h1.product-name",
      injectionTarget: ".prices-add-to-cart-actions",
    },
    "www.asics.com": {
      brands: ["asics"],
      titleSelector: "h1.pdp-top__product-name__not-ot",
      injectionTarget: ".pdp-top__cta.product-add-to-cart",
    },
    "www.nike.com": {
      brands: ["nike", "nikecourt", "jordan", "air-jordan"],
      titleSelector: "#pdp_product_title",
      injectionTarget: '[data-testid="atb-button"]',
    },
    "www.saucony.com": {
      brands: ["saucony"],
      titleSelector: "h1.product-name-v2",
      injectionTarget: ".add-to-cart-container",
    },
    "www.altrarunning.com": {
      brands: ["altra"],
      titleSelector: ".main-product-standard__block--product-title h1",
      injectionTarget:
        ".main-product-standard .main-product-standard__add-to-cart",
    },
  };

  // Must stay in sync with slugify() in scraper.js.
  function slugify(text) {
    return text
      .toLowerCase()
      .replace(/\+/g, " plus ") // "Metaspeed Sky+" -> "metaspeed-sky-plus"
      .replace(/(\d)\s*v(\d)/g, "$1 v$2") // "1080v14" -> "1080-v14"
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");
  }

  // Turns a product name from a shop page or the database into the key used
  // for matching, e.g. "Men's Fresh Foam X 1080v14 Running Shoes" ->
  // "fresh-foam-x-1080-v14".
  function productKey(title) {
    const name = title.trim().replace(/^(?:men|women)['’]?s\s+/i, "");
    return slugify(name).replace(SHOE_SUFFIX, "");
  }

  function prepareDatabase(shoes) {
    return shoes.map((shoe) => ({ ...shoe, key: productKey(shoe.title) }));
  }

  // Shop pages may or may not include the brand in the product name, so try
  // the key as-is and with each of the site's brands in front of it.
  function findMatchingShoe(database, brands, key) {
    const candidates = [key, ...brands.map((brand) => `${brand}-${key}`)];
    for (const candidate of candidates) {
      const match = database.find(
        (shoe) => shoe.key === candidate && brands.includes(shoe.brand)
      );
      if (match) return match;
    }
    return null;
  }

  // RunRepeat redirects some retired models to their successor (e.g.
  // nike-quest-4 -> nike-quest-6), so check the page is about the shoe we
  // asked for. Pages without a readable title are given the benefit of the
  // doubt.
  function isReviewFor(review, key) {
    return !review.title || productKey(review.title) === key;
  }

  // Fallback for shoes added to RunRepeat since the database was last built.
  function guessRunRepeatUrls(brands, key) {
    const hasBrand = brands.some((brand) => key.startsWith(`${brand}-`));
    const slug = hasBrand ? key : `${brands[0]}-${key}`;
    return [
      `https://runrepeat.com/${slug}`,
      `https://runrepeat.com/${slug}-shoes`,
    ];
  }

  // Reads a RunRepeat review page. "#product-intro" holds the score widget
  // (overall score plus per-use scores) followed by the verdict text.
  function parseRunRepeat(doc) {
    const text = (node) => node?.textContent.replace(/\s+/g, " ").trim() || "";
    const tone = (node) =>
      [...(node?.classList || [])]
        .find((name) => name.startsWith("score_"))
        ?.slice("score_".length) || "";
    const intro = doc.querySelector("#product-intro");
    const scoreBox = intro?.querySelector(".our-score__box");
    return {
      title: text(doc.querySelector("#product-title h1")).replace(
        /\s*review$/i,
        ""
      ),
      verdict: text(intro?.querySelector(".our-score + div")),
      score:
        parseInt(text(scoreBox?.querySelector(".our-score__value")), 10) || 0,
      scoreText: text(scoreBox?.querySelector(".our-score__label")),
      scoreTone: tone(scoreBox),
      subScores: [...(intro?.querySelectorAll(".our-score__sub") || [])]
        .map((sub) => {
          const value = sub.querySelector(".our-score__sub-value");
          return {
            name: text(sub.querySelector(".our-score__sub-name")),
            value: text(value),
            tone: tone(value),
          };
        })
        .filter((sub) => sub.name && sub.value),
      pros: [...doc.querySelectorAll("#the_good ul li")].map(text),
      cons: [...doc.querySelectorAll("#the_bad ul li")].map(text),
      awards: [...doc.querySelectorAll("#awards_section .awards-list li")].map(
        text
      ),
    };
  }

  // Creates an element with inline styles. Strings become text nodes, so
  // review text is never parsed as HTML.
  function el(tag, style, ...children) {
    const node = document.createElement(tag);
    if (style) node.style.cssText = style;
    node.append(...children.filter(Boolean));
    return node;
  }

  function toneColor(tone) {
    return SCORE_TONE_COLORS[tone] || "#6c757d";
  }

  function createRunRepeatSection(data) {
    const scoreColor = toneColor(data.scoreTone);
    const scoreBadge =
      data.score > 0 &&
      el(
        "div",
        `display:flex; align-items:center; gap:8px; flex-shrink:0; background:white; padding:8px 16px; border-radius:20px; border:2px solid ${scoreColor};`,
        el(
          "div",
          `font-size:24px; font-weight:bold; color:${scoreColor}; line-height:1;`,
          String(data.score)
        ),
        el(
          "div",
          `font-size:12px; font-weight:600; color:${scoreColor}; text-transform:uppercase;`,
          data.scoreText
        )
      );

    const link = el(
      "a",
      "color:#007bff; text-decoration:none; font-size:14px; font-weight:500;",
      "Read the complete review on RunRepeat →"
    );
    link.href = data.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";

    const section = el(
      "div",
      `border:1px solid #e0e0e0; border-radius:8px; padding:20px; margin:20px 0; background:#fdfdfd; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;`,
      el(
        "div",
        "display:flex; flex-wrap:wrap; align-items:center; justify-content:space-between; gap:12px; margin-bottom:20px; padding-bottom:12px; border-bottom:2px solid #eee;",
        renderHeading(data.title),
        scoreBadge
      ),
      renderSubScores(data.subScores),
      renderAwards(data.awards),
      el(
        "div",
        "margin-bottom:20px;",
        el(
          "h4",
          `${HEADING_RESET} margin:0 0 10px 0; font-size:18px; color:#111; font-weight:600;`,
          "Expert Verdict"
        ),
        el(
          "div",
          "background:white; padding:16px; border-radius:6px; border-left:4px solid #007bff; font-size:16px; line-height:1.6; color:#333; box-shadow:0 1px 3px rgba(0,0,0,0.05);",
          data.verdict || "No verdict available."
        )
      ),
      buildListSection("👍 What's Great", data.pros, "#28a745", "✔"),
      buildListSection("👎 Consider This", data.cons, "#dc3545", "✘"),
      el(
        "div",
        "text-align:center; padding-top:20px; margin-top:20px; border-top:1px solid #eee;",
        link
      )
    );
    section.className = "runrepeat-section";
    return section;
  }

  // The shoe's name as RunRepeat titles it (so it's easy to confirm the
  // review is for the right shoe), above "RunRepeat Expert Review".
  function renderHeading(title) {
    const headingStyle = `${HEADING_RESET} margin:0; font-size:20px; font-weight:600; color:#111;`;
    return el(
      "div",
      "display:flex; flex-direction:column; gap:8px; min-width:0;",
      title && el("h3", headingStyle, title),
      el(
        "div",
        "display:flex; align-items:center; gap:12px; white-space:nowrap;",
        el(
          "div",
          "background:#000; color:white; padding:6px 12px; border-radius:4px; font-weight:bold; font-size:14px;",
          "RunRepeat"
        ),
        title
          ? el(
              "span",
              "font-size:16px; font-weight:500; color:#555;",
              "Expert Review"
            )
          : el("h3", headingStyle, "Expert Review")
      )
    );
  }

  // Per-use scores, e.g. "Daily running 84", "Tempo 42".
  function renderSubScores(subScores) {
    if (!subScores?.length) return null;
    return el(
      "div",
      "display:flex; flex-wrap:wrap; gap:8px; margin-bottom:20px;",
      ...subScores.map((sub) =>
        el(
          "span",
          "display:inline-flex; align-items:center; gap:6px; background:white; font-size:13px; color:#333; padding:6px 12px; border-radius:15px; border:1px solid #e0e0e0;",
          sub.name,
          el("strong", `color:${toneColor(sub.tone)};`, sub.value)
        )
      )
    );
  }

  function renderAwards(awards) {
    if (!awards?.length) return null;
    return el(
      "div",
      "margin-bottom:20px;",
      el(
        "h4",
        `${HEADING_RESET} margin:0 0 10px 0; font-size:14px; color:#555; text-transform:uppercase; letter-spacing:0.5px; font-weight:600;`,
        "Awards & Recognition"
      ),
      el(
        "div",
        "display:flex; flex-wrap:wrap; gap:8px;",
        ...awards.map((award) =>
          el(
            "span",
            "background:#fff8e1; color:#6d4c41; font-size:13px; font-weight:500; padding:6px 12px; border-radius:15px; border:1px solid #ffecb3;",
            `🏆 ${award}`
          )
        )
      )
    );
  }

  function buildListSection(title, items, color, icon) {
    if (!items?.length) return null;
    return el(
      "div",
      `background:white; padding:20px; border-radius:8px; border-top:4px solid ${color}; box-shadow:0 2px 4px rgba(0,0,0,0.05); margin-bottom:16px;`,
      el(
        "h4",
        `${HEADING_RESET} margin:0 0 16px 0; font-size:16px; color:${color}; font-weight:600;`,
        title
      ),
      el(
        "ul",
        "margin:0; padding:0; list-style:none; color:#333;",
        ...items.map((item) =>
          el(
            "li",
            "font-size:14px; line-height:1.5; margin-bottom:10px; padding-left:20px; position:relative;",
            el(
              "span",
              `position:absolute; left:0; top:1px; color:${color};`,
              icon
            ),
            item
          )
        )
      )
    );
  }

  // Outside a userscript manager (i.e. in the tests), expose the helpers
  // above instead of running.
  if (typeof GM_xmlhttpRequest === "undefined") {
    if (typeof module === "object") {
      module.exports = {
        siteConfigs,
        slugify,
        productKey,
        prepareDatabase,
        findMatchingShoe,
        guessRunRepeatUrls,
        isReviewFor,
        parseRunRepeat,
        createRunRepeatSection,
      };
    }
    return;
  }

  const config = siteConfigs[location.hostname];
  if (!config) return;

  const log = (...args) => console.log("[RunRepeat]", ...args);

  // Review lookups for this page session, keyed by product key. Holds
  // promises so a product is only looked up once, e.g. across colourways.
  const reviewCache = new Map();
  let databasePromise = null;
  let state = newState(null);
  let runTimer = null;

  function newState(key) {
    // status: idle -> loading -> ready | none, or stopped after too many
    // re-injections.
    return {
      key,
      status: "idle",
      review: null,
      section: null,
      injections: 0,
      injectedAt: 0,
    };
  }

  function request(url) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        timeout: REQUEST_TIMEOUT_MS,
        onload: (res) => resolve(res.status === 200 ? res.responseText : null),
        onerror: () => resolve(null),
        ontimeout: () => resolve(null),
      });
    });
  }

  function loadShoeDatabase() {
    if (!databasePromise) {
      databasePromise = request(DATABASE_URL)
        .then((text) => {
          if (!text) throw new Error("request failed");
          return prepareDatabase(JSON.parse(text));
        })
        .catch((error) => {
          console.error("[RunRepeat] Could not load shoe database:", error);
          return [];
        });
    }
    return databasePromise;
  }

  async function fetchReview(url) {
    const html = await request(url);
    if (!html) return null;
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (!doc.querySelector("#product-intro")) return null;
    return { ...parseRunRepeat(doc), url };
  }

  async function lookupReview(key) {
    const database = await loadShoeDatabase();
    const shoe = findMatchingShoe(database, config.brands, key);
    if (shoe) {
      log("Matched in database:", shoe.url);
      const review = await fetchReviewFor(shoe.url, shoe.key);
      if (review) return review;
    }
    // Also covers database entries whose RunRepeat page has since moved.
    const urls = guessRunRepeatUrls(config.brands, key).filter(
      (url) => url !== shoe?.url
    );
    log(`Trying RunRepeat URLs for "${key}":`, urls);
    const pages = await Promise.all(
      urls.map((url) => fetchReviewFor(url, productKey(new URL(url).pathname)))
    );
    return pages.find(Boolean) || null;
  }

  async function fetchReviewFor(url, key) {
    const review = await fetchReview(url);
    if (review && !isReviewFor(review, key)) {
      log(`${url} is about "${review.title}", not "${key}"; skipping it.`);
      return null;
    }
    return review;
  }

  function readProductKey() {
    const titleEl = document.querySelector(config.titleSelector);
    if (!titleEl) return null;
    const title = config.getTitle
      ? config.getTitle(titleEl)
      : titleEl.textContent;
    return productKey(title) || null;
  }

  async function run() {
    const key = readProductKey();
    if (!key) return; // Not a product page, or the title hasn't rendered yet.

    if (key !== state.key) {
      state.section?.remove();
      state = newState(key);
    }

    if (state.status === "idle") {
      state.status = "loading";
      const current = state;
      if (!reviewCache.has(key)) {
        reviewCache.set(
          key,
          lookupReview(key).catch((error) => {
            console.error("[RunRepeat] Lookup failed:", error);
            return null;
          })
        );
      }
      const review = await reviewCache.get(key);
      if (state !== current) return; // Moved on to another product meanwhile.
      state.review = review;
      state.status = review ? "ready" : "none";
      if (!review) log(`No RunRepeat review found for "${key}".`);
    }

    if (state.status === "ready" && readProductKey() === state.key) inject();
  }

  function inject() {
    if (state.section?.isConnected) return;
    const target = document.querySelector(config.injectionTarget);
    if (!target) return; // The observer retries once it appears.

    if (Date.now() - state.injectedAt > STABLE_INJECTION_MS) {
      state.injections = 0;
    }
    if (state.injections >= MAX_REINJECTIONS) {
      state.status = "stopped";
      log("The page keeps removing the review section; giving up.");
      return;
    }

    state.injections++;
    state.injectedAt = Date.now();
    state.section = createRunRepeatSection(state.review);
    target.after(state.section);
    log("Review section injected for", state.review.url);
  }

  // Runs at most once every 400 ms, however often the page changes.
  // Client-side navigation always changes the DOM, so this also picks up
  // new product pages.
  function scheduleRun() {
    if (runTimer) return;
    runTimer = setTimeout(() => {
      runTimer = null;
      run();
    }, 400);
  }

  new MutationObserver(scheduleRun).observe(document.body, {
    childList: true,
    subtree: true,
  });
  run();
})();
