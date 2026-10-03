# RunRepeat Review Summaries on Shoe Sites

![Untitled](https://github.com/user-attachments/assets/80caeba0-b7cc-4bdb-879b-290acf93bf32)

This userscript injects expert reviews from RunRepeat directly onto product pages of major shoe brands. It enhances the shopping experience by providing detailed insights, pros, cons, and audience scores for various shoes.

## 📥 Install from GitHub

To install the script, click [here](https://raw.githubusercontent.com/sinazadeh/runrepeat/refs/heads/main/RunRepeat_Review_Summaries_on_Shoe_Sites.user.js).

--- 

## Features
- Automatically fetches and displays RunRepeat reviews on supported product pages.
- Highlights expert verdicts, pros, cons, and audience scores.
- Seamlessly integrates into the product page layout.

## Supported Websites
The script currently supports the following websites:
- Nike
- Adidas
- New Balance
- Asics
- Brooks Running
- Hoka
- Saucony
- Altra Running
- On

---

## How it works
1. Every week, `scraper.js` reads RunRepeat's review sitemaps and saves each shoe's brand, title and URL to `runrepeat-shoes.json`. A GitHub Action opens a pull request with the changes.
2. On a product page, the userscript reads the product name, normalizes it (e.g. `Men's Fresh Foam X 1080v14` → `fresh-foam-x-1080-v14`) and looks it up in that file.
3. If there is no match, it tries the RunRepeat URL the shoe would most likely have.
4. It then fetches the review page from runrepeat.com and shows the verdict, pros, cons, awards and audience score.

Open the browser console and filter by `[RunRepeat]` to see what was matched.

## Development
```sh
npm ci
npm test         # matching tests, run against the current runrepeat-shoes.json
npm run scrape   # rebuilds runrepeat-shoes.json (takes about an hour)
```

To support another site, add an entry to `siteConfigs` in the userscript and its domain to the `@match` lines. Bump `@version` with every userscript change so installed copies update.

---

## License
This project is licensed under the MIT License.
