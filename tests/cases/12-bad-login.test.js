// TAMO rejects the password: a page says so with Change sign-in details and Try again. Cancelling the prompt keeps
// that page; new details sign in and open the diary.
const H = require("../harness");
(async () => {
  const kc = H.signedIn({ "dienynasplus.password": "wrong-password" });
  const { E, p } = await H.run({ kc, settings: H.quiet() });
  await E.settle();
  console.log("A rejected:", E.log.pages.slice(-1)[0], "page |", E.text(".center"));
  E.check(/TAMO did not accept this username or password/.test(E.text(".center")) && E.$$(".center button").length === 2, "says so, with two ways on");
  E.alert("cancel");
  E.tapText(".center button", "Change sign-in details");
  await E.settle();
  console.log("B prompt:", E.lastAlert().title, "| username filled in:", E.lastAlert().values[0], "| cancelled → still:", E.text(".center h1"));
  E.check(E.log.pages.slice(-1)[0] === "message" && kc["dienynasplus.password"] === "wrong-password", "cancel changes nothing");
  E.tapText(".center button", "Try again");
  await E.settle();
  console.log("C Try again with the same details:", E.text(".center p"));
  E.alert(["demo.tevai", "not-a-real-password"]);
  E.tapText(".center button", "Change sign-in details");
  await E.until(() => E.$(".now"), "the diary");
  await E.settle();
  console.log("D new details:", E.text("h1.date"), "| saved in the Keychain:", kc["dienynasplus.password"] === "not-a-real-password", "| sign-ins:", E.log.logins);
  E.check(E.$(".now") && kc["dienynasplus.password"] === "not-a-real-password", "signed in with the new details");
  E.finish(); await p;
  console.log("errors:", E.errors.length ? E.errors.join(" ; ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
