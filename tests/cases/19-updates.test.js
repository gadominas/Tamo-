// In-app updates (app-blueprints · in-app-updates): the offer a few seconds after start with three highlights, Later
// (snoozed two days, no check meanwhile), Settings › Check for updates now, Update now when GitHub still serves the
// old file, a download that isn't the script, then a good update; offers turned off; the offer in Lithuanian.
const H = require("../harness");
(async () => {
  const kc = H.signedIn();
  const o = { kc, settings: H.quiet(), releases: H.releasesWithOffer(2) };
  let { E, p } = await H.run(o);
  await E.until(() => E.$("#upd"), "the offer", 9000);
  console.log("A offer:", E.text("#upd .updtag"), "|", E.text("#upd .updt"), "|", E.text("#upd .upds"));
  console.log("  highlights:", E.$$("#upd .updi b").map((b) => b.textContent).join(", "));
  E.check(E.$$("#upd .updi").length === 3 && /1 more update/.test(E.text("#upd .upds")) && !/Never shown/.test(E.text("#upd")), "the newest highlights first, topped up to three");
  E.tap('#upd [data-act="upd-later"]');
  await E.settle();
  const until = Number(E.kc["dienynasplus-update-snooze"]);
  console.log("B Later: sheet gone:", !E.$("#upd"), "| snoozed for", Math.round((until - H.NOW) / 3600e3), "hours");
  E.finish(); await p;
  ({ E, p } = await H.run(o));
  await E.settle();
  console.log("  reopened: asked GitHub:", E.log.updateChecks || 0, "times");
  E.check(!E.log.updateChecks, "no check while snoozed");
  E.tap("#settings"); await E.until(() => E.$("#cfgsheet.open"), "Settings");
  E.tap('[data-act="updcheck"]');
  await E.until(() => E.$("#upd"), "the offer after Check now");
  console.log("C Check for updates now:", E.text("#updmsg"), "| Settings closed:", !E.$("#cfgsheet.open"), "| snooze cleared:", !("dienynasplus-update-snooze" in E.kc));
  o.updateStale = true;
  E.tap('#upd [data-act="upd-now"]');
  await E.until(() => E.text("#upd .updmsg"), "the stale answer");
  console.log("D GitHub still serving the old file:", E.text("#upd .updmsg"), "| button:", E.text("#upd .updgo"), "| Later back:", !E.$("#upd .updlater").hidden);
  E.check(/still serving the old version/.test(E.text("#upd .updmsg")) && !(H.ICLOUD + "/Dienynas.js" in E.files), "an old file is never installed");
  o.updateStale = false; o.updateScript = "<html><body>404: Not Found</body></html>";
  E.tap('#upd [data-act="upd-now"]');
  await E.until(() => /didn't look right/.test(E.text("#upd .updmsg")), "the bad download");
  console.log("E a download that isn't the script:", E.text("#upd .updmsg"));
  delete o.updateScript;
  E.tap('#upd [data-act="upd-now"]');
  await E.until(() => /Updated to/.test(E.text("#upd .updtag")), "updated");
  const written = String(E.files[H.ICLOUD + "/Dienynas.js"] || "");
  console.log("F updated:", E.text("#upd .updtag"), "|", E.text("#upd .updmsg"), "| written over the script:", (written.match(/VERSION = '([^']+)'/) || [])[1]);
  E.check(/1\.16\.0/.test(written) && /APP_ID = 'dienynasplus'/.test(written), "the newer script replaces this one");
  E.tap('#upd [data-act="upd-close"]');
  E.finish(); await p;

  ({ E, p } = await H.run({ kc, settings: H.quiet({ checkUpdates: false }), releases: H.releasesWithOffer() }));
  await E.settle(); await H.wait(300);
  console.log("G offers turned off: asked GitHub:", E.log.updateChecks || 0, "| sheet:", !!E.$("#upd"));
  E.check(!E.log.updateChecks && !E.$("#upd"), "no check when offers are off");
  E.finish(); await p;
  ({ E, p } = await H.run({ kc, settings: H.quiet({ lang: "lt" }), releases: H.releasesWithOffer() }));
  await E.until(() => E.$("#upd"), "the offer in Lithuanian", 9000);
  console.log("H in Lithuanian:", E.text("#upd .updt"), "|", E.text("#upd .updgo"), "/", E.text("#upd .updlater"));
  E.finish(); await p;
  console.log("errors:", E.errors.length ? E.errors.join(" ; ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
