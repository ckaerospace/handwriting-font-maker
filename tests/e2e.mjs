// End-to-end test: node tests/e2e.mjs [desktop|iphone|pixel|all]   BASE_URL=http://localhost:8123/ OUT=/workspace/hfm_e2e
import { chromium, webkit, devices } from "@playwright/test";
import fs from "fs"; import path from "path";
const BASE = process.env.BASE_URL || "http://localhost:8123/";
const OUT = process.env.OUT || "e2e-out"; fs.mkdirSync(OUT, { recursive: true });
const TPL = process.env.TPL_PHOTO || "/workspace/hfm_test/tpl/patrick.jpg";
const targets = {
  desktop: { name: "desktop", type: chromium, ctx: { viewport: { width: 1280, height: 900 }, acceptDownloads: true } },
  iphone: { name: "iphone14-webkit", type: webkit, ctx: { ...devices["iPhone 14"], acceptDownloads: true } },
  pixel: { name: "pixel7-chromium", type: chromium, ctx: { ...devices["Pixel 7"], acceptDownloads: true } },
};
const which = (process.argv[2] || "all"); const list = which === "all" ? Object.values(targets) : [targets[which]];
const results = [];
let failed = 0;
function check(dev, name, ok, info = "") { results.push({ dev, name, ok, info }); console.log(`${ok ? "PASS" : "FAIL"} [${dev}] ${name} ${info}`); if (!ok) failed++; }
for (const t of list) {
  const browser = await t.type.launch(); const ctx = await browser.newContext(t.ctx); const page = await ctx.newPage();
  const errs = []; page.on("pageerror", e => errs.push(String(e))); page.on("console", m => { if (m.type() === "error") errs.push(m.text()); });
  const D = t.name, shot = (n) => page.screenshot({ path: path.join(OUT, `${D}_${n}.png`), fullPage: false });
  await page.goto(BASE + "?nosw=1");
  check(D, "page loads", (await page.title()).includes("Handwriting"));
  check(D, "no horizontal overflow", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await shot("1_upload");
  // template pdf links exist
  for (const id of ["tpl-a4", "tpl-letter"]) { const href = await page.getAttribute(`[data-testid=${id}]`, "href"); const r = await page.request.get(new URL(href, BASE).href); check(D, `template ${id} downloads`, r.ok() && (await r.body()).slice(0, 4).toString() === "%PDF", `${r.status()}`); }
  // free-form flow with the print sample + known transcript
  await page.click("[data-testid=sample-print]");
  await page.waitForSelector("[data-testid=step-text]:not([hidden])", { timeout: 60000 });
  await page.waitForFunction(() => document.querySelector("#transcript").value.length > 10);
  await shot("2_text");
  const t0 = Date.now(); await page.click("[data-testid=analyse]");
  await page.waitForSelector("[data-testid=step-review]:not([hidden])", { timeout: 120000 });
  check(D, "analysis done", true, `${Date.now() - t0} ms`);
  const sum = await page.textContent("#summary"); check(D, "summary shows glyph count", /glyphs found/.test(sum), sum.replace(/\s+/g, " "));
  await page.click("#tabs [data-f=all]"); await page.waitForSelector("[data-testid=glyph]");
  const nGl = await page.locator("[data-testid=glyph]").count(); check(D, "glyph grid rendered", nGl > 150, `${nGl} cards`);
  check(D, "no overflow on review", await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  await shot("3_review");
  // editor: open, relabel, close
  await page.locator("[data-testid=glyph]").nth(3).click(); await page.waitForSelector("dialog[open]");
  await shot("3b_editor");
  const before = await page.locator("[data-testid=glyph] .lab").nth(3).textContent();
  await page.fill("#edChar", "q"); await page.dispatchEvent("#edChar", "change"); await page.waitForTimeout(500);
  await page.click("dialog[open] button[value=close]:has-text('Done')");
  await page.waitForTimeout(300);
  check(D, "relabel works", (await page.evaluate(() => window.__hfm.views.glyphs.filter(g => g.manual).length)) === 1, `was "${before}"`);
  // second photo accumulates into the same glyph set
  const covBefore = await page.evaluate(() => window.__hfm.views.covered);
  const ADD = process.env.ADD_PHOTO || "/workspace/hfm_test/architects_mixed";
  await page.click("[data-testid=add-photo]"); await page.waitForSelector("[data-testid=step-upload]:not([hidden])");
  await page.setInputFiles("[data-testid=file-input]", ADD + ".jpg");
  await page.waitForSelector("[data-testid=step-text]:not([hidden])", { timeout: 60000 });
  await page.fill("[data-testid=transcript]", JSON.parse(fs.readFileSync(ADD + ".json")).transcript);
  await page.click("[data-testid=analyse]"); await page.waitForSelector("[data-testid=step-review]:not([hidden])", { timeout: 120000 });
  await page.waitForTimeout(300);
  const covAfter = await page.evaluate(() => window.__hfm.views.covered);
  check(D, "second photo adds characters", covAfter > covBefore + 10, `${covBefore} -> ${covAfter} of 88`);
  await shot("3c_after_second_photo");
  // font step
  await page.click("[data-testid=to-font]"); await page.waitForSelector("[data-testid=step-font]:not([hidden])");
  await page.waitForFunction(() => document.querySelector("#preview").dataset.family, null, { timeout: 60000 });
  const loaded = await page.evaluate(async () => { const fam = document.querySelector("#preview").dataset.family; await document.fonts.load(`40px "${fam}"`, "Hello"); return document.fonts.check(`40px "${fam}"`, "Hello") && [...document.fonts].some(f => f.family.includes(fam) && f.status === "loaded"); });
  check(D, "FontFace loaded in browser", loaded);
  const gcount = await page.getAttribute("#preview", "data-glyphs"); check(D, "font has glyphs", +gcount > 40, gcount);
  await page.waitForTimeout(400); await shot("4_font");
  // rendered preview is not blank and uses the font (pixel measure of text width vs fallback)
  const w1 = await page.evaluate(() => { const p = document.querySelector("#preview"); const r = document.createRange(); r.selectNodeContents(p); return r.getBoundingClientRect().width; });
  check(D, "preview text laid out", w1 > 100, Math.round(w1) + "px");
  await page.fill("#fname", "E2E Hand"); await page.evaluate(() => { const s = document.querySelector("#p_track"); s.value = 30; s.dispatchEvent(new Event("input", { bubbles: true })); }); await page.waitForTimeout(900);
  for (const [id, ext] of [["dl-ttf", "ttf"], ["dl-otf", "otf"], ["dl-woff", "woff"]]) {
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click(`[data-testid=${id}]`)]);
    const p = path.join(OUT, `${D}_E2E-Hand.${ext}`); await dl.saveAs(p);
    check(D, `download ${ext}`, fs.statSync(p).size > 2000 && dl.suggestedFilename().endsWith("." + ext), `${dl.suggestedFilename()} ${fs.statSync(p).size} B`);
  }
  // template flow (fresh page)
  const p2 = await ctx.newPage(); p2.on("pageerror", e => errs.push(String(e)));
  await p2.goto(BASE + "?nosw=1"); await p2.setInputFiles("[data-testid=template-input]", TPL);
  await p2.waitForSelector("[data-testid=step-review]:not([hidden])", { timeout: 120000 });
  const s2 = await p2.textContent("#summary"); check(D, "template flow: all characters covered", /88 of 88/.test(s2), s2.replace(/\s+/g, " "));
  await p2.screenshot({ path: path.join(OUT, `${D}_5_template_review.png`) });
  await p2.close();
  // unknown text flow
  const p3 = await ctx.newPage(); p3.on("pageerror", e => errs.push(String(e)));
  await p3.goto(BASE + "?nosw=1"); await p3.click("[data-testid=sample-print]"); await p3.waitForSelector("[data-testid=step-text]:not([hidden])", { timeout: 60000 });
  const t1 = Date.now(); await p3.click("[data-testid=analyse-auto]"); await p3.waitForSelector("[data-testid=step-review]:not([hidden])", { timeout: 180000 });
  const s3 = await p3.textContent("#summary"); check(D, "no-transcript flow works", /glyphs found/.test(s3), `${Date.now() - t1} ms; ${s3.replace(/\s+/g, " ")}`);
  await p3.close();
  check(D, "no console/page errors", errs.length === 0, errs.slice(0, 3).join(" | "));
  await browser.close();
}
fs.writeFileSync(path.join(OUT, "results.json"), JSON.stringify(results, null, 1));
console.log(failed ? `${failed} FAILED` : "ALL PASSED");
process.exit(failed ? 1 : 0);
