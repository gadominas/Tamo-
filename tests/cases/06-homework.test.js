// Homework: grouped by due date (latest first), the To do / All / Done filter, overdue in red, the tab's badge,
// attached files, and teachers' placeholder entries ("-") hidden.
const H = require("../harness");
(async () => {
  const { E, p } = await H.run({ kc: H.signedIn(), settings: H.quiet() });
  await E.settle();
  const badge = E.text('[data-tab="2"] .badge');
  console.log("A tab badge (due by tomorrow, not done):", badge);
  E.check(badge === "4", "the badge counts the four to do by tomorrow");
  E.tap('[data-tab="2"]');
  const groups = () => E.$$("main section").filter((s) => s.querySelector("h2")).map((s) => s.querySelector("h2").childNodes[0].textContent + " (" + s.querySelectorAll(".row").length + ")");
  console.log("B To do:", groups().join(", "));
  E.check(groups().join() === "Later (2),Due tomorrow (2),Due today (1),Overdue (1)", "groups from Later to Overdue");
  const late = E.$$(".row").find((r) => /Istorija/.test(r.textContent));
  console.log("  overdue:", E.text(late.querySelector(".pill")), "| red:", late.querySelector(".pill").classList.contains("red"));
  console.log("  placeholder '-' shown:", E.$$(".row").some((r) => /Dailė/.test(r.textContent)), "| file:", E.text("button.file"));
  E.check(!E.$$(".row").some((r) => /Dailė/.test(r.textContent)), "teachers' placeholder entries are hidden");
  E.tap('[data-hw="done"]');
  console.log("C Done:", groups().join(", "), "|", E.text(".row .pill"));
  E.check(groups().join() === "Earlier (1)" && E.text(".row .pill") === "Done", "done work, marked Done");
  E.tap('[data-hw="all"]');
  console.log("D All:", groups().join(", "));
  E.tap("button.file");
  await E.until(() => E.log.safari.length, "the file opens");
  console.log("E file opened:", E.log.safari[0]);
  E.finish(); await p;
  console.log("errors:", E.errors.length ? E.errors.join(" ; ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
