import fs from "node:fs";
import vm from "node:vm";

// Runs the userscript outside a userscript manager, where it exports its
// helpers instead of touching the page. `globals` (e.g. a jsdom `document`)
// are visible to the script.
export function loadUserscript(globals = {}) {
  const file = new URL(
    "../RunRepeat_Review_Summaries_on_Shoe_Sites.user.js",
    import.meta.url
  );
  const sandbox = { ...globals, module: { exports: {} } };
  vm.runInNewContext(fs.readFileSync(file, "utf8"), sandbox);
  return sandbox.module.exports;
}
