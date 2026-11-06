// When TAMO can't help: offline with saved data (an out-of-date banner), offline with nothing saved (Try again),
// one section failing or refused (the rest still shows), and an expired session (signed in again without asking).
const H = require("../harness");
(async () => {
  const kc = H.signedIn();
  let { E, p } = await H.run({ kc, settings: H.quiet() });
  await E.settle(); E.finish(); await p;
  const files = E.files;
  const cache = H.local(`dienynas-plus-cache-${H.hashKey(H.roleKeyOf(H.CHILDREN[0]))}.json`), saved = files[cache], widget = JSON.parse(files[H.local("dienynasplus-widget.json")]);
  ({ E, p } = await H.run({ kc, files, tamo: { down: true } }));
  await E.settle();
  console.log("A offline, saved data:", E.text(".banner"), "| Today still there:", !!E.$(".now"));
  E.check(/Showing saved data from 29\.10 10:32\. Refresh failed: Could not reach TAMO/.test(E.text(".banner")) && E.$(".now"), "saved data with a note saying when it's from");
  const w2 = JSON.parse(files[H.local("dienynasplus-widget.json")]);
  console.log("  saved diary kept:", files[cache] === saved, "| widget's homework and messages kept:", JSON.stringify(w2.children) === JSON.stringify(widget.children));
  E.check(files[cache] === saved && JSON.stringify(w2.children) === JSON.stringify(widget.children), "nothing empty is saved over the diary or the widget");
  E.finish(); await p;

  const tamo = { down: true };
  ({ E, p } = await H.run({ kc, settings: H.quiet(), tamo }));
  await E.settle();
  console.log("B offline, nothing saved:", E.log.pages.slice(-1)[0], "page |", E.text(".center"));
  E.check(E.log.pages.slice(-1)[0] === "message" && /Could not reach TAMO/.test(E.text(".center")), "a message page with Try again");
  tamo.down = false;
  E.tap(".center button");
  await E.until(() => E.$(".now"), "the diary after Try again");
  console.log("  Try again (back online):", E.text("h1.date"));
  E.finish(); await p;

  ({ E, p } = await H.run({ kc, settings: H.quiet(), tamo: { fail: ["messaging/messages/received"], deny: ["core/app/dienynas"] } }));
  await E.settle();
  console.log("C some sections failed:", E.text(".banner"));
  E.check(/messages: TAMO responded with HTTP 500/.test(E.text(".banner")) && /grades: TAMO denied access to this data/.test(E.text(".banner")) && /Vadovėlis/.test(E.text("main")), "the banner names the sections, the rest shows");
  E.tap('[data-tab="3"]');
  console.log("  Messages tab:", E.text("main section .empty") || E.text("main").slice(0, 60));
  E.finish(); await p;

  // a session saved earlier that TAMO no longer accepts: one sign-in, no prompt
  const key = H.roleKeyOf(H.CHILDREN[0]);
  const old = Object.assign(H.signedIn(), { "dienynasplus.role": key,
    "dienynasplus.session": JSON.stringify({ token: "tok-expired", roleId: "role-old", roleKey: key, roleTitle: H.CHILDREN[0].title, roleSubtitle: H.CHILDREN[0].subtitle, roles: [], personId: "1", at: H.NOW - 60e3 }) });
  ({ E, p } = await H.run({ kc: old, settings: H.quiet() }));
  await E.settle();
  console.log("D expired session: signed in again:", E.log.logins || 0, "time(s) | prompts:", E.log.alerts.length, "| 401s:", E.log.requests.filter((r) => r.status === 401).length, "| diary:", !!E.$(".now"), "| banner:", E.text(".banner") || "none");
  E.check(E.log.logins === 1 && !E.log.alerts.length && E.$(".now") && !E.$(".banner"), "one quiet sign-in, everything loads");
  E.finish(); await p;
  console.log("errors:", E.errors.length ? E.errors.join(" ; ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
