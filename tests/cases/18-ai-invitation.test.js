// AI invitation (app-blueprints · ai-invitation): without a key, a card appears once the launch screen is gone; Later
// waits 3 days; Turn on AI opens AI settings with Add key highlighted; Don't remind me again ends it; an update offer
// wins over it; it follows the app's language.
const H = require("../harness");
const DAY = 864e5;
(async () => {
  const files = {}, kc = H.signedIn();
  const s0 = { usageAsked: true, photosAsked: true };
  let { E, p } = await H.run({ files, kc, settings: s0 });
  await E.until(() => E.$("#aiinv"), "the invitation", 9000);
  console.log("A invitation:", E.text("#aiinv h2"), "|", E.$$("#aiinv .aiinv-perks li").map((l) => E.text(l)).join(" · "));
  console.log("  over the launch screen:", !!E.$("#splash:not(.gone)"), "| buttons:", E.$$("#aiinv button").map((b) => b.textContent).join(" / "));
  E.check(E.$$("#aiinv .aiinv-perks li").length === 3 && !E.$("#splash:not(.gone)"), "three perks, never over the launch screen");
  E.tap('#aiinv [data-inv="later"]');
  await E.settle();
  const inv = E.settings().aiInvite;
  console.log("B Later: shown", inv.shown, "| later", inv.later, "| next in", Math.round((inv.next - H.NOW) / DAY), "days");
  E.check(inv.later === 1 && Math.round((inv.next - H.NOW) / DAY) === 3, "Later waits three days");
  E.finish(); await p;

  ({ E, p } = await H.run({ files, kc, now: H.NOW + DAY }));
  await E.settle(); await H.wait(800);
  console.log("C next day: offered again:", (E.log.evals || []).some((x) => x.includes("__aiInvite")));
  E.check(!(E.log.evals || []).some((x) => x.includes("__aiInvite")), "not before three days");
  E.finish(); await p;

  const lt = JSON.parse(files[H.SETTINGS]); lt.lang = "lt"; files[H.SETTINGS] = JSON.stringify(lt);
  ({ E, p } = await H.run({ files, kc, now: H.NOW + 4 * DAY }));
  await E.until(() => E.$("#aiinv"), "the invitation again", 9000);
  console.log("D four days later, in Lithuanian:", E.text("#aiinv h2"), "|", E.text("#aiinv .aiinv-go"));
  E.check(E.text("#aiinv h2") === "Suteikite Dienynas+ supergalių", "the invitation follows the app language");
  E.tap('#aiinv [data-inv="open"]');
  await E.until(() => E.$("#aisheet.open .aiinv-nudge"), "AI settings with Add key highlighted");
  console.log("  Turn on AI → AI settings open:", !!E.$("#aisheet.open"), "| highlighted:", E.text("#aisheet .aiinv-nudge"));
  E.finish(); await p;

  ({ E, p } = await H.run({ files, kc, now: H.NOW + 8 * DAY }));
  await E.until(() => E.$("#aiinv"), "the invitation once more", 9000);
  E.tap('#aiinv [data-inv="never"]');
  await E.settle();
  console.log("E Don't remind me again:", JSON.stringify(E.settings().aiInvite));
  E.finish(); await p;
  ({ E, p } = await H.run({ files, kc, now: H.NOW + 40 * DAY }));
  await E.settle(); await H.wait(800);
  console.log("  forty days later: offered:", (E.log.evals || []).some((x) => x.includes("__aiInvite")));
  E.check(E.settings().aiInvite.off === true && !(E.log.evals || []).some((x) => x.includes("__aiInvite")), "never again");
  E.finish(); await p;

  // an update offer wins: one sheet per launch
  ({ E, p } = await H.run({ kc, settings: s0, releases: H.releasesWithOffer() }));
  await E.until(() => E.$("#upd"), "the update offer", 9000);
  await H.wait(4000);
  console.log("F with an update offer: update sheet:", !!E.$("#upd"), "| invitation:", !!E.$("#aiinv"));
  E.check(E.$("#upd") && !E.$("#aiinv"), "the update offer, not the invitation");
  E.finish(); await p;
  console.log("errors:", E.errors.length ? E.errors.join(" ; ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
