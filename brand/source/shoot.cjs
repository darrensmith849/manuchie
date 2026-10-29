// Full-page screenshot of a local HTML file in headless Chromium (fresh temporary profile).
// Usage: NODE_PATH=<dir>/node_modules node shoot.cjs <page.html> <out.png> [width]
// Any request that is not file:// is blocked and reported, so the page is proven self-contained.
const { chromium } = require("playwright");
const path = require("path");

(async () => {
  const [, , page, out, width = "1440"] = process.argv;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: +width, height: 900 }, deviceScaleFactor: 1 });
  const tab = await ctx.newPage();
  const external = [];
  await tab.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("file://") || url.startsWith("data:")) return route.continue();
    external.push(url);
    return route.abort();
  });
  const failed = [];
  tab.on("requestfailed", (r) => { if (r.url().startsWith("file://")) failed.push(r.url()); });
  await tab.goto("file://" + path.resolve(page), { waitUntil: "load" });
  await tab.evaluate(() => document.fonts.ready);
  await tab.waitForTimeout(300);
  await tab.screenshot({ path: out, fullPage: true });
  await browser.close();
  if (external.length) console.log("blocked external requests:\n  " + external.join("\n  "));
  if (failed.length) console.log("missing local files:\n  " + failed.join("\n  "));
  console.log("wrote " + out + (external.length || failed.length ? "" : " (no external requests, no missing files)"));
})();
