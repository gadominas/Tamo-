// The Home Screen and Lock Screen widget (app-blueprints · widgets): "Open to sign in" first, then the lesson now and
// next, homework and message counts, the rest of the day; every size; fresh data when the snapshot is old, an amber
// "Updated …" when TAMO can't be reached; a child picked by name; Lithuanian; never grades or message text.
const H = require("../harness");
(async () => {
  const W = (o) => H.run(Object.assign({ widget: true, family: "medium" }, o));
  let { E, p } = await W({ kc: {} });
  await p;
  console.log("A not signed in:", E.widgetText().join(" · "), "| tap opens:", E.log.widgets[0].url);
  E.check(E.widgetText().includes("Open to sign in."), "says how to start");
  // the app saves what the widget shows, for both children
  const kc = H.signedIn(), files = {};
  ({ E, p } = await H.run({ kc, files, settings: H.quiet(), tamo: { children: 2 }, alerts: [0] }));
  await E.settle();
  E.tap(`[data-kid="${H.roleKeyOf(H.CHILDREN[1])}"]`); await E.settle();
  E.tap(`[data-kid="${H.roleKeyOf(H.CHILDREN[0])}"]`); await E.settle();
  E.finish(); await p;
  ({ E, p } = await W({ kc, files })); await p;
  const medium = E.widgetText();
  console.log("B medium:", medium.join(" · "), "| asked TAMO:", E.log.requests.length);
  E.check(medium.join("|") === "Dienynas|+|Ugnė|Now 10:00–10:45|Anglų kalba|Next: Gamtos mokslai · 11:05|📝|2 due tomorrow, 1 late|✉️|2 today, 2 unread|5|12:00 Dailė|3 lessons left today", "the lesson now, counts and the rest of the day");
  const all = JSON.stringify(E.log.widgets[0]);
  E.check(!/Ekskursija|Klasiokienė|Vadovėlis|Laura/.test(all), "no message text, homework text or teachers on the Home Screen");
  console.log("  refresh asked after:", Math.round((E.log.widgets[0].refreshAfterDate - H.NOW) / 6e4), "min | logo tile cached:", E.log.widgets[0].children[0].children[0].image._image.includes("widget-icon"));
  for (const fam of ["small", "large", "accessoryRectangular", "accessoryInline", "accessoryCircular"]) {
    ({ E, p } = await W({ kc, files, family: fam })); await p;
    console.log("C " + fam + ":", E.widgetText().join(" · "));
  }
  // an old snapshot: the widget asks TAMO itself
  const wfile = H.local("dienynasplus-widget.json"), key = H.roleKeyOf(H.CHILDREN[0]);
  const age = (min) => { const w = JSON.parse(files[wfile]); w.children[key].at = H.NOW - min * 6e4; files[wfile] = JSON.stringify(w); };
  age(45);
  ({ E, p } = await W({ kc, files })); await p;
  console.log("D 45 min old: asked TAMO:", E.requests(/api\.tamo\.lt/).length > 0, "| snapshot now from:", new Date(JSON.parse(files[wfile]).children[key].at).toISOString().slice(11, 16), "UTC");
  age(13 * 60);
  ({ E, p } = await W({ kc, files, tamo: { down: true } })); await p;
  const foot = (function last(n) { return n.kind === "text" ? n : n.children.map(last).filter(Boolean).pop(); })(E.log.widgets[0]);
  console.log("E 13 h old, TAMO unreachable:", foot.text, "| amber:", foot.textColor.hex);
  E.check(foot.text === "⟳ Updated yesterday" && foot.textColor.hex === "#FBBF24", "old data is marked in amber");
  ({ E, p } = await W({ kc, files, widgetParameter: "Jonas" })); await p;
  console.log("F parameter 'Jonas':", E.widgetText().slice(0, 5).join(" · "));
  E.check(E.widgetText()[2] === "Jonas", "a child picked by first name");
  ({ E, p } = await W({ kc, files, widgetParameter: "Petras" })); await p;
  console.log("  parameter 'Petras':", E.widgetText().slice(2).join(" · "));
  const lt = {}; Object.assign(lt, files, { [H.SETTINGS]: JSON.stringify(H.quiet({ lang: "lt" })) });
  ({ E, p } = await W({ kc, files: lt })); await p;
  console.log("G Lithuanian:", E.widgetText().slice(3).join(" · "));
  E.check(/Dabar 10:00–10:45/.test(E.widgetText().join()) && /Šiandien liko 3 pamokos/.test(E.widgetText().join()), "the widget in Lithuanian");
  // updated from 1.7: no widget snapshot yet, only the app's saved diary
  const old = Object.assign({}, files); delete old[wfile];
  ({ E, p } = await W({ kc, files: old, tamo: { down: true } })); await p;
  console.log("H no snapshot yet, from the saved diary:", E.widgetText().slice(3, 6).join(" · "));
  E.check(E.widgetText()[4] === "Anglų kalba", "the widget falls back to the app's saved diary");
  console.log("errors:", E.errors.length ? E.errors.join(" ; ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
