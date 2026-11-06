#!/usr/bin/env node
// Raw phone screens of the real Dienynas.js, for a visual check after a change (see docs/TESTING.md › Screenshots).
//   node tests/screens/run.js            → PNGs in $DIENYNAS_SHOTS or <tmp>/dienynas-screens/shots/
// The harness builds each screen from invented sample data, the page is saved without its scripts, and Chromium
// (Playwright) draws it at 390 × 844 points, 2×. The README's labelled cards are made by app-blueprints' repo-site from
// docs/site/scenario.js; these raw screens show the same states straight from the test fixtures.
// Needs Playwright with Chromium: cd tests && npm i playwright && npx playwright install chromium
"use strict";
const fs = require("fs"), path = require("path"), os = require("os");
const H = require("../harness");
const TMP = process.env.DIENYNAS_TMP || path.join(os.tmpdir(), "dienynas-screens");
const OUT = process.env.DIENYNAS_SHOTS || path.join(TMP, "shots");
fs.mkdirSync(path.join(TMP, "html"), { recursive: true });
fs.mkdirSync(OUT, { recursive: true });

// The page as it is now, without scripts, so Chromium shows exactly this state.
function snapshot(E, id) {
  const doc = E.getDom().window.document.documentElement.cloneNode(true);
  doc.querySelectorAll("script").forEach((s) => s.remove());
  doc.querySelectorAll("#splash").forEach((s) => s.remove());
  const file = path.join(TMP, "html", id + ".html");
  fs.writeFileSync(file, "<!doctype html>" + doc.outerHTML);
  return file;
}
// A widget tree drawn as HTML, close enough to judge layout and wording.
function widgetHTML(w, fam) {
  const size = { small: [158, 158], medium: [338, 158], large: [338, 354] }[fam];
  const css = (c) => (c ? `rgba(${parseInt(c.hex.slice(1, 3), 16)},${parseInt(c.hex.slice(3, 5), 16)},${parseInt(c.hex.slice(5, 7), 16)},${c.alpha})` : "inherit");
  const node = (n) => {
    if (n.kind === "text") return `<div style="font:${/bold/i.test(n.font.name) ? 700 : /semi|medium/i.test(n.font.name) ? 600 : 400} ${n.font.size}px -apple-system,system-ui,sans-serif;color:${css(n.textColor)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${n.text.replace(/</g, "&lt;")}</div>`;
    if (n.kind === "image") return `<div style="width:${n.imageSize ? n.imageSize.width : 20}px;height:${n.imageSize ? n.imageSize.height : 20}px;border-radius:5px;background:#60A5FA"></div>`;
    if (n.kind === "spacer") return `<div style="${n.length == null ? "flex:1" : `flex:0 0 ${n.length}px`}"></div>`;
    const dir = n.vertical ? "column" : "row";
    const pad = n.padding ? `padding:${n.padding.map((x) => x + "px").join(" ")};` : "";
    const sz = n.size && n.size.width ? `width:${n.size.width}px;flex:none;` : "";
    return `<div style="display:flex;flex-direction:${dir};gap:${n.spacing || 0}px;${n.align === "center" ? "align-items:center;" : ""}${pad}${sz}min-width:0;${n.kind === "widget" ? "" : ""}">${n.children.map(node).join("")}</div>`;
  };
  return `<!doctype html><html><body style="margin:0;background:#cfd6e3;display:grid;place-items:center;height:100vh">
    <div style="width:${size[0]}px;height:${size[1]}px;border-radius:22px;overflow:hidden;background:linear-gradient(#171B22,#0E1116);display:flex;flex-direction:column;padding:14px;box-sizing:border-box">${w.children.map(node).join("")}</div></body></html>`;
}

const shots = [];
(async () => {
  const kc = H.withKey();
  const [U, J] = H.CHILDREN.map(H.roleKeyOf);
  let { E, p } = await H.run({ kc, settings: H.quiet(), tamo: { children: 2 }, alerts: [0] });
  await E.settle();
  shots.push(["01-today", snapshot(E, "01-today")]);
  E.tap('[data-tab="5"]'); await E.until(() => /In this chat/.test(E.text(".mem")), "Ask");
  E.tap(E.$$(".sugg button").find((b) => /tests/.test(b.textContent))); await E.until(() => E.$(".bubble.assistant .badge-ai"), "answer");
  shots.push(["02-ask", snapshot(E, "02-ask")]);
  E.tap('[data-tab="2"]'); shots.push(["03-homework", snapshot(E, "03-homework")]);
  E.tap('[data-tab="1"]'); E.tap(".lesson.current"); shots.push(["04-schedule", snapshot(E, "04-schedule")]);
  E.tap('[data-tab="3"]'); shots.push(["05-messages", snapshot(E, "05-messages")]);
  E.tap('[data-tab="4"]'); shots.push(["06-grades", snapshot(E, "06-grades")]);
  E.tap('[data-tab="0"]');
  E.tap("#settings"); await E.until(() => E.$("#cfgsheet.open"), "Settings");
  shots.push(["10-settings", snapshot(E, "10-settings")]);
  E.tap('[data-act="ai-open"]'); await E.until(() => E.$("#aisheet .aicard"), "AI settings");
  E.tap('#aisheet [data-aiact="aitest"][data-v="anthropic"]'); await E.until(() => /works/.test(E.toast()), "test");
  shots.push(["11-ai-settings", snapshot(E, "11-ai-settings")]);
  E.finish(); await p;
  const files = E.files;

  ({ E, p } = await H.run({ kc, files: Object.assign({}, files, { [H.SETTINGS]: JSON.stringify(H.quiet({ lang: "lt" })) }) }));
  await E.settle(); shots.push(["07-lithuanian", snapshot(E, "07-lithuanian")]); E.finish(); await p;
  ({ E, p } = await H.run({ kc, files: Object.assign({}, files, { [H.SETTINGS]: JSON.stringify(H.quiet({ photosAsked: false })) }), tamo: { children: 2 } }));
  await E.settle(); shots.push(["08-children", snapshot(E, "08-children")]); E.finish(); await p;
  ({ E, p } = await H.run({ kc, files: Object.assign({}, files), releases: H.releasesWithOffer() }));
  await E.until(() => E.$("#upd"), "update", 9000); shots.push(["13-update", snapshot(E, "13-update")]); E.finish(); await p;
  ({ E, p } = await H.run({ kc, files: Object.assign({}, files), dark: true }));
  await E.settle(); E.tap('[data-tab="3"]'); E.tap('[data-msg*="9104"]'); await E.until(() => /Gerbiami/.test(E.text("#sheet")), "message");
  shots.push(["14-dark", snapshot(E, "14-dark"), true]); E.finish(); await p;
  for (const fam of ["medium", "small", "large"]) {
    ({ E, p } = await H.run({ kc, files: Object.assign({}, files), widget: true, family: fam })); await p;
    const f = path.join(TMP, "html", `15-widget-${fam}.html`);
    fs.writeFileSync(f, widgetHTML(E.log.widgets[0], fam));
    shots.push([`15-widget-${fam}`, f]);
  }
  if (E.errors.length) { console.log("errors while building the screens:", E.errors.join(" ; ")); process.exit(1); }

  let chromium;
  try { ({ chromium } = require("playwright")); } catch (e) { console.log("Playwright isn't installed: the pages are in " + path.join(TMP, "html")); process.exit(0); }
  const browser = await chromium.launch();
  for (const [id, file, dark] of shots) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: dark ? "dark" : "light" });
    const page = await ctx.newPage();
    await page.route("**/*", (r) => (r.request().url().startsWith("file:") ? r.continue() : r.abort()));   // nothing reaches the network
    await page.goto("file://" + file);
    await page.screenshot({ path: path.join(OUT, id + ".png") });
    await ctx.close();
    console.log("✓ " + id);
  }
  await browser.close();
  console.log("Screens in " + OUT);
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
