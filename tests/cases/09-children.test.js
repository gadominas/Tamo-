// Several children: the row at the top, the add-photos card (a photo, then Not now), switching child (fresh data on the
// same sign-in, then saved data at once), a grade scale per child, and the selected child's menu (remove the photo).
const H = require("../harness");
(async () => {
  const kc = H.signedIn();
  const [U, J] = H.CHILDREN.map(H.roleKeyOf);
  const { E, p } = await H.run({ kc, settings: H.quiet({ photosAsked: false }), tamo: { children: 2 }, alerts: [0] });
  await E.settle();
  const kids = () => E.$$(".kids .kid").map((k) => E.text(k) + (k.classList.contains("on") ? "*" : "") + (/background-image/.test(k.querySelector(".av").getAttribute("style")) ? "📷" : ""));
  console.log("A children at the top:", kids().join(", "), "| picked at sign-in:", E.log.alerts[0].title);
  E.check(kids().join() === "UPUgnė*,JPJonas", "both children, initials and first names, the first one selected");
  console.log("B photo card:", E.text(".photoask .title"), "|", E.$$(".pa-kid").map((k) => E.text(k)).join(", "));
  E.alert("Choose a photo");
  E.tap(`[data-photo="${J}"]`);
  await E.until(() => /✓ Added/.test(E.text(".photoask")), "the photo added");
  console.log("  photo chosen for Jonas:", E.log.photos, "pick | saved:", H.local(`dienynas-plus-avatar-${H.hashKey(J)}.jpg`) in E.files, "| card:", E.$$(".pa-kid").map((k) => E.text(k)).join(", "), "| top:", kids().join(", "));
  E.check(kids()[1] === "📷", "Jonas now shows his photo, without initials");
  E.tap("#photoslater");
  await E.settle();
  console.log("C Not now: card gone:", !E.$(".photoask"), "| remembered:", E.settings().photosAsked);
  E.check(!E.$(".photoask") && E.settings().photosAsked === true, "Not now hides the card for good");
  // switch to Jonas: no saved data for him yet, so TAMO is asked on the same sign-in
  const logins = E.log.logins;
  E.tap(`[data-kid="${J}"]`);
  await E.until(() => E.$(".kid.on") && E.$(".kid.on").getAttribute("aria-label") === "Jonas Pavyzdys", "Jonas selected");
  await E.settle();
  console.log("D switched to Jonas:", kids().join(", "), "| signed in again:", E.log.logins > logins, "| remembered:", E.kc["dienynasplus.role"] === J, "| his cache:", H.local(`dienynas-plus-cache-${H.hashKey(J)}.json`) in E.files);
  E.check(E.log.logins === logins && E.kc["dienynasplus.role"] === J, "switching keeps the sign-in");
  E.alert("1–7");
  E.tap('[data-tab="4"]'); E.tap("[data-scale]");
  await E.until(() => /1–7/.test(E.text("[data-scale]")), "Jonas's scale");
  console.log("E grade scales per child:", JSON.stringify(E.settings().gradeScales));
  E.check(E.settings().gradeScales[J] === 7 && !E.settings().gradeScales[U], "each child has their own scale");
  // back to Ugnė: her saved diary appears at once, then fresh data
  const mark = E.log.timeline.length;
  E.tap(`[data-kid="${U}"]`);
  await E.until(() => E.log.timeline.slice(mark).some((x) => x.startsWith("page")), "her saved page");
  const early = E.log.timeline.slice(mark)[0] === "page app";   // her page first, then TAMO  console.log("F back to Ugnė: saved data shown before asking TAMO:", early, "| shown:", E.$(".kid.on").getAttribute("aria-label"), "| switching:", E.getDom().window.document.body.classList.contains("switching"));
  E.check(early, "a child's saved data appears at once");
  await E.settle();
  console.log("  then fresh:", kids().join(", "), "| scale:", E.text('[data-tab="4"]') && (E.tap('[data-tab="4"]'), E.text("[data-scale]")));
  E.check(/Scale 1–10/.test(E.text("[data-scale]")), "Ugnė keeps 1–10");
  // the selected child's menu: remove Jonas's photo
  E.tap(`[data-kid="${J}"]`); await E.settle();
  E.alert("Remove photo");
  E.tap(`[data-kid="${J}"]`);
  await E.until(() => !(H.local(`dienynas-plus-avatar-${H.hashKey(J)}.jpg`) in E.files), "the photo removed");
  await E.settle();
  console.log("G menu:", E.lastAlert().actions.join(" / "), "| photo removed:", kids().join(", "));
  E.check(E.lastAlert().actions.join() === "Choose another photo,Remove photo,Log out", "photo and Log out in the selected child's menu");
  E.finish(); await p;
  console.log("errors:", E.errors.length ? E.errors.join(" ; ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
