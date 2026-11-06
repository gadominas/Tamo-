// Safe start-up (app-blueprints · recipes/safe-startup): the empty first window, booting from handed-over data,
// a settings file iCloud never delivers, damaged files, another window holding the lock, the widget run, the start-up log.
const H = require("../harness");
const { wait } = H;
(async () => {
  const kc = H.signedIn();
  const key = H.roleKeyOf(H.CHILDREN[0]);
  const files = { [H.SETTINGS]: JSON.stringify(H.quiet({ theme: "sepia" })) };
  // a long Ask conversation on the phone: the list handed over in pieces
  files[H.local(`dienynas-plus-chat-${H.hashKey(key)}.json`)] = JSON.stringify({ v: 1, roleKey: key, pack: null,
    history: Array.from({ length: 45 }, (_, i) => ({ role: i % 2 ? "assistant" : "user", text: "line " + i, by: "Claude", at: 1 })) });
  let { E, p } = await H.run({ files, kc });
  await E.settle();
  let w = E.getDom().window;
  console.log("A first window:", E.log.pages[0], "then", E.log.pages.slice(1).join(", "), "| booted:", w.__booted, "| placeholder gone:", !E.$(".booting"));
  E.check(E.log.blankFirst && w.__booted && !E.$(".booting"), "empty window first, then the page boots");
  E.finish(); await p;

  // B: reopen: the saved diary is on screen before TAMO answers; the chat arrives in pieces of 20
  ({ E, p } = await H.run({ files, kc, tamo: { down: true } }));
  await E.until(() => E.getDom() && E.getDom().window.DATA, "the page booted");
  w = E.getDom().window;
  const pieces = (E.log.evals || []).filter((x) => x.startsWith("window.__parts.push")).length;
  console.log("B reopened from the saved diary:", E.text(".now").slice(0, 40), "| chat pieces:", pieces, "| chat lines:", w.DATA.chat.length, "| theme:", w.document.documentElement.dataset.theme);
  E.check(pieces === 3 && w.DATA.chat.length === 45, "45 chat lines handed over in 3 pieces");
  await E.settle();
  E.finish(); await p;

  // C: iCloud never delivers settings.json: the app opens with defaults within the time limit, says so, saves nothing over it
  const before = files[H.SETTINGS];
  const t0 = Date.now();
  ({ E, p } = await H.run({ files, kc, slowCloud: ["settings.json"] }));
  await E.until(() => E.getDom() && E.getDom().window.__booted, "booted with iCloud slow");
  await E.settle();
  console.log("C slow iCloud: booted in", ((Date.now() - t0) / 1000).toFixed(1) + " s (limit scaled to 0.5 s) | theme:", E.getDom().window.document.documentElement.dataset.theme, "| toast:", E.toast());
  E.check(/couldn't be read/.test(E.toast()), "says some settings couldn't be read");
  E.tap("#settings"); await E.until(() => E.$("#cfgsheet.open"), "settings");
  E.tap('[data-act="look"][data-k="theme"][data-v="night"]'); await E.settle();
  console.log("  changed the theme in Settings; settings.json untouched:", files[H.SETTINGS] === before);
  E.check(files[H.SETTINGS] === before, "a settings file that didn't arrive is never written");
  E.finish(); await p;

  // D: damaged files are copied aside, started fresh, and saving carries on
  files[H.SETTINGS] = "{oops";
  files[H.local("dienynas-plus-usage.json")] = "{bad usage";
  ({ E, p } = await H.run({ files, kc }));
  await E.settle();
  const broken = Object.keys(files).filter((f) => /\.broken-\d+\.json$/.test(f)).map((f) => f.split("/").pop().replace(/\d+/, "<time>"));
  console.log("D damaged: copies kept:", broken.join(", "), "| toast:", E.toast(), "| settings.json valid again:", !!E.settings());
  E.check(broken.length === 2 && Object.keys(files).some((f) => /settings\.broken-/.test(f) && files[f] === "{oops"), "both damaged files kept aside");
  E.tap("#settings"); await E.until(() => E.$("#cfgsheet.open"), "settings");
  E.tap('[data-act="look"][data-k="theme"][data-v="mint"]'); await E.settle();
  console.log("  a change is saved again:", E.settings().theme);
  E.check(E.settings().theme === "mint", "saving works after a damaged file");
  E.finish(); await p;
  ({ E, p } = await H.run({ files, kc })); await E.settle(); E.finish(); await p;
  console.log("  reopened: still", Object.keys(files).filter((f) => /\.broken-/.test(f)).length, "copies, no new toast:", !E.toast());

  // E: another window still holds the lock: this one waits at most 1.5 s, then opens anyway
  files[H.TMP + "/dienynasplus-running"] = String(H.NOW);
  ({ E, p } = await H.run({ files, kc }));
  const opened = await E.until(() => E.getDom() && E.getDom().window.__booted, "opened despite the lock");
  console.log("E lock held by another window: opened anyway:", !!opened);
  await E.settle(); E.finish(); await p;
  console.log("  lock released on close:", !(H.TMP + "/dienynasplus-running" in files));

  // F: a widget run reads its own data and never builds a window
  ({ E, p } = await H.run({ files, kc, widget: true, family: "medium" }));
  await p;
  console.log("F widget run: windows", E.log.webviews || 0, "| widget:", E.widgetText().slice(0, 4).join(" · "));
  E.check(!E.log.webviews && E.log.widgets.length === 1, "the widget never builds a WebView");

  // G: Settings › Updates › Start-up log
  ({ E, p } = await H.run({ files, kc }));
  await E.settle();
  E.tap("#settings"); await E.until(() => E.$("#cfgsheet.open"), "settings");
  E.tap('[data-act="startlog"]'); await E.until(() => !E.$("#startlog").hidden, "the start-up log");
  const lines = E.$("#startlog").textContent.split("\n");
  console.log("G start-up log (last 4):\n    " + lines.slice(-4).join("\n    "));
  E.check(/window on screen/.test(lines.join()) && /data read in/.test(lines.join()) && /screen ready in/.test(lines.join()) && /iCloud didn't deliver settings\.json/.test(lines.join()), "the log tells the start-up story");
  E.check(!/Ugnė|Pavyzd|not-a-real/.test(lines.join()), "no names or sign-in details in the log");
  E.finish(); await p;
  console.log("errors:", E.errors.length ? E.errors.join(" ; ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
