// Refresh and "what's new": the first load only records what's there; after new homework, a grade, a message and a
// teacher note arrive, Refresh pops them up, they stay under "New since last check" (tap one to open it) until
// Mark all as seen. Items older than 21 days are never announced.
const H = require("../harness");
(async () => {
  const kc = H.signedIn();
  let { E, p } = await H.run({ kc, settings: H.quiet() });
  await E.settle();
  const key = H.roleKeyOf(H.CHILDREN[0]);
  const seen = H.local(`dienynas-plus-seen-${H.hashKey(key)}.json`);
  console.log("A first load: baseline recorded:", seen in E.files, "| popup:", E.$("body.open-sheet") ? "yes" : "no", "| news section:", !!E.$(".newsp"));
  E.check(seen in E.files && !E.$(".newsp"), "the first load announces nothing");
  // new things in TAMO
  E.tamo.messages.unshift({ id: "9200", d: "2026-10-29T10:05:00", s: "Rytoj – sporto diena", from: "Mantas Bėgūnas", role: "Fizinio ugdymo mokytojas", unread: true, body: "Atsineškite sportinę aprangą." });
  E.tamo.homework.push({ id: "hw9", s: "Muzika", set: "2026-10-29", due: "2026-11-03", t: "Išmokti dainos posmą." });
  E.tamo.grades.push(["2026-10-29", "Anglų kalba", "10"], ["2026-10-05", "Istorija", "6"]);   // the second is older than 21 days
  E.tamo.feed.push({ id: "f9", eventId: "8", date: "2026-10-29T10:20:00", eventDetails: { ThingName: "Matematika", Date: "2026-10-29", Type: "Pastaba", Value: "Neatliko namų darbų." } });
  E.tap("#refresh");
  await E.until(() => E.$("body.open-sheet"), "the popup");
  await E.settle();
  console.log("B popup:", E.text("#sheet h3"), "|", E.$$("#sheet .row").map((r) => E.text(r.querySelector(".meta")).split(",")[0] + ": " + E.text(r.querySelector(".title"))).join(" · "));
  E.check(E.text("#sheet h3") === "4 new in TAMO" && !/Istorija/.test(E.text("#sheet")), "four new items; the old grade isn't announced");
  E.tap("#sheet [data-close]");
  const sec = () => E.$$("main section").find((s) => /New since last check/.test(s.textContent));
  console.log("C on Today:", sec() ? sec().querySelectorAll(".row").length + " items" : "none", "| saved:", (E.json(H.local(`dienynas-plus-news-${H.hashKey(key)}.json`)) || { items: [] }).items.length);
  const hwRow = [...sec().querySelectorAll("[data-newsidx]")].find((r) => /Muzika/.test(r.textContent));
  E.tap(hwRow);
  console.log("D homework item → tab:", E.text("h1.date"), "| filter:", E.text(".seg .on"));
  E.check(E.text("h1.date") === "Homework" && E.text(".seg .on") === "All", "a homework item opens Homework");
  E.tap('[data-tab="0"]');
  E.tap([...sec().querySelectorAll("[data-newsidx]")].find((r) => /sporto diena/.test(r.textContent)));
  await E.until(() => /sportinę/.test(E.text("#sheet")), "the message");
  console.log("E message item → opens it:", E.text("#sheet h3"));
  E.tap("#sheet [data-close]");
  E.tap("#newsclear");
  await E.settle();
  console.log("F Mark all as seen: section gone:", !sec(), "| file removed:", !(H.local(`dienynas-plus-news-${H.hashKey(key)}.json`) in E.files));
  E.check(!sec(), "marked as seen");
  E.finish(); await p;
  ({ E, p } = await H.run({ kc, files: E.files, settings: H.quiet(), tamoState: E.tamo }));
  await E.settle();
  console.log("G reopened: popup:", !!E.$("body.open-sheet"), "| news section:", !!E.$(".newsp"));
  E.check(!E.$("body.open-sheet") && !E.$(".newsp"), "nothing is announced twice");
  E.finish(); await p;
  console.log("errors:", E.errors.length ? E.errors.join(" ; ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
