// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: deep-blue; icon-glyph: graduation-cap;

/*
 * Dienynas+ — a faster, cleaner wrapper for the TAMO dienynas (Lithuanian school e-diary).
 *
 * Talks to the same API the official TAMO mobile app uses (api.tamo.lt + dienynas.tamo.lt/MobileServiceV3),
 * as documented by github.com/sobakintech/tamo-dienynas-api. Read-only except one thing: opening a message
 * marks it as read in TAMO, exactly like the official app does.
 *
 * Credentials live in the iOS Keychain (Scriptable's Keychain API), never in this file.
 * Run as an app for the full UI; add it as a Scriptable widget for a glanceable "today" view
 * (the shared widget frame, app-blueprints · widgets).
 *
 * Unofficial: TAMO's terms of use do not cover third-party clients. Use with your own account only.
 *
 * Opens on a 2.4 s launch screen with the Dienynas+ calendar logo (app-blueprints · launch-screen), drawn in an
 * empty window that is already on screen; the diary is handed over after (app-blueprints · recipes/safe-startup).
 * Without an AI key, a short invitation now and then shows what ✨ Ask adds (app-blueprints · ai-invitation).
 * The BLUEPRINTS block below lists every shared blueprint this app follows (Settings › Built with).
 */

const APP_NAME = "Dienynas+";
const ZONE = "Europe/Vilnius";
const MODERN = "https://api.tamo.lt/";
const LEGACY = "https://dienynas.tamo.lt/MobileServiceV3/";
const APP_GUID = "1166cfd3-1be5-4dca-aa64-5aff7bbb8acc"; // build constant the official Android app sends
const SESSION_TTL_MIN = 25;


// This build's version. When releasing, bump it and add a matching entry to releases.json.
const VERSION = '1.10.0';
const APP_ID = 'dienynasplus';   // unique per app, never changes
const REPO_RAW = 'https://raw.githubusercontent.com/gadominas/Tamo-/master/';
const SCRIPT_FILE = 'Dienynas.js';   // the script's file name in the repository
const UPDATE_SNOOZE_MS = 2 * 24 * 3600 * 1000;   // "Later" = 2 days
const KC_UPDATE_SNOOZE = 'dienynasplus-update-snooze';   // Keychain key, unique per app

// ───────── Blueprints ─────────
// Shared blueprints this app was built with (github.com/gadominas/app-blueprints). One line per blueprint, in this exact shape:
// inventory tools read it without running the script, and Settings › Built with shows it.
const BLUEPRINTS_REPO = 'https://github.com/gadominas/app-blueprints';
const BLUEPRINTS = [
  { id: 'in-app-updates', name: 'In-app updates', version: '1.0.0', since: '1.4.0' },
  { id: 'settings', name: 'Settings', version: '1.1.0', since: '1.10.0' },
  { id: 'ai-configuration', name: 'AI configuration', version: '1.0.0', since: '1.5.0' },
  { id: 'launch-screen', name: 'Launch screen', version: '1.0.0', since: '1.7.0' },
  { id: 'widgets', name: 'Widgets', version: '1.0.0', since: '1.8.0' },
  { id: 'ai-invitation', name: 'AI invitation', version: '1.2.1', since: '1.9.0' },
];

const K = {
  user: "dienynasplus.username",
  pass: "dienynasplus.password",
  role: "dienynasplus.role",
  session: "dienynasplus.session",
  // 1.5.x kept the language and grade scales here; moved to settings.json on first run
  lang: "dienynasplus.lang",
  scale: "dienynasplus.grade-scale",
};

// ───────── AI invitation (app-blueprints · ai-invitation) ─────────
// What the invitation promises. Exactly three perks, each a real feature that needs a key (all of them ✨ Ask,
// the app's one AI feature, hidden without a key). Dienynas+: `lt` is shown when the app language is Lithuanian.
const AI_INVITE = {
  title: "Give Dienynas+ superpowers",          // punchy, names the app, at most 32 characters
  perks: [                                      // icon + at most 48 characters each
    { icon: "✦", text: "Ask anything about the school week" },
    { icon: "🎒", text: "What's due tomorrow and what to pack" },
    { icon: "✉️", text: "Teachers' messages, summed up for you" },
  ],
  lt: {
    title: "Suteikite Dienynas+ supergalių",
    perks: [
      { icon: "✦", text: "Klauskite bet ko apie mokyklos savaitę" },
      { icon: "🎒", text: "Kas užduota rytojui ir ką įsidėti į kuprinę" },
      { icon: "✉️", text: "Mokytojų žinutės, apibendrintos už jus" },
    ],
  },
};

// ───────────────────────────── settings (app-blueprints · settings) ─────────────────────────────
// Choices live in settings.json in iCloud Drive › Scriptable › DienynasPlus; school data, chats and sign-in stay where they were.
const SET_APP = "DienynasPlus";
const sfm = (() => { try { return FileManager.iCloud(); } catch (e) { return FileManager.local(); } })();
const SET_DIR = sfm.joinPath(sfm.documentsDirectory(), SET_APP);
const SP = (n) => sfm.joinPath(SET_DIR, n + ".json");

// A short start-up log on the phone (local, not iCloud): Settings › Updates › Start-up log, and on screen if opening stalls.
// It records timings and file names only: never sign-in details, names or school data (recipe · safe-startup).
const LOG_PATH = FileManager.local().joinPath(FileManager.local().documentsDirectory(), APP_ID + "-startup.log");
function startLog(msg) {
  try {
    const lfm = FileManager.local(), line = new Date().toISOString().slice(11, 19) + "  " + msg;
    const old = lfm.fileExists(LOG_PATH) ? lfm.readString(LOG_PATH).split("\n").slice(-60) : [];
    lfm.writeString(LOG_PATH, old.concat(line).join("\n"));
  } catch (e) {}
}

const loadIssues = [];    // files that didn't arrive (iCloud too slow, or unreadable): never written this run
const loadRepaired = [];  // files that arrived damaged: kept aside as <name>.broken-<time>.json, then started fresh
async function load(n, def, waitMs = 10000) {
  const p = SP(n);
  if (!sfm.fileExists(p)) return def;
  let txt;
  try {
    if (sfm.isFileStoredIniCloud(p) && !sfm.isFileDownloaded(p)) {
      // iCloud can take a long time (or forever, offline): never let start-up hang on it
      await Promise.race([sfm.downloadFileFromiCloud(p), new Promise((r) => Timer.schedule(waitMs, false, r))]);
      if (!sfm.isFileDownloaded(p)) { loadIssues.push(n); startLog(`iCloud didn't deliver ${n}.json in ${waitMs / 1000} s`); return def; }
    }
    txt = sfm.readString(p);
    if (typeof txt !== "string") throw new Error("no text");
  } catch (e) { loadIssues.push(n); startLog(`Couldn't read ${n}.json: ${e}`); return def; }   // not read: never saved over
  try { return JSON.parse(txt); }
  catch (e) { keepBroken(sfm, p, n, txt); return def; }   // arrived damaged: copied aside, then saving carries on
}
// It arrived but is damaged: keep a copy next to it, then start this file fresh so saving can carry on (1.1.0).
// Without this, one damaged file stopped the app from ever saving again. The widget reads the data on every refresh
// and never saves, so a copy that's already there is not made again. The parse error isn't logged: it can quote the file.
function keepBroken(fm, p, n, txt) {
  try {
    const base = p.replace(/\.json$/, ""), dir = p.slice(0, p.lastIndexOf("/")), pre = base.slice(dir.length + 1) + ".broken-";
    let kept = false;
    try { kept = fm.listContents(dir).some(f => f.startsWith(pre) && fm.readString(fm.joinPath(dir, f)) === txt); } catch (_) {}
    if (!kept) fm.writeString(base + ".broken-" + Date.now() + ".json", txt);
    if (!loadRepaired.includes(n)) loadRepaired.push(n);
    startLog(`${n}.json was damaged (not valid JSON); ${kept ? "a copy was already kept" : "kept a copy"} and started it fresh`);
  } catch (e) { loadIssues.push(n); startLog(`${n}.json was damaged and couldn't be copied aside`); }   // no copy, no overwrite
}
// Files are only written once they were read, so a slow start can never save defaults over them.
// settings.json is the only file write() handles; usage is guarded in aiWrite() the same way.
let settingsOk = false;   // set by loadSettings(): settings that were never read are never saved over
let dataLoaded = false;   // set by loadData()
const write = (n, v) => {
  if (n === "settings" ? !settingsOk : !dataLoaded) return false;
  try { if (!sfm.fileExists(SET_DIR)) sfm.createDirectory(SET_DIR, true); sfm.writeString(SP(n), JSON.stringify(v)); return true; }
  catch (e) { console.warn(`Couldn't save ${n}: ${e}`); return false; }
};

// Defaults first, saved choices on top (loadSettings runs before every branch: app, widget, Shortcuts check).
const settings = {
  lang: "en", checkUpdates: true,   // offer new versions from GitHub (asks again 2 days after "Later")
  theme: "auto", density: "comfortable", font: "sans", textSize: 1,
  gradeScales: {},   // top grade per child: { roleKey: 10 }
  cfg: {},
};
const saveSettings = () => write("settings", settings);

// Every key the page may change, with its check and what closing Settings must then do.
const SET_KEYS = {
  lang: [(v) => ["en", "lt"].includes(v), "render"], checkUpdates: ["bool", ""],
  theme: [(v) => v === "auto" || !!PALETTES[v], ""], density: [(v) => ["comfortable", "compact", "tiny"].includes(v), ""],
  font: [(v) => ["sans", "serif"].includes(v), ""], textSize: [(v) => [0.92, 1, 1.12, 1.25].includes(+v), ""],
};
// Returns the effect ('' or 'render'), or null when the key or value isn't allowed.
function setSetting(k, v) {
  const s = SET_KEYS[k];
  if (!s) return null;
  if (s[0] === "bool") v = v === true || v === "true";
  else if (!s[0](v)) return null;
  if (k === "textSize") v = +v;
  settings[k] = v;
  return s[1];
}

async function loadSettings() {
  const saved = await load("settings", null);
  settingsOk = !loadIssues.includes("settings");   // not read in time: use defaults, save nothing over the file
  if (saved) Object.assign(settings, saved);
  else {   // first run of 1.6: move what 1.5.x kept in the Keychain into settings.json
    // (also a damaged settings.json, listed in loadRepaired: it was copied aside, so the defaults are saved over it)
    if (Keychain.contains(K.lang)) settings.lang = Keychain.get(K.lang);
    try { if (Keychain.contains(K.scale)) settings.gradeScales = JSON.parse(Keychain.get(K.scale)) || {}; } catch (_) {}
    if (saveSettings()) [K.lang, K.scale].forEach((k) => Keychain.contains(k) && Keychain.remove(k));
  }
  const d = { lang: "en", theme: "auto", density: "comfortable", font: "sans", textSize: 1 };
  for (const k of Object.keys(d)) if (setSetting(k, settings[k]) === null) settings[k] = d[k];
  if (!settings.gradeScales || typeof settings.gradeScales !== "object") settings.gradeScales = {};
  settings.cfg = settings.cfg && typeof settings.cfg === "object" ? settings.cfg : {};
}

// Data is read in loadData() (recipe · safe-startup): the app shows its first screen before reading it.
// Dienynas+ keeps its data on this iPhone: the last diary TAMO sent (shown while TAMO is asked again) and the
// AI token usage. Chats and "what's new" files are read per child later, after the window is up.
let diaryCache = null;   // dienynas-plus-cache.json, or null when nothing is saved yet
async function loadData() {
  loadIssues.length = 0;   // loadRepaired is kept, so a damaged settings.json (read before this) still gets its toast
  diaryCache = readCache();   // a broken cache reads as "nothing saved": TAMO's next answer replaces it
  const p = aiPath("usage");
  if (aiFm.fileExists(p)) {
    let txt = null;
    try { txt = aiFm.readString(p); if (typeof txt !== "string") throw new Error("no text"); }
    catch (e) { txt = null; loadIssues.push("usage"); startLog(`Couldn't read usage.json: ${e}`); }   // not read: never saved over
    if (txt !== null) {
      try { usage = JSON.parse(txt); }
      catch (e) {   // arrived damaged: copied aside, counting starts fresh and is saved now (usage is otherwise saved
        // only after an AI call, so the damaged file and its toast would stay until the next question to Ask)
        keepBroken(aiFm, p, "usage", txt);
        if (!loadIssues.includes("usage")) { usage = { since: Date.now(), p: {} }; try { aiFm.writeString(p, JSON.stringify(usage)); } catch (e2) {} }
      }
    }
  }
  dataLoaded = loadIssues.length === 0;   // anything missing: show what we have, save nothing over it
}

// Everything tunable lives here; the Settings screen edits these (stored in settings.cfg, defaults below).
// Group titles and labels carry a Lithuanian version (lt), shown when the app language is Lithuanian.
const CONFIG = [
  [{ en: "What Ask reads", lt: "Ką skaito „Klausk“" }, [
    { k: "askMaxAgeH", label: "Gather school data again after", help: "Ask re-reads TAMO before the next question when its data is older", unit: "h", def: 4, min: 1, max: 24, step: 1,
      lt: { label: "Iš naujo surinkti duomenis po", help: "Prieš kitą klausimą „Klausk“ vėl nuskaito TAMO, jei duomenys senesni", unit: "val." } },
    { k: "weeksBack", label: "Lesson weeks before this week", unit: "weeks", def: 2, min: 0, max: 6, step: 1, lt: { label: "Pamokų savaitės prieš šią", unit: "sav." } },
    { k: "weeksAhead", label: "Lesson weeks after this week", unit: "weeks", def: 2, min: 0, max: 6, step: 1, lt: { label: "Pamokų savaitės po šios", unit: "sav." } },
    { k: "messageDays", label: "Message headers from the last", unit: "days", def: 60, min: 14, max: 180, step: 1, lt: { label: "Žinučių antraštės per paskutines", unit: "d." } },
    { k: "bodyDays", label: "Text of read messages from the last", help: "Unread messages stay unread", unit: "days", def: 45, min: 7, max: 120, step: 1,
      lt: { label: "Perskaitytų žinučių tekstas per paskutines", help: "Neperskaitytos žinutės lieka neperskaitytos", unit: "d." } },
    { k: "maxBodies", label: "At most this many message texts", unit: "messages", def: 30, min: 5, max: 60, step: 5, lt: { label: "Daugiausia žinučių tekstų", unit: "žin." } },
  ]],
  [{ en: "TAMO", lt: "TAMO" }, [
    { k: "requestWait", label: "Time limit per request to TAMO", unit: "s", def: 25, min: 10, max: 60, step: 5, lt: { label: "Laiko limitas vienai užklausai į TAMO", unit: "s" } },
  ]],
  [{ en: "Widget", lt: "Valdiklis" }, [
    { k: "widgetRefreshMin", label: "Ask iOS to refresh every", help: "iOS decides the exact timing", unit: "min", def: 20, min: 15, max: 120, step: 5,
      lt: { label: "Prašyti iOS atnaujinti kas", help: "Tikslų laiką nusprendžia iOS", unit: "min." } },
    { k: "widgetCacheMin", label: "Widget reuses data younger than", help: "Older data is loaded from TAMO again", unit: "min", def: 30, min: 10, max: 120, step: 5,
      lt: { label: "Valdiklis naudoja duomenis, jaunesnius nei", help: "Senesni duomenys vėl įkeliami iš TAMO", unit: "min." } },
    { k: "widgetStaleMin", label: "Mark the widget as out of date after", help: "Older data shows \"Updated …\" in amber", unit: "min", def: 720, min: 60, max: 2880, step: 60,
      lt: { label: "Pažymėti valdiklį kaip pasenusį po", help: "Senesni duomenys rodomi kaip „Atnaujinta …“ gintaro spalva", unit: "min." } },
  ]],
];
const CFG_FLAT = CONFIG.flatMap(([, items]) => items);
const cfgDef = (k) => CFG_FLAT.find((x) => x.k === k);
const cfg = (k) => { const v = settings.cfg && settings.cfg[k]; return v === undefined ? cfgDef(k).def : v; };
function setCfg(k, v) {
  const d = cfgDef(k);
  if (!d) return "Unknown setting";
  settings.cfg = settings.cfg || {};
  if (v === null) { delete settings.cfg[k]; return ""; }   // Reset
  v = Number(String(v).replace(",", "."));   // accept a decimal comma
  if (!isFinite(v)) v = d.def;
  v = Math.min(d.max, Math.max(d.min, v));
  v = d.step < 1 ? Math.round(v / d.step) * d.step : Math.round(v);
  v = Number(v.toFixed(2));
  if (v === d.def) delete settings.cfg[k]; else settings.cfg[k] = v;   // store only what differs
  return "";
}

// Six palettes on the shared colour tokens. TAMO blue is the accent in all of them; mark (the yellow
// "now / today" highlighter), markInk and green are this app's own extra colours.
const PALETTES = {
  ink:      { paper: "#EEF1F6", sheet: "#FFFFFF", ink: "#15203A", ink2: "#33405E", muted: "#5F6A84", rule: "#DCE1EA", signal: "#2450B8", signalWash: "#E2E9FB", amber: "#9A6200", amberWash: "#FDF0D2", danger: "#C8243A", mark: "#FFD84D", markInk: "#3B2F00", green: "#14866A", scheme: "light" },
  sepia:    { paper: "#F3EAD6", sheet: "#FBF5E6", ink: "#2A1F14", ink2: "#4B3B2A", muted: "#73604A", rule: "#E1D3B5", signal: "#2B4E9E", signalWash: "#E3E4EC", amber: "#A16207", amberWash: "#F6E5BF", danger: "#9F1239", mark: "#F5CF55", markInk: "#3B2F00", green: "#3F7A3A", scheme: "light" },
  mint:     { paper: "#F1F6F3", sheet: "#FFFFFF", ink: "#0D2318", ink2: "#2C4A3B", muted: "#556D60", rule: "#D3E2D9", signal: "#2450B8", signalWash: "#E0E8F8", amber: "#B45309", amberWash: "#FBEED8", danger: "#B91C1C", mark: "#FFD84D", markInk: "#3B2F00", green: "#15803D", scheme: "light" },
  contrast: { paper: "#FFFFFF", sheet: "#FFFFFF", ink: "#000000", ink2: "#111111", muted: "#333333", rule: "#9A9A9A", signal: "#0033CC", signalWash: "#E0E8FF", amber: "#7A4B00", amberWash: "#FFEEC2", danger: "#A30000", mark: "#FFD400", markInk: "#000000", green: "#006B3C", scheme: "light" },
  slate:    { paper: "#1C2128", sheet: "#22272E", ink: "#E6EDF3", ink2: "#C5CED8", muted: "#9AA5B1", rule: "#373E47", signal: "#7FA3FF", signalWash: "#1D3350", amber: "#E3B341", amberWash: "#3A2F12", danger: "#FF8A7A", mark: "#E8BE2E", markInk: "#2A2100", green: "#3CC59E", scheme: "dark" },
  night:    { paper: "#0C111C", sheet: "#161E2E", ink: "#E8ECF4", ink2: "#C9D0DE", muted: "#9AA4BA", rule: "#253049", signal: "#7FA3FF", signalWash: "#16233F", amber: "#F0C52E", amberWash: "#2D240C", danger: "#FF6B7D", mark: "#F0C52E", markInk: "#2A2100", green: "#3CC59E", scheme: "dark" },
};
const PALETTE_CSS = Object.entries(PALETTES).map(([k, p]) => `[data-theme=${k}]{--paper:${p.paper};--sheet:${p.sheet};--ink:${p.ink};--ink-2:${p.ink2};--muted:${p.muted};--rule:${p.rule};--signal:${p.signal};--signal-wash:${p.signalWash};--amber:${p.amber};--amber-wash:${p.amberWash};--danger:${p.danger};--mark:${p.mark};--markInk:${p.markInk};--green:${p.green};color-scheme:${p.scheme}}`).join("\n");

// The look for the first paint, so the page never flashes the default palette (the page keeps Auto live afterwards).
function lookState() {
  return { theme: settings.theme, density: settings.density, font: settings.font, textSize: settings.textSize,
           shown: settings.theme === "auto" ? (Device.isUsingDarkAppearance() ? "night" : "ink") : settings.theme };
}

// What the Settings sheet shows, in the app's language. Keys and passwords never go to the page.
function settingsState(child, canSwitch) {
  const lt = LANG() === "lt", loc = (d) => (lt && d.lt ? Object.assign({}, d, d.lt) : d);
  return {
    lang: LANG(), settings: Object.fromEntries(Object.keys(SET_KEYS).map((k) => [k, settings[k]])),
    cfg: Object.fromEntries(CFG_FLAT.map((d) => [d.k, cfg(d.k)])),
    cfgSchema: CONFIG.map(([title, items]) => ({ title: lt ? title.lt : title.en, items: items.map((d) => { const x = loc(d); delete x.lt; return x; }) })),
    palettes: PALETTES, version: VERSION, appName: APP_NAME,
    blueprints: BLUEPRINTS, blueprintsRepo: BLUEPRINTS_REPO,
    child: child ? { name: child.title, scale: gradeMaxFor(child.key) } : null, canSwitch: !!canSwitch,
    hasKey: !!aiKey(), aiStatus: aiStatusLine(),
  };
}

// ───────────────────────────── text & date helpers ─────────────────────────────

const ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(v) {
  return v.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === "#") {
      const code = e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// TAMO text fields mix plain text and small HTML fragments.
function plain(raw) {
  if (raw === null || raw === undefined) return "";
  const value = String(raw).replace(/\r\n?/g, "\n");
  if (!value.includes("<") && !value.includes("&")) return value.trim();
  const text = value
    .replace(/<a\s[^>]*href\s*=\s*["']([^"']+)["'][^>]*>(.*?)<\/a>/gi, (m, href, label) => {
      const l = label.replace(/<[^>]*>/g, "").trim();
      return l && l !== href ? `${l} (${href})` : href;
    })
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h\d)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<[^>]*>/g, "");
  return decodeEntities(text).replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

// Teachers often put "-" or "x" in the homework field when nothing was set.
function isPlaceholder(v) {
  const t = (v || "").trim();
  return t.length <= 1 || !/[\p{L}\p{N}]/u.test(t);
}

const str = (o, k) => {
  const v = o ? o[k] : undefined;
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  return "";
};
const obj = (o, k) => (o && o[k] && typeof o[k] === "object" && !Array.isArray(o[k]) ? o[k] : {});
const list = (o, k) => (o && Array.isArray(o[k]) ? o[k].filter((x) => x && typeof x === "object") : []);
const one = (o, k) => {
  const v = o ? o[k] : undefined;
  if (Array.isArray(v)) return v.filter((x) => x && typeof x === "object");
  return v && typeof v === "object" ? [v] : [];
};
function requiredList(o, k) {
  if (!o || !Array.isArray(o[k])) throw new TamoError(`TAMO returned an unexpected "${k}" response`);
  return o[k];
}

function vilniusParts(date, opts) {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone: ZONE, hourCycle: "h23", ...opts }).formatToParts(date);
  return Object.fromEntries(parts.map((p) => [p.type, p.value]));
}
function todayV(now = new Date()) {
  const p = vilniusParts(now, { year: "numeric", month: "2-digit", day: "2-digit" });
  return `${p.year}-${p.month}-${p.day}`;
}
function loginDateTime(now = new Date()) {
  const p = vilniusParts(now, { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}
const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
const mondayOf = (d) => addDays(d, -((new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7));
function dateOnly(v) {
  const c = String(v || "").trim().slice(0, 10).replace(/\./g, "-");
  return /^\d{4}-\d{2}-\d{2}$/.test(c) && !Number.isNaN(Date.parse(`${c}T00:00:00Z`)) ? c : "";
}
// "...Utc" fields sometimes arrive without a zone designator; they are still UTC.
function utcInstant(v) {
  const s = String(v || "").trim();
  if (!s) return null;
  const withZone = /(Z|[+-]\d\d:?\d\d)$/.test(s) ? s : `${s}Z`;
  const d = new Date(withZone);
  return Number.isNaN(d.getTime()) ? null : d;
}
function localTime(v) {
  const d = utcInstant(v);
  if (!d) return "";
  const p = vilniusParts(d, { hour: "2-digit", minute: "2-digit" });
  return `${p.hour}:${p.minute}`;
}
function localDate(v) {
  const d = utcInstant(v);
  if (!d) return dateOnly(v);
  return todayV(d);
}

function compact(o) {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null && v !== "" && !(Array.isArray(v) && v.length === 0)));
}

// ───────────────────────────── API client ─────────────────────────────

class TamoError extends Error {
  constructor(message, { expired = false, badLogin = false } = {}) {
    super(message);
    this.expired = expired;
    this.badLogin = badLogin;
  }
}

const validHeader = (v) => typeof v === "string" && v.length > 0 && !/[\u0000-\u001f\u007f]/.test(v);
const roleKey = (r) => `${str(r, "title")}|${str(r, "subtitle")}`;

class Tamo {
  constructor(interactive = true) {
    this.interactive = interactive;
    this.session = null;
    this.loginPromise = null;
  }

  creds() {
    return { username: Keychain.contains(K.user) ? Keychain.get(K.user) : "", password: Keychain.contains(K.pass) ? Keychain.get(K.pass) : "" };
  }

  async ensure() {
    if (this.session) return this.session;
    if (Keychain.contains(K.session)) {
      try {
        const cached = JSON.parse(Keychain.get(K.session));
        const fresh = Date.now() - cached.at < SESSION_TTL_MIN * 60000;
        const sameRole = !Keychain.contains(K.role) || Keychain.get(K.role) === cached.roleKey;
        if (fresh && sameRole && validHeader(cached.token) && validHeader(cached.roleId)) {
          this.session = cached;
          return cached;
        }
      } catch (_) {}
    }
    return this.relogin();
  }

  relogin() {
    if (!this.loginPromise) {
      this.loginPromise = this.login().finally(() => {
        this.loginPromise = null;
      });
    }
    return this.loginPromise;
  }

  async login() {
    const { username, password } = this.creds();
    if (!username || !password) throw new TamoError("Sign-in details are missing", { badLogin: true });
    let auth;
    try {
      auth = obj(
        await this.request("AuthenticateV2", {
          legacy: true,
          json: { username, password, dateTime: loginDateTime(), typePhoneSystem: "Android", guid: APP_GUID },
        }),
        "Result"
      );
    } catch (e) {
      if (e instanceof TamoError && !e.expired && /rejected/.test(e.message)) {
        throw new TamoError("TAMO did not accept this username or password", { badLogin: true });
      }
      throw e;
    }
    const token = str(auth, "authToken");
    if (auth.userRoleIsAllowed !== true || !validHeader(token)) throw new TamoError("TAMO did not grant access to this account", { badLogin: true });

    const base = {
      token,
      personId: str(auth, "personId"),
      legacyRole: Number(str(auth, "role")) || 0,
      accountName: `${str(auth, "firstName")} ${str(auth, "lastName")}`.trim(),
    };
    await this.request("core/app/settings/StyleRef", {}, base);
    const roles = requiredList(await this.request("core/app/roles", {}, base), "roles");
    if (!roles.length) throw new TamoError("This TAMO account has no school roles");
    const role = await this.pickRole(roles);
    const roleId = str(role, "id");
    if (!validHeader(roleId)) throw new TamoError("TAMO returned an unusable role");

    const session = {
      ...base,
      roleId,
      roleKey: roleKey(role),
      roleTitle: plain(str(role, "title")),
      roleSubtitle: plain(str(role, "subtitle")),
      studentId: str(role, "childStudentId") || str(role, "studentId"),
      roles: roles.map((r) => ({ key: roleKey(r), title: plain(str(r, "title")), subtitle: plain(str(r, "subtitle")) })),
      at: Date.now(),
    };
    Keychain.set(K.role, session.roleKey);
    Keychain.set(K.session, JSON.stringify(session));
    this.session = session;
    return session;
  }

  // Role ids change on every roles request, so the choice is remembered by title + subtitle.
  async pickRole(roles) {
    const saved = Keychain.contains(K.role) ? Keychain.get(K.role) : "";
    const match = roles.find((r) => roleKey(r) === saved);
    if (match) return match;
    if (roles.length === 1 || !this.interactive) return roles.find((r) => r.active === true) || roles[0];
    const a = new Alert();
    a.title = t("pickChild");
    roles.forEach((r) => a.addAction([plain(str(r, "title")), plain(str(r, "subtitle"))].filter(Boolean).join(" — ")));
    const i = await a.presentSheet();
    return roles[i >= 0 ? i : 0];
  }

  async request(path, { query = {}, legacy = false, json, form, envelope = true } = {}, session) {
    const params = Object.entries(query).filter(([, v]) => v !== undefined && v !== null);
    if (legacy && session) params.push(["authToken", session.token]);
    const qs = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    const req = new Request((legacy ? LEGACY : MODERN) + path + (qs ? `?${qs}` : ""));
    req.timeoutInterval = cfg("requestWait");
    const headers = { Accept: "application/json", "User-Agent": "okhttp/4.9.1" };
    if (!legacy && session) {
      headers.Authorization = `Bearer ${session.token}`;
      if (session.roleId) headers["x-selected-role"] = session.roleId;
    }
    if (json) {
      req.method = "POST";
      headers["Content-Type"] = "application/json; charset=UTF-8";
      req.body = JSON.stringify(json);
    } else if (form) {
      req.method = "POST";
      headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
      req.body = Object.entries(form).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&");
    }
    req.headers = headers;

    let text;
    try {
      text = await req.loadString();
    } catch (_) {
      throw new TamoError("Could not reach TAMO. Check the internet connection.");
    }
    const code = req.response ? req.response.statusCode : 0;
    if (code === 401) throw new TamoError("TAMO session expired", { expired: true });
    if (code < 200 || code > 299) throw new TamoError(code === 403 ? "TAMO denied access to this data" : `TAMO responded with HTTP ${code}`);
    if (!envelope && !String(text || "").trim()) return {};
    let payload;
    try {
      payload = JSON.parse(text);
    } catch (_) {
      throw new TamoError("TAMO returned something that is not JSON");
    }
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new TamoError("TAMO returned an unexpected response");
    if (str(payload, "ErrorMessage") === "User is not authenticated." || str(payload, "message") === "User is not authenticated.") {
      throw new TamoError("TAMO session expired", { expired: true });
    }
    if (envelope) {
      if (legacy || json) {
        if ("Status" in payload && (str(payload, "Status") !== "1" || str(payload, "ErrorCode") !== "0")) {
          throw new TamoError(str(payload, "ErrorCode") === "-13" ? "TAMO requires a TAMO IŠMANIEMS subscription for this data" : "TAMO rejected the request");
        }
        if (!("Status" in payload) && payload.isSuccess === false) throw new TamoError("TAMO rejected the request");
      } else if (payload.isSuccess !== true) {
        throw new TamoError("TAMO could not return this data");
      }
    }
    return payload;
  }

  // Authenticated call with one transparent re-login when the token has expired.
  async call(path, opts = {}) {
    const s = await this.ensure();
    try {
      return await this.request(path, opts, s);
    } catch (e) {
      if (!(e instanceof TamoError) || !e.expired) throw e;
      if (this.session === s) {
        this.session = null;
        if (Keychain.contains(K.session)) Keychain.remove(K.session);
      }
      return this.request(path, opts, await (this.session ? Promise.resolve(this.session) : this.relogin()));
    }
  }

  modern(path, query = {}, envelope = true) {
    return this.call(path, { query, envelope });
  }
}

// ───────────────────────────── mappers ─────────────────────────────

function content(src, name) {
  const v = src[`${name}Content`] ?? src[name];
  if (v && typeof v === "object") return plain(str(v, "content"));
  return typeof v === "string" ? plain(v) : "";
}

function fileRef(f) {
  const name = plain(str(f, "fileName") || str(f, "name") || str(f, "content")) || "attachment";
  const legacyId = str(f, "fileId");
  if (legacyId && legacyId !== "0") return { name, sid: legacyId, legacy: true };
  const sid = str(f, "fileSid") || str(f, "sid");
  return sid ? { name, sid, legacy: false } : { name };
}

function lessonNumber(ev) {
  const cands = [content(ev, "eventIcon"), ...list(ev, "timeBadges").map((b) => plain(str(b, "content")))];
  return cands.map((v) => parseInt(v, 10)).find((n) => n >= 1 && n <= 30);
}

function mapWeek(payload) {
  const formativeGroups = list(payload, "formatives");
  return requiredList(payload, "days").map((day) => ({
    date: dateOnly(str(day, "date")),
    lessons: list(day, "events").map((ev) => {
      const details = list(ev, "eventDetails")
        .map((d) => {
          const title = content(d, "title");
          return compact({
            kind: str(d, "key"),
            title: title || content(d, "label"),
            text: content(d, "body"),
            files: list(d, "files").map(fileRef),
          });
        })
        .filter((d) => d.title || d.text || d.files)
        .filter((d) => !((d.kind || "").startsWith("homework") && !d.files && isPlaceholder(d.text || "")));

      const fKey = str(obj(ev, "references"), "formatives");
      const seen = new Set();
      const formatives = [
        ...list(ev, "formatives"),
        ...(fKey
          ? formativeGroups
              .filter((g) => str(g, "key") === fKey)
              .flatMap((g) => list(g, "items"))
              .filter((i) => str(i, "lessonId") === str(ev, "id"))
          : []),
      ]
        .filter((i) => {
          const id = `${str(i, "date")}|${str(i, "type")}|${str(i, "title")}`;
          if (seen.has(id)) return false;
          seen.add(id);
          return true;
        })
        .map((i) => compact({ value: plain(str(i, "title")), type: plain(str(i, "type")) }))
        .filter((i) => i.value);

      const right = ["rightIconsTop", "rightIconsMiddle", "rightIconsBottom"].flatMap((k) => one(ev, k));
      const marks = [...new Set(right.filter((i) => str(i, "contentType") !== "icon").map((i) => plain(str(i, "content"))).filter(Boolean))];
      const icons = right.filter((i) => str(i, "contentType") === "icon").map((i) => str(i, "content"));
      const note = icons.some((i) => i.includes("negative")) ? "negative" : icons.some((i) => i.includes("positive")) ? "positive" : icons.some((i) => /note|comment/.test(i)) ? "comment" : "";
      const average = plain(str(one(ev, "bottomIconsRight").find((i) => str(i, "key") === "average") || {}, "content"));
      const label = obj(ev, "eventLabel");
      const important = str(obj(ev, "eventHighlight"), "styleRef").includes("important") || str(label, "styleRef").includes("important");

      return compact({
        id: str(ev, "id"),
        number: lessonNumber(ev),
        start: localTime(str(ev, "timeFromUtc")),
        end: localTime(str(ev, "timeToUtc")),
        subject: content(ev, "eventTitle"),
        teacher: content(ev, "eventSubtitle"),
        topic: content(ev, "eventDescription"),
        label: plain(str(label, "content")),
        important: important || undefined,
        marks,
        note,
        average,
        formatives,
        details,
      });
    }),
  }));
}

function mapHomework(payload) {
  const seen = new Set();
  return requiredList(payload, "items")
    .map((i) => {
      const text = plain(str(i, "homeWork"));
      return compact({
        lessonId: str(i, "lessonId"),
        subject: plain(str(i, "thingName")),
        text: isPlaceholder(text) ? "" : text,
        assigned: dateOnly(str(i, "date")),
        due: dateOnly(str(i, "deadline")),
        done: Boolean(str(i, "completionDate")),
        files: list(i, "files").map(fileRef),
      });
    })
    .filter((i) => i.text || i.files)
    .filter((i) => {
      const k = `${i.lessonId}|${i.due}|${i.subject}|${(i.text || "").slice(0, 40)}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => (a.due || "").localeCompare(b.due || ""));
}

function mapFeed(items) {
  return items.flatMap((item, idx) => {
    const d = obj(item, "eventDetails");
    const field = (n) => {
      const key = Object.keys(d).find((k) => k.toLowerCase() === n.toLowerCase());
      return key ? plain(str(d, key)) : "";
    };
    const base = { id: str(item, "id") || String(idx), date: dateOnly(str(item, "date")), subject: field("ThingName"), lessonDate: dateOnly(field("Date")) };
    switch (str(item, "eventId")) {
      case "4": {
        const text = field("HomeWork") || field("Description");
        return isPlaceholder(text) ? [] : [compact({ kind: "homework", ...base, text, due: dateOnly(field("Deadline")) })];
      }
      case "1":
        return field("Value") ? [compact({ kind: "grade", ...base, value: field("Value") })] : [];
      case "2":
        return [compact({ kind: field("Type") === "1" ? "absent" : "late", ...base })];
      case "10":
        return field("Vertinimas") ? [compact({ kind: "formative", ...base, value: field("Vertinimas"), text: field("Tipas") })] : [];
      case "8": {
        const type = field("Type").toLowerCase();
        const kind = type.includes("pagyr") ? "praise" : type.includes("pastab") ? "remark" : "comment";
        return [compact({ kind, ...base, text: field("Value") })];
      }
      default: {
        const text = [...new Set([field("Description"), field("HomeWork"), field("Vertinimas"), field("Value")].filter(Boolean))].join("\n");
        return text ? [compact({ kind: "other", ...base, text })] : [];
      }
    }
  });
}

function mapDiary(payload) {
  const items = requiredList(payload, "items");
  const grades = items
    .filter((i) => plain(str(i, "assessmentValue")))
    .map((i) => compact({ date: dateOnly(str(i, "subjectDate")), subject: plain(str(i, "subject")), value: plain(str(i, "assessmentValue")), type: plain(str(i, "assessmentType")) }));
  const attendance = items
    .filter((i) => plain(str(i, "attendanceValue")))
    .map((i) => compact({ date: dateOnly(str(i, "subjectDate")), subject: plain(str(i, "subject")), value: plain(str(i, "attendanceValue")) }));
  const formatives = list(payload, "formativeGrades")
    .filter((i) => plain(str(i, "title")))
    .map((i) => compact({ date: dateOnly(str(i, "date")), subject: plain(str(i, "subject")), value: plain(str(i, "title")), type: plain(str(i, "type")) }));
  return { grades, attendance, formatives };
}

function mapAllDay(payload) {
  return requiredList(payload, "allDayEvents").map((e) => {
    const from = localDate(str(e, "timeFromUtc"));
    const to = localDate(str(e, "timeToUtc"));
    return compact({ title: content(e, "eventTitle"), label: content(e, "eventLabel"), when: content(e, "eventSubtitle"), from, to: to && to > from ? to : from, description: content(e, "eventDescription") });
  });
}

function mapMessages(items, group) {
  return items
    .map((i) => {
      const raw = str(i, "date");
      return compact({
        id: str(i, "id"),
        sid: str(i, "sid"),
        typeId: str(i, "messageTypeId") || "1",
        date: dateOnly(raw),
        time: raw.slice(11, 16),
        subject: plain(str(i, "subject")),
        from: plain(str(i, "senderPerson")),
        fromTitle: plain(str(i, "senderPersonTitle")),
        unread: !str(i, "readDate") || undefined,
        important: i.isImportant === true || undefined,
        starred: i.isStarred === true || undefined,
        files: i.hasAttachments === true || undefined,
        group: group || undefined,
      });
    })
    .filter((m) => m.id);
}

function mapMessageDetail(payload) {
  const item = obj(payload, "item");
  const files = [...list(payload, "attachments"), ...list(item, "attachments")]
    .map((f) => ({ name: plain(str(f, "name") || str(f, "fileName")) || "attachment", sid: str(f, "sid") || str(f, "fileSid"), legacy: false }))
    .filter((f, i, all) => f.sid && all.findIndex((x) => x.sid === f.sid) === i);
  return {
    body: plain(str(item, "body") || str(item, "bodyPlain")),
    files,
    recipients: list(item, "recipientSets").map((r) => plain(str(r, "title"))).filter(Boolean),
  };
}

// ───────────────────────────── data loading ─────────────────────────────

async function fetchWeek(api, monday) {
  return mapWeek(await api.modern("v2/app/calendar/events", { date: monday }));
}

async function fetchMessages(api, sinceDate, maxPages = 5) {
  const out = [];
  for (let page = 1; page <= maxPages; page++) {
    const res = await api.modern("messaging/messages/received", { orderDescending: "true", page: String(page) }, false);
    const items = mapMessages(list(res, "items"), false);
    out.push(...items);
    if (!items.length || items[items.length - 1].date < sinceDate) break;
  }
  try {
    const g = await api.modern("messaging/messages/group/received", { isDeleted: "false" }, false);
    out.push(...mapMessages(list(g, "items"), true).filter((m) => m.date >= addDays(sinceDate, -21)));
  } catch (_) {
    /* group inbox is optional */
  }
  const seen = new Set();
  return out
    .filter((m) => {
      const k = m.sid || `${m.typeId}/${m.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    })
    .sort((a, b) => `${b.date} ${b.time}`.localeCompare(`${a.date} ${a.time}`));
}

async function loadAll(api) {
  const session = await api.ensure();
  const today = todayV();
  const monday = mondayOf(today);
  const warnings = [];
  const safe = (label, p) =>
    p.catch((e) => {
      if (e && e.badLogin) throw e;
      warnings.push(`${label}: ${e.message || e}`);
      return null;
    });
  const monthStart = `${today.slice(0, 8)}01`;
  const [w0, w1, homework, feed, diary, events, messages] = await Promise.all([
    safe("schedule", fetchWeek(api, monday)),
    safe("schedule (next week)", fetchWeek(api, addDays(monday, 7))),
    safe("homework", api.modern("core/app/darbai", { dateFrom: addDays(today, -21), dateTo: addDays(today, 28), workType: "home" }).then(mapHomework)),
    safe("notifications", api.modern("core/app/feeds").then((r) => mapFeed(requiredList(r, "result")))),
    safe("grades", api.modern("core/app/dienynas", { dateFrom: addDays(today, -30), dateTo: today }).then(mapDiary)),
    safe("calendar", api.modern("core/app/calendar/events/allDay", { dateFrom: monthStart, dateTo: addDays(monthStart, 45) }).then(mapAllDay)),
    safe("messages", fetchMessages(api, addDays(today, -7))),
  ]);
  return {
    v: 1,
    at: Date.now(),
    today,
    monday,
    child: { title: session.roleTitle || session.accountName, subtitle: session.roleSubtitle, key: session.roleKey },
    multipleChildren: (session.roles || []).length > 1,
    weeks: { "0": w0, "1": w1 },
    homework: homework || [],
    feed: feed || [],
    diary: diary || { grades: [], attendance: [], formatives: [] },
    events: events || [],
    messages: messages || [],
    warnings,
  };
}

// ───────────────────────────── cache ─────────────────────────────

const fm = FileManager.local();
const cachePath = () => fm.joinPath(fm.documentsDirectory(), "dienynas-plus-cache.json");
function saveCache(data) {
  try {
    fm.writeString(cachePath(), JSON.stringify(data));
  } catch (_) {}
}
function readCache() {
  try {
    if (!fm.fileExists(cachePath())) return null;
    const d = JSON.parse(fm.readString(cachePath()));
    const key = Keychain.contains(K.role) ? Keychain.get(K.role) : "";
    return d && d.v === 1 && (!key || d.child.key === key) ? d : null;
  } catch (_) {
    return null;
  }
}
function clearCache() {
  try {
    if (fm.fileExists(cachePath())) fm.remove(cachePath());
  } catch (_) {}
}

// ───────────────────────────── widget content (app-blueprints · widgets) ─────────────────────────────
// The shared frame (Widget section, below) draws it; this part decides what the widget shows.
// Privacy: lesson times and subjects, homework due dates and message dates only. No grades, no message
// text, no sign-in details: the widget sits on an unlocked Home Screen.

const WIDGET_TEXT = {
  en: {
    now: (a, b) => `Now ${a}–${b}`, next: (a) => `Next ${a}`, today: "Today",
    nextCap: (s, a) => `Next: ${s} · ${a}`, thenCap: (s, a) => `Then: ${s} · ${a}`, dayCap: (d, s, a) => `${d}: ${s} · ${a}`,
    tomorrow: "Tomorrow", days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
    over: "Lessons over", none: "No lessons today",
    due: (n) => `${n} due tomorrow`, late: (n) => `${n} late`, msgs: (n) => `${n} today`, unread: (n) => `${n} unread`,
    left: (n) => `${n} ${n === 1 ? "lesson" : "lessons"} left today`,
    signIn: "Open to sign in.", noChild: (p) => `Open Dienynas+ and switch to ${p} once.`,
  },
  lt: {
    now: (a, b) => `Dabar ${a}–${b}`, next: (a) => `Toliau ${a}`, today: "Šiandien",
    nextCap: (s, a) => `Toliau: ${s} · ${a}`, thenCap: (s, a) => `Po to: ${s} · ${a}`, dayCap: (d, s, a) => `${d}: ${s} · ${a}`,
    tomorrow: "Rytoj", days: ["Pirmadienis", "Antradienis", "Trečiadienis", "Ketvirtadienis", "Penktadienis", "Šeštadienis", "Sekmadienis"],
    over: "Pamokos baigėsi", none: "Šiandien pamokų nėra",
    due: (n) => `${n} rytoj`, late: (n) => `${n} vėluoja`, msgs: (n) => `${n} šiandien`, unread: (n) => `${n} ${ltPlural(n, "neperskaityta", "neperskaitytos", "neperskaitytų")}`,
    left: (n) => `Šiandien liko ${n} ${ltPlural(n, "pamoka", "pamokos", "pamokų")}`,
    signIn: "Atidarykite, kad prisijungtumėte.", noChild: (p) => `Atidarykite Dienynas+ ir vieną kartą perjunkite į ${p}.`,
  },
};

// Lithuanian number agreement: 1, 21 pamoka · 2–9, 22 pamokos · 10–20, 30 pamokų.
function ltPlural(n, one, few, many) {
  if (n % 10 === 1 && n % 100 !== 11) return one;
  return n % 10 >= 2 && (n % 100 < 10 || n % 100 > 20) ? few : many;
}

// What the widget needs from one TAMO load, kept per child so the widget parameter can pick one.
// Merged with the children saved before; the app calls saveWidget(widgetSnapshot(data)) after TAMO answers.
function widgetSnapshot(data) {
  const prev = readWidget() || {};
  const children = Object.assign({}, prev.children);
  const key = data.child.key;
  const days = {};
  [data.weeks["0"], data.weeks["1"]].forEach((w) => (w || []).forEach((d) => {
    if (d && d.date) days[d.date] = (d.lessons || []).filter((l) => l.start && l.subject).map((l) => compact({ n: l.number, start: l.start, end: l.end, subject: l.subject }));
  }));
  const since = addDays(data.today, -7);
  children[key] = {
    name: data.child.title || "",
    at: data.at || Date.now(),
    days: Object.keys(days).length ? days : (children[key] && children[key].days) || {},   // a failed schedule keeps the last one
    due: (data.homework || []).filter((i) => !i.done && i.due).map((i) => i.due),
    msgs: (data.messages || []).filter((x) => x.date >= since).map((x) => (x.unread ? { d: x.date, u: 1 } : { d: x.date })),
  };
  return { current: key, multi: !!data.multipleChildren, children };
}

// Asks TAMO for fresh data, within one request time limit (TAMO › requestWait); null when it can't.
async function widgetRefresh() {
  let timer = null;
  const late = new Promise((resolve) => { timer = Timer.schedule(cfg("requestWait") * 1000, false, () => resolve(null)); });
  const load = loadAll(new Tamo(false)).catch((e) => { console.log(`Widget: TAMO not reached: ${(e && e.message) || e}`); return null; });
  try {
    const data = await Promise.race([load, late]);
    if (!data) return null;
    const snap = widgetSnapshot(data);
    saveWidget(snap);
    return snap;
  } finally {
    if (timer) timer.invalidate();
  }
}

// The current or next lesson today, homework and message counts, and the rest of the day.
// Parameter: a child's first or full name, when the account has more than one child.
async function widgetModel(param) {
  const T = WIDGET_TEXT[LANG()] || WIDGET_TEXT.en;
  if (!Keychain.contains(K.user) || !Keychain.contains(K.pass)) return { empty: T.signIn };
  let snap = readWidget();
  if (!snap || !snap.children || !snap.current) {   // before the first save (e.g. right after updating from 1.7): the app's cache, read only (loadData)
    snap = diaryCache ? widgetSnapshot(diaryCache) : null;
  }
  const want = String(param || "").trim();
  let key = snap && snap.current;
  if (snap && want && snap.multi) {
    const low = want.toLocaleLowerCase("lt");
    const names = Object.keys(snap.children).map((k) => [k, String(snap.children[k].name || "").toLocaleLowerCase("lt")]);
    const hit = names.find(([, n]) => n === low || n.split(/\s+/)[0] === low) || names.find(([, n]) => n.includes(low));
    if (!hit) return { empty: T.noChild(want) };
    key = hit[0];
  }
  let c = snap && key ? snap.children[key] : null;
  if ((!c || Date.now() - c.at > cfg("widgetCacheMin") * 60000) && (!snap || key === snap.current)) {
    const fresh = await widgetRefresh();
    if (fresh) { snap = fresh; key = fresh.current; c = fresh.children[key]; }
  }
  if (!c) return { empty: T.signIn };

  const today = todayV();
  const p = vilniusParts(new Date(), { hour: "2-digit", minute: "2-digit" });
  const now = Number(p.hour) * 60 + Number(p.minute);
  const mins = (s) => (s ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)) : -1);
  const byTime = (a, b) => mins(a.start) - mins(b.start);
  const lessons = ((c.days || {})[today] || []).slice().sort(byTime);
  const cur = lessons.find((l) => mins(l.start) <= now && now < mins(l.end));
  const hero = cur || lessons.find((l) => mins(l.start) > now);
  const after = hero ? lessons.slice(lessons.indexOf(hero) + 1) : [];
  const following = after[0];

  const first = String(c.name || "").split(/\s+/)[0];
  const m = { badge: first.length > 12 ? `${first.slice(0, 11)}…` : first, at: c.at };
  if (hero) {
    m.kicker = cur ? T.now(cur.start, cur.end) : T.next(hero.start);
    m.title = hero.subject;
    if (following) m.caption = (cur ? T.nextCap : T.thenCap)(following.subject, following.start);
  } else {
    m.kicker = T.today;
    m.title = lessons.length ? T.over : T.none;
    const day = Object.keys(c.days || {}).filter((d) => d > today && (c.days[d] || []).length).sort()[0];
    if (day) {
      const l = c.days[day].slice().sort(byTime)[0];
      const name = day === addDays(today, 1) ? T.tomorrow : T.days[(new Date(`${day}T00:00:00Z`).getUTCDay() + 6) % 7];
      m.caption = T.dayCap(name, l.subject, l.start);
    }
  }

  const due = (c.due || []).filter((d) => d === addDays(today, 1)).length;
  const late = (c.due || []).filter((d) => d < today && d >= addDays(today, -7)).length;
  const msgs = (c.msgs || []).filter((x) => x.d === today).length;
  const unread = (c.msgs || []).filter((x) => x.u && x.d >= addDays(today, -6)).length;
  m.rows = [
    { icon: "📝", text: T.due(due) + (late ? `, ${T.late(late)}` : ""), tone: late ? "warn" : undefined },
    { icon: "✉️", text: T.msgs(msgs) + (unread ? `, ${T.unread(unread)}` : "") },
  ].concat(after.slice(1).map((l) => ({ icon: l.n ? String(l.n) : "·", text: `${l.start} ${l.subject}`, tone: "soft" })));

  const left = lessons.filter((l) => mins(l.end || l.start) > now).length;
  if (left) m.footer = T.left(left);
  return m;
}

// ───────────────────────────── language ─────────────────────────────

const LANG = () => settings.lang;
const NATIVE_TEXT = {
  en: {
    pickChild: "Whose diary?",
    signInTitle: "Sign in to TAMO",
    signInMsg: "Your username and password are saved in the iOS Keychain on this device only.",
    username: "Username",
    password: "Password",
    signIn: "Sign in",
    cancel: "Cancel",
    settings: "Settings",
    switchChild: "Switch child",
    language: "Kalba: lietuvių",
    openWeb: "Open TAMO website",
    changeLogin: "Change sign-in details",
    signOut: "Sign out and forget password",
    signedOut: "Signed out. Run the script again to sign in.",
    badLogin: "TAMO didn't accept the sign-in details. Enter them again?",
    tryAgain: "Try again",
    save: "Save",
    aiSettings: "AI settings",
    aiNoData: "School data hasn't loaded yet. Refresh and try again.",
    aiQuota: "The AI provider's rate limit or quota was reached. Try again in a minute, or check billing with your provider.",
    aiOffline: "Could not reach the AI provider. Check the internet connection.",
    aiEmpty: "The AI returned an empty answer. Try asking again.",
    aiTooLong: "This conversation has grown too long for the AI. Tap Clear memory to start over.",
    scaleTitle: "Grade scale",
    scaleNow: "Now:",
    scaleOther: "Other…",
    scaleOtherTitle: "Highest grade at this school",
    scaleMenu: "Grade scale",
  },
  lt: {
    pickChild: "Kieno dienynas?",
    signInTitle: "Prisijungimas prie TAMO",
    signInMsg: "Vartotojo vardas ir slaptažodis saugomi tik šio įrenginio iOS Keychain.",
    username: "Vartotojo vardas",
    password: "Slaptažodis",
    signIn: "Prisijungti",
    cancel: "Atšaukti",
    settings: "Nustatymai",
    switchChild: "Keisti vaiką",
    language: "Language: English",
    openWeb: "Atidaryti TAMO svetainę",
    changeLogin: "Keisti prisijungimo duomenis",
    signOut: "Atsijungti ir pamiršti slaptažodį",
    signedOut: "Atsijungta. Paleiskite skriptą iš naujo, kad prisijungtumėte.",
    badLogin: "TAMO nepriėmė prisijungimo duomenų. Įvesti iš naujo?",
    tryAgain: "Bandyti dar kartą",
    save: "Išsaugoti",
    aiSettings: "AI nustatymai",
    aiNoData: "Mokyklos duomenys dar neįkelti. Atnaujinkite ir bandykite dar kartą.",
    aiQuota: "Pasiektas DI tiekėjo užklausų ar apmokėjimo limitas. Bandykite po minutės arba patikrinkite apmokėjimą pas tiekėją.",
    aiOffline: "Nepavyko susisiekti su DI tiekėju. Patikrinkite interneto ryšį.",
    aiEmpty: "DI grąžino tuščią atsakymą. Paklauskite dar kartą.",
    aiTooLong: "Pokalbis tapo per ilgas DI. Paspauskite „Išvalyti atmintį“ ir pradėkite iš naujo.",
    scaleTitle: "Vertinimo skalė",
    scaleNow: "Dabar:",
    scaleOther: "Kita…",
    scaleOtherTitle: "Aukščiausias pažymys šioje mokykloje",
    scaleMenu: "Vertinimo skalė",
  },
};
const t = (k) => (NATIVE_TEXT[LANG()] || NATIVE_TEXT.en)[k] || k;

async function askCredentials() {
  const a = new Alert();
  a.title = t("signInTitle");
  a.message = t("signInMsg");
  a.addTextField(t("username"), Keychain.contains(K.user) ? Keychain.get(K.user) : "");
  a.addSecureTextField(t("password"), "");
  a.addAction(t("signIn"));
  a.addCancelAction(t("cancel"));
  if ((await a.presentAlert()) === -1) return false;
  const u = a.textFieldValue(0).trim();
  const p = a.textFieldValue(1);
  if (!u || !p) return false;
  Keychain.set(K.user, u);
  Keychain.set(K.pass, p);
  if (Keychain.contains(K.session)) Keychain.remove(K.session);
  return true;
}

function forgetSession() {
  if (Keychain.contains(K.session)) Keychain.remove(K.session);
}

// ───────────────────────────── HTML page ─────────────────────────────

const safeJSON = (v) => JSON.stringify(v).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");

const NO_ZOOM = '<script>(function(){var p=function(e){e.preventDefault()};["gesturestart","gesturechange","gestureend"].forEach(function(t){document.addEventListener(t,p,{passive:false})});document.addEventListener("touchmove",function(e){if(e.touches&&e.touches.length>1)e.preventDefault()},{passive:false});var last=0;document.addEventListener("touchend",function(e){var n=Date.now();if(n-last<300&&!e.target.closest("button,a,[data-toggle],textarea,input"))e.preventDefault();last=n},{passive:false});})();</script>';

const CSS = `
#aisheet{--ai-paper:var(--paper);--ai-sheet:var(--card);--ai-rule:var(--line);--ai-ink:var(--ink);--ai-muted:var(--muted);--ai-signal:var(--blue);--ai-wash:color-mix(in srgb,var(--ai-signal) 14%,transparent);--ai-danger:var(--red);
  position:fixed;inset:0;z-index:60;background:var(--ai-paper);color:var(--ai-ink);transform:translateY(102%);visibility:hidden;transition:transform .28s ease,visibility 0s linear .28s;overflow-y:auto;-webkit-overflow-scrolling:touch;font:15px/1.4 -apple-system,system-ui,sans-serif;text-align:left}
#aisheet.open{transform:none;visibility:visible;transition:transform .28s ease}
#aisheet *{box-sizing:border-box}
#aisheet button{font:inherit;color:inherit;background:none;border:0;margin:0;padding:0;cursor:pointer;-webkit-appearance:none;appearance:none;touch-action:manipulation}
#aisheet .sh-head{position:sticky;top:0;z-index:1;display:flex;align-items:center;justify-content:space-between;padding:calc(10px + env(safe-area-inset-top,0px)) 16px 10px;background:var(--ai-paper);border-bottom:1px solid var(--ai-rule)}
#aisheet .sh-head h2{margin:0;font-size:22px;font-weight:700}
#aisheet .sh-body{padding:4px 16px calc(28px + env(safe-area-inset-bottom,0px));max-width:680px;margin:0 auto}
#aisheet .link{color:var(--ai-signal);font-weight:600;font-size:17px;padding:8px 0 8px 12px}
#aisheet .hint{font-size:14px;color:var(--ai-muted);margin:12px 0 0}
#aisheet .muted{color:var(--ai-muted)} #aisheet .small{font-size:13px} #aisheet .pad{padding:4px 0 8px;margin:0}
#aisheet .note{font-size:12.5px;color:var(--ai-muted);margin:6px 0 0}
#aisheet .sec{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--ai-muted);margin:24px 0 8px}
#aisheet .sm{font-size:14px;font-weight:600;padding:8px 12px;border-radius:9px;border:1px solid var(--ai-rule);background:var(--ai-sheet);color:var(--ai-ink)}
#aisheet .sm.primary{background:var(--ai-signal);border-color:var(--ai-signal);color:#fff}
#aisheet .srow{display:flex;align-items:center;gap:12px;background:var(--ai-sheet);border:1px solid var(--ai-rule);border-radius:14px;padding:12px 14px;margin:8px 0}
#aisheet .grow{flex:1;min-width:0} #aisheet .grow b{display:block;font-weight:600} #aisheet .grow small{display:block;font-size:13px;margin-top:2px}
#aisheet .switch{flex:none;width:51px;height:31px;border-radius:16px;background:var(--ai-rule);position:relative;transition:background .2s}
#aisheet .switch::after{content:"";position:absolute;top:2px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .2s}
#aisheet .switch.on{background:var(--ai-signal)} #aisheet .switch.on::after{transform:translateX(20px)}
#aisheet .aicard,#aisheet .ucard{background:var(--ai-sheet);border:1px solid var(--ai-rule);border-radius:14px;padding:14px;margin:14px 0}
#aisheet .aicard.active{border-color:var(--ai-signal);box-shadow:0 0 0 1px var(--ai-signal)}
#aisheet .aic-h{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:17px}
#aisheet .aic-row{display:flex;align-items:center;gap:10px;margin-top:10px;font-size:14px}
#aisheet .aic-row.lbl,#aisheet .aic-row .lbl{font-weight:600}
#aisheet code{font:13px ui-monospace,Menlo,monospace;background:var(--ai-paper);border:1px solid var(--ai-rule);border-radius:6px;padding:2px 6px}
#aisheet .aic-btns{display:flex;flex-wrap:wrap;align-items:center;gap:8px;margin-top:10px}
#aisheet .sm[disabled]{opacity:.5}
#aisheet .modelsel{display:block;width:100%;margin-top:6px;font:16px -apple-system,system-ui,sans-serif;color:var(--ai-ink);background:var(--ai-paper);border:1px solid var(--ai-rule);border-radius:9px;padding:9px 10px}
#aisheet .danger{color:var(--ai-danger)} #aisheet .danger.armed{background:var(--ai-danger);color:#fff;border-color:var(--ai-danger)}
#aisheet .ustat{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:10px 0 4px}
#aisheet .ustat div{background:var(--ai-paper);border-radius:10px;padding:8px 10px}
#aisheet .ustat b{display:block;font-size:20px;font-weight:700}
#aisheet .ustat small{color:var(--ai-muted);font-size:12px}
#aisheet .ubars{display:flex;align-items:flex-end;gap:3px;height:56px;margin-top:10px}
#aisheet .ubars span{flex:1;background:var(--ai-signal);border-radius:3px 3px 0 0;min-height:2px}
#aisheet .ubars span.zero{background:var(--ai-rule)}
#aisheet .ubars-l{display:flex;justify-content:space-between;font-size:11.5px;color:var(--ai-muted);margin-top:4px}
#aisheet .utab{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
#aisheet .utab th{text-align:left;font-weight:600;color:var(--ai-muted);padding:4px 4px 4px 0;border-bottom:1px solid var(--ai-rule)}
#aisheet .utab td{padding:6px 4px 6px 0;border-bottom:1px solid var(--ai-rule);word-break:break-word}
#aisheet .utab th:not(:first-child),#aisheet .utab td:not(:first-child){text-align:right;white-space:nowrap}
#aitoast{position:fixed;left:50%;bottom:calc(24px + env(safe-area-inset-bottom,0px));z-index:61;transform:translate(-50%,20px);opacity:0;visibility:hidden;max-width:90vw;padding:10px 16px;border-radius:18px;background:var(--ink);color:var(--paper);font:14px/1.35 -apple-system,system-ui,sans-serif;text-align:center;pointer-events:none;transition:transform .25s,opacity .25s,visibility 0s linear .25s}
#aitoast.on{transform:translate(-50%,0);opacity:1;visibility:visible;transition:transform .25s,opacity .25s}
.badge-ai{display:inline-block;font-size:12px;font-weight:700;color:var(--blue);background:color-mix(in srgb,var(--blue) 14%,transparent);border-radius:6px;padding:2px 8px}
.badge-ex{display:inline-block;font-size:12px;font-weight:600;color:var(--muted);border:1px dashed var(--muted);border-radius:6px;padding:1px 8px}
.bubble.assistant .badge-ai{margin-bottom:6px}
:root{
  --ts:1; --serif: ui-serif, "New York", Georgia, serif; --sans: -apple-system, "SF Pro Text", system-ui, sans-serif;
  --rounded: ui-rounded, "SF Pro Rounded", -apple-system, sans-serif; --display: var(--rounded);
  --rowpad:12px 14px; --lessonpad:11px 14px; --gap:18px;
}
html[data-font=serif]{--display:var(--serif)}
${PALETTE_CSS}
:root{--card:var(--sheet);--line:var(--rule);--blue:var(--signal);--red:var(--danger);--faint:color-mix(in srgb,var(--muted) 72%,var(--paper));--chip:color-mix(in srgb,var(--ink) 8%,var(--sheet))}
body.d-compact{--rowpad:8px 12px;--lessonpad:7px 12px;--gap:12px}
body.d-tiny{--rowpad:7px 12px;--lessonpad:6px 12px;--gap:10px}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--paper);color:var(--ink);touch-action:pan-x pan-y;-webkit-user-select:none;user-select:none}
.body,.text,.detail p{-webkit-user-select:text;user-select:text}
body{font:calc(16px * var(--ts))/1.4 var(--sans);padding:env(safe-area-inset-top) 0 calc(78px + env(safe-area-inset-bottom));-webkit-text-size-adjust:100%}
button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
button:focus-visible{outline:2px solid var(--blue);outline-offset:2px;border-radius:8px}
.num{font-family:ui-rounded,"SF Pro Rounded",-apple-system,sans-serif;font-variant-numeric:tabular-nums}
header.top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 18px 6px}
.who{font-size:calc(13px * var(--ts));color:var(--muted);line-height:1.3}
.who b{color:var(--ink);font-family:var(--display);font-weight:600;font-size:calc(15px * var(--ts));display:block}
.tools{display:flex;gap:6px}
.icon-btn{width:38px;height:38px;border-radius:19px;background:var(--card);display:grid;place-items:center;border:1px solid var(--line)}
.icon-btn svg{width:19px;height:19px;stroke:var(--ink);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.icon-btn.busy svg{animation:turn 1s linear infinite}
@keyframes turn{to{transform:rotate(360deg)}}
h1.date{font:800 calc(30px * var(--ts))/1.08 var(--display);letter-spacing:-.02em;margin:4px 18px 2px}
.sub{margin:0 18px 14px;color:var(--muted);font-size:calc(15px * var(--ts))}
main{padding:0 14px}
section{margin:var(--gap) 0 0}
h2{font-family:var(--display);font-size:calc(19px * var(--ts));font-weight:700;margin:0 4px 8px;letter-spacing:-.01em;display:flex;justify-content:space-between;align-items:baseline}
h2 small{font-size:calc(14px * var(--ts));font-weight:500;color:var(--muted)}
.panel{background:var(--card);border-radius:16px;border:1px solid var(--line);overflow:hidden}
.row{display:flex;gap:12px;padding:var(--rowpad);border-top:1px solid var(--line);align-items:flex-start;text-align:left;width:100%}
.row:first-child{border-top:0}
.row .main{flex:1;min-width:0}
.row .title{font-weight:600}
.row .meta{color:var(--muted);font-size:calc(14px * var(--ts))}
.row .body{font-size:calc(15px * var(--ts));margin-top:3px;white-space:pre-wrap;overflow-wrap:anywhere}
.empty{padding:16px 14px;color:var(--muted);font-size:calc(15px * var(--ts))}
.bar{width:5px;align-self:stretch;border-radius:3px;flex:none}
.pill{display:inline-block;font-size:calc(12.5px * var(--ts));font-weight:600;padding:2px 8px;border-radius:999px;background:var(--chip);color:var(--ink);margin:4px 4px 0 0;white-space:nowrap}
.pill.red{background:color-mix(in srgb,var(--red) 16%,transparent);color:var(--red)}
.pill.green{background:color-mix(in srgb,var(--green) 16%,transparent);color:var(--green)}
.pill.mark{background:var(--mark);color:var(--markInk)}
.pill.grade{font-family:ui-rounded,-apple-system,sans-serif;font-size:calc(14px * var(--ts));padding:1px 9px}
.dot{width:9px;height:9px;border-radius:5px;background:var(--blue);flex:none;margin-top:7px}
.dot.off{background:transparent}
/* Now card: the one loud element */
.now{background:var(--mark);color:var(--markInk);border-radius:20px;padding:16px 18px;position:relative;overflow:hidden}
.now .k{font-size:calc(14px * var(--ts));font-weight:600;opacity:.75}
.now .s{font:800 calc(26px * var(--ts))/1.1 var(--display);margin:2px 0 4px;letter-spacing:-.01em}
.now .m{font-size:calc(15px * var(--ts));font-weight:500}
.now .progress{position:absolute;left:0;bottom:0;height:6px;background:var(--markInk);opacity:.85}
.now.quiet{background:var(--card);color:var(--ink);border:1px solid var(--line)}
.now.quiet .k{color:var(--muted);opacity:1}
/* Lesson timeline */
.lesson{display:flex;gap:12px;padding:var(--lessonpad);border-top:1px solid var(--line);width:100%;text-align:left;cursor:pointer}
.lesson:first-child{border-top:0}
.lesson .n{width:30px;height:30px;border-radius:15px;display:grid;place-items:center;font-weight:700;font-size:calc(15px * var(--ts));color:#fff;flex:none}
.lesson .when{font-size:calc(13px * var(--ts));color:var(--muted)}
.lesson.past{opacity:.55}
.lesson.current{background:color-mix(in srgb,var(--mark) 28%,transparent)}
.lesson .more{display:none;margin-top:6px}
.lesson.open .more{display:block}
.detail{margin-top:8px;font-size:calc(15px * var(--ts))}
.detail b{font-weight:600;display:block;font-size:calc(13px * var(--ts));color:var(--muted)}
.detail p{margin:2px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
.file{display:inline-flex;gap:6px;align-items:center;font-size:calc(14px * var(--ts));color:var(--blue);font-weight:600;margin:6px 10px 0 0}
.chips{display:flex;flex-wrap:wrap;gap:6px;padding:12px 14px}
.chip{display:inline-flex;align-items:center;gap:6px;background:var(--chip);border-radius:999px;padding:5px 11px;font-size:calc(14px * var(--ts));font-weight:600}
.chip i{width:8px;height:8px;border-radius:4px;display:inline-block}
/* Segmented + week nav */
.seg{display:flex;background:var(--chip);border-radius:12px;padding:3px;margin:0 0 12px}
.seg button{flex:1;padding:7px 4px;border-radius:9px;font-size:calc(14px * var(--ts));font-weight:600;color:var(--muted)}
.seg button.on{background:var(--card);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.12)}
.weeknav{display:flex;align-items:center;justify-content:space-between;margin:0 0 10px}
.weeknav .lbl{font-weight:700;font-size:calc(17px * var(--ts));text-align:center}
.weeknav .lbl small{display:block;font-weight:500;color:var(--muted);font-size:calc(13px * var(--ts))}
.days{display:grid;grid-template-columns:repeat(var(--cols,5),1fr);gap:6px;margin:0 0 12px}
.day{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:8px 0 7px;text-align:center}
.day .w{font-size:calc(12.5px * var(--ts));color:var(--muted);font-weight:600}
.day .d{font-size:calc(20px * var(--ts));font-weight:800}
.day .c{font-size:calc(11.5px * var(--ts));color:var(--faint)}
.day.on{background:var(--ink);border-color:var(--ink)}
.day.on .w,.day.on .d,.day.on .c{color:var(--card)}
.day.today .d{text-decoration:underline;text-decoration-color:var(--mark);text-decoration-thickness:4px;text-underline-offset:3px}
/* Message week chart */
.chart{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;align-items:end;padding:14px 12px 10px}
.chart button{display:flex;flex-direction:column;align-items:center;gap:4px}
.chart .col{width:100%;max-width:34px;border-radius:8px 8px 4px 4px;background:var(--chip);position:relative;min-height:6px}
.chart .col.has{background:var(--blue)}
.chart .col .u{position:absolute;left:0;right:0;bottom:0;background:var(--mark);border-radius:0 0 4px 4px}
.chart .cnt{font-size:calc(14px * var(--ts));font-weight:700}
.chart .w{font-size:calc(12px * var(--ts));color:var(--muted);font-weight:600}
.chart button.on .w{color:var(--ink);text-decoration:underline;text-decoration-thickness:3px;text-decoration-color:var(--mark);text-underline-offset:3px}
/* Grades */
.avg{display:flex;align-items:center;gap:12px;padding:10px 14px;border-top:1px solid var(--line)}
.avg:first-child{border-top:0}
.avg .s{flex:1;font-weight:600;min-width:0}
.avg .track{flex:1.2;height:8px;border-radius:4px;background:var(--chip);overflow:hidden}
.avg .fill{height:100%;border-radius:4px}
.avg .v{width:40px;text-align:right;font-weight:800;font-size:calc(17px * var(--ts))}
/* Tab bar */
nav.tabs{position:fixed;left:0;right:0;bottom:0;display:flex;background:color-mix(in srgb,var(--card) 92%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-top:1px solid var(--line);padding:6px 4px calc(6px + env(safe-area-inset-bottom))}
nav.tabs button{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;font-size:calc(11px * var(--ts));font-weight:600;color:var(--faint);position:relative;padding:4px 0}
nav.tabs svg{width:24px;height:24px;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
nav.tabs button.on{color:var(--blue)}
nav.tabs .badge{position:absolute;top:0;left:calc(50% + 6px);background:var(--red);color:#fff;font-size:calc(11px * var(--ts));font-weight:700;border-radius:9px;min-width:18px;height:18px;padding:0 5px;display:grid;place-items:center}
/* Sheet */
.scrim{position:fixed;inset:0;background:rgba(0,0,0,.35);display:none;z-index:10}
.sheet{position:fixed;left:0;right:0;bottom:0;max-height:88vh;overflow:auto;background:var(--card);border-radius:20px 20px 0 0;padding:16px 18px calc(24px + env(safe-area-inset-bottom));transform:translateY(100%);visibility:hidden;transition:transform .25s ease,visibility 0s linear .25s;z-index:11}
.open-sheet .scrim{display:block}
.open-sheet .sheet{transform:none;visibility:visible;transition:transform .25s ease}
.sheet .x{float:right;font-weight:600;color:var(--blue)}
.sheet h3{font-size:calc(20px * var(--ts));margin:28px 0 4px;line-height:1.25}
.sheet .meta{color:var(--muted);font-size:calc(14px * var(--ts))}
.sheet .text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:calc(16px * var(--ts));line-height:1.5;margin-top:14px}
.banner{margin:12px 4px 0;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--red) 12%,transparent);color:var(--red);font-size:calc(14px * var(--ts))}
.banner.info{background:var(--chip);color:var(--ink)}
footer{color:var(--faint);font-size:calc(12.5px * var(--ts));text-align:center;margin:22px 0 8px}
/* Ask */
.icon-btn.on{background:var(--blue);border-color:var(--blue)}
.icon-btn.on svg{stroke:#fff}
.askwrap{display:flex;flex-direction:column;min-height:calc(100vh - 190px - env(safe-area-inset-top) - env(safe-area-inset-bottom))}
.chat{flex:1;display:flex;flex-direction:column;gap:10px;padding-top:14px}
.intro{color:var(--muted);font-size:calc(15px * var(--ts));margin:2px 4px 12px}
.sugg{display:flex;flex-wrap:wrap;gap:8px}
.sugg button{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:8px 12px;font-size:calc(15px * var(--ts));text-align:left}
.bubble{max-width:88%;padding:10px 13px;border-radius:18px;font-size:calc(16px * var(--ts));line-height:1.45;overflow-wrap:anywhere;-webkit-user-select:text;user-select:text}
.bubble.user{align-self:flex-end;background:var(--blue);color:#fff;border-bottom-right-radius:6px;white-space:pre-wrap}
.bubble.assistant{align-self:flex-start;background:var(--card);border:1px solid var(--line);border-bottom-left-radius:6px}
.bubble.error{align-self:flex-start;background:color-mix(in srgb,var(--red) 12%,transparent);color:var(--red)}
.bubble p{margin:0 0 6px}.bubble p:last-child{margin:0}
.bubble ul{margin:4px 0 6px;padding-left:20px}.bubble li{margin:2px 0}
.typing{display:inline-flex;gap:4px;align-items:center}
.typing i{width:7px;height:7px;border-radius:4px;background:var(--faint);animation:blink 1.2s infinite}
.typing i:nth-child(2){animation-delay:.2s}.typing i:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,80%,100%{opacity:.25}40%{opacity:1}}
.mem{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px 14px;margin:10px 0 12px;font-size:calc(14px * var(--ts))}
.mem.err{color:var(--red)}
.mem-h{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.mem-h span{color:var(--faint);font-size:calc(13px * var(--ts))}
.mem-p{color:var(--muted);margin-top:4px;line-height:1.4}
.mem-a{display:flex;gap:18px;margin-top:8px}
.lnk{color:var(--blue);font-weight:600;font-size:calc(14px * var(--ts))}
.lnk.red{color:var(--red)}
#upd{position:fixed;inset:0;z-index:48;background:rgba(0,0,0,.55);display:flex;align-items:flex-end}
.updp{width:100%;max-height:92vh;overflow:auto;background:var(--card);color:var(--ink);border-radius:22px 22px 0 0;padding:20px 18px calc(16px + env(safe-area-inset-bottom));display:flex;flex-direction:column;gap:8px}
.updtag{align-self:flex-start;background:var(--blue);color:var(--paper);font-size:calc(12px * var(--ts));font-weight:800;padding:4px 10px;border-radius:999px}
.updt{margin:6px 0 0;font:800 calc(22px * var(--ts))/1.2 ui-rounded,"SF Pro Rounded",-apple-system,sans-serif}
.upds{color:var(--muted);font-size:calc(14px * var(--ts))}
.updl{display:flex;flex-direction:column;gap:10px;margin:8px 0 6px}
.updi{display:flex;gap:12px;align-items:flex-start;background:var(--chip);border-radius:14px;padding:12px}
.updic{font-size:calc(24px * var(--ts));line-height:1.1;flex:none}
.updi b{display:block;font-size:calc(15px * var(--ts))}
.updi span{display:block;color:var(--muted);font-size:calc(13px * var(--ts));line-height:1.35;margin-top:2px}
.updmsg{font-size:calc(15px * var(--ts))}
.updmsg:empty{display:none}
.updgo{padding:13px;font-size:calc(16px * var(--ts));font-weight:700;border-radius:14px;background:var(--blue);color:var(--paper)}
.updgo:disabled{opacity:.6}
.updlater{padding:11px;font-size:calc(15px * var(--ts));font-weight:600;border-radius:14px;background:var(--chip);color:inherit}
.ver{display:block;margin-top:2px}
.keycard{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;font-size:calc(15px * var(--ts))}
.keycard p{margin:0 0 10px;color:var(--muted)}
.keyrow{display:flex;gap:8px}
.keyrow input{flex:1;min-width:0;font:16px -apple-system,sans-serif;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--paper);color:var(--ink);-webkit-user-select:text;user-select:text}
.keyrow button,.newchat{background:var(--ink);color:var(--card);border-radius:12px;padding:10px 14px;font-weight:700}
.newchat{background:var(--chip);color:var(--ink);font-size:calc(14px * var(--ts));padding:6px 12px;border-radius:999px}
.composer{position:sticky;bottom:calc(72px + env(safe-area-inset-bottom));display:flex;gap:8px;align-items:flex-end;padding:12px 0 8px;background:linear-gradient(to bottom,transparent,var(--paper) 35%)}
.composer textarea{flex:1;font:16px/1.35 -apple-system,"SF Pro Text",sans-serif;padding:10px 14px;border-radius:21px;border:1px solid var(--line);background:var(--card);color:var(--ink);resize:none;height:44px;max-height:130px;-webkit-user-select:text;user-select:text;outline:none}
.composer textarea:focus{border-color:var(--blue)}
.composer .send{width:44px;height:44px;border-radius:22px;background:var(--blue);display:grid;place-items:center;flex:none}
.composer .send:disabled{opacity:.4}
.composer .send svg{width:20px;height:20px;stroke:#fff;fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.askhint{color:var(--faint);font-size:calc(12.5px * var(--ts));text-align:center;margin:2px 0 0}
@media (prefers-reduced-motion: reduce){ .sheet{transition:none} .icon-btn.busy svg{animation:none} .typing i{animation:none;opacity:.6} }
/* Dienynas+ logo: calendar plus (header mark, loading and sign-in screens, launch screen) */
.brand{display:flex;align-items:center;gap:10px;min-width:0}
.brand-mark{width:34px;height:34px;border-radius:9px;background:#0E1116;flex:none;box-shadow:inset 0 0 0 1px rgba(246,247,249,.14)}
.idleMark{display:block;width:76px;height:76px;margin:0 0 16px;border-radius:18px;background:#0E1116}
/* Launch screen (app-blueprints · launch-screen 1.0.0) */
.splash{--sp-bg:#0E1116;--sp-ink:#F6F7F9;--sp-accent:#60A5FA;--sp-accent2:#2DD4BF;--sp-muted:#9AA3AE;--sp-font:var(--display);--sp-sweep-from:-40px;
  position:fixed;inset:0;z-index:90;background:var(--sp-bg);color:var(--sp-ink);
  display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;cursor:pointer;
  animation:spOut .4s ease 2.4s forwards}
.splash.gone{display:none}
.spIcon{width:148px;height:148px;opacity:0;transform:scale(.86);animation:spIn .5s cubic-bezier(.2,.9,.3,1.2) .05s forwards}
.spIcon svg{width:100%;height:100%;display:block;overflow:visible}
.spFrame{fill:none;stroke:var(--sp-ink);stroke-opacity:.35;stroke-width:7;stroke-linecap:round;stroke-linejoin:round;opacity:0;animation:spFade .4s ease .25s forwards}
.spDraw{fill:none;stroke:var(--sp-ink);stroke-width:13;stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:100;stroke-dashoffset:100;animation:spDraw .8s ease-in-out .15s forwards}
.spPop{fill:var(--sp-accent);transform-box:fill-box;transform-origin:center;transform:scale(0);animation:spPop .45s cubic-bezier(.3,1.7,.5,1) .75s forwards}
.spDetail{fill:var(--sp-ink);opacity:0;animation:spFade .3s ease 1.05s forwards}
.spSweep{fill:none;stroke:var(--sp-accent2);stroke-width:7;stroke-linecap:round;opacity:0;transform:translateX(var(--sp-sweep-from,-120px));animation:spSweep 1s ease-in-out .95s forwards}
.spWord{font:800 40px/1 var(--sp-font,ui-rounded,-apple-system,system-ui,sans-serif);letter-spacing:-.02em;opacity:0;transform:translateY(10px);animation:spUp .45s ease 1.05s forwards}
.spWord span{color:var(--sp-accent)}
.spTag{font:600 15px/1.3 -apple-system,system-ui,sans-serif;letter-spacing:.06em;color:var(--sp-muted);opacity:0;transform:translateY(8px);animation:spUp .45s ease 1.4s forwards}
@keyframes spIn{to{opacity:1;transform:scale(1)}}
@keyframes spFade{to{opacity:1}}
@keyframes spDraw{to{stroke-dashoffset:0}}
@keyframes spPop{to{transform:scale(1)}}
@keyframes spSweep{0%{opacity:0}15%{opacity:1}100%{opacity:1;transform:translateX(0)}}
@keyframes spUp{to{opacity:1;transform:none}}
@keyframes spOut{to{opacity:0;visibility:hidden}}
@media (prefers-reduced-motion:reduce){
  .splash *{animation:none!important;opacity:1!important;transform:none!important;stroke-dashoffset:0!important}
  .splash{animation:spOut .3s ease 1.6s forwards!important}
}
/* Dienynas+ deviation: the plus is cut out of the blue day, so it takes the background colour */
.splash .spDetail{fill:var(--sp-bg)}

/* Tiny: one line per item; tap a homework item or note to see all of it */
body.d-tiny .row .main{display:flex;align-items:baseline;gap:8px;flex-wrap:nowrap}
body.d-tiny .row .title{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
body.d-tiny .row:not(.open) .body,body.d-tiny .row:not(.open) .file,body.d-tiny button.row .main .meta{display:none}
body.d-tiny .row .meta{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:0!important}
body.d-tiny .row.open .main{flex-wrap:wrap}
body.d-tiny .row.open .title{white-space:normal}
body.d-tiny .row .pill{margin-top:0}
body.d-tiny .lesson .when{display:inline;margin-left:6px}
/* Settings sheet (scoped: the app already uses .seg, .sheet and .chip) */
#cfgsheet{position:fixed;inset:0;z-index:50;background:var(--paper);color:var(--ink);transform:translateY(102%);visibility:hidden;transition:transform .28s ease,visibility 0s linear .28s;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;text-align:left}
#cfgsheet.open{transform:none;visibility:visible;transition:transform .28s ease}
#cfgsheet button{font:inherit;color:inherit;background:none;border:0;border-radius:0;padding:0;font-weight:inherit;cursor:pointer;text-align:inherit}
#cfgsheet .sh-head{position:sticky;top:0;z-index:2;background:var(--paper);display:flex;justify-content:space-between;align-items:center;padding:calc(env(safe-area-inset-top) + 14px) 18px 12px;border-bottom:1px solid var(--rule)}
#cfgsheet .sh-head h2{font:700 calc(24px * var(--ts))/1 var(--display);margin:0}
#cfgsheet .sh-body{padding:16px 18px calc(env(safe-area-inset-bottom) + 40px);max-width:680px;margin:0 auto}
#cfgsheet .link{color:var(--signal);font-weight:600;font-size:16px}
#cfgsheet .link.small{font-size:calc(14px * var(--ts))}
#cfgsheet .hint{font-size:calc(13px * var(--ts));color:var(--muted);margin:8px 2px 0}
#cfgsheet .muted{color:var(--muted)}
#cfgsheet .sec{display:block;font:700 calc(17px * var(--ts))/1.2 var(--display);color:var(--ink);margin:26px 0 6px}
#cfgsheet .srow{display:flex;align-items:center;gap:8px;padding:11px 0;border-bottom:1px solid var(--rule)}
#cfgsheet .grow{flex:1;min-width:0}
#cfgsheet .grow b{display:block;font-weight:600}
#cfgsheet .grow small{display:block;font-size:calc(13px * var(--ts));color:var(--ink-2)}
#cfgsheet .switch{width:46px;height:28px;border-radius:14px;background:var(--rule);position:relative;flex:none;transition:background .2s}
#cfgsheet .switch::after{content:"";position:absolute;top:3px;left:3px;width:22px;height:22px;border-radius:11px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .2s}
#cfgsheet .switch.on{background:var(--signal)}
#cfgsheet .switch.on::after{transform:translateX(18px)}
#cfgsheet .sm{font-size:calc(13px * var(--ts));padding:6px 11px;border-radius:8px;border:1px solid var(--rule);background:var(--sheet);white-space:nowrap;flex:none}
#cfgsheet .danger{color:var(--danger)}
#cfgsheet .danger.armed{background:var(--danger);color:#fff;border-color:var(--danger)}
#cfgsheet .seg{display:flex;flex:none;gap:0;padding:0;border:1px solid var(--rule);border-radius:9px;overflow:hidden;background:var(--sheet)}
#cfgsheet .seg button{font-size:calc(12.5px * var(--ts));padding:6px 10px;color:var(--ink-2);white-space:nowrap}
#cfgsheet .seg button.on{background:var(--ink);color:var(--paper);font-weight:600}
#cfgsheet .seg.wide button{flex:1;text-align:center;padding:9px 4px;font-size:calc(13.5px * var(--ts))}
#cfgsheet .lk-row{margin:10px 0 14px}
#cfgsheet .lk-l{display:block;font-size:calc(13px * var(--ts));font-weight:600;color:var(--ink-2);margin-bottom:6px}
#cfgsheet .sws{display:flex;gap:12px;overflow-x:auto;scrollbar-width:none;padding:3px 3px 2px}
#cfgsheet .sws::-webkit-scrollbar{display:none}
#cfgsheet .sw{display:flex;flex-direction:column;align-items:center;gap:5px;flex:none}
#cfgsheet .sw .prev{position:relative;width:50px;height:50px;border-radius:13px;display:grid;place-items:center;border:1px solid rgba(127,127,127,.35);font:700 18px/1 var(--display)}
#cfgsheet .sw .prev i{position:absolute;right:6px;bottom:6px;width:9px;height:9px;border-radius:5px}
#cfgsheet .sw.on .prev{outline:2.5px solid var(--signal);outline-offset:2px}
#cfgsheet .sw small{font-size:12px;color:var(--ink-2)}
#cfgsheet .sw.on small{color:var(--ink);font-weight:600}
#cfgsheet .cfg{padding:12px 0;border-bottom:1px solid var(--rule)}
#cfgsheet .cfg.ch .cfg-h b::after{content:"";display:inline-block;width:7px;height:7px;border-radius:4px;background:var(--signal);margin-left:7px;vertical-align:2px}
#cfgsheet .cfg-h{display:flex;justify-content:space-between;align-items:baseline;gap:10px}
#cfgsheet .cfg-h b{font-weight:600}
#cfgsheet .cfg small{display:block;font-size:calc(13px * var(--ts));margin-top:2px}
#cfgsheet .stepper{display:flex;align-items:center;gap:6px;margin-top:8px;flex-wrap:wrap}
#cfgsheet .stepper button{width:38px;height:36px;border-radius:9px;border:1px solid var(--rule);background:var(--sheet);font-size:20px;font-weight:600;text-align:center}
#cfgsheet .stepper button[disabled]{opacity:.35}
#cfgsheet .stepper input{width:86px;text-align:center;font:600 16px var(--sans);padding:7px 6px;border-radius:9px;border:1px solid var(--rule);background:var(--paper);color:var(--ink)}
#cfgsheet .stepper .unit{font-size:calc(14px * var(--ts));color:var(--ink-2);min-width:2.5em}
#cfgsheet .stepper .range{flex-basis:100%;font-size:calc(12px * var(--ts));color:var(--muted)}
#cfgsheet .cfgin.wide,#cfgsheet .cfgsel{display:block;width:100%;margin-top:8px;font:16px/1.45 var(--sans);padding:9px 11px;border-radius:9px;border:1px solid var(--rule);background:var(--paper);color:var(--ink);-webkit-appearance:none;appearance:none}
#cfgsheet textarea.cfgsel{resize:none}
#cfgsheet .cfgin:focus,#cfgsheet .cfgsel:focus{outline:2px solid var(--signal);outline-offset:-1px}
#cfgsheet .cfg-foot{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:8px;margin-top:18px}
/* Settings blueprint 1.1.0: sections are cards under small muted capitals */
#cfgsheet h3.sec{font:700 calc(12.5px * var(--ts, 1))/1.2 var(--sans, -apple-system, system-ui, sans-serif);letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:28px 4px 8px}
#cfgsheet .grp{background:var(--sheet);border:1px solid var(--rule);border-radius:16px;padding:0 16px;overflow:hidden}
#cfgsheet .grp>*:last-child{border-bottom:0}
#cfgsheet .grp .lk-row{margin:0;padding:12px 0;border-bottom:1px solid var(--rule)}
#cfgsheet .cfg-foot{margin:10px 4px 0}
#cfgsheet .note{font-size:12.5px;color:var(--muted)}
#cfgsheet .srow.bp{width:100%;text-align:left}
#cfgsheet .chev{flex:none;color:var(--muted);font-size:calc(20px * var(--ts));line-height:1}
#cfgsheet input,#cfgsheet textarea{-webkit-user-select:text;user-select:text}
#cfgsheet .srow.act{width:100%}
/* Safe start-up (app-blueprints · recipes/safe-startup): the placeholder until the data is handed over, and the start-up log */
.booting{display:flex;align-items:center;justify-content:center;gap:10px;padding:80px 20px;color:var(--muted);font-size:calc(14px * var(--ts))}
.booting.note{flex-direction:column;text-align:center;color:var(--ink-2);padding:60px 24px}
.booting.note b{font-size:calc(18px * var(--ts));color:var(--ink)}
.booting.note pre,.startlog{max-width:100%;overflow:auto;text-align:left;font:12px/1.45 ui-monospace,Menlo,monospace;background:var(--sheet);border:1px solid var(--rule);border-radius:10px;padding:10px;color:var(--ink-2);white-space:pre-wrap;-webkit-user-select:text;user-select:text}
.startlog{margin:8px 0;max-height:260px}
.busy-dot{width:15px;height:15px;flex:none;border-radius:50%;border:2px solid var(--rule);border-top-color:var(--signal);animation:bdspin .8s linear infinite}
@keyframes bdspin{to{transform:rotate(360deg)}}
/* AI invitation (app-blueprints · ai-invitation): above Settings and the AI sheet, below the update sheet and the launch screen */
#aiinv{position:fixed;inset:0;z-index:47;display:flex;align-items:center;justify-content:center;padding:24px;background:rgba(0,0,0,.45);animation:aiinvFade .25s ease both}
#aiinv.out{animation:aiinvFadeOut .24s ease both}
.aiinv-card{position:relative;width:100%;max-width:380px;background:var(--sheet);color:var(--ink);border:1px solid var(--rule);border-radius:24px;padding:26px 22px 16px;text-align:center;box-shadow:0 24px 60px rgba(0,0,0,.35);animation:aiinvUp .5s cubic-bezier(.2,.9,.3,1.2) both}
#aiinv.out .aiinv-card{animation:aiinvDown .24s ease both}
.aiinv-spark{width:56px;height:56px;margin:-4px auto 10px;border-radius:18px;display:grid;place-items:center;font-size:calc(30px * var(--ts));color:var(--signal);background:var(--signal-wash);animation:aiinvTwinkle 2.4s ease-in-out .5s infinite}
#aiinv h2{margin:0 0 6px;font-family:var(--display);font-size:calc(23px * var(--ts));line-height:1.2;font-weight:800}
.aiinv-lead{margin:0 0 14px;color:var(--ink-2);font-size:calc(15px * var(--ts))}
.aiinv-perks{list-style:none;margin:0 0 14px;padding:0;text-align:left}
.aiinv-perks li{display:flex;gap:10px;align-items:center;padding:9px 12px;margin-bottom:6px;border-radius:12px;background:var(--signal-wash);font-size:calc(15px * var(--ts));font-weight:600;animation:aiinvPerk .4s ease both;animation-delay:calc(.25s + var(--i) * .09s)}
.aiinv-ico{flex:none;width:22px;text-align:center}
.aiinv-steps{margin:0 0 16px;padding-left:22px;text-align:left;color:var(--muted);font-size:calc(13px * var(--ts));line-height:1.6}
.aiinv-go{display:block;width:100%;border:0;border-radius:14px;padding:14px;font:700 calc(17px * var(--ts)) var(--display);color:var(--sheet);background:var(--signal);animation:aiinvGlow 1.6s ease-in-out .9s 2}
.aiinv-go:focus{outline:none}
.aiinv-go:focus-visible{box-shadow:0 0 0 4px var(--signal-wash)}
.aiinv-row{display:flex;justify-content:space-between;gap:8px;margin-top:6px}
.aiinv-later,.aiinv-never{border:0;background:none;padding:12px 6px;color:var(--muted);font:600 calc(14px * var(--ts)) var(--sans, inherit)}
.aiinv-later{color:var(--ink-2)}
.aiinv-nudge{animation:aiinvGlow 1.2s ease-in-out 2}
@keyframes aiinvFade{from{opacity:0}to{opacity:1}}
@keyframes aiinvFadeOut{from{opacity:1}to{opacity:0}}
@keyframes aiinvUp{from{opacity:0;transform:translateY(40px) scale(.94)}to{opacity:1;transform:none}}
@keyframes aiinvDown{to{opacity:0;transform:translateY(24px) scale(.97)}}
@keyframes aiinvPerk{from{opacity:0;transform:translateX(-12px)}to{opacity:1;transform:none}}
@keyframes aiinvTwinkle{0%,100%{transform:scale(1) rotate(0)}50%{transform:scale(1.12) rotate(12deg)}}
@keyframes aiinvGlow{0%,100%{box-shadow:0 0 0 0 transparent}50%{box-shadow:0 0 0 6px var(--signal-wash)}}
@media (prefers-reduced-motion:reduce){
  #aiinv,#aiinv.out,.aiinv-card,#aiinv.out .aiinv-card,.aiinv-perks li,.aiinv-spark,.aiinv-go,.aiinv-nudge{animation:none}
  #aiinv.out{opacity:0;transition:opacity .2s}
}
`;

// Runs inside the WebView. Kept as a real function so it needs no escaping.
function pageMain() {
  const D = window.DATA;
  const LANGS = {
    en: {
      tabs: ["Today", "Schedule", "Homework", "Messages", "Grades"],
      wd: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"],
      wdLong: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
      mon: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
      monLong: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"],
      longDate: (w, d, m) => `${w}, ${m} ${d}`,
      shortDate: (w, d, m) => `${w} ${m} ${d}`,
      now: "Now", next: "Next lesson", endsIn: (n) => `ends in ${n} min`, startsIn: (n) => `starts in ${n} min`,
      overToday: "Lessons are over for today", noLessonsToday: "No lessons today", lessonsToday: "Today's lessons",
      prepFor: (d) => `Get ready for ${d}`, tomorrow: "tomorrow", lessonsN: (n) => `${n} lessons`,
      dueThatDay: "Homework due", dueSoon: "Homework to do", nothingDue: "Nothing to do in the next few days",
      messagesToday: "Today's messages", noMessagesToday: "No messages today", seeAll: "See all",
      whatsNew: "New this week", nothingNew: "Nothing new this week", checks: "Tests and checks ahead",
      overdue: "Overdue", dueToday: "Due today", dueTomorrow: "Due tomorrow", laterWeek: "Later this week", later: "Later", earlier: "Earlier", doneG: "Done",
      todo: "To do", all: "All", done: "Done", set: (d) => `set ${d}`, due: (d) => `due ${d}`,
      inDays: (n) => (n === 1 ? "tomorrow" : `in ${n} days`), ago: (n) => (n === 1 ? "1 day late" : `${n} days late`), todayW: "today", yesterday: "Yesterday", today: "Today",
      thisWeek: "This week", nextWeek: "Next week", lastWeek: "Last week", weekOf: (d) => `Week of ${d}`,
      noLessons: "No lessons this day", hw: "Homework", topic: "Topic", teacher: "Teacher", average: "Subject average", files: "Attachments",
      last7: "Messages, last 7 days", all7: "All 7 days", older: "Older", noMessages: "No messages in the last 7 days", noMessagesDay: "No messages that day",
      unreadN: (n) => `${n} unread`, loading: "Loading…", failed: (e) => `Couldn't load: ${e}`, close: "Close", to: "To",
      averages: "Averages, last 30 days", recent: "Recent grades", attendance: "Attendance, last 30 days", absent: "absent", late: "late", noGrades: "No grades in the last 30 days",
      formatives: "Formative assessments", noSchool: "No school", updated: (t) => `Updated ${t}`, stale: (t, e) => `Showing saved data from ${t}. Refresh failed: ${e}`,
      partial: "Some sections couldn't load:", feed: { grade: "Grade", formative: "Assessment", absent: "Absent", late: "Late", praise: "Praise", remark: "Remark", comment: "Comment", homework: "New homework", other: "Note" },
      opening: "Opening…", markedRead: "Opening a message marks it as read in TAMO.",
      askTitle: "Ask", askIntro: "Ask anything about the school week. Answers use only what's loaded from TAMO: schedule, homework, grades, attendance, notices and messages.",
      askSugg: ["What's due tomorrow?", "Any tests in the next two weeks?", "Summarise today's messages", "How are the maths grades going?", "What should go in the school bag tomorrow?"],
      askPlaceholder: "Ask about school…", newChat: "New chat",
      keyHelp: "Ask needs a Claude or OpenAI key. Add one in Settings › AI settings.", keyOpen: "AI settings",
      aiBy: (p) => `✦ AI answer by ${p}`, askFailed: (e) => `Couldn't answer: ${e}`,
      askHint: "AI answers can be wrong. Check important dates in TAMO.",
      memTitle: "In this chat",
      memLine: (i, range, from) => `Lessons: ${i.lessons} (${range}). Homework: ${i.homework}. Grades and assessments: ${i.grades}. Attendance marks: ${i.absences}. Messages: ${i.messages} (${i.bodies} with text). Calendar dates: ${i.events}. Since ${from}.`,
      memUpdated: (t) => `pulled ${t}`, memRefresh: "Refresh data", memClear: "Clear memory", memClearConfirm: "Tap again to clear",
      memNote: "The whole conversation is kept on this phone and sent with every question, so earlier answers aren't forgotten.",
      gathering: "Pulling everything from TAMO…", gatherFailed: (e) => `Couldn't pull the data: ${e}`,
      stages: { schedule: "Lessons", homework: "Homework", grades: "Grades and attendance", calendar: "School calendar", messages: "Messages" },
      scaleLbl: (m) => `Scale 1–${m}`,
      upd: {
        tag: (v) => `New version ${v}`, title: "An update is ready", more: (n) => ` (and ${n} more update${n > 1 ? "s" : ""})`,
        have: (cur, more) => `You have ${cur}${more}. Here’s what you get:`, now: "Update now", later: "Later, remind me in 2 days",
        updating: "Updating…", done: (v) => `Updated to ${v}`, doneMsg: "<b>✓ Done.</b> Close the app and open it again to start using the new version.",
        gotIt: "Got it", retry: "Try again", failed: "Update failed",
      },
    },
    lt: {
      tabs: ["Šiandien", "Tvarkaraštis", "Namų darbai", "Žinutės", "Pažymiai"],
      wd: ["Pr", "An", "Tr", "Kt", "Pn", "Št", "Sk"],
      wdLong: ["Pirmadienis", "Antradienis", "Trečiadienis", "Ketvirtadienis", "Penktadienis", "Šeštadienis", "Sekmadienis"],
      mon: ["sau.", "vas.", "kov.", "bal.", "geg.", "birž.", "liep.", "rugp.", "rugs.", "spal.", "lapkr.", "gruod."],
      monLong: ["sausio", "vasario", "kovo", "balandžio", "gegužės", "birželio", "liepos", "rugpjūčio", "rugsėjo", "spalio", "lapkričio", "gruodžio"],
      longDate: (w, d, m) => `${w}, ${m} ${d} d.`,
      shortDate: (w, d, m) => `${w}, ${m} ${d} d.`,
      now: "Dabar", next: "Kita pamoka", endsIn: (n) => `baigsis po ${n} min.`, startsIn: (n) => `prasidės po ${n} min.`,
      overToday: "Šiandien pamokos baigėsi", noLessonsToday: "Šiandien pamokų nėra", lessonsToday: "Šiandienos pamokos",
      prepFor: (d) => `Pasiruošti: ${d}`, tomorrow: "rytoj", lessonsN: (n) => `${n} pamok.`,
      dueThatDay: "Atlikti iki tos dienos", dueSoon: "Neatlikti namų darbai", nothingDue: "Artimiausiomis dienomis nieko neužduota",
      messagesToday: "Šiandienos žinutės", noMessagesToday: "Šiandien žinučių nėra", seeAll: "Visos",
      whatsNew: "Šios savaitės naujienos", nothingNew: "Šią savaitę naujienų nėra", checks: "Artėjantys atsiskaitymai",
      overdue: "Vėluoja", dueToday: "Atlikti šiandien", dueTomorrow: "Atlikti rytoj", laterWeek: "Vėliau šią savaitę", later: "Vėliau", earlier: "Anksčiau", doneG: "Atlikta",
      todo: "Neatlikti", all: "Visi", done: "Atlikti", set: (d) => `užduota ${d}`, due: (d) => `iki ${d}`,
      inDays: (n) => (n === 1 ? "rytoj" : `po ${n} d.`), ago: (n) => `vėluoja ${n} d.`, todayW: "šiandien", yesterday: "Vakar", today: "Šiandien",
      thisWeek: "Ši savaitė", nextWeek: "Kita savaitė", lastWeek: "Praėjusi savaitė", weekOf: (d) => `Savaitė nuo ${d}`,
      noLessons: "Šią dieną pamokų nėra", hw: "Namų darbai", topic: "Tema", teacher: "Mokytojas", average: "Dalyko vidurkis", files: "Priedai",
      last7: "Žinutės per 7 dienas", all7: "Visos 7 dienos", older: "Senesnės", noMessages: "Per 7 dienas žinučių nėra", noMessagesDay: "Tą dieną žinučių nėra",
      unreadN: (n) => `${n} neperskait.`, loading: "Įkeliama…", failed: (e) => `Nepavyko įkelti: ${e}`, close: "Uždaryti", to: "Kam",
      averages: "Vidurkiai, 30 d.", recent: "Naujausi pažymiai", attendance: "Lankomumas, 30 d.", absent: "praleista", late: "vėluota", noGrades: "Per 30 d. pažymių nėra",
      formatives: "Kaupiamieji vertinimai", noSchool: "Pamokų nėra", updated: (t) => `Atnaujinta ${t}`, stale: (t, e) => `Rodomi išsaugoti duomenys (${t}). Nepavyko atnaujinti: ${e}`,
      partial: "Kai kurių skilčių įkelti nepavyko:", feed: { grade: "Pažymys", formative: "Kaupiamasis", absent: "Praleido", late: "Pavėlavo", praise: "Pagyrimas", remark: "Pastaba", comment: "Komentaras", homework: "Naujas namų darbas", other: "Įrašas" },
      opening: "Atidaroma…", markedRead: "Atidarius žinutę, TAMO ji pažymima kaip perskaityta.",
      askTitle: "Klausk", askIntro: "Klauskite apie mokyklos savaitę. Atsakymai remiasi tik iš TAMO įkeltais duomenimis: tvarkaraščiu, namų darbais, pažymiais, lankomumu, pranešimais ir žinutėmis.",
      askSugg: ["Ką reikia atlikti rytojui?", "Ar per dvi savaites bus kontrolinių?", "Apibendrink šiandienos žinutes", "Kaip sekasi matematika?", "Ką įsidėti į kuprinę rytojui?"],
      askPlaceholder: "Klauskite apie mokyklą…", newChat: "Naujas pokalbis",
      keyHelp: "Klausimams reikia Claude arba OpenAI rakto. Pridėkite jį: Nustatymai › AI nustatymai.", keyOpen: "AI nustatymai",
      aiBy: (p) => `✦ DI atsakymas: ${p}`, askFailed: (e) => `Nepavyko atsakyti: ${e}`,
      askHint: "DI atsakymai gali klysti. Svarbias datas pasitikrinkite TAMO.",
      memTitle: "Šiame pokalbyje",
      memLine: (i, range, from) => `Pamokos: ${i.lessons} (${range}). Namų darbai: ${i.homework}. Pažymiai ir vertinimai: ${i.grades}. Lankomumo žymos: ${i.absences}. Žinutės: ${i.messages} (su tekstu: ${i.bodies}). Kalendoriaus datos: ${i.events}. Nuo ${from}.`,
      memUpdated: (t) => `surinkta ${t}`, memRefresh: "Atnaujinti duomenis", memClear: "Išvalyti atmintį", memClearConfirm: "Paspauskite dar kartą",
      memNote: "Visas pokalbis saugomas šiame telefone ir siunčiamas su kiekvienu klausimu, todėl ankstesni atsakymai nepamirštami.",
      gathering: "Renkami visi TAMO duomenys…", gatherFailed: (e) => `Nepavyko surinkti duomenų: ${e}`,
      stages: { schedule: "Pamokos", homework: "Namų darbai", grades: "Pažymiai ir lankomumas", calendar: "Mokyklos kalendorius", messages: "Žinutės" },
      scaleLbl: (m) => `Skalė 1–${m}`,
      upd: {
        tag: (v) => `Nauja versija ${v}`, title: "Atnaujinimas paruoštas", more: (n) => ` (ir dar atnaujinimų: ${n})`,
        have: (cur, more) => `Jūsų versija ${cur}${more}. Kas naujo:`, now: "Atnaujinti dabar", later: "Vėliau, priminti po 2 dienų",
        updating: "Atnaujinama…", done: (v) => `Atnaujinta į ${v}`, doneMsg: "<b>✓ Atlikta.</b> Uždarykite programą ir atidarykite iš naujo, kad pradėtumėte naudoti naują versiją.",
        gotIt: "Supratau", retry: "Bandyti dar kartą", failed: "Nepavyko atnaujinti",
      },
    },
  };
  const T = LANGS[D.lang] || LANGS.en;
  const PALETTE = ["#2450B8", "#14866A", "#C8243A", "#7B3FB3", "#D06A12", "#0B86A0", "#B0466F", "#56751A", "#5B4FD0", "#9A5530", "#1F6E8C", "#A33AA0"];

  const $ = (s) => document.querySelector(s);
  const h = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const addDays = (d, n) => new Date(Date.parse(`${d}T00:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  const dow = (d) => (new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7;
  const dayDiff = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);
  const dnum = (d) => Number(d.slice(8, 10));
  const mnum = (d) => Number(d.slice(5, 7)) - 1;
  const longDate = (d) => T.longDate(T.wdLong[dow(d)], dnum(d), T.monLong[mnum(d)]);
  const shortDate = (d) => T.shortDate(T.wd[dow(d)], dnum(d), D.lang === "lt" ? T.monLong[mnum(d)] : T.mon[mnum(d)]);
  const dayName = (d) => (d === D.today ? T.today : d === addDays(D.today, -1) ? T.yesterday : d === addDays(D.today, 1) ? T.tomorrow[0].toUpperCase() + T.tomorrow.slice(1) : shortDate(d));
  const color = (subject) => {
    let x = 0;
    for (const c of String(subject || "")) x = (x * 31 + c.codePointAt(0)) >>> 0;
    return PALETTE[x % PALETTE.length];
  };
  const nowMinutes = () => {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Vilnius", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date()).map((x) => [x.type, x.value]));
    return Number(p.hour) * 60 + Number(p.minute);
  };
  const mins = (hhmm) => (hhmm ? Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5)) : null);
  const isCheck = (l) => /kontrol|test|atsiskait|diktant|apklaus|patikrin|savarank|egzamin|projekt/i.test(`${l.label || ""}`) || (l.important && l.label);

  // ── bridge to Scriptable ──
  let seq = 0;
  const pending = {};
  let chain = Promise.resolve();
  window.bridgeReply = (id, ok, payload) => {
    const p = pending[id];
    if (!p) return;
    delete pending[id];
    clearTimeout(p.timer);
    ok ? p.res(payload) : p.rej(new Error(payload));
  };
  function call(action, params = {}, timeoutMs = 60000) {
    const run = () =>
      new Promise((res, rej) => {
        const id = ++seq;
        pending[id] = { res, rej, timer: setTimeout(() => window.bridgeReply(id, false, "timeout"), timeoutMs) };
        location.href = `tamo://${action}?id=${id}&p=${encodeURIComponent(JSON.stringify(params))}`;
      });
    const p = chain.then(run, run);
    chain = p.catch(() => {});
    return p;
  }

  // ── state ──
  const S = { tab: 0, weekOffset: 0, weeks: { ...D.weeks }, day: null, hwFilter: "todo", msgDay: null, chat: (D.chat || []).slice(), thinking: false, needKey: false, pendingQ: "", info: D.chatInfo || null, preparing: false, stage: "", prepError: "", clearArmed: false };
  if (typeof D.startTab === "number") S.tab = D.startTab;
  if (S.tab === 5 && !D.hasAiKey) S.tab = 0;   // Ask is hidden without an AI key
  const GMAX = Number(D.gradeMax) || 10;
  const allDays = () => [...(S.weeks["0"] || []), ...(S.weeks["1"] || [])];
  const dayOf = (date) => allDays().find((d) => d.date === date) || (Object.values(S.weeks).flat().find((d) => d && d.date === date));
  const eventsOn = (date) => (D.events || []).filter((e) => e.from && e.from <= date && (e.to || e.from) >= date);
  const nextSchoolDay = () => {
    for (let i = 1; i <= 10; i++) {
      const d = addDays(D.today, i);
      const day = dayOf(d);
      if (day && day.lessons.length) return day;
    }
    return null;
  };
  // Latest due date first; same day: most recently set first.
  const byDue = (a, b) => (b.due || "").localeCompare(a.due || "") || (b.assigned || "").localeCompare(a.assigned || "") || (a.subject || "").localeCompare(b.subject || "", "lt");
  const relDue = (due) => {
    const n = dayDiff(D.today, due);
    return n === 0 ? T.todayW : n > 0 ? T.inDays(n) : T.ago(-n);
  };

  // ── components ──
  function lessonRow(l, date, opts = {}) {
    const now = nowMinutes();
    const isToday = date === D.today;
    const s = mins(l.start), e = mins(l.end);
    const state = isToday && s !== null && e !== null ? (now >= e ? (opts.compact ? "past" : "") : now >= s ? "current" : "") : "";
    const c = color(l.subject);
    const pills = [];
    if (l.label) pills.push(`<span class="pill ${isCheck(l) ? "red" : ""}">${h(l.label)}</span>`);
    (l.marks || []).forEach((m) => pills.push(`<span class="pill grade ${/^n|^p/i.test(m) && m.length <= 3 && isNaN(m) ? "red" : "mark"}">${h(m)}</span>`));
    (l.formatives || []).forEach((f) => pills.push(`<span class="pill green">${h(f.value)}</span>`));
    if (l.note === "negative") pills.push(`<span class="pill red">${h(T.feed.remark)}</span>`);
    if (l.note === "positive") pills.push(`<span class="pill green">${h(T.feed.praise)}</span>`);
    const hwDetail = (l.details || []).find((d) => (d.kind || "").startsWith("homework"));
    if (hwDetail && !opts.compact) pills.push(`<span class="pill">${h(T.hw)}</span>`);
    const details = [
      l.teacher ? `<div class="detail"><b>${h(T.teacher)}</b><p>${h(l.teacher)}</p></div>` : "",
      l.topic ? `<div class="detail"><b>${h(T.topic)}</b><p>${h(l.topic)}</p></div>` : "",
      ...(l.details || []).map((d) => `<div class="detail"><b>${h(d.title || "")}</b>${d.text ? `<p>${h(d.text)}</p>` : ""}${fileLinks(d.files)}</div>`),
      l.average ? `<div class="detail"><b>${h(T.average)}</b><p class="num">${h(l.average)}</p></div>` : "",
    ].join("");
    return `<div class="lesson ${state}" data-toggle role="button" tabindex="0">
      <span class="n num" style="background:${c}">${h(l.number ?? "·")}</span>
      <span class="main" style="flex:1;min-width:0">
        <span class="when num">${h(l.start || "")}${l.end ? "–" + h(l.end) : ""}</span>
        <div class="title" style="font-weight:600">${h(l.subject || "")}</div>
        ${l.topic && !opts.compact ? `<div class="meta" style="color:var(--muted);font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${h(l.topic)}</div>` : ""}
        ${pills.length ? `<div>${pills.join("")}</div>` : ""}
        <div class="more">${details}</div>
      </span>
    </div>`;
  }
  function fileLinks(files) {
    return (files || [])
      .filter((f) => f.sid)
      .map((f) => `<button class="file" data-file='${h(JSON.stringify({ sid: f.sid, legacy: !!f.legacy }))}'>📎 ${h(f.name)}</button>`)
      .join("");
  }
  function hwRow(i) {
    const c = color(i.subject);
    const n = i.due ? dayDiff(D.today, i.due) : 0;
    const late = !i.done && n < 0;
    return `<div class="row" data-toggle>
      <span class="bar" style="background:${c}"></span>
      <div class="main">
        <div class="title">${h(i.subject)}</div>
        <div class="body">${h(i.text || "")}</div>
        ${fileLinks(i.files)}
        <div class="meta" style="margin-top:4px">
          ${i.due ? `<span class="pill ${i.done ? "green" : late ? "red" : n <= 1 ? "mark" : ""}">${h(i.done ? T.doneG : relDue(i.due))}</span>` : ""}
          ${h([i.due ? T.due(shortDate(i.due)) : "", i.assigned ? T.set(shortDate(i.assigned)) : ""].filter(Boolean).join(", "))}
        </div>
      </div>
    </div>`;
  }
  function msgRow(m) {
    return `<button class="row" data-msg='${h(JSON.stringify({ id: m.id, typeId: m.typeId }))}'>
      <span class="dot ${m.unread ? "" : "off"}"></span>
      <span class="main">
        <div class="title" style="${m.unread ? "" : "font-weight:500"}">${h(m.subject || "—")}</div>
        <div class="meta">${h(m.from || "")}${m.fromTitle ? ", " + h(m.fromTitle) : ""}</div>
      </span>
      <span class="meta num" style="white-space:nowrap">${m.files ? "📎 " : ""}${m.important ? "❗" : ""}${h(m.date === D.today ? m.time : shortDate(m.date))}</span>
    </button>`;
  }
  function feedRow(f) {
    const label = T.feed[f.kind] || T.feed.other;
    const tone = { grade: "mark", formative: "green", absent: "red", late: "red", praise: "green", remark: "red" }[f.kind] || "";
    return `<div class="row" data-toggle>
      <span class="bar" style="background:${color(f.subject)}"></span>
      <div class="main">
        <div><span class="pill ${tone}">${h(label)}</span>${f.value ? `<span class="pill grade mark">${h(f.value)}</span>` : ""}</div>
        <div class="title" style="margin-top:4px">${h(f.subject || "")}</div>
        ${f.text ? `<div class="body">${h(f.text)}</div>` : ""}
        <div class="meta">${h(dayName(f.lessonDate || f.date || D.today))}${f.due ? ", " + h(T.due(shortDate(f.due))) : ""}</div>
      </div>
    </div>`;
  }
  const panel = (rows, empty) => `<div class="panel">${rows.length ? rows.join("") : `<div class="empty">${h(empty)}</div>`}</div>`;
  const section = (title, inner, aside = "") => `<section><h2>${h(title)}${aside ? `<small>${aside}</small>` : ""}</h2>${inner}</section>`;

  // ── screens ──
  function screenToday() {
    const today = dayOf(D.today);
    const lessons = (today && today.lessons) || [];
    const now = nowMinutes();
    let nowCard;
    const cur = lessons.find((l) => mins(l.start) <= now && now < mins(l.end));
    const nxt = lessons.find((l) => mins(l.start) > now);
    if (cur) {
      const pct = Math.min(100, Math.max(0, ((now - mins(cur.start)) / (mins(cur.end) - mins(cur.start))) * 100));
      nowCard = `<div class="now"><div class="k">${h(T.now)}, ${h(cur.start)}–${h(cur.end)}</div><div class="s">${h(cur.subject)}</div><div class="m">${h(T.endsIn(mins(cur.end) - now).replace(/\.$/, ""))}${nxt ? `. ${h(T.next)}: ${h(nxt.subject)}` : ""}</div><div class="progress" style="width:${pct}%"></div></div>`;
    } else if (nxt) {
      nowCard = `<div class="now"><div class="k">${h(T.next)}, ${h(nxt.start)}</div><div class="s">${h(nxt.subject)}</div><div class="m">${h(T.startsIn(mins(nxt.start) - now).replace(/\.$/, ""))}${nxt.label ? `. ${h(nxt.label)}` : ""}</div></div>`;
    } else {
      nowCard = `<div class="now quiet"><div class="k">${h(T.today)}</div><div class="s" style="font-size:21px">${h(lessons.length ? T.overToday : T.noLessonsToday)}</div></div>`;
    }

    const parts = [];
    const ev = eventsOn(D.today);
    if (ev.length) parts.push(`<div class="banner info">${ev.map((e) => h(e.title)).join("<br>")}</div>`);
    parts.push(`<section>${nowCard}</section>`);
    if (lessons.length) parts.push(section(T.lessonsToday, panel(lessons.map((l) => lessonRow(l, D.today, { compact: true })), ""), h(T.lessonsN(lessons.length))));

    // Next school day: what to pack and what's due
    const nd = nextSchoolDay();
    if (nd) {
      const label = nd.date === addDays(D.today, 1) ? `${T.tomorrow}, ${T.wdLong[dow(nd.date)].toLowerCase()}` : longDate(nd.date);
      // one chip per subject: double lessons would otherwise show twice; keep every distinct label
      const subjects = new Map();
      nd.lessons.forEach((l) => {
        const k = (l.subject || "").trim();
        if (!subjects.has(k)) subjects.set(k, new Set());
        if (l.label) subjects.get(k).add(l.label);
      });
      const chips = [...subjects]
        .map(([subj, labels]) => `<span class="chip"><i style="background:${color(subj)}"></i>${h(subj)}${[...labels].map((lb) => ` <span class="pill red" style="margin:0">${h(lb)}</span>`).join("")}</span>`)
        .join("");
      const due = (D.homework || []).filter((i) => i.due === nd.date).sort(byDue);
      parts.push(section(T.prepFor(label), `<div class="panel"><div class="chips">${chips}</div>${due.length ? due.map(hwRow).join("") : ""}</div>`));
    }

    const soon = (D.homework || []).filter((i) => !i.done && i.due && dayDiff(D.today, i.due) <= 3 && dayDiff(D.today, i.due) >= -7 && (!nd || i.due !== nd.date)).sort(byDue);
    parts.push(section(T.dueSoon, panel(soon.map(hwRow), T.nothingDue)));

    const msgs = (D.messages || []).filter((m) => m.date === D.today);
    parts.push(section(T.messagesToday, panel(msgs.map(msgRow), T.noMessagesToday), `<button data-tab="3" style="color:var(--blue);font-weight:600">${h(T.seeAll)}</button>`));

    const checks = allDays()
      .filter((d) => d.date >= D.today)
      .flatMap((d) => d.lessons.filter(isCheck).map((l) => ({ d, l })))
      .filter((x, i, all) => all.findIndex((y) => y.d.date === x.d.date && y.l.subject === x.l.subject && y.l.label === x.l.label) === i);
    if (checks.length) {
      parts.push(section(T.checks, panel(checks.map(({ d, l }) => `<div class="row"><span class="bar" style="background:${color(l.subject)}"></span><div class="main"><div class="title">${h(l.subject)}</div><div class="meta">${h(dayName(d.date))}${l.start ? ", " + h(l.start) : ""}</div><span class="pill red">${h(l.label)}</span>${l.topic ? `<div class="body">${h(l.topic)}</div>` : ""}</div></div>`), "")));
    }

    const weekAgo = addDays(D.today, -7);
    const feed = (D.feed || []).filter((f) => (f.date || f.lessonDate || D.today) >= weekAgo && f.kind !== "homework").slice(0, 10);
    parts.push(section(T.whatsNew, panel(feed.map(feedRow), T.nothingNew)));
    return parts.join("");
  }

  function screenSchedule() {
    const days = S.weeks[String(S.weekOffset)];
    const monday = addDays(D.monday, S.weekOffset * 7);
    const lbl = S.weekOffset === 0 ? T.thisWeek : S.weekOffset === 1 ? T.nextWeek : S.weekOffset === -1 ? T.lastWeek : T.weekOf(shortDate(monday));
    const range = `${shortDate(monday)} – ${shortDate(addDays(monday, 4))}`;
    const nav = `<div class="weeknav">
      <button class="icon-btn" data-week="-1" aria-label="previous week"><svg viewBox="0 0 24 24" style="stroke:var(--ink);fill:none;stroke-width:2;width:19px"><path d="M15 18l-6-6 6-6"/></svg></button>
      <div class="lbl">${h(lbl)}<small>${h(range)}</small></div>
      <button class="icon-btn" data-week="1" aria-label="next week"><svg viewBox="0 0 24 24" style="stroke:var(--ink);fill:none;stroke-width:2;width:19px"><path d="M9 18l6-6-6-6"/></svg></button>
    </div>`;
    if (!days) {
      if (days === undefined) loadWeek(S.weekOffset);
      return `<section>${nav}${panel([], days === null ? T.failed("") : T.loading)}</section>`;
    }
    const shown = days.filter((d, i) => i < 5 || d.lessons.length);
    if (!S.day || !shown.find((d) => d.date === S.day)) {
      S.day = (shown.find((d) => d.date === D.today) || shown.find((d) => d.date > D.today && d.lessons.length) || shown[0] || {}).date;
    }
    const chips = shown
      .map((d) => `<button class="day ${d.date === S.day ? "on" : ""} ${d.date === D.today ? "today" : ""}" data-day="${d.date}"><div class="w">${h(T.wd[dow(d.date)])}</div><div class="d num">${dnum(d.date)}</div><div class="c num">${d.lessons.length || (eventsOn(d.date).length ? "—" : "0")}</div></button>`)
      .join("");
    const day = shown.find((d) => d.date === S.day);
    const ev = day ? eventsOn(day.date) : [];
    const body = day ? panel(day.lessons.map((l) => lessonRow(l, day.date)), ev.length ? `${T.noSchool}: ${ev.map((e) => e.title).join(", ")}` : T.noLessons) : "";
    return `<section>${nav}<div class="days" style="--cols:${shown.length}">${chips}</div>
      ${day ? `<h2>${h(longDate(day.date))}</h2>` : ""}
      ${ev.length && day && day.lessons.length ? `<div class="banner info" style="margin:0 0 10px">${ev.map((e) => h(e.title)).join("<br>")}</div>` : ""}
      ${body}</section>`;
  }

  async function loadWeek(offset) {
    try {
      const res = await call("week", { monday: addDays(D.monday, offset * 7) });
      S.weeks[String(offset)] = res;
    } catch (e) {
      S.weeks[String(offset)] = null;
    }
    if (S.tab === 1 && S.weekOffset === offset) render();
  }

  function screenHomework() {
    const seg = `<div class="seg">${[["todo", T.todo], ["all", T.all], ["done", T.done]].map(([k, l]) => `<button class="${S.hwFilter === k ? "on" : ""}" data-hw="${k}">${h(l)}</button>`).join("")}</div>`;
    const items = (D.homework || []).filter((i) => (S.hwFilter === "all" ? true : S.hwFilter === "done" ? i.done : !i.done)).sort(byDue);
    const endOfWeek = addDays(D.monday, 6);
    const groups = [
      [S.hwFilter === "todo" ? T.overdue : T.earlier, (i) => i.due < D.today],
      [T.dueToday, (i) => i.due === D.today],
      [T.dueTomorrow, (i) => i.due === addDays(D.today, 1)],
      [T.laterWeek, (i) => i.due > addDays(D.today, 1) && i.due <= endOfWeek],
      [T.later, (i) => i.due > endOfWeek && i.due > addDays(D.today, 1)],
    ];
    groups.reverse(); // latest group first, matching byDue
    const used = new Set();
    const out = [];
    for (const [title, test] of groups) {
      const g = items.filter((i) => !used.has(i) && i.due && test(i));
      g.forEach((i) => used.add(i));
      if (g.length) out.push(section(title, panel(g.map(hwRow), ""), h(String(g.length))));
    }
    return `<section>${seg}</section>${out.join("") || panel([], T.nothingDue)}`;
  }

  function screenMessages() {
    const days = Array.from({ length: 7 }, (_, i) => addDays(D.today, i - 6));
    const byDay = Object.fromEntries(days.map((d) => [d, (D.messages || []).filter((m) => m.date === d)]));
    const max = Math.max(1, ...days.map((d) => byDay[d].length));
    const chart = `<div class="panel"><div class="chart">${days
      .map((d) => {
        const n = byDay[d].length;
        const u = byDay[d].filter((m) => m.unread).length;
        const hgt = 8 + (n / max) * 72;
        return `<button data-msgday="${d}" class="${S.msgDay === d ? "on" : ""}" aria-label="${h(shortDate(d))}: ${n}"><span class="cnt num">${n || ""}</span><span class="col ${n ? "has" : ""}" style="height:${hgt}px">${u ? `<span class="u" style="height:${(u / n) * 100}%"></span>` : ""}</span><span class="w">${h(T.wd[dow(d)])}</span></button>`;
      })
      .join("")}</div></div>`;
    const totalUnread = days.reduce((a, d) => a + byDay[d].filter((m) => m.unread).length, 0);
    const parts = [section(T.last7, chart, totalUnread ? `<i style="display:inline-block;width:9px;height:9px;border-radius:2px;background:var(--mark);margin-right:5px"></i>${h(T.unreadN(totalUnread))}` : "")];
    if (S.msgDay) {
      parts.push(`<div style="margin:10px 4px 0"><button data-msgday="" class="pill">✕ ${h(T.all7)}</button></div>`);
      parts.push(section(longDate(S.msgDay), panel(byDay[S.msgDay].map(msgRow), T.noMessagesDay)));
    } else {
      const any = days.some((d) => byDay[d].length);
      if (!any) parts.push(section("", panel([], T.noMessages)));
      days
        .slice()
        .reverse()
        .forEach((d) => {
          if (byDay[d].length) parts.push(section(dayName(d), panel(byDay[d].map(msgRow), ""), h(String(byDay[d].length))));
        });
      const older = (D.messages || []).filter((m) => m.date < days[0]);
      if (older.length) parts.push(section(T.older, panel(older.slice(0, 30).map(msgRow), "")));
    }
    return parts.join("");
  }

  function screenGrades() {
    const g = (D.diary && D.diary.grades) || [];
    const numeric = g.map((x) => ({ ...x, n: parseFloat(String(x.value).replace(",", ".")) })).filter((x) => x.n >= 1 && x.n <= GMAX);
    const subjects = {};
    numeric.forEach((x) => (subjects[x.subject] = subjects[x.subject] || []).push(x.n));
    const avgs = Object.entries(subjects)
      .map(([s, v]) => [s, v.reduce((a, b) => a + b, 0) / v.length, v.length])
      .sort((a, b) => b[1] - a[1]);
    const avgRows = avgs.map(
      ([s, a, n]) => `<div class="avg"><span class="s">${h(s)}<div class="meta" style="font-weight:400;color:var(--muted);font-size:13px">${n}×</div></span><span class="track"><span class="fill" style="display:block;width:${Math.min(100, (a / GMAX) * 100)}%;background:${color(s)}"></span></span><span class="v num">${a.toFixed(1)}</span></div>`
    );
    const recent = g
      .slice()
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, 25)
      .map((x) => `<div class="row"><span class="bar" style="background:${color(x.subject)}"></span><div class="main"><div class="title">${h(x.subject)}</div><div class="meta">${h(shortDate(x.date))}${x.type ? ", " + h(x.type) : ""}</div></div><span class="pill grade mark" style="font-size:17px">${h(x.value)}</span></div>`);
    const att = (D.diary && D.diary.attendance) || [];
    const absent = att.filter((a) => /^n/i.test(a.value)).length;
    const late = att.filter((a) => /^p/i.test(a.value)).length;
    const form = ((D.diary && D.diary.formatives) || [])
      .slice()
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .slice(0, 15)
      .map((x) => `<div class="row"><span class="bar" style="background:${color(x.subject)}"></span><div class="main"><div class="title">${h(x.subject)}</div><div class="meta">${h(shortDate(x.date))}${x.type ? ", " + h(x.type) : ""}</div></div><span class="pill green">${h(x.value)}</span></div>`);
    return [
      section(T.averages, panel(avgRows, T.noGrades), `<button data-scale style="color:var(--blue);font-weight:600">${h(T.scaleLbl(GMAX))}</button>`),
      section(T.recent, panel(recent, T.noGrades)),
      form.length ? section(T.formatives, panel(form, "")) : "",
      section(T.attendance, `<div class="panel"><div class="chips"><span class="chip num">${absent} ${h(T.absent)}</span><span class="chip num">${late} ${h(T.late)}</span></div>${att
        .slice()
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
        .slice(0, 12)
        .map((a) => `<div class="row"><div class="main"><div class="title">${h(a.subject)}</div><div class="meta">${h(shortDate(a.date))}</div></div><span class="pill red">${h(a.value)}</span></div>`)
        .join("")}</div>`),
    ].join("");
  }

// ── AI settings sheet (app-blueprints · ai-configuration) ──
  // Opened with window.__aiOpen(); the Scriptable side pushes state with window.__aiState(state).
  var AIS=null, aiIsOpen=false, aiArmed=null, aiLoading={};
  var AI_PN={ anthropic:'Claude', openai:'OpenAI' };
  var AI_FEAT={"ask": "Ask", "test": "Connection tests", "other": "Other"};
  var AI_JOBS=[];
  function aiSend(act,data){ call(act,data,120000).catch(function(){}); }
  function aiEsc(t){ var d=document.createElement('div'); d.textContent=String(t==null?'':t); return d.innerHTML; }
  function aiFmtN(n){ return n>=1e6?(n/1e6).toFixed(2)+'M':n>=1e4?Math.round(n/1e3)+'k':n>=1e3?(n/1e3).toFixed(1)+'k':String(n); }
  function aiRel(t){ var s=Math.max(0,Math.round((Date.now()-t)/1000)); if(s<60) return 'just now'; if(s<3600) return Math.round(s/60)+' min ago'; if(s<86400) return Math.round(s/3600)+' h ago'; return Math.round(s/86400)+' d ago'; }
  function aiDayStr(d){ return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2); }
  function aiArm(k){ aiArmed=k; renderAI(); setTimeout(function(){ if(aiArmed===k){ aiArmed=null; renderAI(); } },3500); }
  function aiSheet(){
    var el=document.getElementById('aisheet');
    if(!el){
      el=document.createElement('div'); el.id='aisheet'; el.setAttribute('role','dialog'); el.setAttribute('aria-label','AI settings');
      document.body.appendChild(el);
      el.addEventListener('click',aiClick);
      el.addEventListener('change',function(e){ e.stopPropagation(); if(e.target.classList.contains('modelsel')) aiSend('aimodel',{p:e.target.getAttribute('data-p'),v:e.target.value}); });
    }
    return el;
  }
  window.__aiOpen=function(){ aiIsOpen=true; renderAI(); aiSend('aistate',{}); };
  window.__aiState=function(s){ AIS=s; aiLoading={}; renderAI(); if(typeof window.__aiChanged==='function') window.__aiChanged(s); };
  window.__aiToast=function(t){
    if(!t) return; if(typeof toast==='function') return toast(t);
    var el=document.getElementById('aitoast'); if(!el){ el=document.createElement('div'); el.id='aitoast'; el.setAttribute('aria-live','polite'); document.body.appendChild(el); }
    el.textContent=t; el.classList.add('on'); clearTimeout(el.tm); el.tm=setTimeout(function(){ el.classList.remove('on'); },2600);
  };
  function aiUsageBlock(p,P){
    var days=[], now=new Date(), i;
    for(i=13;i>=0;i--){ var d=new Date(now); d.setDate(d.getDate()-i); days.push(aiDayStr(d)); }
    var tot=function(k){ var x=P.days[k]; return x?x.in+x.out:0; };
    var max=Math.max.apply(null,[1].concat(days.map(tot))), month=AIS.today.slice(0,7);
    var monthTot=Object.keys(P.days).filter(function(k){ return k.indexOf(month)===0; }).reduce(function(n,k){ return n+P.days[k].in+P.days[k].out; },0);
    var rows=function(obj,label){ return Object.keys(obj).sort(function(a,b){ return (obj[b].in+obj[b].out)-(obj[a].in+obj[a].out); }).map(function(k){ var x=obj[k];
      return '<tr><td>'+aiEsc(label(k))+'</td><td>'+x.calls+'</td><td>'+aiFmtN(x.in)+'</td><td>'+aiFmtN(x.out)+'</td></tr>'; }).join(''); };
    return '<div class="ucard"><div class="aic-h"><b>'+AI_PN[p]+'</b><span class="muted small">'+P.calls+' request'+(P.calls===1?'':'s')+'</span></div>'+
      '<div class="ustat"><div><b>'+aiFmtN(P.in+P.out)+'</b><small>total tokens</small></div><div><b>'+aiFmtN(P.in)+'</b><small>input</small></div><div><b>'+aiFmtN(P.out)+'</b><small>output</small></div></div>'+
      '<p class="note">Today '+aiFmtN(tot(AIS.today))+' tokens — this month '+aiFmtN(monthTot)+' tokens</p>'+
      '<div class="ubars" aria-label="Tokens per day, last 14 days">'+days.map(function(k){ var v=tot(k); return '<span style="height:'+Math.max(v?6:2,v/max*100)+'%" class="'+(v?'':'zero')+'" title="'+k+': '+v+' tokens"></span>'; }).join('')+'</div>'+
      '<div class="ubars-l"><span>2 weeks ago</span><span>Today</span></div>'+
      '<table class="utab"><tr><th>Feature</th><th>Requests</th><th>In</th><th>Out</th></tr>'+rows(P.features,function(k){ return AI_FEAT[k]||k; })+'</table>'+
      '<table class="utab"><tr><th>Model</th><th>Requests</th><th>In</th><th>Out</th></tr>'+rows(P.models,function(k){ return k; })+'</table></div>';
  }
  function renderAI(){
    var el=aiSheet(), keep=el.scrollTop;
    el.classList.toggle('open',aiIsOpen);
    if(!aiIsOpen) return;
    if(!AIS){ el.innerHTML='<div class="sh-head"><h2>AI</h2><button class="link" data-aiact="aiclose">Done</button></div><div class="sh-body"><p class="muted pad">Loading…</p></div>'; return; }
    var A=AIS;
    var card=function(p){
      var key=A.keys[p], ml=(A.models[p]||{}).list||[], cur=A.model[p];
      var opts=ml.some(function(m){ return m.id===cur; })?ml:[{id:cur,name:cur}].concat(ml);   // keep the chosen model visible
      return '<div class="aicard '+(A.provider===p?'active':'')+'">'+
        '<div class="aic-h"><b>'+AI_PN[p]+'</b>'+(A.provider===p?'<span class="badge-ai">In use</span>':key?'<button class="sm" data-aiact="aiprov" data-v="'+p+'">Use '+AI_PN[p]+'</button>':'')+'</div>'+
        '<div class="aic-row"><span class="lbl">API key</span>'+(key?'<code>'+aiEsc(key)+'</code>':'<span class="muted">Not set</span>')+'</div>'+
        '<div class="aic-btns"><button class="sm '+(key?'':'primary')+'" data-aiact="aikey" data-v="'+p+'">'+(key?'Change key':'Add key')+'</button>'+
          (key?'<button class="sm" data-aiact="aitest" data-v="'+p+'">Test connection</button><button class="sm danger '+(aiArmed==='rm'+p?'armed':'')+'" data-aiact="airm" data-v="'+p+'">'+(aiArmed==='rm'+p?'Confirm':'Remove')+'</button>':'')+'</div>'+
        '<label class="aic-row lbl" for="ms-'+p+'">Model</label>'+
        '<select id="ms-'+p+'" class="modelsel" data-p="'+p+'">'+opts.map(function(m){ return '<option value="'+aiEsc(m.id)+'" '+(m.id===cur?'selected':'')+'>'+aiEsc(m.name)+(m.name!==m.id?' — '+aiEsc(m.id):'')+'</option>'; }).join('')+'</select>'+
        '<div class="aic-btns"><button class="sm" data-aiact="aimodels" data-v="'+p+'" '+(key&&!aiLoading[p]?'':'disabled')+'>'+(aiLoading[p]?'Loading…':ml.length?'Refresh model list':'Load my models')+'</button>'+
          '<span class="note">'+(ml.length?ml.length+' models, updated '+aiRel(A.models[p].at):key?'Loads the models your key can use':'Add a key to load models')+'</span></div>'+
      '</div>';
    };
    var order=A.provider==='openai'?['openai','anthropic']:['anthropic','openai'];
    var used=Object.keys(A.usage.p).filter(function(p){ return A.usage.p[p].calls; });
    var jobs=AI_JOBS.length?AI_JOBS.map(function(j){
        return '<div class="srow"><div class="grow"><b>'+aiEsc(j.title)+'</b><small class="muted">'+aiEsc(j.text)+'</small></div>'+
          '<button class="switch '+(A.ai?'on':'')+'" data-aiact="aitoggle" aria-label="'+aiEsc(j.title)+'"></button></div>'; }).join('')
      :'<p class="muted pad">Nothing runs in the background: AI only answers when you ask in the ✨ Ask tab.</p>';
    el.innerHTML='<div class="sh-head"><h2>AI</h2><button class="link" data-aiact="aiclose">Done</button></div><div class="sh-body">'+
      '<p class="hint">Keys stay in this iPhone’s Keychain. Only the provider marked “In use” is called.</p>'+
      order.map(card).join('')+
      '<h3 class="sec">What AI does</h3>'+jobs+
      '<h3 class="sec">Token usage</h3>'+
      (used.length?used.map(function(p){ return aiUsageBlock(p,A.usage.p[p]); }).join(''):'<p class="muted pad">No AI requests yet.</p>')+
      (used.length?'<div class="aic-btns"><span class="note">Counting since '+new Date(A.usage.since).toLocaleDateString(undefined,{month:'long',day:'numeric',year:'numeric'})+'</span>'+
        '<button class="sm danger '+(aiArmed==='reset'?'armed':'')+'" data-aiact="usagereset">'+(aiArmed==='reset'?'Confirm reset':'Reset counters')+'</button></div>':'')+
    '</div>';
    el.scrollTop=keep;   // re-renders must not jump the user back to the top
  }
  function aiClick(e){
    e.stopPropagation();   // the sheet's taps never reach the app's own click handler
    if(e.target.closest('select, option, input, textarea')) return;
    var t=e.target.closest('[data-aiact]'); if(!t||t.disabled) return;
    var act=t.getAttribute('data-aiact'), v=t.getAttribute('data-v');
    if(act==='aiclose'){ aiIsOpen=false; aiArmed=null; renderAI(); return; }
    if(act==='aikey'||act==='aitest'||act==='aiprov'||act==='aitoggle'){ if(act==='aitest') window.__aiToast('Testing '+AI_PN[v]+'…'); aiSend(act,{v:v}); return; }
    if(act==='aimodels'){ aiLoading[v]=1; renderAI(); aiSend('aimodels',{v:v}); return; }
    if(act==='airm'){ if(aiArmed==='rm'+v){ aiArmed=null; aiSend('airm',{v:v}); } else aiArm('rm'+v); return; }
    if(act==='usagereset'){ if(aiArmed==='reset'){ aiArmed=null; aiSend('usagereset',{}); } else aiArm('reset'); return; }
  }
  // A key added or removed in AI settings shows or hides the Ask tab straight away; a waiting question is asked.
  window.__aiChanged = (s) => {
    const had = D.hasAiKey;
    D.hasAiKey = s.hasKey;
    if (!s.hasKey && S.tab === 5) S.tab = 0;
    if (had !== s.hasKey || S.needKey) {
      const q = s.hasKey && S.needKey ? S.pendingQ : "";
      if (s.hasKey) { S.needKey = false; S.pendingQ = ""; }
      render();
      if (q) ask(q);
    }
    const st = document.getElementById("s-aistatus"), P = s.usage.p[s.provider];   // the AI settings row in Settings
    if (st) st.textContent = s.hasKey ? `${AI_PN[s.provider]} — ${s.model[s.provider]}${P && P.calls ? ` — ${aiFmtN(P.in + P.out)} tokens` : ""}` : CT.aiNone;
  };

  // ── AI invitation (app-blueprints · ai-invitation) ── ES5, no backticks, as the blueprint writes it.
  // Dienynas+: the fixed text follows the app language (the blueprint's English words, or Lithuanian);
  // aiSend is this page's send(); the app's own message sheet (body.open-sheet) counts as busy too.
  var INV_TEXT = {
    en: { lead: "Add an AI key and these switch on:", steps: ["Get a key from Claude or OpenAI", "Paste it in AI settings", "That’s it: these turn on at once"], go: "Turn on AI", later: "Later", never: "Don’t remind me again" },
    lt: { lead: "Pridėkite DI raktą ir įsijungs šios funkcijos:", steps: ["Gaukite raktą iš Claude arba OpenAI", "Įklijuokite jį į AI nustatymus", "Tai viskas: jos įsijungs iš karto"], go: "Įjungti DI", later: "Vėliau", never: "Daugiau nepriminti" },
  };
  window.__aiInvite = function (c) {
    var tries = 0;
    (function wait() {
      // Never over the launch screen, another sheet, or a task the app says can't be interrupted.
      var busy = document.querySelector("#splash:not(.gone)") || document.getElementById("upd") || document.getElementById("aiinv") ||
        document.querySelector(".sheet.open, #cfgsheet.open, #aisheet.open, body.open-sheet") || (window.canInvite && !window.canInvite());
      if (busy) { if (++tries < 40) setTimeout(wait, 500); return; }   // gives up after 20 s; it comes back another day
      setTimeout(function () { if (!document.getElementById("aiinv")) showInvite(c); }, 600);
    })();
  };
  function escI(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function showInvite(c) {
    var L = INV_TEXT[D.lang] || INV_TEXT.en;
    var el = document.createElement("div");
    el.id = "aiinv";
    el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "aiinv-t");
    el.innerHTML = '<div class="aiinv-card">' +
      '<div class="aiinv-spark" aria-hidden="true">✦</div>' +
      '<h2 id="aiinv-t">' + escI(c.title) + '</h2>' +
      '<p class="aiinv-lead">' + escI(L.lead) + '</p>' +
      '<ul class="aiinv-perks">' + c.perks.slice(0, 3).map(function (p, i) {
        return '<li style="--i:' + i + '"><span class="aiinv-ico" aria-hidden="true">' + escI(p.icon) + '</span>' + escI(p.text) + '</li>';
      }).join("") + '</ul>' +
      '<ol class="aiinv-steps">' + L.steps.map(function (s) { return '<li>' + escI(s) + '</li>'; }).join("") + '</ol>' +
      '<button class="aiinv-go" data-inv="open">' + escI(L.go) + '</button>' +
      '<div class="aiinv-row"><button class="aiinv-later" data-inv="later">' + escI(L.later) + '</button>' +
      '<button class="aiinv-never" data-inv="never">' + escI(L.never) + '</button></div></div>';
    el.addEventListener("click", function (e) {
      var b = e.target.closest ? e.target.closest("[data-inv]") : null;
      if (!b && e.target !== el) return;      // taps inside the card do nothing
      closeInvite(b ? b.dataset.inv : "later");   // a tap on the dimmed backdrop counts as Later
    });
    document.body.appendChild(el);
    aiSend("aiinvite", { v: "shown" });
    var go = el.querySelector(".aiinv-go"); if (go && go.focus) go.focus();
  }
  function closeInvite(what) {
    var el = document.getElementById("aiinv"); if (!el || el.classList.contains("out")) return;
    el.classList.add("out");
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
    aiSend("aiinvite", { v: what });
    if (what === "open") setTimeout(function () {
      window.__aiOpen();   // the same thing the Settings row's "ai-open" action does
      // Dienynas+: the AI sheet draws its cards once its state arrives, so look for Add key for up to 2 s.
      (function nudge(n) {
        // The Add key of the provider in use: its card is the one marked .active (ai-invitation 1.2.1).
        var add = document.querySelector('#aisheet .aicard.active [data-aiact="aikey"]') || document.querySelector('#aisheet [data-aiact="aikey"]');
        if (!add) { if (n < 14) setTimeout(function () { nudge(n + 1); }, 150); return; }
        add.classList.add("aiinv-nudge"); if (add.scrollIntoView) add.scrollIntoView({ block: "center" }); setTimeout(function () { add.classList.remove("aiinv-nudge"); }, 2600);
      })(0);
    }, 280);
  }

  // ── Settings (app-blueprints · settings): every change applies at once and is saved; Done closes ──
  const CT_ALL = {
    en: { title: "Settings", done: "Done", hint: "Changes apply right away and are kept on this iPhone.", appearance: "Appearance", colours: "Colours", layout: "Layout", textSize: "Text size", font: "Headline font",
      themes: { auto: "Auto", ink: "Ink", sepia: "Sepia", mint: "Mint", contrast: "Contrast", slate: "Slate", night: "Night" },
      layouts: ["Comfortable", "Compact", "Tiny"], sizes: ["Small", "Default", "Large", "Larger"], fonts: ["Sans serif", "Serif"],
      general: "General", language: "Language", languageHelp: "The app redraws in this language when you close Settings", grades: "Grades", scale: (n) => `Grade scale for ${n}`, scaleHelp: "Averages, bars and Ask use it", other: "Other…",
      ask: "Ask", aiRow: "Keys, models and token usage", aiNone: "Add a Claude or OpenAI key for ✨ Ask", aiBtn: "AI settings",
      account: "Account", switchChild: "Switch child", web: "Open TAMO website", login: "Change sign-in details", signout: "Sign out and forget password", signoutHelp: "Keeps these settings", confirm: "Confirm",
      updates: "Updates", offer: "Offer new versions", offerHelp: (v) => `You have Dienynas+ ${v}. “Later” waits two days.`, check: "Check for updates now", checkBtn: "Check", checking: "Checking…",
      startLog: "Start-up log", startLogHelp: "What happened the last times Dienynas+ opened", show: "Show", hide: "Hide", nothingLogged: "Nothing logged yet.",
      reset: "Reset", original: "original", changed: (n) => `${n} setting${n === 1 ? "" : "s"} changed`, none: "All settings are at their original values", resetAll: "Reset all", confirmReset: "Confirm reset",
      builtWith: "Built with", builtHint: (a) => `${a} is built from shared blueprints that the other apps use too. Tap one to read how that part works.`, bp: (v, a, s) => `Blueprint ${v} · since ${a} ${s}`, all: "All blueprints",
      dec: "Decrease", inc: "Increase" },
    lt: { title: "Nustatymai", done: "Baigti", hint: "Pakeitimai įsigalioja iš karto ir saugomi šiame iPhone.", appearance: "Išvaizda", colours: "Spalvos", layout: "Išdėstymas", textSize: "Teksto dydis", font: "Antraščių šriftas",
      themes: { auto: "Automatiškai", ink: "Rašalas", sepia: "Sepija", mint: "Mėtinė", contrast: "Kontrastas", slate: "Skalūnas", night: "Naktis" },
      layouts: ["Erdvus", "Glaustas", "Mažytis"], sizes: ["Mažas", "Įprastas", "Didelis", "Didesnis"], fonts: ["Be serifų", "Su serifais"],
      general: "Bendra", language: "Kalba", languageHelp: "Uždarius nustatymus programa persipieš šia kalba", grades: "Pažymiai", scale: (n) => `Vertinimo skalė: ${n}`, scaleHelp: "Ja remiasi vidurkiai, juostos ir „Klausk“", other: "Kita…",
      ask: "Klausk", aiRow: "Raktai, modeliai ir žetonų naudojimas", aiNone: "Pridėkite Claude arba OpenAI raktą „Klausk“ funkcijai", aiBtn: "AI nustatymai",
      account: "Paskyra", switchChild: "Keisti vaiką", web: "Atidaryti TAMO svetainę", login: "Keisti prisijungimo duomenis", signout: "Atsijungti ir pamiršti slaptažodį", signoutHelp: "Šie nustatymai išlieka", confirm: "Patvirtinti",
      updates: "Atnaujinimai", offer: "Siūlyti naujas versijas", offerHelp: (v) => `Jūsų versija: Dienynas+ ${v}. „Vėliau“ palaukia dvi dienas.`, check: "Tikrinti atnaujinimus dabar", checkBtn: "Tikrinti", checking: "Tikrinama…",
      startLog: "Paleidimo žurnalas", startLogHelp: "Kas vyko paskutinius kartus atidarant Dienynas+", show: "Rodyti", hide: "Slėpti", nothingLogged: "Kol kas nieko neužrašyta.",
      reset: "Atstatyti", original: "pradinė", changed: (n) => `Pakeista nustatymų: ${n}`, none: "Visi nustatymai pradiniai", resetAll: "Atstatyti viską", confirmReset: "Patvirtinti",
      builtWith: "Sukurta pagal", builtHint: (a) => `${a} sukurta pagal bendrus šablonus, kuriuos naudoja ir kitos programos. Paspauskite, kad perskaitytumėte, kaip veikia ta dalis.`, bp: (v, a, s) => `Šablonas ${v} · nuo ${a} ${s}`, all: "Visi šablonai",
      dec: "Mažinti", inc: "Didinti" },
  };
  const CT = CT_ALL[D.lang] || CT_ALL.en;
  const LOOK = Object.assign({ theme: "auto", density: "comfortable", font: "sans", textSize: 1 }, D.look || {});
  let SET = null, cfgOpen = false, cfgArmed = false, outArmed = false;
  const darkMQ = window.matchMedia ? matchMedia("(prefers-color-scheme: dark)") : { matches: false };
  function applyLook() {
    const root = document.documentElement;
    root.dataset.theme = LOOK.theme === "auto" ? (darkMQ.matches ? "night" : "ink") : LOOK.theme;
    root.dataset.font = LOOK.font;
    root.style.setProperty("--ts", LOOK.textSize);
    document.body.classList.remove("d-comfortable", "d-compact", "d-tiny");
    document.body.classList.add("d-" + LOOK.density);
  }
  const onDark = () => { if (LOOK.theme === "auto") applyLook(); };
  if (darkMQ.addEventListener) darkMQ.addEventListener("change", onDark); else if (darkMQ.addListener) darkMQ.addListener(onDark);
  const cfgSheet = () => {
    let el = document.getElementById("cfgsheet");
    if (!el) {
      el = document.createElement("div"); el.id = "cfgsheet"; el.setAttribute("role", "dialog"); el.setAttribute("aria-label", CT.title);
      document.body.appendChild(el);
      el.addEventListener("click", cfgClick);
      el.addEventListener("change", cfgChange);
    }
    return el;
  };
  const cfgItem = (k) => { for (const sec of SET.cfgSchema) for (const d of sec.items) if (d.k === k) return d; return null; };
  const cfgChanged = (k) => { const d = cfgItem(k); return !!d && JSON.stringify(SET.cfg[k]) !== JSON.stringify(d.def); };
  const fmtCfg = (d, v) => (d.step && d.step < 1 ? Number(v).toFixed(String(d.step).split(".")[1].length) : String(v));
  const segRow = (k, opts) => `<div class="seg wide">${opts.map(([v, l]) => `<button class="${String(LOOK[k]) === String(v) ? "on" : ""}" data-act="look" data-k="${k}" data-v="${v}">${h(l)}</button>`).join("")}</div>`;
  function lookHTML() {
    const P = SET.palettes, themes = ["auto"].concat(Object.keys(P));
    return `<div class="lk-row"><span class="lk-l">${h(CT.colours)}</span><div class="sws">${themes.map((k) => {
        const st = k === "auto" ? `background:linear-gradient(135deg,${P.ink.paper} 50%,${P.night.sheet} 50%);color:${P.night.signal}` : `background:${P[k].paper};color:${P[k].ink}`;
        return `<button class="sw ${LOOK.theme === k ? "on" : ""}" data-act="look" data-k="theme" data-v="${k}" aria-label="${h(CT.themes[k] || k)}"><span class="prev" style="${st}">Aa<i style="background:${(P[k] || P.night).signal}"></i></span><small>${h(CT.themes[k] || k)}</small></button>`;
      }).join("")}</div></div>
      <div class="lk-row"><span class="lk-l">${h(CT.layout)}</span>${segRow("density", [["comfortable", CT.layouts[0]], ["compact", CT.layouts[1]], ["tiny", CT.layouts[2]]])}</div>
      <div class="lk-row"><span class="lk-l">${h(CT.textSize)}</span>${segRow("textSize", [[0.92, CT.sizes[0]], [1, CT.sizes[1]], [1.12, CT.sizes[2]], [1.25, CT.sizes[3]]])}</div>
      <div class="lk-row"><span class="lk-l">${h(CT.font)}</span>${segRow("font", [["sans", CT.fonts[0]], ["serif", CT.fonts[1]]])}</div>`;
  }
  const swRow = (k, label, help) => `<div class="srow"><div class="grow"><b>${h(label)}</b><small>${h(help)}</small></div><button class="switch ${SET.settings[k] ? "on" : ""}" data-act="toggle" data-v="${k}" aria-label="${h(label)}"></button></div>`;
  const actRow = (v, label, help, danger) => `<button class="srow act" data-act="acct" data-v="${v}"><div class="grow"><b class="${danger ? "danger" : ""}">${h(danger && outArmed ? CT.confirm : label)}</b>${help ? `<small>${h(help)}</small>` : ""}</div><span class="chev" aria-hidden="true">›</span></button>`;
  function fieldHTML(d) {
    const v = SET.cfg[d.k], ch = cfgChanged(d.k);
    const reset = ch ? `<button class="link small" data-act="cfgreset" data-k="${d.k}">${h(CT.reset)}</button>` : "";
    const head = `<div class="cfg-h"><b>${h(d.label)}</b>${reset}</div>${d.help ? `<small class="muted">${h(d.help)}</small>` : ""}`;
    return `<div class="cfg ${ch ? "ch" : ""}">${head}
      <div class="stepper"><button data-act="cfgstep" data-k="${d.k}" data-v="-1" aria-label="${h(CT.dec)}" ${v <= d.min ? "disabled" : ""}>−</button>
      <input class="cfgin" data-k="${d.k}" value="${fmtCfg(d, v)}" inputmode="decimal" aria-label="${h(d.label)}">
      <button data-act="cfgstep" data-k="${d.k}" data-v="1" aria-label="${h(CT.inc)}" ${v >= d.max ? "disabled" : ""}>+</button>
      <span class="unit">${h(d.unit || "")}</span><span class="range">${fmtCfg(d, d.min)}–${fmtCfg(d, d.max)}${ch ? ` — ${h(CT.original)} ${fmtCfg(d, d.def)}` : ""}</span></div></div>`;
  }
  const bpLink = (b) => `${SET.blueprintsRepo}/blob/${b.id}-v${b.version}/blueprints/${b.id}.md`;
  function builtWithHTML() {
    return `<h3 class="sec">${h(CT.builtWith)}</h3><p class="hint">${h(CT.builtHint(SET.appName))}</p>
      ${SET.blueprints.map((b) => `<button class="srow bp" data-act="openurl" data-v="${h(bpLink(b))}"><div class="grow"><b>${h(b.name)}</b><small class="muted">${h(CT.bp(b.version, SET.appName, b.since))}</small></div><span class="chev" aria-hidden="true">›</span></button>`).join("")}
      <button class="srow bp" data-act="openurl" data-v="${h(SET.blueprintsRepo)}"><div class="grow"><b>${h(CT.all)}</b><small class="muted">${h(SET.blueprintsRepo.replace("https://", ""))}</small></div><span class="chev" aria-hidden="true">›</span></button>`;
  }
  // Settings blueprint 1.1.0: each section's rows in one card (.grp), built right after every render.
  // A heading's explanation (p.hint right under it) and the changed-count footer (.cfg-foot) stay outside.
  function cardSections(body) {
    if (!body) return;
    var inSec = false, grp = null, kids = Array.prototype.slice.call(body.children);
    kids.forEach(function (n) {
      var c = n.classList;
      if (n.tagName === "H3" && c.contains("sec")) { inSec = true; grp = null; return; }
      if (!inSec || c.contains("grp") || c.contains("cfg-foot")) { grp = null; return; }
      if (!grp && n.tagName === "P" && c.contains("hint")) return;
      if (!grp) { grp = document.createElement("div"); grp.className = "grp"; body.insertBefore(grp, n); }
      grp.appendChild(n);
    });
  }
  function renderCfg() {
    const el = cfgSheet(), keep = el.scrollTop;
    el.classList.toggle("open", cfgOpen);
    document.body.style.overflow = cfgOpen ? "hidden" : "";
    if (!cfgOpen || !SET) return;
    const changed = Object.keys(SET.cfg).filter(cfgChanged).length, s = SET.settings, ch = SET.child;
    const scaleOpts = [10, 7, 5].concat(ch && ![10, 7, 5].includes(ch.scale) ? [ch.scale] : []);
    el.innerHTML = `<div class="sh-head"><h2>${h(CT.title)}</h2><button class="link" data-act="cfgclose">${h(CT.done)}</button></div><div class="sh-body">
      <p class="hint">${h(CT.hint)}</p>
      <h3 class="sec">${h(CT.appearance)}</h3>${lookHTML()}
      <h3 class="sec">${h(CT.general)}</h3>
      <div class="lk-row"><span class="lk-l">${h(CT.language)}</span>${`<div class="seg wide">${[["en", "English"], ["lt", "Lietuvių"]].map(([v, l]) => `<button class="${s.lang === v ? "on" : ""}" data-act="lang" data-v="${v}">${l}</button>`).join("")}</div>`}<small class="muted">${h(CT.languageHelp)}</small></div>
      ${ch ? `<h3 class="sec">${h(CT.grades)}</h3>
      <div class="cfg"><div class="cfg-h"><b>${h(CT.scale(ch.name))}</b></div><small class="muted">${h(CT.scaleHelp)}</small>
        <select class="cfgsel" data-k="scale">${scaleOpts.map((n) => `<option value="${n}"${n === ch.scale ? " selected" : ""}>1–${n}</option>`).join("")}<option value="other">${h(CT.other)}</option></select></div>` : ""}
      <h3 class="sec">${h(CT.ask)}</h3>
      <div class="srow"><div class="grow"><b>${h(CT.aiRow)}</b><small id="s-aistatus">${h(SET.hasKey ? SET.aiStatus : CT.aiNone)}</small></div><button class="sm" data-act="ai-open">${h(CT.aiBtn)}</button></div>
      <h3 class="sec">${h(CT.account)}</h3>
      ${SET.canSwitch ? actRow("switchChild", CT.switchChild) : ""}${actRow("web", CT.web)}${actRow("login", CT.login)}${actRow("signout", CT.signout, CT.signoutHelp, true)}
      <h3 class="sec">${h(CT.updates)}</h3>
      ${swRow("checkUpdates", CT.offer, CT.offerHelp(SET.version))}
      <div class="srow"><div class="grow"><b>${h(CT.check)}</b><small id="updmsg" class="muted" aria-live="polite"></small></div><button class="sm" data-act="updcheck">${h(CT.checkBtn)}</button></div>
      <div class="srow"><div class="grow"><b>${h(CT.startLog)}</b><small class="muted">${h(CT.startLogHelp)}</small></div><button class="sm" data-act="startlog">${h(CT.show)}</button></div>
      <pre id="startlog" class="startlog" hidden></pre>
      ${SET.cfgSchema.map((sec) => `<h3 class="sec">${h(sec.title)}</h3>${sec.items.map(fieldHTML).join("")}`).join("")}
      <div class="cfg-foot"><span class="note">${h(changed ? CT.changed(changed) : CT.none)}</span>
        ${changed ? `<button class="sm danger ${cfgArmed ? "armed" : ""}" data-act="cfgall">${h(cfgArmed ? CT.confirmReset : CT.resetAll)}</button>` : ""}</div>
      ${builtWithHTML()}</div>`;
    cardSections(el.querySelector(".sh-body"));   // Settings 1.1.0: one card per section
    el.scrollTop = keep;   // re-renders must not jump back to the top
  }
  const sendCfg = (action, params) => call(action, params || {}, 600000).then((st) => { if (st && st.cfgSchema) SET = st; renderCfg(); }, (e) => { (window.__aiToast || alert)(e.message); renderCfg(); });
  function openSettings() {
    if (cfgOpen) return;
    call("settings-get", {}, 30000).then((st) => { SET = st; cfgOpen = true; renderCfg(); cfgSheet().scrollTop = 0; }, (e) => (window.__aiToast || alert)(e.message));
  }
  function closeSettings() { cfgOpen = false; cfgArmed = false; outArmed = false; renderCfg(); call("settings-done", {}, 30000).catch(() => {}); }
  function cfgClick(e) {
    e.stopPropagation();   // the sheet's taps never reach the app's own click handler
    if (e.target.closest("select, option, input, textarea")) return;
    const t = e.target.closest("[data-act]"); if (!t || t.disabled) return;
    const act = t.dataset.act, v = t.dataset.v, k = t.dataset.k;
    if (act === "cfgclose") return closeSettings();
    if (act === "look") { const val = k === "textSize" ? +v : v; LOOK[k] = val; applyLook(); renderCfg(); return sendCfg("set", { k, v: val }); }
    if (act === "lang") { SET.settings.lang = v; renderCfg(); return sendCfg("set", { k: "lang", v }); }
    if (act === "toggle") { SET.settings[v] = !SET.settings[v]; renderCfg(); return sendCfg("set", { k: v, v: SET.settings[v] }); }
    if (act === "cfgreset") return sendCfg("cfg", { k, reset: 1 });
    if (act === "cfgstep") { const d = cfgItem(k), step = d.step || 1; SET.cfg[k] = Number(Math.min(d.max, Math.max(d.min, Number(SET.cfg[k]) + step * +v)).toFixed(2)); renderCfg(); return sendCfg("cfg", { k, v: SET.cfg[k] }); }
    if (act === "cfgall") {
      if (cfgArmed) { cfgArmed = false; return sendCfg("cfg", { k: "*" }); }
      cfgArmed = true; renderCfg(); setTimeout(() => { if (cfgArmed) { cfgArmed = false; renderCfg(); } }, 3500); return;
    }
    if (act === "ai-open") return window.__aiOpen();
    if (act === "startlog") {   // Settings › Updates › Start-up log (recipe · safe-startup)
      const pre = document.getElementById("startlog");
      if (!pre.hidden) { pre.hidden = true; t.textContent = CT.show; return; }
      return call("startlog", {}, 30000).then((txt) => { pre.textContent = txt || CT.nothingLogged; pre.hidden = false; t.textContent = CT.hide; }, () => {});
    }
    if (act === "openurl") return call("openurl", { v }).catch(() => {});
    if (act === "updcheck") {
      const um = document.getElementById("updmsg"); t.disabled = true; if (um) um.textContent = CT.checking;
      return call("update-check", {}, 30000).then((r) => { t.disabled = false; if (um) um.textContent = (r && r.msg) || ""; if (r && r.available) closeSettings(); }, (er) => { t.disabled = false; if (um) um.textContent = er.message; });
    }
    if (act === "acct") {
      if (v === "signout" && !outArmed) { outArmed = true; renderCfg(); setTimeout(() => { if (outArmed) { outArmed = false; renderCfg(); } }, 3500); return; }
      outArmed = false; cfgOpen = false; renderCfg();
      return call("acct", { v }).catch(() => {});
    }
  }
  function cfgChange(e) {
    e.stopPropagation();
    const el = e.target;
    if (el.classList.contains("cfgin")) return sendCfg("cfg", { k: el.dataset.k, v: el.value });
    if (el.dataset.k === "scale") return sendCfg(el.value === "other" ? "scale-other" : "scale-set", { v: el.value });
  }
  applyLook();

  // ── ask (chat) ──
  function md(text) {
    const inline = (s) => h(s).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/\*([^*\s][^*]*)\*/g, "<i>$1</i>").replace(/https?:\/\/[^\s<)]+/g, (u) => `<a href="${u}" style="color:var(--blue)">${u}</a>`);
    const out = [];
    let ul = [];
    const flush = () => {
      if (ul.length) out.push(`<ul>${ul.map((li) => `<li>${inline(li)}</li>`).join("")}</ul>`);
      ul = [];
    };
    String(text || "").split(/\n/).forEach((raw) => {
      const line = raw.trim();
      const b = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)$/);
      if (b) return ul.push(b[1]);
      flush();
      if (line) out.push(`<p>${inline(line.replace(/^#+\s*/, ""))}</p>`);
    });
    flush();
    return out.join("");
  }
  function memCard() {
    if (S.preparing) {
      return `<div class="mem"><div class="mem-h"><b>${h(T.gathering)}</b></div><div class="mem-p"><span class="typing"><i></i><i></i><i></i></span> ${h(T.stages[S.stage] || "")}</div></div>`;
    }
    if (S.prepError) return `<div class="mem err">${h(T.gatherFailed(S.prepError))} <button class="lnk" id="memrefresh">${h(T.memRefresh)}</button></div>`;
    const i = S.info;
    if (!i) return "";
    const t = new Date(i.builtAt);
    const at = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
    const range = i.weekFrom ? `${shortDate(i.weekFrom)} – ${shortDate(i.weekTo)}` : "";
    return `<div class="mem">
      <div class="mem-h"><b>${h(T.memTitle)}</b><span>${h(T.memUpdated(at))}</span></div>
      <div class="mem-p">${h(T.memLine(i, range, i.from ? shortDate(i.from) : ""))}</div>
      <div class="mem-a"><button class="lnk" id="memrefresh">${h(T.memRefresh)}</button><button class="lnk red" id="memclear">${h(S.clearArmed ? T.memClearConfirm : T.memClear)}</button></div>
    </div>`;
  }
  function screenAsk() {
    const bubbles = S.chat.map((m) => `<div class="bubble ${m.role}">${m.role === "assistant" ? `<span class="badge-ai">${h(m.by ? T.aiBy(m.by) : "✦ AI")}</span>${md(m.text)}` : h(m.text)}</div>`);
    if (S.thinking) bubbles.push(`<div class="bubble assistant"><span class="typing"><i></i><i></i><i></i></span>${S.stage ? ` <span style="color:var(--muted);font-size:14px">${h(T.stages[S.stage] || "")}</span>` : ""}</div>`);
    const intro = `${memCard()}${!S.chat.length && !S.thinking
      ? `<p class="intro">${h(T.askIntro)}</p><div class="sugg">${T.askSugg.map((q) => `<button data-ask="${h(q)}">${h(q)}</button>`).join("")}</div>`
      : ""}`;
    const key = S.needKey
      ? `<div class="keycard"><p>${h(T.keyHelp)}</p><div class="keyrow"><button id="aiopen">${h(T.keyOpen)}</button></div></div>`
      : "";
    return `<div class="askwrap">${intro}<div class="chat">${bubbles.join("")}${key}</div>
      <div class="composer"><textarea id="q" rows="1" enterkeyhint="send" placeholder="${h(T.askPlaceholder)}"></textarea>
      <button class="send" id="send" aria-label="send" ${S.thinking ? "disabled" : ""}><svg viewBox="0 0 24 24"><path d="M12 19V5M5 12l7-7 7 7"/></svg></button></div>
      <p class="askhint">${h(T.askHint)} ${h(T.memNote)}</p></div>`;
  }
  window.askProgress = (stage) => {
    S.stage = stage;
    if (S.tab === 5) render();
  };
  async function prepare(force) {
    if (S.preparing) return;
    S.preparing = true;
    S.prepError = "";
    S.stage = "";
    render();
    try {
      const r = await call("prepare", { force: !!force }, 180000);
      S.info = r.info;
    } catch (e) {
      S.prepError = e.message;
    }
    S.preparing = false;
    S.stage = "";
    if (S.tab === 5) render();
  }
  async function ask(question) {
    const q = String(question || "").trim();
    if (!q || S.thinking) return;
    S.chat.push({ role: "user", text: q });
    S.thinking = true;
    S.needKey = false;
    render();
    const box = $("#q");
    if (box) box.value = "";
    scrollEnd();
    try {
      const r = await call("ask", { q }, 300000);
      S.chat.push({ role: "assistant", text: r.answer, by: r.by });
      if (r.info) S.info = r.info;
    } catch (e) {
      if (e.message === "NEED_KEY") {
        S.chat.pop();
        S.pendingQ = q;
        S.needKey = true;
      } else {
        S.chat.push({ role: "error", text: T.askFailed(e.message) });
      }
    }
    S.thinking = false;
    S.stage = "";
    render();
    scrollEnd();
  }
  function scrollEnd() {
    if (S.tab === 5) setTimeout(() => window.scrollTo(0, document.body.scrollHeight), 30);
  }

  // ── update sheet: shown when the Scriptable side finds a newer version on GitHub ──
  window.__showUpdate = (u) => {
    if (!u || document.getElementById("upd")) return;
    const U = T.upd;
    const lt = D.lang === "lt";
    const ov = document.createElement("div");
    ov.id = "upd";
    const cards = (u.highlights || [])
      .map((x) => {
        const title = (lt && x.lt && x.lt.title) || x.title;
        const text = (lt && x.lt && x.lt.text) || x.text || "";
        return `<div class="updi"><span class="updic">${h(x.icon || "✨")}</span><div><b>${h(title)}</b><span>${h(text)}</span></div></div>`;
      })
      .join("");
    const more = u.skipped > 1 ? U.more(u.skipped - 1) : "";
    ov.innerHTML = `<div class="updp" role="dialog" aria-label="${h(U.title)}">
      <div class="updtag">${h(U.tag(u.latest))}</div>
      <h2 class="updt">${h((lt && u.titleLt) || u.title || U.title)}</h2>
      <div class="upds">${h(U.have(u.current, more))}</div>
      <div class="updl">${cards}</div>
      <div class="updmsg" aria-live="polite"></div>
      <button class="updgo" data-act="upd-now">${h(U.now)}</button>
      <button class="updlater" data-act="upd-later">${h(U.later)}</button></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("click", (e) => {
      e.stopPropagation();
      if (e.target === ov) return updLater(); // outside = Later
      const b = e.target.closest("[data-act]");
      if (!b) return;
      if (b.dataset.act === "upd-now") updNow(b);
      else if (b.dataset.act === "upd-later") updLater();
      else if (b.dataset.act === "upd-close") ov.remove();
    });
  };
  function updLater() {
    const ov = document.getElementById("upd");
    if (!ov) return;
    ov.remove();
    call("update-later").catch(() => {});
  }
  async function updNow(btn) {
    const U = T.upd;
    const ov = document.getElementById("upd");
    const msg = ov.querySelector(".updmsg");
    const later = ov.querySelector(".updlater");
    btn.disabled = true;
    btn.textContent = U.updating;
    later.hidden = true;
    msg.textContent = "";
    try {
      const v = await call("update-now", {}, 90000);
      ov.querySelector(".updtag").textContent = U.done(v);
      msg.innerHTML = U.doneMsg;
      btn.disabled = false;
      btn.textContent = U.gotIt;
      btn.dataset.act = "upd-close";
    } catch (e) {
      msg.textContent = e.message || U.failed;
      btn.disabled = false;
      btn.textContent = U.retry;
      later.hidden = false;
    }
  }

  // ── chrome ──
  const ICONS = [
    '<path d="M3 11l9-7 9 7"/><path d="M5 10v10h14V10"/><path d="M10 20v-6h4v6"/>',
    '<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    '<path d="M5 4h11l3 3v13H5z"/><path d="M9 12l2 2 4-4"/>',
    '<path d="M4 5h16v11H8l-4 4z"/>',
    '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  ];
  function render() {
    const unread = (D.messages || []).filter((m) => m.unread && m.date >= addDays(D.today, -6)).length;
    const hwBadge = (D.homework || []).filter((i) => !i.done && i.due && i.due >= addDays(D.today, -7) && i.due <= addDays(D.today, 1)).length;
    const head = `<header class="top">
      <div class="brand"><svg class="brand-mark" viewBox="0 0 240 240" aria-hidden="true">${D.logo || ""}</svg><div class="who"><b>${h(D.child.title)}</b>${h(D.child.subtitle || "")}</div></div>
      <div class="tools">
        ${D.hasAiKey ? `<button class="icon-btn ${S.tab === 5 ? "on" : ""}" data-tab="5" aria-label="ask"><svg viewBox="0 0 24 24"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg></button>` : ""}
        <button class="icon-btn" id="refresh" aria-label="refresh"><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg></button>
        <button class="icon-btn" id="settings" aria-label="Settings"><svg viewBox="0 0 24 24"><path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/></svg></button>
      </div></header>
      <h1 class="date">${h(S.tab === 0 ? longDate(D.today) : S.tab === 5 ? T.askTitle : T.tabs[S.tab])}</h1>`;
    const banners = [];
    if (D.stale) banners.push(`<div class="banner">${h(T.stale(D.stale.at, D.stale.error))}</div>`);
    else if (D.warnings && D.warnings.length) banners.push(`<div class="banner">${h(T.partial)} ${h(D.warnings.join("; "))}</div>`);
    const screens = [screenToday, screenSchedule, screenHomework, screenMessages, screenGrades, screenAsk];
    const draft = $("#q") ? $("#q").value : "";
    const tabs = `<nav class="tabs">${T.tabs
      .map((l, i) => `<button class="${i === S.tab ? "on" : ""}" data-tab="${i}"><svg viewBox="0 0 24 24">${ICONS[i]}</svg>${h(l)}${i === 3 && unread ? `<span class="badge num">${unread}</span>` : ""}${i === 2 && hwBadge ? `<span class="badge num">${hwBadge}</span>` : ""}</button>`)
      .join("")}</nav>`;
    const t = new Date(D.at);
    const updated = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}`;
    $("#app").innerHTML = `${head}<main>${banners.join("")}${screens[S.tab]()}${S.tab === 5 ? "" : `<footer>${h(T.updated(updated))}<span class="ver">Dienynas+ v${h(D.version || "")}</span></footer>`}</main>${tabs}`;
    if ($("#q") && draft) $("#q").value = draft;
  }

  // ── message sheet ──
  async function openMessage(ref) {
    const m = (D.messages || []).find((x) => x.id === ref.id && x.typeId === ref.typeId) || {};
    const sheet = $("#sheet");
    const head = `<button class="x" data-close>${h(T.close)}</button><h3>${h(m.subject || "")}</h3><div class="meta">${h(m.from || "")}${m.fromTitle ? ", " + h(m.fromTitle) : ""}</div><div class="meta num">${h(m.date ? longDate(m.date) : "")} ${h(m.time || "")}</div>`;
    sheet.innerHTML = `${head}<div class="text" style="color:var(--muted)">${h(T.loading)}</div>`;
    document.body.classList.add("open-sheet");
    try {
      const d = await call("message", ref);
      sheet.innerHTML = `${head}<div class="text">${linkify(d.body || "")}</div>${d.files && d.files.length ? `<div class="detail"><b>${h(T.files)}</b>${fileLinks(d.files)}</div>` : ""}`;
      if (m.unread) {
        m.unread = undefined;
        render();
      }
    } catch (e) {
      sheet.innerHTML = `${head}<div class="banner">${h(T.failed(e.message))}</div>`;
    }
  }
  function linkify(text) {
    return h(text).replace(/https?:\/\/[^\s<)]+/g, (u) => `<a href="${u}" style="color:var(--blue)">${u}</a>`);
  }
  const closeSheet = () => document.body.classList.remove("open-sheet");

  // ── events ──
  document.addEventListener("click", async (e) => {
    const el = e.target.closest("button, a, .scrim, [data-toggle]");
    if (!el) return;
    if (el.classList.contains("scrim") || el.hasAttribute("data-close")) return closeSheet();
    if (el.dataset.file) {
      e.stopPropagation();
      const prev = el.textContent;
      el.textContent = T.opening;
      try {
        await call("file", JSON.parse(el.dataset.file));
      } catch (err) {
        alert(T.failed(err.message));
      }
      el.textContent = prev;
      return;
    }
    if (el.dataset.tab !== undefined) {
      S.tab = Number(el.dataset.tab);
      render();
      window.scrollTo(0, 0);
      if (S.tab === 5) {
        scrollEnd();
        if (!S.info && !S.preparing && !S.prepError) prepare(false);
      }
      return;
    }
    if (el.hasAttribute("data-scale")) return call("scale", { tab: S.tab }).catch(() => {});
    if (el.id === "memrefresh") return prepare(true);
    if (el.id === "memclear") {
      if (!S.clearArmed) {
        S.clearArmed = true;
        render();
        setTimeout(() => {
          if (S.clearArmed) {
            S.clearArmed = false;
            if (S.tab === 5) render();
          }
        }, 4000);
        return;
      }
      S.clearArmed = false;
      await call("clearchat").catch(() => {});
      S.chat = [];
      S.info = null;
      S.needKey = false;
      render();
      return prepare(false);
    }
    if (el.dataset.ask) return ask(el.dataset.ask);
    if (el.id === "send") return ask($("#q").value);
    if (el.id === "aiopen") return window.__aiOpen();
    if (el.hasAttribute("data-toggle")) return el.classList.toggle("open");
    if (el.dataset.week) {
      S.weekOffset += Number(el.dataset.week);
      S.day = null;
      return render();
    }
    if (el.dataset.day) {
      S.day = el.dataset.day;
      return render();
    }
    if (el.dataset.hw) {
      S.hwFilter = el.dataset.hw;
      return render();
    }
    if (el.dataset.msgday !== undefined) {
      S.msgDay = el.dataset.msgday && S.msgDay !== el.dataset.msgday ? el.dataset.msgday : null;
      return render();
    }
    if (el.dataset.msg) return openMessage(JSON.parse(el.dataset.msg));
    if (el.id === "refresh") {
      el.classList.add("busy");
      return call("refresh").catch(() => el.classList.remove("busy"));
    }
    if (el.id === "settings") return openSettings();
  });

  document.addEventListener("keydown", (e) => {
    if (e.target && e.target.id === "q" && e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      ask(e.target.value);
    }
  });
  document.addEventListener("input", (e) => {
    if (e.target && e.target.id === "q") {
      e.target.style.height = "44px";
      e.target.style.height = `${Math.min(130, e.target.scrollHeight + 2)}px`;
    }
  });

  render();
  if (D.update) window.__showUpdate(D.update);
  // keep the "now" card honest while the app stays open
  setInterval(() => {
    if (S.tab === 0 && !document.body.classList.contains("open-sheet")) render();
  }, 60000);
}

// ───────── Logo and launch screen (app-blueprints · launch-screen 1.0.0) ─────────
// The Dienynas+ logo: a week calendar with a teal homework day and a blue plus on the selected day.
// Same geometry as docs/logo.svg; used for the header mark and the loading and sign-in screens.
const LOGO_PARTS = '<g fill="#F6F7F9" fill-opacity="0.35"><circle cx="120" cy="130" r="7"/><circle cx="156" cy="130" r="7"/><circle cx="84" cy="162" r="7"/><circle cx="120" cy="162" r="7"/></g><path d="M76 60 H164 A24 24 0 0 1 188 84 V168 A24 24 0 0 1 164 192 H76 A24 24 0 0 1 52 168 V84 A24 24 0 0 1 76 60 Z" fill="none" stroke="#F6F7F9" stroke-width="13" stroke-linejoin="round"/><path d="M52 100 H188 M88 44 V72 M152 44 V72" fill="none" stroke="#F6F7F9" stroke-width="13" stroke-linecap="round"/><circle cx="156" cy="162" r="19" fill="#60A5FA"/><path d="M152.5 152 A3.5 3.5 0 0 1 159.5 152 V158.5 H166 A3.5 3.5 0 0 1 166 165.5 H159.5 V172 A3.5 3.5 0 0 1 152.5 172 V165.5 H146 A3.5 3.5 0 0 1 146 158.5 H152.5 Z" fill="#0E1116"/><circle cx="84" cy="130" r="7" fill="#2DD4BF"/>';
const BRAND = { name: "Dienynas", plus: "+", tag: { en: "Messages. Homework. Calm.", lt: "Žinutės. Užduotys. Ramybė." } };

// Shown once per run, on the first screen the app loads (cached diary or "Loading…").
// Later page loads wait for it to fade (afterSplash), so fresh data never cuts it short.
let splashAt = 0;
function splashHTML() {
  if (splashAt) return "";
  splashAt = Date.now();
  const tag = BRAND.tag[LANG() === "lt" ? "lt" : "en"];
  return `<div class="splash" id="splash" role="img" aria-label="${BRAND.name}${BRAND.plus}. ${tag}">
  <div class="spIcon"><svg viewBox="0 0 240 240" aria-hidden="true">
    <circle class="spFrame" cx="120" cy="130" r="3.5"></circle><circle class="spFrame" cx="156" cy="130" r="3.5"></circle><circle class="spFrame" cx="84" cy="162" r="3.5"></circle><circle class="spFrame" cx="120" cy="162" r="3.5"></circle>
    <path class="spDraw" pathLength="100" d="M76 60 H164 A24 24 0 0 1 188 84 V168 A24 24 0 0 1 164 192 H76 A24 24 0 0 1 52 168 V84 A24 24 0 0 1 76 60 Z"></path>
    <path class="spDraw" pathLength="100" d="M52 100 H188 M88 44 V72 M152 44 V72"></path>
    <circle class="spPop" cx="156" cy="162" r="19"></circle>
    <path class="spDetail" d="M152.5 152 A3.5 3.5 0 0 1 159.5 152 V158.5 H166 A3.5 3.5 0 0 1 166 165.5 H159.5 V172 A3.5 3.5 0 0 1 152.5 172 V165.5 H146 A3.5 3.5 0 0 1 146 158.5 H152.5 Z"></path>
    <circle class="spSweep" cx="84" cy="130" r="3.5"></circle>
  </svg></div>
  <div class="spWord">${BRAND.name}<span>${BRAND.plus}</span></div>
  <div class="spTag">${tag}</div>
</div>`;
}
async function afterSplash() {
  const left = splashAt + 2900 - Date.now();
  if (left > 0) await new Promise((resolve) => Timer.schedule(left, false, resolve));
}
// The launch screen's script: first in the page script, self-contained ES5 (no backticks, no ${).
const SPLASH_JS = '(function () {' +
  '  var sp = document.getElementById("splash");' +
  '  if (!sp) return;' +
  '  function gone() { sp.classList.add("gone"); sp.setAttribute("aria-hidden", "true"); }' +
  '  sp.addEventListener("click", gone);' +   // tap to skip
  '  setTimeout(gone, 2900);' +               // out of the page once the CSS fade is done
  '})();';

// What the start-up placeholder and its notes say (recipe · safe-startup), in the app's language.
const BOOT_TEXT = () => (LANG() === "lt"
  ? { loading: "Įkeliamas dienynas…", still: "Vis dar įkeliama…", failed: "Dienynas+ nepavyko atidaryti",
      again: "Uždarykite Dienynas+ ir atidarykite iš naujo. Jei tai kartojasi, dar kartą paleiskite diegimo skriptą.",
      missing: "Kai kurių nustatymų ar duomenų nepavyko nuskaityti. Kol iš naujo neatidarysite Dienynas+, jie nebus perrašyti.",
      repaired: "Kai kurių jūsų duomenų nepavyko nuskaityti, todėl Dienynas+ pasiliko jų kopiją ir pradėjo juos iš naujo." }
  : { loading: "Loading your diary…", still: "Still loading…", failed: "Dienynas+ couldn't open",
      again: "Close Dienynas+ and open it again. If it keeps happening, run the installer once more.",
      missing: "Some of your settings or data couldn't be read. Nothing will be saved over them until you reopen Dienynas+.",
      repaired: "Some of your data couldn't be read, so Dienynas+ kept a copy and started it fresh." });

// The page shell. It never contains the diary: the page goes on screen first, shows "Loading your diary…",
// receives the chat in pieces (window.__parts), then window.__boot(state) starts it (recipe · safe-startup).
// It may read settings (look, language), which are loaded before every branch.
function buildHTML() {
  const look = lookState(), B = BOOT_TEXT();
  return `<!doctype html><html data-theme="${look.shown}" data-font="${look.font}" style="--ts:${look.textSize}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<style>${CSS}</style>${NO_ZOOM}</head><body class="d-${look.density}">
${splashHTML()}<div id="app"><div class="booting" role="status"><span class="busy-dot"></span>${B.loading}</div></div><div class="scrim"></div><div class="sheet" id="sheet"></div>
<script>${SPLASH_JS}
// The page goes on screen first; Scriptable hands over the data once it has read it.
window.__parts = [];
window.__bootNote = function (title, detail) {
  var b = document.querySelector(".booting"); if (!b) return;
  b.className = "booting note";
  b.innerHTML = "<b></b><span></span>" + (detail ? "<pre></pre>" : "");
  b.querySelector("b").textContent = title;
  b.querySelector("span").textContent = ${safeJSON(B.again)};
  if (detail) b.querySelector("pre").textContent = detail;
};
setTimeout(function () { if (!window.__booted) window.__bootNote(${safeJSON(B.still)}); }, 25000);
document.addEventListener("visibilitychange", function () {   // coming back into view: redraw
  if (document.visibilityState !== "visible") return;
  var d = document.documentElement; d.style.transform = "translateZ(0)"; void d.offsetHeight; d.style.transform = "";
});
window.__boot = function (st) {
  if (window.__booted) return;
  window.__booted = true;
  if (!st) return;   // Dienynas+: no diary saved yet; the placeholder stays until TAMO answers and the page is built again
  if (!st.chat || !st.chat.length) st.chat = [].concat.apply([], window.__parts);
  window.__parts = [];
  window.DATA = st;
  requestAnimationFrame(function () {   // make WebKit draw again once the data is in (helps if the window came up blank)
    var d = document.documentElement; d.style.transform = "translateZ(0)"; void d.offsetHeight;
    requestAnimationFrame(function () { d.style.transform = ""; });
  });
  (${pageMain.toString()})();
};</script>
</body></html>`;
}

function messageHTML(title, message, buttons = []) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><style>${CSS}
  .center{min-height:80vh;display:flex;flex-direction:column;justify-content:center;padding:24px}
  .btn{display:block;margin-top:12px;padding:13px;border-radius:14px;background:var(--ink);color:var(--card);font-weight:700;text-align:center;width:100%}
  .btn.alt{background:var(--chip);color:var(--ink)}</style>${NO_ZOOM}</head><body style="padding-bottom:0">
  ${splashHTML()}<script>${SPLASH_JS}</script>
  <div class="center"><svg class="idleMark" viewBox="0 0 240 240" role="img" aria-label="Dienynas+ logo">${LOGO_PARTS}</svg><h1 class="date" style="margin:0 0 8px">${esc(title)}</h1><p class="sub" style="margin:0 0 18px">${esc(message)}</p>
  ${buttons.map((b, i) => `<button class="btn ${i ? "alt" : ""}" onclick="location.href='tamo://${b.action}?id=0&p=%7B%7D'">${esc(b.label)}</button>`).join("")}</div></body></html>`;
}

// ─────────────── AI configuration ───────────────
// Follows github.com/gadominas/app-blueprints · blueprints/ai-configuration.md (reference: BlogPulse.js).
// Every AI request goes through aiCall. Keys live in the iOS Keychain only; the page sees them masked.

// AI providers. Keychain names are unique per app; models are defaults until the user picks one.
const AI = {
  anthropic: { key: "DIENYNASPLUS_ANTHROPIC_KEY", model: "claude-haiku-5-5" },
  openai:    { key: "DIENYNASPLUS_OPENAI_KEY",    model: "gpt-5.4-mini" },
};
const PROVIDERS = { anthropic: "Claude", openai: "OpenAI" };

// AI settings and token usage live in their own small JSON files on this iPhone (never the keys).
const aiFm = FileManager.local();
const aiPath = name => aiFm.joinPath(aiFm.documentsDirectory(), "dienynas-plus-" + name + ".json");
function aiLoad(name, fallback) {
  try { const p = aiPath(name); if (aiFm.fileExists(p)) return JSON.parse(aiFm.readString(p)); }
  catch (e) { console.log("AI: couldn't read " + name + ": " + e); }
  return fallback;
}
function aiWrite(name, data) {
  if (name === "usage" && !dataLoaded) return;   // usage is read in loadData(): never save over a file that wasn't read
  try { aiFm.writeString(aiPath(name), JSON.stringify(data)); } catch (e) { console.log("AI: couldn't save " + name + ": " + e); }
}
const aiSettings = Object.assign({
  aiProvider: "anthropic",   // the provider marked "In use"
  ai: true,                  // background AI jobs on/off ("What AI does")
  // model:  { anthropic: "…", openai: "…" }   set when the user picks a model
  // models: { anthropic: { at, list: [{ id, name }] }, openai: … }   cached model lists
}, aiLoad("ai-settings", {}));
const saveAiSettings = () => aiWrite("ai-settings", aiSettings);

const keyFor   = p => Keychain.contains(AI[p].key) ? Keychain.get(AI[p].key) : null;
const aiKey    = () => keyFor(aiSettings.aiProvider);   // the key of the provider in use
const modelFor = p => (aiSettings.model && aiSettings.model[p]) || AI[p].model;
const maskKey  = k => k ? (k.length > 14 ? k.slice(0, 7) + "…" + k.slice(-4) : "…" + k.slice(-4)) : null;

// Run once at start: move a key an earlier version stored elsewhere, then use whichever provider has a key.
function aiMigrate(oldKeyNames, oldModel) {
  for (const old of oldKeyNames || []) {
    if (!Keychain.contains(old)) continue;
    if (!Keychain.contains(AI.openai.key)) Keychain.set(AI.openai.key, Keychain.get(old));
    Keychain.remove(old);
    if (!keyFor("anthropic")) aiSettings.aiProvider = "openai";   // use the key that now exists
  }
  if (oldModel && !(aiSettings.model && aiSettings.model.openai)) aiSettings.model = Object.assign({}, aiSettings.model, { openai: oldModel });
  if (!PROVIDERS[aiSettings.aiProvider]) aiSettings.aiProvider = "anthropic";
  if (!aiKey()) { const other = Object.keys(PROVIDERS).find(p => keyFor(p)); if (other) aiSettings.aiProvider = other; }
  saveAiSettings();
}

async function askKey(p) {
  const cur = keyFor(p);
  const al = new Alert();
  al.title = `${PROVIDERS[p]} API key`;
  al.message = cur ? `The saved key ends in …${cur.slice(-4)}. Paste a new key to replace it.`
                   : "Paste your API key. It's stored in the iOS Keychain on this device only.";
  al.addSecureTextField(p === "openai" ? "sk-…" : "sk-ant-…", "");
  al.addAction("Save key");
  al.addCancelAction("Cancel");
  if (await al.present() !== 0) return false;
  const v = al.textFieldValue(0).trim();
  if (!v) return false;
  Keychain.set(AI[p].key, v);
  if (!aiKey()) aiSettings.aiProvider = p;   // first key saved: use that provider
  return true;
}

function removeKey(p) {
  if (Keychain.contains(AI[p].key)) Keychain.remove(AI[p].key);
}

// The only way the app calls AI. feature: a short tag for the usage table.
// provider: defaults to the one in use; "Test connection" passes the card's provider.
// user: one message, or a whole conversation as [{ role: "user" | "assistant", content }] (Tamo+ Ask keeps the chat).
async function aiCall(system, user, maxTokens = 2500, feature = "other", provider = aiSettings.aiProvider) {
  const key = keyFor(provider);
  if (!key) throw new Error(`No ${PROVIDERS[provider]} key saved`);
  const openai = provider === "openai", model = modelFor(provider);
  const r = new Request(openai ? "https://api.openai.com/v1/chat/completions" : "https://api.anthropic.com/v1/messages");
  r.method = "POST";
  r.timeoutInterval = 90;
  const convo = Array.isArray(user) ? user : [{ role: "user", content: user }];
  if (openai) {
    r.headers = { "Authorization": "Bearer " + key, "Content-Type": "application/json" };
    r.body = JSON.stringify({ model, messages: [{ role: "system", content: system }].concat(convo) });
  } else {
    r.headers = { "x-api-key": key, "anthropic-version": "2023-06-01", "content-type": "application/json" };
    r.body = JSON.stringify({ model, max_tokens: maxTokens, system, messages: convo });
  }
  const j = await r.loadJSON();
  if (j.error) throw new Error(j.error.message || "AI request failed");
  const u = j.usage || {};
  recordUsage(provider, model, feature,
    openai ? (u.prompt_tokens || 0) : (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0),
    openai ? (u.completion_tokens || 0) : (u.output_tokens || 0));
  return openai ? ((j.choices && j.choices[0] && j.choices[0].message.content) || "")
                : (j.content || []).map(c => c.text || "").join("");
}

// For prompts that ask for JSON: tolerate code fences and stray text around it.
function parseJSON(txt) {
  const s = String(txt).replace(/```json|```/g, "").trim();
  const a = s.search(/[\[{]/), b = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  return JSON.parse(s.slice(a, b + 1));
}

// Token usage, counted from what the provider reports, per provider, model, feature and local day.
let usage = { since: Date.now(), p: {} };   // read in loadData()
const aiDayKey = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

function recordUsage(provider, model, feature, tin, tout) {
  const P = usage.p[provider] = usage.p[provider] || { calls: 0, in: 0, out: 0, models: {}, features: {}, days: {} };
  const b = (o, k) => o[k] = o[k] || { calls: 0, in: 0, out: 0 };
  for (const x of [P, b(P.models, model), b(P.features, feature), b(P.days, aiDayKey())]) {
    x.calls++; x.in += tin; x.out += tout;
  }
  const days = Object.keys(P.days).sort();
  while (days.length > 400) delete P.days[days.shift()];   // keep about 13 months of days
  aiWrite("usage", usage);   // save after every call: the app can be closed at any moment
}

function resetUsage() { usage = { since: Date.now(), p: {} }; aiWrite("usage", usage); }

// The models the user's own key can call, newest first; cached so the menu works offline.
async function fetchModels(p) {
  const key = keyFor(p);
  if (!key) throw new Error(`Add a ${PROVIDERS[p]} key first`);
  const r = new Request(p === "openai" ? "https://api.openai.com/v1/models" : "https://api.anthropic.com/v1/models?limit=100");
  r.headers = p === "openai" ? { "Authorization": "Bearer " + key } : { "x-api-key": key, "anthropic-version": "2023-06-01" };
  r.timeoutInterval = 20;
  const j = await r.loadJSON();
  if (j.error) throw new Error(j.error.message || "Couldn't load models");
  let list = (j.data || []).map(m => ({
    id: m.id, name: m.display_name || m.id,
    t: m.created_at ? Date.parse(m.created_at) : (m.created || 0) * 1000,
  }));
  // OpenAI lists every model the key can reach; keep only the ones that write text.
  if (p === "openai") list = list.filter(m => /^(gpt-|o\d|chatgpt-)/.test(m.id)
    && !/(audio|realtime|tts|transcribe|image|search|embedding|instruct|moderation)/.test(m.id));
  list.sort((a, b) => b.t - a.t);
  aiSettings.models = aiSettings.models || {};
  aiSettings.models[p] = { at: Date.now(), list: list.map(m => ({ id: m.id, name: m.name })) };
  saveAiSettings();
  return list.length;
}

// Bridge actions from the AI settings sheet. Returns the toast to show ("" for none).
const AI_ACTIONS = ["aistate", "aikey", "airm", "aiprov", "aimodels", "aimodel", "aitest", "usagereset", "aitoggle"];
async function aiAction(head, m) {
  const P = PROVIDERS[m.v] ? m.v : aiSettings.aiProvider;
  let msg = "";
  switch (head) {
    case "aikey":
      if (await askKey(P)) {
        aiSettings.ai = true; saveAiSettings();
        try { const n = await fetchModels(P); msg = `${PROVIDERS[P]} key saved — ${n} models available`; }
        catch (e) { msg = `Key saved, but checking it failed: ${String(e.message || e).slice(0, 70)}`; }
      }
      break;
    case "airm": removeKey(P); msg = `${PROVIDERS[P]} key removed`;
      if (!aiKey()) { const other = Object.keys(PROVIDERS).find(p => keyFor(p)); if (other) aiSettings.aiProvider = other; }
      aiInviteKeyRemoved();   // the last key gone: invite again from the next launch (after the switch, so another key still counts)
      break;
    case "aiprov": if (PROVIDERS[m.v] && keyFor(m.v)) aiSettings.aiProvider = m.v; break;
    case "aimodels":
      try { const n = await fetchModels(P); msg = `${n} ${PROVIDERS[P]} models found`; }
      catch (e) { msg = String(e.message || e).slice(0, 90); }
      break;
    case "aimodel":
      if (PROVIDERS[m.p] && m.v) { aiSettings.model = aiSettings.model || {}; aiSettings.model[m.p] = m.v; msg = `${PROVIDERS[m.p]} now uses ${m.v}`; }
      break;
    case "aitest": {
      const t0 = Date.now();
      try {
        await aiCall("Reply with the single word OK.", "Connection test.", 10, "test", P);
        msg = `${PROVIDERS[P]} works — ${modelFor(P)} answered in ${((Date.now() - t0) / 1000).toFixed(1)} s`;
      } catch (e) { msg = `${PROVIDERS[P]} test failed: ${String(e.message || e).slice(0, 80)}`; }
      break;
    }
    case "usagereset": resetUsage(); msg = "Usage counters reset"; break;
    case "aitoggle": aiSettings.ai = !aiSettings.ai; break;
  }
  saveAiSettings();
  return msg;
}

// What the page gets. Keys appear only masked.
function aiClientState() {
  return {
    provider: aiSettings.aiProvider,
    keys:  Object.fromEntries(Object.keys(PROVIDERS).map(p => [p, maskKey(keyFor(p))])),
    model: Object.fromEntries(Object.keys(PROVIDERS).map(p => [p, modelFor(p)])),
    models: aiSettings.models || {}, usage, today: aiDayKey(),
    ai: aiSettings.ai, hasKey: !!aiKey(),
  };
}
// One-line status for the app's Settings row: "Claude — claude-haiku-5-5 — 12.4k tokens used".
function aiStatusLine() {
  if (!aiKey()) return "";
  const P = usage.p[aiSettings.aiProvider];
  return `${PROVIDERS[aiSettings.aiProvider]} — ${modelFor(aiSettings.aiProvider)}` +
    (P && P.calls ? ` — ${aiFmtN(P.in + P.out)} tokens used` : "");
}
const aiFmtN = n => n >= 1e6 ? (n / 1e6).toFixed(2) + "M" : n >= 1e4 ? Math.round(n / 1e3) + "k" : n >= 1e3 ? (n / 1e3).toFixed(1) + "k" : String(n);
// ─────────────── end of AI configuration ───────────────

// ── AI invitation (app-blueprints · ai-invitation): when it may appear ──
// Its state lives in settings.json as settings.aiInvite (no UI of its own). saveSettings() is this app's saveAll().
const INVITE_DAY = 864e5;
const INVITE_GAP = 3;          // days between invitations (about twice a week)
const INVITE_GAP_SLOW = 7;     // days between invitations after the 4th "Later"
function aiInviteDue(now = Date.now()) {
  const s = settings.aiInvite || (settings.aiInvite = {});
  if (aiKey()) return false;   // a key means AI is on: nothing to invite to
  if (s.off) return false;     // "Don't remind me again"
  return now >= (s.next || 0); // from the very first launch (right after install), then at most every 3 days
}
// Removing the last key turns AI off: invite again from the next launch (called in the "airm" action).
function aiInviteKeyRemoved() {
  if (aiKey()) return;
  const s = settings.aiInvite || (settings.aiInvite = {});
  s.next = 0; saveSettings();
}
// The page reports what happened: "shown", "open", "later" or "never".
function aiInviteNote(what, now = Date.now()) {
  const s = settings.aiInvite || (settings.aiInvite = {});
  if (what === "shown") { s.shown = (s.shown || 0) + 1; s.next = now + INVITE_GAP * INVITE_DAY; }
  else if (what === "later") { s.later = (s.later || 0) + 1; s.next = now + (s.later >= 4 ? INVITE_GAP_SLOW : INVITE_GAP) * INVITE_DAY; }
  else if (what === "never") s.off = true;
  else return;   // "open": the AI sheet takes over; "shown" already set the next date
  saveSettings();
}
// One offer per launch, and an update wins: called once the update check (and TAMO's first answer) has settled.
// ev() is this app's js(); the card's words follow the app language.
function inviteIfDue() {
  if (!app || app.pendingUpdate || app.updateOffered || !aiInviteDue()) return;
  ev(`window.__aiInvite && window.__aiInvite(${safeJSON(LANG() === "lt" ? AI_INVITE.lt : AI_INVITE)})`).catch(() => {});
}

// ───────────────────────────── ✨ Ask: chat over everything TAMO has (through aiCall) ─────────────────────────────


const WEEKDAYS_EN = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const weekdayOf = (d) => WEEKDAYS_EN[(new Date(`${d}T00:00:00Z`).getUTCDay() + 6) % 7];
const clip = (s, n) => (s && s.length > n ? `${s.slice(0, n)}…` : s);
const schoolYearStart = (d) => (Number(d.slice(5, 7)) >= 9 ? `${d.slice(0, 4)}-09-01` : `${Number(d.slice(0, 4)) - 1}-09-01`);
function chunkRange(from, to, maxDays = 60) {
  const out = [];
  for (let s = from; s <= to; s = addDays(s, maxDays + 1)) {
    const e = addDays(s, maxDays);
    out.push([s, e < to ? e : to]);
  }
  return out;
}
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}
function dedupe(items, keyOf) {
  const seen = new Set();
  return items.filter((x) => {
    const k = keyOf(x);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

// ── grade scale, chosen per child (most schools grade 1–10, some 1–7) ──
function gradeScales() {
  return settings.gradeScales || {};
}
const gradeMaxFor = (roleKey) => Number(gradeScales()[roleKey]) || 10;
function setGradeMax(roleKey, max) {
  const all = gradeScales();
  all[roleKey] = max;
  settings.gradeScales = all;
  saveSettings();
}
async function pickGradeScale(roleKey, childName) {
  const cur = gradeMaxFor(roleKey);
  const a = new Alert();
  a.title = t("scaleTitle");
  a.message = `${childName ? `${childName}. ` : ""}${t("scaleNow")} 1–${cur}`;
  const opts = [10, 7, 5];
  opts.forEach((n) => a.addAction(`1–${n}${n === cur ? "  ✓" : ""}`));
  a.addAction(t("scaleOther"));
  a.addCancelAction(t("cancel"));
  const i = await a.presentSheet();
  if (i < 0) return false;
  let max = opts[i];
  if (i === opts.length) {
    const o = new Alert();
    o.title = t("scaleOtherTitle");
    o.addTextField("10", String(cur));
    o.addAction("OK");
    o.addCancelAction(t("cancel"));
    if ((await o.presentAlert()) === -1) return false;
    max = parseInt(o.textFieldValue(0), 10);
    if (!(max >= 2 && max <= 100)) return false;
  }
  setGradeMax(roleKey, max);
  return true;
}

// ── chat memory: one conversation per child, kept on this phone ──
function hashKey(s) {
  let x = 5381;
  for (const c of String(s)) x = ((x * 33) ^ c.codePointAt(0)) >>> 0;
  return x.toString(36);
}
const chatPath = (roleKey) => fm.joinPath(fm.documentsDirectory(), `dienynas-plus-chat-${hashKey(roleKey)}.json`);
function loadChat(roleKey) {
  try {
    const p = chatPath(roleKey);
    if (fm.fileExists(p)) {
      const c = JSON.parse(fm.readString(p));
      if (c && c.v === 1 && c.roleKey === roleKey && Array.isArray(c.history)) return c;
    }
  } catch (_) {}
  return { v: 1, roleKey, history: [], pack: null };
}
function saveChat(chat) {
  try {
    fm.writeString(chatPath(chat.roleKey), JSON.stringify(chat));
  } catch (_) {}
}
function deleteChat(roleKey) {
  try {
    const p = chatPath(roleKey);
    if (fm.fileExists(p)) fm.remove(p);
  } catch (_) {}
}
function deleteAllChats() {
  try {
    fm.listContents(fm.documentsDirectory())
      .filter((n) => /^dienynas-plus-chat-.*\.json$/.test(n))
      .forEach((n) => fm.remove(fm.joinPath(fm.documentsDirectory(), n)));
  } catch (_) {}
}

// ── pull everything TAMO offers for this child: the chat's knowledge pack ──
async function gatherAll(api, base, progress = () => {}) {
  const session = await api.ensure();
  const today = todayV();
  const from = schoolYearStart(today);
  const monday = mondayOf(today);
  const warnings = [];
  const safe = (label, p) =>
    p.catch((e) => {
      if (e && e.badLogin) throw e;
      warnings.push(`${label}: ${e.message || e}`);
      return null;
    });

  progress("schedule");
  const mondays = [];
  for (let i = -cfg("weeksBack"); i <= cfg("weeksAhead"); i++) mondays.push(addDays(monday, i * 7));
  const weekList = await mapLimit(mondays, 3, (m) => safe(`schedule ${m}`, fetchWeek(api, m)));
  const weeks = Object.fromEntries(mondays.map((m, i) => [m, weekList[i]]).filter(([, d]) => d));

  progress("homework");
  const hwChunks = await mapLimit(chunkRange(from, addDays(today, 35)), 3, ([a, b]) =>
    safe("homework", api.modern("core/app/darbai", { dateFrom: a, dateTo: b, workType: "home" }).then(mapHomework))
  );
  const homework = dedupe(hwChunks.filter(Boolean).flat(), (i) => `${i.lessonId}|${i.due}|${i.subject}|${(i.text || "").slice(0, 40)}`).sort((a, b) =>
    (a.due || "").localeCompare(b.due || "")
  );
  const classwork = (await safe("classwork", api.modern("core/app/darbai", { dateFrom: addDays(today, -35), dateTo: today, workType: "class" }).then(mapHomework))) || [];

  progress("grades");
  const diaryChunks = await mapLimit(chunkRange(from, today), 3, ([a, b]) => safe("grades", api.modern("core/app/dienynas", { dateFrom: a, dateTo: b }).then(mapDiary)));
  const diary = { grades: [], attendance: [], formatives: [] };
  diaryChunks.filter(Boolean).forEach((d) => {
    diary.grades.push(...d.grades);
    diary.attendance.push(...d.attendance);
    diary.formatives.push(...d.formatives);
  });

  progress("calendar");
  const evChunks = await mapLimit(chunkRange(from, addDays(today, 120)), 3, ([a, b]) =>
    safe("calendar", api.modern("core/app/calendar/events/allDay", { dateFrom: a, dateTo: b }).then(mapAllDay))
  );
  const events = dedupe(evChunks.filter(Boolean).flat(), (e) => `${e.title}|${e.from}|${e.to}`);
  const feed = (await safe("notifications", api.modern("core/app/feeds").then((r) => mapFeed(requiredList(r, "result"))))) || (base && base.feed) || [];

  progress("messages");
  const messages = (await safe("messages", fetchMessages(api, addDays(today, -cfg("messageDays")), 12))) || (base && base.messages) || [];
  const readable = messages.filter((m) => !m.unread && m.date >= addDays(today, -cfg("bodyDays"))).slice(0, cfg("maxBodies"));
  const bodies = {};
  await mapLimit(readable, 4, async (m) => {
    try {
      const d = mapMessageDetail(await api.modern(`messaging/messages/received/${encodeURIComponent(m.typeId)}/${encodeURIComponent(m.id)}`, {}, false));
      if (d.body) bodies[`${m.typeId}/${m.id}`] = d.body;
    } catch (_) {}
  });

  return { builtAt: Date.now(), today, from, roleKey: session.roleKey, class: session.roleSubtitle, weeks, homework, classwork, diary, events, feed, messages, bodies, warnings };
}

function packInfo(pack) {
  if (!pack) return null;
  const days = Object.values(pack.weeks || {}).flat();
  const mondays = Object.keys(pack.weeks || {}).sort();
  return {
    builtAt: pack.builtAt,
    from: pack.from,
    weekFrom: mondays[0],
    weekTo: mondays.length ? addDays(mondays[mondays.length - 1], 4) : "",
    lessons: days.reduce((n, d) => n + ((d && d.lessons) || []).length, 0),
    homework: (pack.homework || []).length,
    grades: ((pack.diary && pack.diary.grades) || []).length + ((pack.diary && pack.diary.formatives) || []).length,
    absences: ((pack.diary && pack.diary.attendance) || []).length,
    messages: (pack.messages || []).length,
    bodies: Object.keys(pack.bodies || {}).length,
    events: (pack.events || []).length,
    warnings: pack.warnings || [],
  };
}

// The knowledge pack reshaped into compact JSON. The child's name is left out.
function aiContext(pack, opened = {}, gradeMax = 10) {
  const byDate = new Map();
  Object.values(pack.weeks || {})
    .filter(Array.isArray)
    .flat()
    .forEach((d) => d && d.date && byDate.set(d.date, d));
  const bodies = { ...(pack.bodies || {}), ...opened };
  const work = (h) => compact({ subject: h.subject, task: clip(h.text, 600), set_on: h.assigned, due: h.due, done: h.done, files: (h.files || []).map((f) => f.name) });
  return {
    data_pulled_on: pack.today,
    class: pack.class,
    grade_scale: `1–${gradeMax}`,
    schedule: [...byDate.values()]
      .sort((a, b) => a.date.localeCompare(b.date))
      .map((d) => ({
        date: d.date,
        weekday: weekdayOf(d.date),
        lessons: d.lessons.map((l) =>
          compact({
            nr: l.number,
            time: l.start ? `${l.start}-${l.end || ""}` : "",
            subject: l.subject,
            teacher: l.teacher,
            topic: clip(l.topic, 300),
            label: l.label,
            marks_given: l.marks,
            formatives: (l.formatives || []).map((f) => [f.value, f.type].filter(Boolean).join(" ")),
            notes: (l.details || []).map((x) => compact({ title: x.title, text: clip(x.text, 400), files: (x.files || []).map((f) => f.name) })),
            subject_average: l.average,
          })
        ),
      })),
    homework_since_school_year_start: (pack.homework || []).map(work),
    classwork_last_5_weeks: (pack.classwork || []).map((h) => compact({ date: h.assigned, subject: h.subject, done_in_class: clip(h.text, 400) })),
    recent_notifications: pack.feed || [],
    grades_since_school_year_start: (pack.diary && pack.diary.grades) || [],
    formative_assessments: (pack.diary && pack.diary.formatives) || [],
    attendance_marks: (pack.diary && pack.diary.attendance) || [],
    school_calendar: pack.events || [],
    messages: (pack.messages || []).map((m) =>
      compact({
        date: m.date,
        time: m.time,
        from: m.from,
        from_role: m.fromTitle,
        subject: m.subject,
        unread: m.unread,
        important: m.important,
        has_attachments: m.files,
        class_group: m.group,
        body: clip(bodies[`${m.typeId}/${m.id}`], 1500),
      })
    ),
  };
}

// The rules and the data come first and stay identical between questions, so OpenAI can cache them.
function aiInstructions(ctx, gradeMax) {
  const p = vilniusParts(new Date(), { hour: "2-digit", minute: "2-digit" });
  const today = todayV();
  return [
    "You are the assistant inside Tamo+, an iPhone app a parent uses to follow their child's Lithuanian school e-diary (TAMO dienynas).",
    "Answer ONLY from the TAMO data below and from this conversation. If the answer isn't there, say so plainly and, if useful, say where in TAMO to look. Never invent lessons, grades, homework, dates, teachers or messages.",
    "Reply in the language of the user's latest question (Lithuanian or English). School content is in Lithuanian: quote subjects and tasks as written, and add a short translation when replying in English.",
    "Be brief and practical for a phone screen: lead with the answer, then short '- ' bullets with dates and subjects. You may use **bold**. No tables, no headings.",
    `This school grades on a 1–${gradeMax} scale: ${gradeMax} is the best grade. Judge and compare grades and averages on that scale. Attendance 'n' means absent, 'p' means late. Formative assessments can be percentages, +/- or words.`,
    "A message 'body' is included for messages that were already read; unread messages show only date, sender and subject.",
    "Weekends and dates in school_calendar have no lessons.",
    "",
    "TAMO data (JSON):",
    JSON.stringify(ctx),
    "",
    `Now: ${weekdayOf(today)} ${today}, ${p.hour}:${p.minute} (Europe/Vilnius). Resolve "today", "tomorrow", "this week" and "next school day" against this.`,
  ].join("\n");
}

async function aiAsk(pack, opened, history, question, gradeMax) {
  if (!aiKey()) return { needKey: true };
  const provider = aiSettings.aiProvider;
  // the whole conversation, every time, so nothing said earlier is forgotten
  const convo = [...history.filter((m) => m.role === "user" || m.role === "assistant").map((m) => ({ role: m.role, content: m.text })), { role: "user", content: question }];
  let text = "";
  try {
    // Chat Completions doesn't store requests by default, so the child's school data isn't kept on OpenAI's side.
    text = await aiCall(aiInstructions(aiContext(pack, opened, gradeMax), gradeMax), convo, 2500, "ask");
  } catch (e) {
    const m = String((e && e.message) || e);
    if (/context|too long|maximum.*tokens/i.test(m)) throw new Error(t("aiTooLong"));
    if (/rate.?limit|quota|overloaded|credit balance/i.test(m)) throw new Error(t("aiQuota"));
    if (/offline|internet|network|could not connect|timed out/i.test(m)) throw new Error(t("aiOffline"));
    throw e;
  }
  text = String(text).trim();
  if (!text) throw new Error(t("aiEmpty"));
  return { answer: text, by: PROVIDERS[provider] };
}

// ───────────────────────────── 🔔 what's new since the last run ─────────────────────────────
//
// Run with the parameter "check" (Shortcuts: Run Script → Parameter: check, or scriptable:///run/Dienynas?check=1)
// to look for new homework, grades, messages and teacher notes. Inside the Scriptable app the news appears as an
// alert; when Shortcuts runs the script in the background, iOS doesn't allow alerts, so it arrives as a notification.
// The same text is also returned as the Shortcut output.

const NEWS_MAX_KEYS = 1500; // remembered items per kind
const MONTHS_SHORT = {
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  lt: ["sau.", "vas.", "kov.", "bal.", "geg.", "birž.", "liep.", "rugp.", "rugs.", "spal.", "lapkr.", "gruod."],
};
const NEWS_TEXT = {
  en: {
    title: (n) => `${n} new in TAMO`,
    hw: "📝 Homework",
    grades: "⭐ Grades",
    msgs: "✉️ Messages",
    notes: "🗒 Teacher notes",
    due: (d) => `due ${d}`,
    more: (n) => `+${n} more`,
    nothing: "Nothing new since the last check.",
    started: "Checking is set up. From now on you'll see anything new here.",
    open: "Open",
    ok: "OK",
    signIn: "Open the script in Scriptable once to sign in.",
    failed: (e) => `Couldn't check TAMO: ${e}`,
    note: { praise: "Praise", remark: "Remark", comment: "Comment", absent: "Absent", late: "Late" },
  },
  lt: {
    title: (n) => `TAMO naujienos: ${n}`,
    hw: "📝 Namų darbai",
    grades: "⭐ Pažymiai",
    msgs: "✉️ Žinutės",
    notes: "🗒 Mokytojų įrašai",
    due: (d) => `iki ${d}`,
    more: (n) => `ir dar ${n}`,
    nothing: "Nuo paskutinio patikrinimo naujienų nėra.",
    started: "Tikrinimas nustatytas. Nuo šiol čia matysite visas naujienas.",
    open: "Atidaryti",
    ok: "Gerai",
    signIn: "Vieną kartą atidarykite skriptą Scriptable programoje ir prisijunkite.",
    failed: (e) => `Nepavyko patikrinti TAMO: ${e}`,
    note: { praise: "Pagyrimas", remark: "Pastaba", comment: "Komentaras", absent: "Praleido", late: "Pavėlavo" },
  },
};
const NT = () => NEWS_TEXT[LANG()] || NEWS_TEXT.en;
const shortDay = (d) => (d ? `${(MONTHS_SHORT[LANG()] || MONTHS_SHORT.en)[Number(d.slice(5, 7)) - 1]} ${Number(d.slice(8, 10))}` : "");

function isCheckRun() {
  const a = typeof args === "undefined" ? {} : args || {};
  const qp = a.queryParameters || {};
  const sp = a.shortcutParameter;
  const plain = Array.isArray(a.plainTexts) ? a.plainTexts : [];
  return "check" in qp || sp === "check" || (sp && typeof sp === "object" && "check" in sp) || plain.includes("check");
}

const seenPath = (roleKey) => fm.joinPath(fm.documentsDirectory(), `dienynas-plus-seen-${hashKey(roleKey)}.json`);
function newsItems(data) {
  const hw = (data.homework || []).map((i) => ({
    key: i.lessonId ? `${i.lessonId}|${i.subject}|${i.due}` : `${i.subject}|${i.due}|${(i.text || "").slice(0, 40)}`,
    line: `${i.subject}: ${clip(i.text || (i.files || []).map((f) => f.name).join(", "), 70)}${i.due ? ` (${NT().due(shortDay(i.due))})` : ""}`,
  }));
  const diary = data.diary || {};
  const grades = [
    ...(diary.grades || []).map((g) => ({ key: `g|${g.date}|${g.subject}|${g.value}|${g.type || ""}`, line: `${g.subject}: ${g.value}${g.type ? ` (${g.type})` : ""}, ${shortDay(g.date)}` })),
    ...(diary.formatives || []).map((g) => ({ key: `f|${g.date}|${g.subject}|${g.value}|${g.type || ""}`, line: `${g.subject}: ${g.value}${g.type ? ` (${g.type})` : ""}, ${shortDay(g.date)}` })),
  ];
  const msgs = (data.messages || []).map((m) => ({ key: m.sid || `${m.typeId}/${m.id}`, line: `${m.subject || "—"}${m.from ? ` — ${m.from}` : ""}` }));
  const notes = (data.feed || [])
    .filter((f) => ["praise", "remark", "comment", "absent", "late"].includes(f.kind))
    .map((f) => ({
      key: `${f.kind}|${f.id}|${f.date}|${f.subject}`,
      line: `${NT().note[f.kind]}: ${f.subject || ""}${f.text ? ` — ${clip(f.text, 60)}` : ""}${f.lessonDate || f.date ? `, ${shortDay(f.lessonDate || f.date)}` : ""}`,
    }));
  return { hw, grades, msgs, notes };
}

// Compares with what was seen last time and remembers the new state. First run only records a baseline.
function findNews(data) {
  const key = data.child && data.child.key;
  if (!key) return { total: 0, first: false, kinds: {} };
  const items = newsItems(data);
  let seen = null;
  try {
    if (fm.fileExists(seenPath(key))) seen = JSON.parse(fm.readString(seenPath(key)));
  } catch (_) {}
  const kinds = {};
  let total = 0;
  for (const k of Object.keys(items)) {
    const before = new Set((seen && seen[k]) || []);
    kinds[k] = seen ? items[k].filter((i) => !before.has(i.key)) : [];
    total += kinds[k].length;
  }
  const next = { at: Date.now() };
  for (const k of Object.keys(items)) {
    next[k] = [...new Set([...items[k].map((i) => i.key), ...((seen && seen[k]) || [])])].slice(0, NEWS_MAX_KEYS);
  }
  try {
    fm.writeString(seenPath(key), JSON.stringify(next));
  } catch (_) {}
  return { total, first: !seen, kinds };
}

function newsText(news) {
  const T = NT();
  const blocks = [];
  for (const [k, label] of [["hw", T.hw], ["grades", T.grades], ["msgs", T.msgs], ["notes", T.notes]]) {
    const list = news.kinds[k] || [];
    if (!list.length) continue;
    const lines = list.slice(0, 5).map((i) => `• ${i.line}`);
    if (list.length > 5) lines.push(`  ${T.more(list.length - 5)}`);
    blocks.push(`${label} (${list.length})\n${lines.join("\n")}`);
  }
  return blocks.join("\n\n");
}

async function showNewsAlert(news, data, withOpen) {
  const a = new Alert();
  a.title = `${NT().title(news.total)}${data.child && data.child.title ? `\n${data.child.title}` : ""}`;
  a.message = newsText(news);
  if (withOpen) a.addAction(NT().open);
  a.addCancelAction(NT().ok);
  return (await a.presentAlert()) === 0 && withOpen;
}

async function notify(title, body) {
  try {
    const n = new Notification();
    n.title = title;
    n.body = body;
    n.threadIdentifier = "dienynas-plus-news";
    n.openURL = URLScheme.forRunningScript();
    n.sound = "default";
    await n.schedule();
  } catch (_) {}
}

async function runCheck() {
  const T = NT();
  const inApp = config.runsInApp;
  const say = async (msg) => {
    Script.setShortcutOutput(msg);
    if (inApp) {
      const a = new Alert();
      a.title = APP_NAME;
      a.message = msg;
      a.addAction(T.ok);
      await a.presentAlert();
    }
  };
  if (!Keychain.contains(K.user) || !Keychain.contains(K.pass)) {
    if (!inApp) await notify(APP_NAME, T.signIn);
    return say(T.signIn);
  }
  let data;
  try {
    data = await loadAll(new Tamo(inApp));
    saveCache(data);
    saveWidget(widgetSnapshot(data));
  } catch (e) {
    const msg = T.failed(e.message || String(e));
    if (!inApp && e && e.badLogin) await notify(APP_NAME, msg); // offline hiccups stay quiet in the background
    return say(msg);
  }
  const news = findNews(data);
  if (news.first) return say(T.started);
  if (!news.total) return say(T.nothing);
  const body = newsText(news);
  Script.setShortcutOutput(`${T.title(news.total)}\n\n${body}`);
  if (!inApp) return notify(`${T.title(news.total)}${data.child.title ? ` · ${data.child.title}` : ""}`, body);
  if (await showNewsAlert(news, data, true)) await main(data);
}

// ───────────────────────────── ⬆️ in-app updates (releases.json on GitHub) ─────────────────────────────

// Compares "1.10.0" and "1.9.2" as numbers: returns 1, 0 or -1.
function cmpVer(a, b) {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

async function checkForUpdate() {
  if (!settings.checkUpdates || updateSnoozed()) return null;
  try {
    const req = new Request(`${REPO_RAW}releases.json?t=${Date.now()}`);
    req.timeoutInterval = 10;
    const data = await req.loadJSON();
    if (!data || !Array.isArray(data.releases)) return null;
    const newer = data.releases
      .filter(r => r && r.version && cmpVer(r.version, VERSION) > 0)
      .sort((x, y) => cmpVer(y.version, x.version));
    if (!newer.length) return null;
    // The newest release's highlights first, topped up from older versions the user skipped.
    const highlights = [];
    newer.forEach(r => (r.highlights || []).forEach(h => {
      if (highlights.length < 3 && h && h.title) highlights.push(h);
    }));
    return {
      current: VERSION, latest: newer[0].version, title: newer[0].title || '',
      titleLt: (newer[0].lt && newer[0].lt.title) || '',
      skipped: newer.length, highlights, script: data.script || SCRIPT_FILE,
    };
  } catch (e) {
    console.log('Update check skipped: ' + e);
    return null;
  }
}

function updateSnoozed() {
  try {
    return Keychain.contains(KC_UPDATE_SNOOZE) && Date.now() < +Keychain.get(KC_UPDATE_SNOOZE);
  } catch (e) { return false; }
}

function snoozeUpdate() {
  Keychain.set(KC_UPDATE_SNOOZE, String(Date.now() + UPDATE_SNOOZE_MS));
}

function clearUpdateSnooze() {
  if (Keychain.contains(KC_UPDATE_SNOOZE)) Keychain.remove(KC_UPDATE_SNOOZE);
}

async function applyUpdate(info) {
  const req = new Request(`${REPO_RAW}${encodeURI((info && info.script) || SCRIPT_FILE)}?t=${Date.now()}`);
  req.timeoutInterval = 30;
  const code = await req.loadString();
  const okStatus = req.response && req.response.statusCode === 200;
  const m = code && code.match(/const VERSION = '([^']+)'/);
  // 1. A real script for THIS app, not an error page or another project's file
  if (!okStatus || !m || !code.includes(`const APP_ID = '${APP_ID}'`)) {
    throw new Error(LANG() === 'lt' ? 'Atsisiųstas failas atrodo netinkamas. Bandykite vėliau.' : "The download didn't look right. Try again later.");
  }
  // 2. Actually newer: GitHub's cache can serve the old file for a few minutes after a release
  if (cmpVer(m[1], VERSION) <= 0) {
    throw new Error(LANG() === 'lt' ? 'GitHub dar rodo seną versiją. Bandykite po kelių minučių.' : 'GitHub is still serving the old version. Try again in a few minutes.');
  }
  // 3. Write it where the running script lives (iCloud or on the phone)
  const path = module.filename;
  let fm = FileManager.local();
  try {
    const ic = FileManager.iCloud();
    if (path.startsWith(ic.documentsDirectory())) fm = ic;
  } catch (e) {}
  fm.writeString(path, code);
  return m[1];   // the version now installed
}

// ───────────────────────────── app controller ─────────────────────────────

class App {
  constructor() {
    this.api = new Tamo(true);
    this.wv = new WebView();
    this.busy = false;
    this.data = null;
    this.chatState = null; // {roleKey, history: [{role, text, at}], pack} — saved per child on this phone
    this.msgBodies = {}; // bodies of messages opened in this session, for Ask
    this.pendingUpdate = null; // newer version found on GitHub, offered until answered
    this.updateChecked = false;
    this.updateOffered = false; // an update sheet was offered this launch (then no AI invitation)
    this.settingsEffect = ""; // what closing Settings must do: "" or "render"
  }

  offerUpdate() {
    if (!this.pendingUpdate) return;
    this.updateOffered = true;   // one offer per launch: no AI invitation after an update was offered
    this.wv.evaluateJavaScript(`window.__showUpdate && window.__showUpdate(${safeJSON(this.pendingUpdate)})`, false).catch(() => {});
  }

  // The conversation for the child currently shown, loaded from the phone the first time it's needed.
  chatFor(data) {
    const key = data && data.child && data.child.key;
    if (!key) return { v: 1, roleKey: "", history: [], pack: null };
    if (!this.chatState || this.chatState.roleKey !== key) this.chatState = loadChat(key);
    return this.chatState;
  }

  // What the page boots from. Handed over after the page is on screen; buildHTML() never inlines it.
  clientState(data, extra = {}) {
    const chat = this.chatFor(data);
    return {
      ...data,
      chat: chat.history.map((m) => ({ role: m.role, text: m.text, by: m.by })),
      chatInfo: packInfo(chat.pack),
      gradeMax: gradeMaxFor(data.child && data.child.key),
      hasAiKey: !!aiKey(),
      update: this.pendingUpdate, // re-offered after every reload of the main page, until answered
      ...extra,
      lang: LANG(), version: VERSION, look: lookState(), logo: LOGO_PARTS,
    };
  }

  // Every later page load (fresh data, language, grade scale): the page shell first, then its data (recipe · safe-startup).
  async show(data, extra = {}) {
    await Promise.race([this.wv.loadHTML(buildHTML()), pause(15000)]);
    await handOver(this.clientState(data, extra));
  }

  async progress(stage) {
    try {
      await this.wv.evaluateJavaScript(`window.askProgress && window.askProgress(${safeJSON(stage)})`, false);
    } catch (_) {}
  }

  // Pull everything into the chat once, then reuse it; re-pull when it's older than a few hours or on request.
  async ensurePack(force = false) {
    const data = this.data || readCache();
    if (!data) throw new Error(t("aiNoData"));
    const chat = this.chatFor(data);
    const fresh = chat.pack && Date.now() - chat.pack.builtAt < cfg("askMaxAgeH") * 3600000 && chat.pack.today === todayV();
    if (!force && fresh) return chat;
    chat.pack = await gatherAll(this.api, data, (stage) => this.progress(stage));
    saveChat(chat);
    return chat;
  }

  route(req) {
    const url = String(req.url || "");
    if (url.startsWith("tamo://")) {
      this.bridge(url);
      return false;
    }
    if (/^https?:\/\//i.test(url)) {
      Safari.open(url);
      return false;
    }
    return true;
  }

  async reload(announce = false) {
    if (this.busy) return;
    this.busy = true;
    const t0 = Date.now();
    try {
      const data = await loadAll(this.api);
      saveCache(data);
      saveWidget(widgetSnapshot(data));   // what the Home Screen widget shows: lesson times, counts, no grades or message text
      this.data = data;
      startLog(`TAMO answered in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
      await afterSplash();   // the launch screen plays out over the cached diary first
      await this.show(data);
      // pop up anything new since the last run (scheduled check or app launch)
      if (announce) {
        const news = findNews(data);
        if (news.total) await showNewsAlert(news, data, false);
      }
    } catch (e) {
      startLog(`TAMO didn't answer after ${((Date.now() - t0) / 1000).toFixed(1)} s${e && e.badLogin ? " (sign-in refused)" : ""}`);   // no error text: it could name a child or a server detail
      await afterSplash();
      if (e && e.badLogin) {
        await this.wv.loadHTML(
          messageHTML(APP_NAME, `${e.message}.`, [
            { label: t("changeLogin"), action: "relogin" },
            { label: t("tryAgain"), action: "refresh" },
          ])
        );
      } else {
        const cached = readCache();
        const at = cached ? new Date(cached.at) : null;
        if (cached) {
          const stamp = `${at.getDate()}.${String(at.getMonth() + 1).padStart(2, "0")} ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
          this.data = this.data || cached;
          await this.show(cached, { warnings: [], stale: { at: stamp, error: e.message || String(e) } });
        } else {
          await this.wv.loadHTML(messageHTML(APP_NAME, e.message || String(e), [{ label: t("tryAgain"), action: "refresh" }]));
        }
      }
    } finally {
      this.busy = false;
    }
  }

  async reply(id, ok, payload) {
    if (!id || id === "0") return;
    try {
      await this.wv.evaluateJavaScript(`window.bridgeReply && window.bridgeReply(${Number(id)}, ${ok ? "true" : "false"}, ${safeJSON(payload)})`, false);
    } catch (_) {}
  }

  async bridge(url) {
    const [action, qs = ""] = url.slice("tamo://".length).split("?");
    const q = Object.fromEntries(qs.split("&").filter(Boolean).map((kv) => kv.split("=").map(decodeURIComponent)));
    let params = {};
    try {
      params = JSON.parse(q.p || "{}");
    } catch (_) {}
    if (AI_ACTIONS.includes(action)) {   // AI settings sheet (app-blueprints · ai-configuration)
      const msg = await aiAction(action, params);
      await this.wv.evaluateJavaScript(`window.__aiState(${safeJSON(aiClientState())})`, false).catch(() => {});
      if (msg) await this.wv.evaluateJavaScript(`window.__aiToast(${safeJSON(msg)})`, false).catch(() => {});
      return this.reply(q.id, true, {});
    }
    try {
      switch (action) {
        case "update-later":
          snoozeUpdate();
          this.pendingUpdate = null;
          return this.reply(q.id, true, {});
        case "update-now": {
          const v = await applyUpdate(this.pendingUpdate);
          this.pendingUpdate = null;
          clearUpdateSnooze();
          return this.reply(q.id, true, v);
        }
        case "week": {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(params.monday || "")) throw new Error("bad date");
          const days = await fetchWeek(this.api, params.monday);
          if (this.chatState && this.chatState.pack) this.chatState.pack.weeks[params.monday] = days;
          return this.reply(q.id, true, days);
        }
        case "message": {
          const id = encodeURIComponent(String(params.id || ""));
          const type = encodeURIComponent(String(params.typeId || "1"));
          if (!id) throw new Error("bad message");
          const detail = mapMessageDetail(await this.api.modern(`messaging/messages/received/${type}/${id}`, {}, false));
          this.msgBodies[`${params.typeId || "1"}/${params.id}`] = detail.body;
          return this.reply(q.id, true, detail);
        }
        case "file": {
          await this.openFile(params);
          return this.reply(q.id, true, {});
        }
        case "prepare": {
          const chat = await this.ensurePack(!!params.force);
          return this.reply(q.id, true, { info: packInfo(chat.pack) });
        }
        case "ask": {
          const question = String(params.q || "").trim().slice(0, 4000);
          if (!question) throw new Error("empty question");
          if (!aiKey()) return this.reply(q.id, false, "NEED_KEY");
          const chat = await this.ensurePack(false);
          const max = gradeMaxFor(chat.roleKey);
          const r = await aiAsk(chat.pack, this.msgBodies, chat.history, question, max);
          if (r.needKey) return this.reply(q.id, false, "NEED_KEY");
          const at = Date.now();
          chat.history.push({ role: "user", text: question, at }, { role: "assistant", text: r.answer, by: r.by, at: Date.now() });
          saveChat(chat);
          return this.reply(q.id, true, { answer: r.answer, by: r.by, info: packInfo(chat.pack) });
        }
        case "scale": {
          const data = this.data || readCache();
          await this.reply(q.id, true, {});
          if (data && (await pickGradeScale(data.child.key, data.child.title))) await this.show(data, { warnings: [], startTab: params.tab });
          return;
        }
        case "clearchat": {
          const data = this.data || readCache();
          if (data) {
            deleteChat(data.child.key);
            this.chatState = { v: 1, roleKey: data.child.key, history: [], pack: null };
          }
          return this.reply(q.id, true, {});
        }
        case "refresh":
          await this.reply(q.id, true, {});
          return this.reload();
        case "relogin":
          if (await askCredentials()) {
            forgetSession();
            this.api = new Tamo(true);
          }
          return this.reload();
        // Settings (app-blueprints · settings): each change is applied and saved at once; the reply is the fresh state.
        case "settings-get":
        case "set":
        case "cfg":
        case "scale-set":
        case "scale-other": {
          const cur = this.data || readCache();
          if (action === "set") {
            const effect = setSetting(params.k, params.v);
            if (effect === null) throw new Error(LANG() === "lt" ? "Šio nustatymo čia pakeisti negalima." : "That setting can’t be changed here.");
            if (effect) this.settingsEffect = effect;
            saveSettings();
          } else if (action === "cfg") {
            if (params.k === "*") settings.cfg = {};
            else setCfg(params.k, params.reset ? null : params.v);
            saveSettings();
          } else if (action === "scale-set" && cur) {
            const max = parseInt(params.v, 10);
            if (max >= 2 && max <= 100) { setGradeMax(cur.child.key, max); this.settingsEffect = "render"; }
          } else if (action === "scale-other" && cur) {
            if (await pickGradeScale(cur.child.key, cur.child.title)) this.settingsEffect = "render";
          }
          const session = this.api.session || (Keychain.contains(K.session) ? JSON.parse(Keychain.get(K.session)) : null);
          return this.reply(q.id, true, settingsState(cur && cur.child, session && (session.roles || []).length > 1));
        }
        case "settings-done": {   // the sheet closed: redraw once if the language or a grade scale changed
          const effect = this.settingsEffect;
          this.settingsEffect = "";
          await this.reply(q.id, true, {});
          const cur = this.data || readCache();
          if (effect && cur) await this.show(cur, { warnings: [] });
          return;
        }
        case "update-check": {   // Settings › Check for updates now: clears "Later" and checks at once
          if (Keychain.contains(KC_UPDATE_SNOOZE)) Keychain.remove(KC_UPDATE_SNOOZE);
          const was = settings.checkUpdates; settings.checkUpdates = true;
          const u = await checkForUpdate(); settings.checkUpdates = was;
          const lt = LANG() === "lt";
          await this.reply(q.id, true, { available: !!u, msg: u ? (lt ? `Yra versija ${u.latest}` : `Version ${u.latest} is available`) : (lt ? `Naudojate naujausią versiją (${VERSION})` : `You're on the latest version (${VERSION})`) });
          if (u) { this.pendingUpdate = u; this.offerUpdate(); }
          return;
        }
        case "aiinvite":   // AI invitation: shown, open, later or never
          aiInviteNote(params.v);
          return this.reply(q.id, true, {});
        case "startlog": {   // Settings › Updates › Start-up log (recipe · safe-startup)
          let txt = "";
          try { txt = FileManager.local().readString(LOG_PATH).split("\n").slice(-40).join("\n"); } catch (e) {}
          return this.reply(q.id, true, txt);
        }
        case "openurl":   // Built with: only the blueprints repository opens from here
          if (params.v === BLUEPRINTS_REPO || String(params.v).startsWith(BLUEPRINTS_REPO + "/")) await Safari.openInApp(params.v, false);
          return this.reply(q.id, true, {});
        case "acct":
          await this.reply(q.id, true, {});
          return this.account(params.v);
        default:
          throw new Error(`unknown action ${action}`);
      }
    } catch (e) {
      return this.reply(q.id, false, (e && e.message) || String(e));
    }
  }

  async openFile({ sid, legacy }) {
    if (!sid) throw new Error("missing file");
    let url = "";
    if (legacy) {
      const r = obj(await this.api.call("GetFileUrl", { legacy: true, query: { fileId: String(sid) } }), "Result");
      url = str(r, "url") || str(r, "Url");
    } else {
      url = str(await this.api.call("files/filedownloadurl", { form: { fileSid: String(sid) } }), "url");
    }
    if (!/^https:\/\//i.test(url)) throw new Error("TAMO returned no download link");
    await Safari.openInApp(url, false);
  }

  // Account actions from Settings (they used to be the ••• menu).
  async account(act) {
    if (act === "switchChild") {
      if (Keychain.contains(K.role)) Keychain.remove(K.role);
      forgetSession();
      clearCache();
      this.api = new Tamo(true);
      return this.reload();
    }
    if (act === "web") return Safari.open("https://dienynas.tamo.lt/");
    if (act === "login") {
      if (await askCredentials()) {
        forgetSession();
        clearCache();
        saveWidget({ children: {} });   // possibly another account: the widget waits for its data
        if (Keychain.contains(K.role)) Keychain.remove(K.role);
        this.api = new Tamo(true);
        return this.reload();
      }
      return;
    }
    if (act === "signout") {   // keeps settings.json (appearance, language, grade scales), as 1.5 kept them
      [K.user, K.pass, K.role, K.session].forEach((k) => Keychain.contains(k) && Keychain.remove(k));
      Object.keys(PROVIDERS).forEach(removeKey);
      deleteAllChats();
      try {
        fm.listContents(fm.documentsDirectory())
          .filter((n) => /^dienynas-plus-seen-.*\.json$/.test(n))
          .forEach((n) => fm.remove(fm.joinPath(fm.documentsDirectory(), n)));
      } catch (_) {}
      this.chatState = null;
      clearCache();
      saveWidget({ children: {} });   // the widget forgets the children too
      return this.wv.loadHTML(messageHTML(APP_NAME, t("signedOut")));
    }
  }
}

// ───────── Widget ─────────
// Shared widget frame (github.com/gadominas/app-blueprints › blueprints/widgets.md).
// An app changes only WIDGET and widgetModel(); everything below WB is the same in every app.
const WIDGET = {
  name: [BRAND.name, BRAND.plus],         // as on the launch screen: plain part, highlighted part, optional rest
  accent: '#60A5FA',                      // the logo's focal colour (the launch screen's --sp-accent)
  icon: REPO_RAW + 'docs/icon-1024.png',  // the app icon, cached on the phone after the first fetch
  get words() {   // in the app's language; a getter, because WIDGET is built before loadSettings() reads the language
    return LANG() === 'lt'
      ? { open: 'Paspauskite, kad atidarytumėte', nothing: 'Kol kas nėra ką rodyti.', updated: 'Atnaujinta', yesterday: 'vakar' }
      : { open: 'Tap to open', nothing: 'Nothing to show yet.', updated: 'Updated', yesterday: 'yesterday' };
  },
};
// Brand colours, the same in every app and in light and dark mode: the logo tile's ground and lines.
const WB = { ground: '#0E1116', raised: '#171B22', ink: '#F6F7F9', ink2: '#C9CED6', muted: '#9AA3AE', good: '#2DD4BF', warn: '#FBBF24' };
const wfm = FileManager.local();
const wPath = (n) => wfm.joinPath(wfm.documentsDirectory(), APP_ID + '-' + n);

// What the widget shows is saved by the app and only read by the widget: fast, offline, no sign-in.
function saveWidget(data) {
  try { wfm.writeString(wPath('widget.json'), JSON.stringify(Object.assign({}, data, { at: Date.now() }))); }
  catch (e) { console.log('Widget: not saved: ' + e); }
}
function readWidget() {
  try { const p = wPath('widget.json'); return wfm.fileExists(p) ? JSON.parse(wfm.readString(p)) : null; }
  catch (e) { return null; }
}

// Tones: ink, soft, muted, accent, good, warn, or a hex colour.
const wColor = (c, a = 1) => {
  const k = c === 'soft' ? 'ink2' : c;
  return new Color(k === 'accent' ? WIDGET.accent : (WB[k] || k), a);
};
// Rounded system fonts, falling back to the plain system font on older Scriptable versions.
function wFont(weight, size) {
  const name = { bold: 'boldRoundedSystemFont', semi: 'semiboldRoundedSystemFont', med: 'mediumRoundedSystemFont' }[weight] || 'regularRoundedSystemFont';
  if (typeof Font[name] === 'function') return Font[name](size);
  return weight === 'bold' ? Font.boldSystemFont(size) : weight === 'semi' ? Font.semiboldSystemFont(size) : weight === 'med' ? Font.mediumSystemFont(size) : Font.systemFont(size);
}
function wText(stack, s, size, weight, tone, lines = 1) {
  const t = stack.addText(String(s));
  t.font = wFont(weight, size);
  t.textColor = wColor(tone);
  t.lineLimit = lines;
  if (lines === 1) t.minimumScaleFactor = 0.75;
  return t;
}
function wWhen(ts) {
  const d = new Date(ts), now = new Date(), f = new DateFormatter();
  const day = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const ago = Math.round((day(now) - day(d)) / 864e5);
  if (ago === 1) return WIDGET.words.yesterday;
  f.dateFormat = ago === 0 ? 'HH:mm' : 'd MMM';
  return f.string(d);
}

// The app's logo tile, from the repository's icon, cached per app version; a monogram until then.
async function widgetIcon() {
  const p = wPath('widget-icon-' + VERSION + '.png');
  try {
    if (wfm.fileExists(p)) return wfm.readImage(p);
    const r = new Request(WIDGET.icon);
    r.timeoutInterval = 8;
    const dc = new DrawContext();
    dc.size = new Size(96, 96); dc.opaque = false; dc.respectScreenScale = false;
    dc.drawImageInRect(await r.loadImage(), new Rect(0, 0, 96, 96));
    const img = dc.getImage();
    const dir = wfm.documentsDirectory();
    wfm.listContents(dir).filter((f) => f.startsWith(APP_ID + '-widget-icon-')).forEach((f) => { try { wfm.remove(wfm.joinPath(dir, f)); } catch (e) {} });
    wfm.writeImage(p, img);
    return img;
  } catch (e) {
    return widgetMonogram();
  }
}
function widgetMonogram() {
  const dc = new DrawContext();
  dc.size = new Size(96, 96); dc.opaque = false; dc.respectScreenScale = false;
  dc.setFillColor(wColor('raised')); dc.fillRect(new Rect(0, 0, 96, 96));
  dc.setFont(wFont('bold', 54)); dc.setTextColor(wColor('accent')); dc.setTextAlignedCenter();
  dc.drawTextInRect(WIDGET.name.join('').charAt(0), new Rect(0, 14, 96, 70));
  return dc.getImage();
}

// Rows that fit: a line counts 1, a sub line 0.8; medium holds 5.5 (3 rows at most), large 12 (6 at most).
function wFit(rows, budget, max) {
  const out = [];
  let used = 0;
  for (const r of rows || []) {
    const n = (r.lines || 1) + (r.sub ? 0.8 : 0);
    if (out.length >= max || used + n > budget + 1e-9) break;   // 1e-9: 3 + 5 × 1.8 must still fit in 12
    used += n;
    out.push(r);
  }
  return out;
}
function wRows(stack, rows) {
  rows.forEach((r, i) => {
    if (i) stack.addSpacer(5);
    const row = stack.addStack();
    row.topAlignContent(); row.spacing = 6;
    if (r.url) row.url = r.url;
    if (r.icon) { const ic = row.addStack(); ic.size = new Size(15, 0); wText(ic, r.icon, 11.5, 'reg', 'ink'); }
    const tx = row.addStack();
    tx.layoutVertically();
    wText(tx, r.text, 12.5, r.lines ? 'reg' : 'med', r.tone || (r.lines ? 'soft' : 'ink'), r.lines || 1);
    if (r.sub) wText(tx, r.sub, 11, 'reg', 'muted');
  });
}

async function renderWidget(m) {
  const fam = config.widgetFamily || 'medium';
  const w = new ListWidget();
  w.url = m.url || URLScheme.forRunningScript();
  w.refreshAfterDate = new Date(Date.now() + cfg('widgetRefreshMin') * 60e3);
  if (fam.startsWith('accessory')) return renderAccessory(w, fam, m);
  const small = fam === 'small', medium = fam === 'medium', large = !small && !medium;
  const g = new LinearGradient();
  g.colors = [wColor('raised'), wColor('ground')]; g.locations = [0, 1];
  g.startPoint = new Point(0, 0); g.endPoint = new Point(0, 1);
  w.backgroundGradient = g;
  w.setPadding(14, 14, 14, 14);

  // 1. Header: logo tile, name (highlighted part in the accent), badge
  const hd = w.addStack();
  hd.centerAlignContent();
  const icon = hd.addImage(await widgetIcon());
  const is = small ? 18 : 20;
  icon.imageSize = new Size(is, is); icon.cornerRadius = is * 0.225;
  hd.addSpacer(6);
  WIDGET.name.forEach((part, i) => {
    if (!part) return;
    const t = hd.addText(part);
    t.font = wFont('bold', small ? 13 : 14); t.textColor = wColor(i === 1 ? 'accent' : 'ink'); t.lineLimit = 1;
  });
  hd.addSpacer();
  if (m.badge && !small) {
    const b = hd.addStack();
    b.setPadding(2, 7, 2, 7); b.cornerRadius = 8;
    b.backgroundColor = wColor(m.badgeTone || 'accent', 0.16);
    wText(b, m.badge, 11.5, 'semi', m.badgeTone || 'accent');
  }
  w.addSpacer(small ? 8 : 10);

  // Empty state: what to do next, never an error
  if (m.empty) {
    wText(w, m.empty, 13, 'semi', 'soft', 3);
    w.addSpacer();
    wText(w, m.footer || WIDGET.words.open, 11, 'reg', 'muted');
    Script.setWidget(w);
    return;
  }

  // 2. Hero: kicker, then a big value with its caption, or a title with its caption
  const body = w.addStack();
  body.topAlignContent();
  const left = body.addStack();
  left.layoutVertically();
  if (medium) left.size = new Size(136, 0);
  if (m.kicker) wText(left, m.kicker, 11, 'semi', m.kickerTone || 'accent');
  if (m.value != null && m.value !== '') {
    wText(left, m.value, small ? 40 : 42, 'bold', m.valueTone || 'ink');
    if (m.caption) wText(left, m.caption, 13, 'semi', 'ink');
  } else {
    if (m.title) wText(left, m.title, small ? 16 : 18, 'bold', 'ink', 2);
    if (m.caption) { left.addSpacer(2); wText(left, m.caption, 12, 'reg', 'soft', 2); }
  }

  // 3. Rows: beside the hero on medium, under it on large, none on small
  const rows = m.rows || [];
  if (medium && wFit(rows, 5.5, 3).length) {
    body.addSpacer(12);
    const right = body.addStack();
    right.layoutVertically();
    wRows(right, wFit(rows, 5.5, 3));
  }
  body.addSpacer();
  if (large && wFit(rows, 12, 6).length) { w.addSpacer(14); wRows(w, wFit(rows, 12, 6)); }

  // 4. Footer: one muted line; amber when the data is stale. Small shows the badge here if there's no footer.
  w.addSpacer();
  const ft = small ? (m.footer || m.badge) : m.footer;
  if (ft) wText(w, (m.stale ? '⟳ ' : '') + ft, 11, 'reg', m.stale ? 'warn' : 'muted');
  Script.setWidget(w);
}

// Lock Screen: iOS tints these, so text only, no colours or logo.
function renderAccessory(w, fam, m) {
  const name = WIDGET.name.join('');
  const a = m.accessory || {};
  const hasValue = m.value != null && m.value !== '';
  const hero = m.empty || (hasValue ? (m.value + ' ' + (m.caption || '')).trim() : (m.title || ''));
  if (fam === 'accessoryInline') {
    w.addText(a.inline || (hero ? name + ': ' + hero : name));
  } else if (fam === 'accessoryCircular') {
    w.addAccessoryWidgetBackground = true;
    const c = w.addStack();
    c.layoutVertically(); c.centerAlignContent();
    const gl = c.addText(a.glyph || name.charAt(0)); gl.font = Font.systemFont(11); gl.centerAlignText();
    const v = c.addText(String(a.value != null ? a.value : hasValue ? m.value : '–'));
    v.font = wFont('bold', 20); v.minimumScaleFactor = 0.5; v.centerAlignText();
  } else {
    const lines = [
      [[name, m.badge || m.kicker].filter(Boolean).join(' · '), 'semi', 12],
      [hero, 'bold', 15],
      [m.empty ? '' : hasValue ? (m.footer || '') : (m.caption || m.footer || ''), 'reg', 12],
    ];
    lines.forEach(([s, wt, size]) => { if (!s) return; const t = w.addText(s); t.font = wFont(wt, size); t.lineLimit = 1; t.minimumScaleFactor = 0.7; });
  }
  Script.setWidget(w);
}

// Widget runs come here and only here: no WebView, Alert or QuickLook may be built or presented.
async function runWidget() {
  const name = WIDGET.name.join('');
  let m = null;
  try { m = await widgetModel(args.widgetParameter || '', config.widgetFamily || 'medium'); }
  catch (e) { console.error('Widget model: ' + e); }
  if (!m) m = { empty: WIDGET.words.nothing };
  try {
    if (m.at && !m.empty && Date.now() - m.at > cfg('widgetStaleMin') * 60e3) {
      m.stale = true;
      m.footer = WIDGET.words.updated + ' ' + wWhen(m.at);
    }
    await renderWidget(m);
  } catch (e) {
    console.error('Widget render: ' + e);
    const w = new ListWidget();
    w.backgroundColor = wColor('ground');
    w.url = URLScheme.forRunningScript();
    wText(w, name, 14, 'bold', 'ink');
    w.addSpacer(4);
    wText(w, WIDGET.words.open, 12, 'reg', 'muted');
    Script.setWidget(w);
  }
}
// ───────── end of Widget ─────────

// ───────────────────────────── run (app-blueprints · recipes/safe-startup) ─────────────────────────────
// A run marks itself as open while its window is on screen. A new run waits at most 1.5 s for an older
// window to close, then opens anyway: quick taps on the widget don't stack up copies.
const lockFm = FileManager.local();
const RUN_LOCK = lockFm.joinPath(lockFm.temporaryDirectory(), APP_ID + '-running');
let lockTimer = null;
const lockAge = () => { try { return lockFm.fileExists(RUN_LOCK) ? Date.now() - Number(lockFm.readString(RUN_LOCK)) : Infinity; } catch (e) { return Infinity; } };
const pause = ms => new Promise(r => Timer.schedule(ms, false, r));
async function waitForOtherWindow() { for (let waited = 0; lockAge() < 2500 && waited < 1500; waited += 300) await pause(300); }
function holdLock() {
  const beat = () => { try { lockFm.writeString(RUN_LOCK, String(Date.now())); } catch (e) {} };
  beat(); lockTimer = Timer.schedule(1000, true, beat);
}
function releaseLock() {
  if (lockTimer) { lockTimer.invalidate(); lockTimer = null; }
  try { if (lockFm.fileExists(RUN_LOCK)) lockFm.remove(RUN_LOCK); } catch (e) {}
}
let app = null;   // this run's App (its bridge, TAMO session and update offer)
let wv = null;    // its window (app.wv)
// Talks to the page with a time limit, so a stuck page can't stall the app.
const ev = (js, ms = 20000) => Promise.race([wv.evaluateJavaScript(js, false), pause(ms).then(() => { throw new Error("the page didn't respond in " + ms / 1000 + " s"); })]);

// Hands the page its state: the chat (the list that grows with use) in pieces, then the rest with __boot.
async function handOver(st) {
  const list = st.chat || [];
  st.chat = [];
  for (let i = 0; i < list.length; i += 20) await ev(`window.__parts.push(${safeJSON(list.slice(i, i + 20))})`);   // in pieces: one huge message can stall WebKit
  await ev(`window.__boot(${safeJSON(st)})`);
}

// `fresh` is data a Shortcuts check just loaded: show it straight away without asking TAMO again.
async function bootApp(fresh, isClosed) {
  const t0 = Date.now();
  startLog(`Dienynas+ ${VERSION}: reading data`);
  await loadData();
  const data = fresh || diaryCache, at = data && new Date(data.at);
  startLog(`data read in ${((Date.now() - t0) / 1000).toFixed(1)} s: ${data ? `diary from ${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}` : "no diary saved yet"}${loadIssues.length ? "; missing: " + loadIssues.join(", ") : ""}`);
  if (isClosed()) return;
  app.data = data;
  if (data) await handOver(app.clientState(data, { warnings: [] }));
  else await ev(`window.__boot(null)`);   // nothing saved yet: "Loading your diary…" stays until TAMO answers
  let seen = "";
  try { seen = await ev(`document.visibilityState + ", " + innerWidth + "x" + innerHeight`, 5000); } catch (e) { seen = String(e.message || e); }
  startLog(`screen ready in ${((Date.now() - t0) / 1000).toFixed(1)} s (page: ${seen})`);
  if (loadIssues.length || !settingsOk) ev(`window.__aiToast && window.__aiToast(${safeJSON(BOOT_TEXT().missing)})`).catch(() => {});
  else if (loadRepaired.length) ev(`window.__aiToast && window.__aiToast(${safeJSON(BOOT_TEXT().repaired)})`).catch(() => {});   // damaged files were kept aside (safe-startup 1.1.0)
  // Deferred work, once the first screen is drawn: today's diary from TAMO, then updates (and the AI invitation), then the widget's icon.
  let refreshed = Promise.resolve();
  Timer.schedule(700, false, () => {
    if (isClosed() || fresh) return;
    refreshed = app.reload(true).catch(() => {});   // writes only TAMO's own data (cache, widget snapshot), never a file that wasn't read
  });
  Timer.schedule(3500, false, () => {
    if (isClosed() || app.updateChecked) return;
    app.updateChecked = true;
    checkForUpdate().then((u) => { app.pendingUpdate = u; app.offerUpdate(); }).catch(() => {})
      .then(() => refreshed).then(() => { if (!isClosed()) inviteIfDue(); });   // AI invitation: after the update check and TAMO's answer (a new page would drop the card), never with an offer
  });
  Timer.schedule(6000, false, () => { widgetIcon(); });
}

// The app, and the Shortcuts check's "Open". Widget runs never come here (see the branch below).
async function main(fresh = null) {
  if (!Keychain.contains(K.user) || !Keychain.contains(K.pass)) {
    if (!(await askCredentials())) return;   // a native prompt, before the window: nothing to show without sign-in details
  }
  await waitForOtherWindow();
  app = new App();
  wv = app.wv;
  wv.shouldAllowRequest = (req) => app.route(req);
  // A page built before its window is on screen can stay blank on some iPhones (the page runs, nothing is drawn),
  // most often when opened from the widget. So: an empty dark window first, then the real page built inside it.
  await wv.loadHTML('<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#0E1116"></body></html>');
  const presented = wv.present(true);
  holdLock();
  await pause(300);                          // let the window finish appearing
  startLog("window on screen");
  await Promise.race([wv.loadHTML(buildHTML()), pause(15000)]);   // the launch screen, drawn on screen
  let closed = false;
  presented.then(() => { closed = true; releaseLock(); });
  bootApp(fresh, () => closed).catch((e) => {   // runs beside the window: closing it never waits on this
    startLog("start-up failed: " + (e.message || e));
    let log = "";
    try { log = FileManager.local().readString(LOG_PATH).split("\n").slice(-12).join("\n"); } catch (x) {}
    if (!closed) wv.evaluateJavaScript(`window.__bootNote(${safeJSON(BOOT_TEXT().failed)}, ${safeJSON(log)})`, false).catch(() => {});
  });
  await presented;
  closed = true;
  releaseLock();
  // Nothing to save on close: settings and AI files are saved at every change, the diary and the widget snapshot after every TAMO answer.
}

// ───────────────────────────── entry ─────────────────────────────

if (!globalThis.__DIENYNAS_TEST__) {
  await loadSettings();   // before every branch: app, widget and Shortcuts runs all use the saved choices
  if (config.runsInWidget || config.runsInAccessoryWidget) {
    await loadData();              // the widget reads its own data
    await runWidget();             // never builds or presents a WebView, Alert or QuickLook
  } else {
    aiMigrate(["dienynasplus.openai-key"]);   // 1.4.x kept one OpenAI key under another name (widget runs migrate nothing)
    if (isCheckRun()) {            // Shortcuts: "check" looks for news; its "Open" opens the app through main()
      widgetIcon();                // caches the logo tile for the widget, in the background
      await runCheck();
    } else {
      await main();
    }
  }
  Script.complete();
}
