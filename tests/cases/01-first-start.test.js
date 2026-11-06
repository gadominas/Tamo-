// First start: sign in with a native prompt, pick a child, see the placeholder, then Today. Cancelling opens nothing.
const H = require("../harness");
(async () => {
  let { E, p } = await H.run({ alerts: [["demo.tevai", "not-a-real-password"], "Jonas Pavyzdys — 2B klasė"], tamo: { children: 2 } });
  const [signIn, pick] = await E.until(() => E.log.alerts.length >= 2 && E.log.alerts, "the two prompts");
  console.log("A sign-in prompt:", signIn.title, "| fields:", signIn.fields.join(", "), "| password hidden:", signIn.secure[1], "| before any window:", !signIn.overWindow);
  E.check(!signIn.overWindow && signIn.secure[1] && !signIn.secure[0], "a native sign-in prompt before the window, password in a secure field");
  console.log("B whose diary:", pick.title, "| choices:", pick.actions.join(" / "), "| style:", pick.style);
  await E.until(() => E.log.pages.length >= 2, "the app page");
  const placeholder = E.text(".booting");
  console.log("C first screens:", E.log.pages.slice(0, 2).join(" → "), "| placeholder:", placeholder || "(already replaced)");
  await E.settle();
  E.check(E.log.blankFirst, "the empty first window comes first");
  console.log("D Today:", E.text("h1.date"), "|", E.text(".now"), "| child:", E.$(".kid.on").getAttribute("aria-label"));
  E.check(/Now, 10:00–10:45 ?Anglų kalba/.test(E.text(".now")), "the lesson on now");
  E.check(E.$(".kid.on").getAttribute("aria-label") === "Jonas Pavyzdys", "the picked child is shown");
  const tabs = E.$$("nav.tabs button").map((b) => b.textContent.replace(/\d+$/, "").trim());
  console.log("  tabs:", tabs.join(", "), "| Ask button:", !!E.$('[data-tab="5"]'), "| footer:", E.text("footer"));
  E.check(tabs.length === 5 && !E.$('[data-tab="5"]'), "five tabs, no Ask without a key");
  E.check(E.text("footer").includes("Dienynas+ v" + H.VERSION), "version in the footer");
  console.log("E Keychain:", Object.keys(E.kc).sort().join(", "));
  E.check(E.kc["dienynasplus.role"] === H.roleKeyOf(H.CHILDREN[1]), "the chosen child is remembered");
  const leaked = Object.entries(E.files).filter(([, v]) => String(v).includes("not-a-real-password")).map(([k]) => k);
  console.log("  files:", Object.keys(E.files).map((f) => f.split("/").pop()).join(", "), "| password in a file:", leaked.length ? leaked : "no");
  E.check(!leaked.length, "the password is never written to a file");
  E.check(E.text("#app").includes("Help improve Dienynas+?"), "the one-time usage question on Today");
  E.finish(); await p;

  // Cancel the sign-in: nothing opens, nothing is asked of TAMO
  ({ E, p } = await H.run({ alerts: ["cancel"] }));
  await p;
  console.log("F cancelled: windows", E.log.presented || 0, "| requests", E.log.requests.length, "| script finished:", !!E.log.completed);
  E.check(!E.log.presented && !E.log.requests.length && E.log.completed, "cancelling the sign-in opens nothing");
  console.log("errors:", E.errors.length ? E.errors.join(" ; ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
