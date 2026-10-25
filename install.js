// Dienynas+ installer for Scriptable: downloads the latest Dienynas script from GitHub.
// Run it again any time to update. Sign-in, settings and chat history are kept.
const SOURCE = "https://raw.githubusercontent.com/gadominas/Tamo-/master/Dienynas.js";
const NAME = "Dienynas";

const req = new Request(SOURCE);
let code = "";
try {
  code = await req.loadString();
} catch (_) {}
if (!req.response || req.response.statusCode !== 200 || !code.includes("Dienynas+")) {
  const e = new Alert();
  e.title = "Download failed";
  e.message = "Couldn't download Dienynas. Check the internet connection and run the installer again.";
  e.addAction("OK");
  await e.presentAlert();
} else {
  // Save next to this installer: in iCloud Drive or on the device, wherever Scriptable keeps scripts.
  const managers = [];
  try {
    managers.push(FileManager.iCloud());
  } catch (_) {}
  managers.push(FileManager.local());
  const fm = managers.find((m) => m.fileExists(m.joinPath(m.documentsDirectory(), `${Script.name()}.js`))) || managers[0];
  const path = fm.joinPath(fm.documentsDirectory(), `${NAME}.js`);
  const updating = fm.fileExists(path);
  fm.writeString(path, code);

  const a = new Alert();
  a.title = updating ? "Dienynas updated" : "Dienynas installed";
  a.message = updating ? "You're on the latest version." : "Open it and sign in with your TAMO username and password.";
  a.addAction("Open Dienynas");
  a.addCancelAction("Done");
  if ((await a.presentAlert()) === 0) Safari.open(`scriptable:///run/${encodeURIComponent(NAME)}`);
}
Script.complete();
