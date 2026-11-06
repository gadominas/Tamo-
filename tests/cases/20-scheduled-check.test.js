// Scheduled checks (Shortcuts, parameter "check"): no sign-in yet, the first check only records, nothing new, news as a
// notification and Shortcut output in the background, the alert's Open in the app (no second load from TAMO),
// a refused sign-in notifies, being offline stays quiet.
const H = require("../harness");
(async () => {
  let { E, p } = await H.run({ kc: {}, query: { check: "1" }, inApp: false });
  await p;
  console.log("A not signed in:", E.log.shortcutOutput, "| notification:", (E.log.notifications[0] || {}).body, "| windows:", E.log.presented || 0);
  E.check(/sign in/.test(E.log.shortcutOutput) && E.log.notifications.length === 1 && !E.log.presented, "asks to open the app once");
  const kc = H.signedIn(), files = {};
  const bg = (extra = {}) => H.run(Object.assign({ kc, files, settings: H.quiet(), query: { check: "1" }, inApp: false, tamoState: tamo }, extra));
  let tamo;
  ({ E, p } = await bg()); tamo = E.tamo; await p;
  console.log("B first check:", E.log.shortcutOutput, "| notifications:", E.log.notifications.length, "| widget snapshot saved:", H.local("dienynasplus-widget.json") in files);
  E.check(/Checking is set up/.test(E.log.shortcutOutput) && !E.log.notifications.length, "the first check only records what's there");
  ({ E, p } = await bg({ shortcutParameter: "check", query: {} })); await p;
  console.log("C nothing new (Shortcut parameter 'check'):", E.log.shortcutOutput, "| notifications:", E.log.notifications.length);
  tamo.messages.unshift({ id: "9300", d: "2026-10-29T10:10:00", s: "Pamokos trumpinamos", from: "Pavyzdžių progimnazija", role: "Administracija", unread: true });
  tamo.homework.push({ id: "hw10", s: "Dailė", set: "2026-10-29", due: "2026-11-05", t: "Nupiešti rudens medį." });
  ({ E, p } = await bg()); await p;
  const n = E.log.notifications[0] || {};
  console.log("D news in the background:", n.title, "| opens:", n.openURL, "|\n    " + String(n.body).split("\n").join("\n    "));
  E.check(n.title === "2 new in TAMO · Ugnė Pavyzdytė" && /Pamokos trumpinamos/.test(n.body) && /Nupiešti/.test(n.body) && /2 new in TAMO/.test(E.log.shortcutOutput), "a notification and the Shortcut output list what's new");
  console.log("  kept for Today:", (E.json(H.local(`dienynas-plus-news-${H.hashKey(H.roleKeyOf(H.CHILDREN[0]))}.json`)) || { items: [] }).items.length, "items");
  tamo.grades.push(["2026-10-29", "Informatika", "10"]);
  ({ E, p } = await bg({ inApp: true, alerts: ["Open"] }));
  await E.until(() => E.$(".newsp"), "the app opened from the alert");
  const loads = E.requests(/core\/app\/feeds/).length;
  await E.settle();
  console.log("E in the app: alert:", E.log.alerts[0].title.replace("\n", " · "), "|", E.log.alerts[0].actions.join("/"), "→ opened the app:", E.log.pages.join(","), "| TAMO loads:", E.requests(/core\/app\/feeds/).length);
  console.log("  New since last check:", [...E.$(".newsp").querySelectorAll(".row")].map((r) => E.text(r.querySelector(".title"))).join(", "));
  E.check(loads === 1 && E.requests(/core\/app\/feeds/).length === 1, "Open shows what the check loaded, without asking TAMO again");
  E.finish(); await p;
  ({ E, p } = await bg({ kc: H.signedIn({ "dienynasplus.password": "wrong-password" }) })); await p;
  console.log("F refused sign-in:", (E.log.notifications[0] || {}).body);
  E.check(/did not accept/.test((E.log.notifications[0] || {}).body), "a refused sign-in is worth a notification");
  ({ E, p } = await bg({ tamo: { down: true } })); await p;
  console.log("G offline:", E.log.shortcutOutput, "| notifications:", E.log.notifications.length);
  E.check(!E.log.notifications.length && /Could not reach TAMO/.test(E.log.shortcutOutput), "offline hiccups stay quiet");
  console.log("errors:", E.errors.length ? E.errors.join(" ; ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
