// Today: the lesson on now, today's lessons, getting ready for the next school day, homework to do, today's messages,
// tests ahead and what's new this week. Then before school, after school, a holiday, and in Lithuanian.
const H = require("../harness");
const sectionText = (E, title) => { const s = E.$$("section").find((x) => (x.querySelector("h2") || {}).textContent && x.querySelector("h2").textContent.startsWith(title)); return s ? E.text(s) : ""; };
(async () => {
  const kc = H.signedIn();
  let { E, p } = await H.run({ kc, settings: H.quiet() });
  await E.settle();
  console.log("A now:", E.text(".now"));
  E.check(/ends in 13 min\. Next lesson: Gamtos mokslai/.test(E.text(".now")), "the lesson on now, minutes left and the next one");
  const today = E.$$("section").find((s) => /Today's lessons/.test(s.textContent));
  const rows = [...today.querySelectorAll(".lesson")];
  console.log("B today's lessons:", rows.map((r) => r.querySelector(".title").textContent + (r.classList.contains("past") ? " (done)" : r.classList.contains("current") ? " (now)" : "")).join(", "));
  console.log("  marks on lessons:", rows.map((r) => [...r.querySelectorAll(".pill.grade")].map((x) => x.textContent).join("")).filter(Boolean).join(", "));
  E.check(rows.length === 5 && rows[0].classList.contains("past") && rows[2].classList.contains("current"), "finished lessons fade, the current one is marked");
  const prep = sectionText(E, "Get ready for");
  console.log("C", prep);
  E.check(/Get ready for tomorrow, friday/.test(prep) && /Matematika Kontrolinis darbas/.test(prep) && /Vadovėlis p\. 48/.test(prep) && /Perskaityti pasaką/.test(prep), "tomorrow's subjects, the test and the homework due");
  const todo = sectionText(E, "Homework to do");
  console.log("D", todo);
  E.check(/Istorija/.test(todo) && /2 days late/.test(todo) && /Informatika/.test(todo) && !/Dailė/.test(todo), "overdue and due-today homework; teachers' '-' hidden");
  const msgs = sectionText(E, "Today's messages");
  console.log("E", msgs);
  E.check(/Ekskursija/.test(msgs) && /Penktadienio/.test(msgs) && !/Tėvų susirinkimas/.test(msgs), "only today's messages");
  const checks = sectionText(E, "Tests and checks ahead");
  console.log("F", checks);
  E.check(/Kontrolinis darbas/.test(checks) && /Žodžių diktantas/.test(checks), "tests in the next two weeks");
  const news = sectionText(E, "New this week");
  console.log("G", news);
  E.check(/Grade/.test(news) && /Praise/.test(news) && /Absent/.test(news) && /Assessment/.test(news) && !/New homework/.test(news), "grades, praise, absences; new homework isn't repeated here");
  E.finish(); await p;

  const at = (iso) => Date.parse(iso);
  ({ E, p } = await H.run({ kc, settings: H.quiet(), now: at("2026-10-29T05:30:00Z") }));   // 07:30 in Vilnius
  await E.settle();
  console.log("H before school:", E.text(".now"));
  E.check(/Next lesson, 08:00 ?Matematika ?starts in 30 min/.test(E.text(".now")), "the next lesson before school");
  E.finish(); await p;
  ({ E, p } = await H.run({ kc, settings: H.quiet(), now: at("2026-10-29T14:00:00Z") }));   // 16:00
  await E.settle();
  console.log("I after school:", E.text(".now"));
  E.check(/Lessons are over for today/.test(E.text(".now")), "lessons over");
  E.finish(); await p;
  ({ E, p } = await H.run({ kc, settings: H.quiet(), now: at("2026-11-02T08:00:00Z") }));   // Monday 2 November, a day off
  await E.settle();
  console.log("J holiday:", E.text(".banner.info"), "|", E.text(".now"));
  E.check(/Vėlinės/.test(E.text(".banner.info")) && /No lessons today/.test(E.text(".now")), "the holiday banner");
  E.finish(); await p;

  ({ E, p } = await H.run({ kc, settings: H.quiet({ lang: "lt" }) }));
  await E.settle();
  console.log("K Lithuanian:", E.text("h1.date"), "|", E.text(".now").slice(0, 40), "|", E.$$("section h2").map((h) => h.textContent).slice(1, 4).join(" / "));
  E.check(E.text("h1.date") === "Ketvirtadienis, spalio 29 d." && /Pasiruošti: rytoj, penktadienis/.test(E.text("#app")), "Today in Lithuanian");
  E.finish(); await p;
  console.log("errors:", E.errors.length ? E.errors.join(" ; ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
