// ==UserScript==
// @name         RunRepeat Review Summaries on Shoe Sites
// @namespace    https://github.com/sinazadeh/userscripts
// @version      1.1.6
// @description  Injects RunRepeat reviews onto product pages of major shoe brands.
// @author       You
// @match        https://www.adidas.com/*
// @match        https://www.brooksrunning.com/*
// @match        https://www.hoka.com/*
// @match        https://www.on.com/*
// @match        https://www.newbalance.com/*
// @match        https://www.asics.com/*
// @grant        GM_xmlhttpRequest
// @connect      runrepeat.com
// @license      MIT
// ==/UserScript==
/* jshint esversion: 11 */
(function () {
  "use strict";

  let reviewData = null;
  let currentSlug = null;
  let currentConfig = null;
  let isFetching = false;
  let hasFailed = false;
  let lastUrl = location.href;
  let shoeDatabase = null;

  const siteConfigs = {
    "www.adidas.com": {
      brand: "adidas",
      getSlug: () => {
        const el = document.querySelector('h1[data-testid="product-title"]');
        if (!el) return null;
        let productName = el.textContent
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "-")
          .replace(/[^a-z0-9-]/g, ""); // Remove special characters
        productName = productName.replace(
          /-(training|golf|running|basketball)?-shoes$/,
          ""
        ); // Remove specific suffixes
        return `adidas-${productName}`; // Prepend the brand name to the slug
      },
      injectionTarget: '[data-testid="buy-section"], .product-description',
      injectionMethod: "after",
    },
    "www.brooksrunning.com": {
      brand: "brooks",
      getSlug: () =>
        document
          .querySelector("h1.m-buy-box-header__name")
          ?.textContent.trim()
          .toLowerCase()
          .replace(/\s+/g, "-") || null,
      injectionTarget: ".m-buy-box .js-pdp-add-cart-btn",
      injectionMethod: "after",
    },
    "www.hoka.com": {
      brand: "hoka",
      getSlug: () =>
        document
          .querySelector('h1[data-qa="productName"]')
          ?.textContent.trim()
          .toLowerCase()
          .replace(/\s+/g, "-") || null,
      injectionTarget: "div.product-primary-attributes",
      injectionMethod: "after",
    },
    "www.on.com": {
      brand: "on",
      getSlug: () => {
        const el = document.querySelector(
          'h1[data-test-id="productNameTitle"]'
        );
        if (!el) return null;
        const clone = el.cloneNode(true);
        clone.querySelectorAll("span").forEach((span) => span.remove());
        const productName = clone.textContent
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "-");
        return `on-${productName}`; // Prepend the brand name to the slug
      },
      injectionTarget: '[data-test-id="cartButton"]',
      injectionMethod: "after",
    },
    "www.newbalance.com": {
      brand: "new-balance",
      getSlug: () => {
        const el = document.querySelector(
          "#productDetails h1, h1.product-name"
        );
        if (!el) return null;
        let txt = el.textContent.trim();
        txt = txt
          .replace(/(\d)(v\d+)/gi, "$1 $2")
          .replace(/([a-z])([A-Z])/g, "$1 $2");
        return txt.toLowerCase().replace(/\s+/g, "-");
      },
      injectionTarget: ".prices-add-to-cart-actions",
      injectionMethod: "after",
    },
    "www.asics.com": {
      brand: "asics",
      getSlug: () =>
        document
          .querySelector("h1.pdp-top__product-name__not-ot")
          ?.textContent.trim()
          .toLowerCase()
          .replace(/\s+/g, "-") || null,
      injectionTarget: ".pdp-top__cta.product-add-to-cart",
      injectionMethod: "after",
    },
  };

  function generateRunRepeatURLs(slug, brand) {
    if (!slug) return [];
    const cleanSlug = slug.replace(/-shoes$/, "");
    const baseSlug = slug.startsWith(`${brand}-`)
      ? cleanSlug
      : `${brand}-${cleanSlug}`; // Avoid double brand name
    return [
      `https://runrepeat.com/${baseSlug}`,
      `https://runrepeat.com/${baseSlug}-shoes`,
    ];
  }

  function fetchAndParseRunRepeat(url) {
    return new Promise((resolve) => {
      GM_xmlhttpRequest({
        method: "GET",
        url,
        onload: (res) => {
          if (res.status !== 200) return resolve(null);
          const doc = new DOMParser().parseFromString(
            res.responseText,
            "text/html"
          );
          if (!doc.querySelector("#product-intro")) return resolve(null);
          resolve({ ...parseRunRepeat(doc), url });
        },
        onerror: () => resolve(null),
      });
    });
  }

  function findMatchingShoe(brand, slug) {
    if (!shoeDatabase) return null;
    console.log("[RunRepeat] Searching for slug:", slug);
    const match = shoeDatabase.find((shoe) => {
      return shoe.brand === brand && shoe.name === slug;
    });
    if (match) {
      console.log("[RunRepeat] Found match in database for slug:", slug);
    } else {
      console.log("[RunRepeat] No match found in database for slug:", slug);
    }
    return match;
  }

  async function findValidRunRepeatPage(slug, brand) {
    const urls = generateRunRepeatURLs(slug, brand);
    console.log("[RunRepeat] Trying to match URLs:", urls);
    const results = await Promise.all(urls.map(fetchAndParseRunRepeat));
    const validPage = results.find(Boolean);
    if (validPage) {
      console.log(
        "[RunRepeat] Found valid RunRepeat page for URL:",
        validPage.url
      );
    } else {
      console.log("[RunRepeat] No valid RunRepeat page found for URLs:", urls);
    }
    return validPage || null;
  }

  function parseRunRepeat(doc) {
    const q = (sel) => doc.querySelector(sel)?.textContent.trim() || "";
    const scoreEl = doc.querySelector(
      "#audience_verdict #corescore .corescore-big__score"
    );
    return {
      verdict: q("#product-intro .product-intro-verdict + div"),
      pros: [...doc.querySelectorAll("#the_good ul li")].map((li) =>
        li.textContent.trim()
      ),
      cons: [...doc.querySelectorAll("#the_bad ul li")].map((li) =>
        li.textContent.trim()
      ),
      audienceScore: parseInt(scoreEl?.textContent.trim() || "0", 10),
      scoreText: q("#audience_verdict .corescore-big__text"),
      awards: [
        ...doc.querySelectorAll(
          "#product-intro ul.awards-list li, #audience_verdict ul.awards-list li"
        ),
      ].map((li) => li.textContent.replace(/\s+/g, " ").trim()),
    };
  }

  function createRunRepeatSection(data) {
    const scoreColorMap = {
      superb: "#098040",
      great: "#098040",
      good: "#54cb62",
      decent: "#ffb717",
      bad: "#eb1c24",
    };
    const scoreKey = (data.scoreText || "").replace("!", "").toLowerCase();
    const scoreColor = scoreColorMap[scoreKey] || "#6c757d";

    const section = document.createElement("div");
    section.className = "runrepeat-section";
    section.style.cssText = `border:1px solid #e0e0e0; border-radius:8px; padding:20px; margin:20px 0; background:#fdfdfd; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;`;
    section.innerHTML = `
            <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:20px; padding-bottom:12px; border-bottom:2px solid #eee;">
                <div style="display:flex; align-items:center; gap:12px;">
                    <div style="background:#000; color:white; padding:6px 12px; border-radius:4px; font-weight:bold; font-size:14px;">RunRepeat</div>
                    <h3 style="margin:0; font-size:20px; font-weight:600; color:#111;">Expert Review</h3>
                </div>
                ${data.audienceScore ? `<div style="display:flex; align-items:center; gap:8px; background:white; padding:8px 16px; border-radius:20px; border:2px solid ${scoreColor};"><div style="font-size:24px; font-weight:bold; color:${scoreColor}; line-height:1;">${data.audienceScore}</div><div style="font-size:12px; font-weight:600; color:${scoreColor}; text-transform:uppercase;">${data.scoreText || ""}</div></div>` : ""}
            </div>
            ${renderAwards(data.awards)}
            <div style="margin-bottom:20px;"><h4 style="margin:0 0 10px 0; font-size:18px; color:#111; font-weight:600;">Expert Verdict</h4><div style="background:white; padding:16px; border-radius:6px; border-left:4px solid #007bff; font-size:16px; line-height:1.6; color:#333; box-shadow:0 1px 3px rgba(0,0,0,0.05);">${data.verdict || "No verdict available."}</div></div>
            ${buildListSection("👍 What's Great", data.pros, "#28a745")}
            ${buildListSection("👎 Consider This", data.cons, "#dc3545")}
            <div style="text-align:center; padding-top:20px; margin-top:20px; border-top:1px solid #eee;"><a href="${data.url}" target="_blank" style="color:#007bff; text-decoration:none; font-size:14px; font-weight:500;">Read the complete review on RunRepeat →</a></div>`;
    return section;
  }

  function renderAwards(awards) {
    if (!awards?.length) return "";
    return `<div style="margin-bottom:20px;"><h4 style="margin:0 0 10px 0; font-size:14px; color:#555; text-transform:uppercase; letter-spacing:0.5px; font-weight:600;">Awards & Recognition</h4><div style="display:flex; flex-wrap:wrap; gap:8px;">${awards.map((award) => `<span style="background:#fff8e1; color:#6d4c41; font-size:13px; font-weight:500; padding:6px 12px; border-radius:15px; border:1px solid #ffecb3;">🏆 ${award}</span>`).join("")}</div></div>`;
  }

  function buildListSection(title, items, color) {
    if (!items?.length) return "";
    return `<div style="background:white; padding:20px; border-radius:8px; border-top:4px solid ${color}; box-shadow:0 2px 4px rgba(0,0,0,0.05); margin-bottom:16px;"><h4 style="margin:0 0 16px 0; font-size:16px; color:${color}; font-weight:600;">${title}</h4><ul style="margin:0; padding:0; list-style:none; color:#333;">${items.map((item) => `<li style="font-size:14px; line-height:1.5; margin-bottom:10px; padding-left:20px; position:relative;"><span style="position:absolute; left:0; top:1px; color:${color};">${color === "#28a745" ? "✔" : "✘"}</span>${item}</li>`).join("")}</ul></div>`;
  }

  async function loadShoeDatabase() {
    if (shoeDatabase) return;
    try {
      const response = await fetch(
        "https://raw.githubusercontent.com/sinazadeh/runrepeat/refs/heads/main/runrepeat-shoes.json"
      );
      if (!response.ok) throw new Error("Failed to load shoe database");
      shoeDatabase = await response.json();
    } catch (error) {
      console.error("Error loading shoe database:", error);
      shoeDatabase = [];
    }
  }

  async function injectReviewSection() {
    if (hasFailed || reviewData) return; // Stop if already matched or failed

    currentConfig = siteConfigs[window.location.hostname];
    if (!currentConfig) return;

    currentSlug = currentConfig.getSlug();
    if (!currentSlug) {
      setTimeout(injectReviewSection, 500);
      return;
    }

    await loadShoeDatabase();
    const matchingShoe = findMatchingShoe(currentConfig.brand, currentSlug);

    if (matchingShoe) {
      console.log("[RunRepeat] Matched using database:", matchingShoe);
      const fetchedData = await fetchAndParseRunRepeat(matchingShoe.url);
      if (fetchedData) {
        console.log(
          "[RunRepeat] Successfully fetched review data from database URL:",
          matchingShoe.url
        );
        reviewData = fetchedData;
      } else {
        console.log(
          "[RunRepeat] Failed to fetch review data from database URL:",
          matchingShoe.url
        );
        reviewData = {
          url: matchingShoe.url,
          title: matchingShoe.title,
        };
      }
    } else if (!reviewData && !isFetching) {
      console.log(
        "[RunRepeat] No match in database, attempting URL matching..."
      );
      isFetching = true;
      reviewData =
        (await findValidRunRepeatPage(currentSlug, currentConfig.brand)) ||
        "failed";
      isFetching = false;

      if (reviewData !== "failed") {
        console.log(
          "[RunRepeat] Successfully matched using URL:",
          reviewData.url
        );
      } else {
        console.log("[RunRepeat] URL matching failed.");
      }
    }

    if (reviewData === "failed") {
      hasFailed = true;
      return;
    }

    const target = document.querySelector(currentConfig.injectionTarget);
    if (!target) {
      setTimeout(injectReviewSection, 500);
      return;
    }

    if (!document.querySelector(".runrepeat-section")) {
      target.parentNode.insertBefore(
        createRunRepeatSection(reviewData),
        target.nextSibling
      );
    }
  }

  function handleUrlChange() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      reviewData = null;
      hasFailed = false;
      document.querySelector(".runrepeat-section")?.remove();
      debounceInject();
    }
  }

  function hookHistoryEvents() {
    const pushState = history.pushState;
    history.pushState = function (...args) {
      pushState.apply(this, args);
      handleUrlChange();
    };
    window.addEventListener("popstate", handleUrlChange);
  }

  let injectTimeout;
  function debounceInject() {
    clearTimeout(injectTimeout);
    injectTimeout = setTimeout(injectReviewSection, 400);
  }

  const observer = new MutationObserver(() => {
    if (!document.querySelector(".runrepeat-section")) {
      debounceInject();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });

  hookHistoryEvents();
  injectReviewSection();
})();
