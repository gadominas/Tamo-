// A phone that isn't signed in to iCloud (stability-patterns): the script lives on the phone, iCloud is never touched
// (on a real phone the first call ends the script), settings are kept locally, and an update writes the script locally.
const H = require("../harness");
(async () => {
  const kc = H.signedIn();
  const files = {};
  let { E, p } = await H.run({ files, kc, noICloud: true, releases: H.releasesWithOffer() });
  await E.settle();
  console.log("A opened without iCloud:", !!E.getDom().window.__booted, "| iCloud calls:", E.log.icloudCalls, "| Today:", E.text(".now").slice(0, 30));
  E.check(E.getDom().window.__booted && E.log.icloudCalls === 0, "opens and never touches iCloud");
  const set = H.LOCAL + "/DienynasPlus/settings.json";
  console.log("B settings kept on the phone:", set in files, "| nothing in iCloud:", !Object.keys(files).some((f) => f.startsWith(H.ICLOUD)));
  E.check(set in files && !Object.keys(files).some((f) => f.startsWith(H.ICLOUD)), "every file is on the phone");
  E.tap("#settings"); await E.until(() => E.$("#cfgsheet.open"), "settings");
  E.tap('[data-act="look"][data-k="density"][data-v="compact"]'); await E.settle();
  console.log("  layout saved locally:", E.json(set).density);
  E.check(E.json(set).density === "compact", "a setting is saved on the phone");
  E.tap('[data-act="cfgclose"]');
  // the update offer arrives a few seconds after start; Update now writes the script where it lives
  await E.until(() => E.$("#upd"), "the update sheet");
  E.tap('#upd [data-act="upd-now"]');
  await E.until(() => /Updated to/.test(E.text("#upd .updtag")), "updated");
  const script = H.LOCAL + "/Dienynas.js";
  console.log("C update written to:", script in files ? "the phone (" + (String(files[script]).match(/VERSION = '([^']+)'/) || [])[1] + ")" : "nowhere", "| sheet:", E.text("#upd .updtag"));
  E.check(script in files && E.log.icloudCalls === 0, "the update is written locally, without iCloud");
  E.finish(); await p;
  console.log("errors:", E.errors.length ? E.errors.join(" ; ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
