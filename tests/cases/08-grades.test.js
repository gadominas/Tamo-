// Grades: subject averages for 30 days, recent grades, formative assessments, attendance, and the grade scale
// (1–7 from the Grades tab, then Other… with an invalid and a valid top grade).
const H = require("../harness");
(async () => {
  const { E, p } = await H.run({ kc: H.signedIn(), settings: H.quiet() });
  await E.settle();
  E.tap('[data-tab="4"]');
  const avgs = () => E.$$(".avg").map((a) => E.text(a.querySelector(".s")).replace(/ ?\d+×/, "") + " " + E.text(a.querySelector(".v")));
  console.log("A averages:", avgs().join(", "), "|", E.text("[data-scale]"));
  E.check(avgs().join() === "Anglų kalba 9.5,Lietuvių kalba 9.0,Gamtos mokslai 9.0,Matematika 8.0,Istorija 8.0", "30-day averages, best first");
  const sec = (t) => E.$$("main section").find((s) => s.querySelector("h2") && s.querySelector("h2").textContent.startsWith(t));
  console.log("B recent:", [...sec("Recent grades").querySelectorAll(".row")].map((r) => E.text(r.querySelector(".title")) + " " + E.text(r.querySelector(".pill"))).join(", "));
  console.log("C formative:", E.text(sec("Formative assessments").querySelector(".row")), "| attendance:", E.text(sec("Attendance").querySelector(".chips")));
  E.check(/1 absent/.test(E.text(sec("Attendance"))) && /1 late/.test(E.text(sec("Attendance"))), "absences and late arrivals counted");
  E.alert("1–7");
  E.tap("[data-scale]");
  await E.until(() => /Scale 1–7/.test(E.text("[data-scale]")), "the 1–7 scale");
  const sheet = E.log.alerts.slice(-1)[0];
  console.log("D scale sheet:", sheet.title, "|", sheet.message, "|", sheet.actions.join(" / "), "→ still on Grades:", /Averages/.test(E.text("main")));
  console.log("  averages on 1–7:", avgs().join(", "), "| saved:", JSON.stringify(E.settings().gradeScales));
  E.check(E.settings().gradeScales[H.roleKeyOf(H.CHILDREN[0])] === 7, "the scale is saved for this child");
  E.alert("Other…", ["1"]);
  E.tap("[data-scale]"); await E.settle();
  console.log("E Other… with 1:", E.text("[data-scale]"), "(unchanged)");
  E.alert("Other…", ["12"]);
  E.tap("[data-scale]");
  await E.until(() => /Scale 1–12/.test(E.text("[data-scale]")), "the 1–12 scale");
  console.log("  Other… with 12:", E.text("[data-scale]"), "| prompt:", E.log.alerts.slice(-1)[0].title);
  E.finish(); await p;
  console.log("errors:", E.errors.length ? E.errors.join(" ; ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
