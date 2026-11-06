// Dienynas+ test harness: runs the real Dienynas.js in Node with Scriptable's APIs replaced by stand-ins (see docs/TESTING.md).
//
// The script runs in its own vm context, so the browser APIs Scriptable doesn't have (setTimeout, URL, fetch, atob…)
// don't exist there either. Every WebView is a jsdom page; its tamo:// and https:// navigations reach the script's
// shouldAllowRequest, as on the phone. Every network request is answered from the fixtures below; a request
// without a fixture fails the scenario. Files and the Keychain live in memory (E.files, E.kc).
"use strict";
process.env.TZ = process.env.TZ || "Europe/Vilnius";   // the phone's time zone: the script and its pages read local times
const fs = require("fs");
const path = require("path");
const vm = require("vm");

// jsdom can't navigate to tamo:// or leave the page. Its navigate() is replaced before jsdom loads, so every navigation
// (location.href = …, a tapped link) goes to the WebView's shouldAllowRequest instead, as in Scriptable.
const jsdomDir = path.dirname(require.resolve("jsdom/package.json"));
const navigation = require(path.join(jsdomDir, "lib/jsdom/living/window/navigation.js"));
const whatwgURL = require(require.resolve("whatwg-url", { paths: [jsdomDir] }));
const jsdomNavigate = navigation.navigate;
navigation.navigate = (window, newURL, flags) => {
  const url = whatwgURL.serializeURL(newURL);
  if (window && typeof window.__scriptableNav === "function" && !/^javascript:/i.test(url)) {
    const cur = window.location && window.location.href.split("#")[0];
    if (url.split("#")[0] !== cur) return window.__scriptableNav(url);
  }
  return jsdomNavigate(window, newURL, flags);
};
const { JSDOM, VirtualConsole } = require("jsdom");

const SCRIPT = process.env.DIENYNAS_SCRIPT || path.join(__dirname, "..", "Dienynas.js");
const SRC = fs.readFileSync(SCRIPT, "utf8");
const RELEASES = JSON.parse(fs.readFileSync(path.join(path.dirname(SCRIPT), "releases.json"), "utf8"));
const VERSION = (SRC.match(/const VERSION = '([^']+)'/) || [])[1];

// ───────── the phone ─────────
const ICLOUD = "/var/mobile/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents";
const LOCAL = "/var/mobile/Containers/Data/Application/SCRIPTABLE/Documents";
const TMP = "/var/mobile/Containers/Data/Application/SCRIPTABLE/tmp";
const NOW = Date.UTC(2026, 9, 29, 8, 32);   // Thursday 29 October 2026, 10:32 in Vilnius: lesson 3 is on
const KEYS = { anthropic: "sk-ant-api03-ABCDEFGHIJKLMNOP1234", openai: "sk-proj-ABCDEFGHIJKLMNOP5678" };   // fake
// Settings that keep the one-time cards (usage question, AI invitation, add-photos card) out of scenarios about something else.
const quiet = (extra = {}) => Object.assign({ usageAsked: true, photosAsked: true, aiInvite: { off: true } }, extra);
const signedIn = (extra = {}) => Object.assign({ "dienynasplus.username": "demo.tevai", "dienynasplus.password": "not-a-real-password" }, extra);
const withKey = (extra = {}) => signedIn(Object.assign({ DIENYNASPLUS_ANTHROPIC_KEY: KEYS.anthropic }, extra));
const SETTINGS = ICLOUD + "/DienynasPlus/settings.json";
const local = (name) => LOCAL + "/" + name;
function hashKey(s) { let x = 5381; for (const c of String(s)) x = ((x * 33) ^ c.codePointAt(0)) >>> 0; return x.toString(36); }   // the script's own file-name hash

// ───────── invented school data (no real pupil, teacher or school) ─────────
const CHILDREN = [{ title: "Ugnė Pavyzdytė", subtitle: "5A klasė" }, { title: "Jonas Pavyzdys", subtitle: "2B klasė" }];
const roleKeyOf = (c) => c.title + "|" + c.subtitle;
const addDays = (d, n) => new Date(Date.parse(d + "T00:00:00Z") + n * 864e5).toISOString().slice(0, 10);
const dow = (d) => (new Date(d + "T00:00:00Z").getUTCDay() + 6) % 7;   // 0 = Monday
const utc = (date, hhmm) => {   // Vilnius local time → UTC; summer time ended on 25 October 2026
  const off = date < "2026-10-25" ? 3 : 2, [h, m] = hhmm.split(":").map(Number);
  return new Date(Date.parse(date + "T00:00:00Z") + ((h - off) * 60 + m) * 6e4).toISOString().slice(0, 19);
};
const TIMES = [["08:00", "08:45"], ["08:55", "09:40"], ["10:00", "10:45"], ["11:05", "11:50"], ["12:00", "12:45"], ["13:00", "13:45"]];
const TEACH = { "Matematika": "Rasa Skaičiūtė", "Lietuvių kalba": "Jūratė Žodelienė", "Anglų kalba": "Laura Kalbaitė", "Gamtos mokslai": "Tomas Gamtelis",
  "Istorija": "Darius Praeitis", "Fizinis ugdymas": "Mantas Bėgūnas", "Informatika": "Paulius Kodelis", "Dailė": "Eglė Spalvienė", "Muzika": "Gintarė Natelė" };
const WEEK = [
  ["Lietuvių kalba", "Matematika", "Anglų kalba", "Istorija"],
  ["Matematika", "Lietuvių kalba", "Gamtos mokslai", "Fizinis ugdymas"],
  ["Lietuvių kalba", "Matematika", "Informatika", "Anglų kalba"],
  ["Matematika", "Lietuvių kalba", "Anglų kalba", "Gamtos mokslai", "Dailė"],
  ["Lietuvių kalba", "Matematika", "Istorija", "Muzika"],
];
const LABELS = { "2026-10-30|Matematika": "Kontrolinis darbas", "2026-11-04|Anglų kalba": "Žodžių diktantas" };
const HOLIDAYS = { "2026-11-02": "Vėlinės (poilsio diena)" };
const AVG = { "Matematika": "8,0", "Anglų kalba": "9,5", "Lietuvių kalba": "9,0", "Gamtos mokslai": "9,0", "Istorija": "8,0" };
function baseData() {
  return {
    homework: [
      { id: "hw1", s: "Matematika", set: "2026-10-27", due: "2026-10-30", t: "Vadovėlis p. 48, 3–7 užd." },
      { id: "hw2", s: "Lietuvių kalba", set: "2026-10-28", due: "2026-10-30", t: "Perskaityti pasaką iki 5 skyriaus." },
      { id: "hw3", s: "Istorija", set: "2026-10-23", due: "2026-10-27", t: "Užpildyti darbo sąsiuvinį p. 15." },
      { id: "hw4", s: "Anglų kalba", set: "2026-10-29", due: "2026-11-04", t: "Workbook p. 22, ex. 1–3." },
      { id: "hw5", s: "Gamtos mokslai", set: "2026-10-27", due: "2026-11-05", t: "Paruošti pristatymą apie medžius.", f: "Pristatymo planas.pdf" },
      { id: "hw6", s: "Matematika", set: "2026-10-20", due: "2026-10-22", t: "Vadovėlis p. 44.", done: "2026-10-21" },
      { id: "hw7", s: "Dailė", set: "2026-10-28", due: "2026-10-29", t: "-" },   // a teacher's placeholder: hidden
      { id: "hw8", s: "Informatika", set: "2026-10-28", due: "2026-10-29", t: "Atsinešti ausines." },
    ],
    grades: [["2026-09-15", "Matematika", "8"], ["2026-10-01", "Anglų kalba", "10"], ["2026-10-08", "Matematika", "7", "Kontrolinis darbas"],
      ["2026-10-14", "Lietuvių kalba", "9"], ["2026-10-20", "Gamtos mokslai", "9"], ["2026-10-22", "Anglų kalba", "9", "Testas"],
      ["2026-10-26", "Istorija", "8"], ["2026-10-29", "Matematika", "9"]],
    attendance: [["2026-10-27", "Fizinis ugdymas", "n"], ["2026-10-19", "Matematika", "p"]],
    formatives: [["2026-10-28", "Lietuvių kalba", "Puikiai", "Kaupiamasis vertinimas"]],
    feed: [
      { id: "f1", eventId: "1", date: "2026-10-29T08:50:00", eventDetails: { ThingName: "Matematika", Date: "2026-10-29", Value: "9" } },
      { id: "f2", eventId: "10", date: "2026-10-28T14:10:00", eventDetails: { ThingName: "Lietuvių kalba", Date: "2026-10-28", Vertinimas: "Puikiai", Tipas: "Kaupiamasis vertinimas" } },
      { id: "f3", eventId: "8", date: "2026-10-26T15:05:00", eventDetails: { ThingName: "Dailė", Date: "2026-10-26", Type: "Pagyrimas", Value: "Labai kruopščiai atliktas darbas." } },
      { id: "f4", eventId: "2", date: "2026-10-27T11:30:00", eventDetails: { ThingName: "Fizinis ugdymas", Date: "2026-10-27", Type: "1" } },
      { id: "f5", eventId: "4", date: "2026-10-29T10:50:00", eventDetails: { ThingName: "Anglų kalba", Date: "2026-10-29", HomeWork: "Workbook p. 22, ex. 1–3.", Deadline: "2026-11-04" } },
    ],
    messages: [
      { id: "9104", d: "2026-10-29T09:14:00", s: "Ekskursija į muziejų", from: "Asta Klasiokienė", role: "Klasės vadovė", unread: true, files: true,
        body: "Gerbiami tėveliai,\n\nlapkričio 12 d. vyksime į muziejų. Daugiau: https://example.org/ekskursija\n\nPrašome grąžinti sutikimo formą.", att: "Sutikimo forma.pdf" },
      { id: "9101", d: "2026-10-29T07:48:00", s: "Penktadienio pamokų laikas", from: "Pavyzdžių progimnazija", role: "Administracija", body: "Penktadienį pamokos vyks įprastu laiku." },
      { id: "9087", d: "2026-10-28T16:02:00", s: "Kontrolinis darbas penktadienį", from: "Rasa Skaičiūtė", role: "Matematikos mokytoja", body: "Penktadienį rašysime kontrolinį darbą apie trupmenas." },
      { id: "9080", d: "2026-10-28T12:30:00", s: "Klasės fotografavimas", from: "Asta Klasiokienė", role: "Klasės vadovė", group: true, body: "Lapkričio 3 d. vyks klasės fotografavimas." },
      { id: "9072", d: "2026-10-27T18:41:00", s: "Tėvų susirinkimas", from: "Asta Klasiokienė", role: "Klasės vadovė", unread: true, important: true, body: "Susirinkimas lapkričio 5 d. 18 val." },
      { id: "9051", d: "2026-10-20T11:05:00", s: "Rudens krosas", from: "Mantas Bėgūnas", role: "Fizinio ugdymo mokytojas", body: "Ačiū visiems dalyvavusiems!" },
    ],
    allDay: [{ t: "Vėlinės (poilsio diena)", from: "2026-11-02", to: "2026-11-02", l: "Poilsio diena" }, { t: "Kalėdų atostogos", from: "2026-12-23", to: "2027-01-02", l: "Atostogos" }],
  };
}
function lessonsOn(D, date) {
  if (dow(date) > 4 || HOLIDAYS[date] || date < "2026-09-01") return [];
  return WEEK[dow(date)].map((s, i) => {
    const key = date + "|" + s, n = i + 1;
    const ev = { id: date + "-" + n, eventIcon: { content: String(n) }, timeFromUtc: utc(date, TIMES[i][0]), timeToUtc: utc(date, TIMES[i][1]),
      eventTitle: { content: s }, eventSubtitle: { content: TEACH[s] }, eventDescription: { content: s + ": tema " + (Number(date.slice(8)) % 5 + 1) }, eventDetails: [] };
    if (LABELS[key]) { ev.eventLabel = { content: LABELS[key], styleRef: "label-important" }; ev.eventHighlight = { styleRef: "important" }; }
    const marks = D.grades.filter((g) => g[0] === date && g[1] === s).map((g) => ({ contentType: "text", content: g[2] }))
      .concat(D.attendance.filter((a) => a[0] === date && a[1] === s).map((a) => ({ contentType: "text", content: a[2] })));
    if (marks.length) ev.rightIconsTop = marks;
    if (AVG[s] && date <= "2026-10-29") ev.bottomIconsRight = [{ key: "average", content: AVG[s] }];
    const hw = D.homework.find((h) => h.set === date && h.s === s);
    if (hw) ev.eventDetails.push({ key: "homework", title: { content: "Namų darbai" }, body: { content: hw.t }, files: hw.f ? [{ fileName: hw.f, fileSid: "f-" + hw.id }] : [] });
    return ev;
  });
}
const lessonId = (h) => h.set + "-" + (WEEK[dow(h.set)] ? WEEK[dow(h.set)].indexOf(h.s) + 1 : 0);
const inRange = (d, a, b) => (!a || d >= a) && (!b || d <= b);
const msgItem = (m, read) => ({ id: m.id, sid: "sid-" + m.id, messageTypeId: "1", date: m.d, subject: m.s, senderPerson: m.from, senderPersonTitle: m.role,
  readDate: m.unread && !read.has(m.id) ? null : m.d, isImportant: !!m.important, isStarred: false, hasAttachments: !!m.files });

// releases.json with one version newer than the script, for the update offer
function releasesWithOffer(extra = 1) {
  const r = JSON.parse(JSON.stringify(RELEASES)), [maj, min] = String(VERSION).split(".").map(Number);
  for (let i = 1; i <= extra; i++) r.releases.unshift({ version: `${maj}.${min + i}.0`, date: "2026-11-12", title: i === extra ? "Ready for the week" : "An earlier update",
    lt: { title: "Pasiruošę savaitei" },
    highlights: i === extra ? [{ icon: "🎒", title: "Pack for tomorrow", text: "Tomorrow's subjects as a checklist." }] : [{ icon: "🔔", title: "Quieter checks", text: "Checks skip empty runs." }, { icon: "✨", title: "Ask remembers more", text: "Longer conversations." }, { icon: "📅", title: "Never shown", text: "A fourth highlight." }],
    changes: [] });
  return r;
}

// ───────── a run ─────────
let current = null;   // the run whose problems an unhandled rejection belongs to
process.on("unhandledRejection", (e) => (current ? current.errors : []).push("UNHANDLED " + ((e && e.stack) || e)));
const issuedTokens = new Set();   // TAMO tokens this test has seen issued (a session saved by an earlier run stays valid)
const roleIds = new Map();        // role id → child index; TAMO hands out new ids on every roles request
let counter = 0;
const SHARED = { errors: [], jsErrors: undefined };   // one scenario is one process: problems from all its runs add up

function makeEnv(opts = {}) {
  const files = opts.files || {};
  const dirs = new Set();
  const kc = opts.kc || {};
  const errors = SHARED.errors;
  const log = { timeline: [], requests: [], alerts: [], pages: [], navigations: [], safari: [], notifications: [], widgets: [], ai: [], usage: [], tamoRead: [],
    console: [], pageAlerts: [], pageConsole: [], photos: 0, icloudCalls: 0 };
  Object.defineProperty(log, "jsErrors", { get: () => SHARED.jsErrors, set: (v) => { SHARED.jsErrors = v; }, enumerable: true });
  const E = { files, kc, log, errors, paths: { icloud: ICLOUD, local: LOCAL, tmp: TMP, settings: SETTINGS } };
  const scale = opts.timeScale == null ? 0.05 : opts.timeScale;   // the script's timers run 20 times faster
  const offset = (opts.now || NOW) - Date.now();
  const tamo = opts.tamoState || Object.assign(baseData(), { read: new Set() });
  E.tamo = tamo;
  const T = opts.tamo || {};
  if (opts.settings && !(SETTINGS in files)) files[SETTINGS] = JSON.stringify(opts.settings);
  let lastActivity = Date.now(), inflight = 0;
  const busy = () => { lastActivity = Date.now(); };

  // ── FileManager: one in-memory disk; iCloud paths can be slow (never delivered) ──
  const slow = (p) => p.startsWith(ICLOUD) && (opts.slowCloud || []).some((n) => p.endsWith("/" + n));
  const exists = (p) => p in files || dirs.has(p) || Object.keys(files).some((k) => k.startsWith(p + "/"));
  const asData = (buf) => new Data(buf);
  function fileManager(root, kind) {
    const guard = () => { if (kind === "icloud") { log.icloudCalls++; if (opts.noICloud) { errors.push("iCloud touched on a phone without iCloud"); throw new Error("iCloud is not supported"); } } };
    const m = {
      documentsDirectory: () => (guard(), root), temporaryDirectory: () => TMP, libraryDirectory: () => root.replace(/Documents$/, "Library"),
      joinPath: (a, b) => String(a).replace(/\/$/, "") + "/" + String(b).replace(/^\//, ""),
      fileExists: (p) => (guard(), exists(p)), isDirectory: (p) => dirs.has(p),
      createDirectory: (p) => { guard(); dirs.add(p); },
      readString: (p) => { guard(); if (!(p in files)) throw new Error(`The file “${path.basename(p)}” couldn’t be opened because there is no such file.`); if (slow(p)) throw new Error("not downloaded"); return Buffer.isBuffer(files[p]) ? files[p].toString() : String(files[p]); },
      writeString: (p, s) => { guard(); if (!p.startsWith(TMP)) busy(); files[p] = String(s); },
      read: (p) => { guard(); if (!(p in files)) throw new Error("no such file"); return asData(Buffer.isBuffer(files[p]) ? files[p] : Buffer.from(String(files[p]))); },
      write: (p, d) => { guard(); files[p] = d && d._buf ? d._buf : Buffer.from(String(d)); },
      readImage: (p) => { guard(); if (!(p in files)) throw new Error("no such file"); return { _image: p, size: new Size(96, 96) }; },
      writeImage: (p) => { guard(); files[p] = Buffer.from("PNG"); },
      listContents: (d) => { guard(); const pre = d.replace(/\/$/, "") + "/"; return [...new Set(Object.keys(files).filter((k) => k.startsWith(pre)).map((k) => k.slice(pre.length).split("/")[0]))]; },
      remove: (p) => { guard(); if (!p.startsWith(TMP)) busy(); for (const k of Object.keys(files)) if (k === p || k.startsWith(p + "/")) delete files[k]; dirs.delete(p); },
      isFileStoredIniCloud: (p) => (guard(), kind === "icloud" && p.startsWith(ICLOUD)),
      isFileDownloaded: (p) => (guard(), !slow(p)),
      downloadFileFromiCloud: (p) => { guard(); log.icloudDownloads = (log.icloudDownloads || []).concat(path.basename(p)); return slow(p) ? new Promise(() => {}) : Promise.resolve(); },
      fileSize: (p) => (p in files ? String(files[p]).length / 1000 : 0),
    };
    return m;
  }
  const localFm = fileManager(LOCAL, "local"), icloudFm = fileManager(ICLOUD, "icloud");

  // ── small Scriptable types ──
  class Data { constructor(buf) { this._buf = buf; } toBase64String() { return this._buf.toString("base64"); } toRawString() { return this._buf.toString("latin1"); } getBytes() { return [...this._buf]; }
    static fromJPEG() { return new Data(Buffer.from("JPEG-AVATAR")); } static fromPNG() { return new Data(Buffer.from("PNG")); }
    static fromBase64String(b) { return new Data(Buffer.from(String(b), "base64")); } static fromString(s) { return new Data(Buffer.from(String(s))); } }
  class Size { constructor(w, h) { this.width = w; this.height = h; } }
  class Rect { constructor(x, y, w, h) { Object.assign(this, { x, y, width: w, height: h }); } }
  class Point { constructor(x, y) { this.x = x; this.y = y; } }
  class Color { constructor(hex, alpha) { this.hex = hex; this.alpha = alpha == null ? 1 : alpha; } }
  class LinearGradient { constructor() { this.colors = []; this.locations = []; } }
  const Font = new Proxy({}, { get: (t, name) => (size) => ({ name: String(name), size }) });
  class DrawContext { constructor() { this.size = new Size(0, 0); } drawImageInRect() {} setFillColor() {} fillRect() {} setFont() {} setTextColor() {} setTextAlignedCenter() {} drawTextInRect() {}
    getImage() { return { _image: "drawn", size: this.size }; } }
  class DateFormatter { constructor() { this.dateFormat = "HH:mm"; }
    string(d) { const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
      return this.dateFormat === "HH:mm" ? `${p.hour}:${p.minute}` : `${p.day} ${p.month}`; } }

  // ── widgets: a tree that tests can read ──
  class WNode { constructor(kind) { this.kind = kind; this.children = []; }
    addStack() { return this._add(new WNode("stack")); }
    addText(t) { const n = this._add(new WNode("text")); n.text = String(t); n.centerAlignText = n.leftAlignText = n.rightAlignText = () => {}; return n; }
    addImage(img) { const n = this._add(new WNode("image")); n.image = img; return n; }
    addSpacer(n) { this._add(Object.assign(new WNode("spacer"), { length: n == null ? null : n })); }
    addDate(d) { const n = this._add(new WNode("date")); n.date = d; n.applyTimeStyle = n.applyRelativeStyle = () => {}; return n; }
    _add(n) { this.children.push(n); return n; }
    setPadding(...p) { this.padding = p; } layoutVertically() { this.vertical = true; } layoutHorizontally() { this.vertical = false; }
    centerAlignContent() { this.align = "center"; } topAlignContent() { this.align = "top"; } bottomAlignContent() { this.align = "bottom"; } }
  class ListWidget extends WNode { constructor() { super("widget"); this.vertical = true; } async presentMedium() {} async presentSmall() {} async presentLarge() {} }

  // ── Alert: answers queued by the test ──
  const answers = (opts.alerts || []).slice();
  E.alert = (...a) => answers.push(...a);
  class Alert {
    constructor() { this.title = ""; this.message = ""; this._fields = []; this._actions = []; }
    addTextField(placeholder, value) { this._fields.push({ placeholder, value: value || "", secure: false }); return { setDecimalPadKeyboard() {}, setNumberPadKeyboard() {} }; }
    addSecureTextField(placeholder, value) { this._fields.push({ placeholder, value: value || "", secure: true }); return {}; }
    addAction(t) { this._actions.push(t); } addDestructiveAction(t) { this._actions.push(t); } addCancelAction(t) { this._cancel = t; }
    async _present(style) {
      busy();
      let a = answers.length ? answers.shift() : undefined;
      const rec = { title: this.title, message: this.message, actions: this._actions.slice(), fields: this._fields.map((f) => f.placeholder), secure: this._fields.map((f) => f.secure), values: this._fields.map((f) => f.value), style, overWindow: !!log.presented };
      log.alerts.push(rec);
      if (a === undefined) { rec.unanswered = true; a = { cancel: true }; }   // nobody answered: like tapping Cancel
      if (Array.isArray(a)) a = { action: 0, text: a };
      if (typeof a === "number") a = { action: a };
      if (typeof a === "string") a = a === "cancel" ? { cancel: true } : { action: this._actions.indexOf(a) };
      this._text = a.text || [];
      rec.answer = a.cancel ? "cancel" : this._actions[a.action];
      return a.cancel ? -1 : a.action;
    }
    present() { return this._present("alert"); } presentAlert() { return this._present("alert"); } presentSheet() { return this._present("sheet"); }
    textFieldValue(i) { return this._text[i] != null ? String(this._text[i]) : this._fields[i] ? this._fields[i].value : ""; }
  }

  // ── Request: fixtures only ──
  class Request {
    constructor(url) { this.url = url; this.method = "GET"; this.headers = {}; this.body = undefined; this.timeoutInterval = 60; this.response = null; }
    async _go() {
      inflight++; busy();
      const rec = { url: this.url, method: this.method, headers: Object.assign({}, this.headers), body: this.body };
      log.requests.push(rec);
      log.timeline.push("request " + this.url.split("?")[0]);
      try {
        await new Promise((r) => setTimeout(r, opts.latency == null ? 2 : opts.latency));
        const res = route(rec, this);
        rec.status = res.status;
        this.response = { statusCode: res.status, url: this.url, headers: res.headers || {}, cookies: [] };
        if (res.fail) throw new Error(res.fail);
        return res;
      } finally { inflight--; busy(); }
    }
    async loadString() { const r = await this._go(); return r.text; }
    async loadJSON() { const r = await this._go(); return ctxJSON.parse(r.text); }
    async load() { const r = await this._go(); return new Data(Buffer.from(r.text || "")); }
    async loadImage() { const r = await this._go(); return { _image: this.url, size: new Size(1024, 1024) }; }
  }
  const json = (o, status = 200) => ({ status, text: JSON.stringify(o) });
  function route(req, r) {
    const url = req.url;
    let u;
    try { u = new URL(url); } catch (e) { return unmocked(); }
    function unmocked() {
      errors.push("UNMOCKED " + req.method + " " + url);
      process.stderr.write("UNMOCKED " + req.method + " " + url + "\n");
      return { status: 0, fail: "not mocked: " + url };
    }
    // TAMO
    if (u.hostname === "dienynas.tamo.lt" || u.hostname === "api.tamo.lt") return tamoRoute(req, u) || unmocked();
    // GitHub
    if (u.hostname === "raw.githubusercontent.com" && u.pathname.endsWith("/releases.json")) { log.updateChecks = (log.updateChecks || 0) + 1; return json(opts.releases || RELEASES); }
    if (u.hostname === "raw.githubusercontent.com" && u.pathname.endsWith("/Dienynas.js")) {
      const newest = (opts.releases || RELEASES).releases[0].version;
      return { status: 200, text: opts.updateScript || `// Dienynas+\nconst VERSION = '${opts.updateStale ? VERSION : newest}';\nconst APP_ID = 'dienynasplus';\n` };
    }
    if (u.hostname === "raw.githubusercontent.com" && u.pathname.endsWith("/docs/icon-1024.png")) return { status: 200, text: "PNG" };
    // AI
    if (u.hostname === "api.anthropic.com" || u.hostname === "api.openai.com") return aiRoute(req, u) || unmocked();
    // anonymous usage (PostHog)
    if (u.hostname === "us.i.posthog.com" && u.pathname === "/batch/") {
      const b = JSON.parse(req.body);
      log.usage.push(...b.batch);
      return json({ status: 1 });
    }
    return unmocked();
  }

  // ── TAMO: sign-in, roles and the diary, shaped like the API the official app uses ──
  function tamoRoute(req, u) {
    if (T.down) return { status: 0, fail: "The Internet connection appears to be offline." };
    const p = u.pathname, q = Object.fromEntries(u.searchParams);
    if (p === "/MobileServiceV3/AuthenticateV2") {
      const b = JSON.parse(req.body || "{}");
      log.logins = (log.logins || 0) + 1;
      if (T.badLogin || b.password === "wrong-password" || !b.username) return json({ Status: "0", ErrorCode: "1", ErrorMessage: "Bad credentials" });
      const token = "tok-" + ++counter;
      issuedTokens.add(token);
      return json({ Status: "1", ErrorCode: "0", Result: { authToken: token, userRoleIsAllowed: true, personId: "100200", role: "3", firstName: "Demo", lastName: "Tėvai" } });
    }
    if (p === "/MobileServiceV3/GetFileUrl") return json({ Status: "1", ErrorCode: "0", Result: { url: "https://files.tamo.lt/legacy/" + q.fileId + ".pdf" } });
    // api.tamo.lt: every call needs a token TAMO issued
    const auth = String(req.headers.Authorization || "");
    if (!issuedTokens.has(auth.replace(/^Bearer /, ""))) return json({ message: "User is not authenticated." }, 401);
    if ((T.fail || []).some((f) => p.includes(f))) return json({ isSuccess: false, message: "Server error" }, 500);
    if ((T.deny || []).some((f) => p.includes(f))) return json({ isSuccess: false }, 403);
    const child = roleIds.get(req.headers["x-selected-role"]) || 0;
    if (p === "/core/app/settings/StyleRef") return json({ isSuccess: true });
    if (p === "/core/app/roles") {
      const kids = T.children === 2 ? CHILDREN : CHILDREN.slice(0, 1);
      return json({ isSuccess: true, roles: kids.map((c, i) => { const id = "role-" + ++counter; roleIds.set(id, i); return { id, title: c.title, subtitle: c.subtitle, active: i === 0, childStudentId: "30040" + i }; }) });
    }
    log.tamoChild = (log.tamoChild || []).concat(child);
    if (p === "/v2/app/calendar/events") {
      const monday = String(q.date).slice(0, 10);
      log.weeks = (log.weeks || []).concat(monday);
      return json({ isSuccess: true, formatives: [], days: [0, 1, 2, 3, 4].map((i) => { const d = addDays(monday, i); return { date: d + "T00:00:00", events: lessonsOn(tamo, d) }; }) });
    }
    if (p === "/core/app/darbai") {
      if (q.workType === "class") {
        const out = [];
        for (let d = q.dateFrom; d <= q.dateTo; d = addDays(d, 1)) lessonsOn(tamo, d).forEach((l) => out.push({ lessonId: l.id, thingName: l.eventTitle.content, homeWork: "Klasėje: " + l.eventDescription.content, date: d + "T00:00:00", deadline: d + "T00:00:00", completionDate: d + "T00:00:00" }));
        return json({ isSuccess: true, items: out });
      }
      return json({ isSuccess: true, items: tamo.homework.filter((h) => inRange(h.set, q.dateFrom, q.dateTo) || inRange(h.due, q.dateFrom, q.dateTo)).map((h) => ({
        lessonId: lessonId(h), thingName: h.s, homeWork: h.t, date: h.set + "T00:00:00", deadline: h.due + "T00:00:00", completionDate: h.done ? h.done + "T18:20:00" : null,
        files: h.f ? [{ fileName: h.f, fileSid: "f-" + h.id }] : [] })) });
    }
    if (p === "/core/app/feeds") return json({ isSuccess: true, result: tamo.feed });
    if (p === "/core/app/dienynas") return json({ isSuccess: true,
      items: tamo.grades.filter((g) => inRange(g[0], q.dateFrom, q.dateTo)).map((g) => ({ subjectDate: g[0] + "T00:00:00", subject: g[1], assessmentValue: g[2], assessmentType: g[3] || "" }))
        .concat(tamo.attendance.filter((a) => inRange(a[0], q.dateFrom, q.dateTo)).map((a) => ({ subjectDate: a[0] + "T00:00:00", subject: a[1], attendanceValue: a[2] }))),
      formativeGrades: tamo.formatives.filter((f) => inRange(f[0], q.dateFrom, q.dateTo)).map((f) => ({ date: f[0], subject: f[1], title: f[2], type: f[3] })) });
    if (p === "/core/app/calendar/events/allDay") return json({ isSuccess: true, allDayEvents: tamo.allDay.filter((e) => e.to >= (q.dateFrom || "") && e.from <= (q.dateTo || "9999")).map((e) => ({
      eventTitle: { content: e.t }, eventLabel: { content: e.l }, eventSubtitle: { content: "" }, timeFromUtc: utc(e.from, "00:00"), timeToUtc: utc(e.to, "23:59") })) });
    let m;
    if ((m = /^\/messaging\/messages\/received\/(\d+)\/(\w+)$/.exec(p))) {
      const msg = tamo.messages.find((x) => x.id === m[2]);
      if (!msg) return json({ message: "Not found" }, 404);
      log.tamoRead.push(msg.id); tamo.read.add(msg.id);   // opening a message marks it as read in TAMO
      return json({ item: { body: msg.body || "", attachments: msg.att ? [{ name: msg.att, sid: "att-" + msg.id }] : [], recipientSets: [{ title: "5A klasės tėvai" }] } });
    }
    if (p === "/messaging/messages/received") return json({ items: q.page === "1" ? tamo.messages.filter((x) => !x.group).map((x) => msgItem(x, tamo.read)) : [] });
    if (p === "/messaging/messages/group/received") return json({ items: tamo.messages.filter((x) => x.group).map((x) => msgItem(x, tamo.read)) });
    if (p === "/files/filedownloadurl") {
      const sid = new URLSearchParams(req.body || "").get("fileSid");
      return json({ isSuccess: true, url: "https://files.tamo.lt/download/" + sid + ".pdf" });
    }
    return null;
  }

  // ── AI: fixed answers per kind of prompt; every request is kept in E.log.ai ──
  function aiRoute(req, u) {
    const provider = u.hostname === "api.openai.com" ? "openai" : "anthropic";
    const key = provider === "openai" ? String(req.headers.Authorization || "").replace(/^Bearer /, "") : req.headers["x-api-key"];
    if (u.pathname === "/v1/models") {
      log.modelLists = (log.modelLists || []).concat(provider);
      return provider === "openai"
        ? json({ data: [{ id: "gpt-5.4-mini", created: 1780000000 }, { id: "gpt-5.4", created: 1781000000 }, { id: "text-embedding-3-small", created: 1700000000 }, { id: "gpt-4o-realtime-preview", created: 1720000000 }] })
        : json({ data: [{ id: "claude-haiku-5-5", display_name: "Claude Haiku 5.5", created_at: "2026-09-01T00:00:00Z" }, { id: "claude-sonnet-5-5", display_name: "Claude Sonnet 5.5", created_at: "2026-09-02T00:00:00Z" }] });
    }
    if (!/\/v1\/(messages|chat\/completions)$/.test(u.pathname)) return null;
    const body = JSON.parse(req.body);
    const system = provider === "openai" ? (body.messages[0] || {}).content : body.system;
    const convo = provider === "openai" ? body.messages.slice(1) : body.messages;
    const q = String((convo[convo.length - 1] || {}).content || "");
    const kind = /single word OK/.test(system) ? "test" : /assistant inside Tamo\+/.test(system) ? "ask" : "other";
    log.ai.push({ provider, kind, key, body, system, question: q });
    if (opts.aiError) return json({ type: "error", error: { type: "api_error", message: opts.aiError } }, 429);
    let text = "OK";
    if (kind === "ask") text = /due tomorrow|rytojui/i.test(q)
      ? "Tomorrow, **Friday 30 October**:\n- **Matematika**: *Vadovėlis p. 48, 3–7 užd.*\n- **Lietuvių kalba**: read the tale up to chapter 5\nThe maths lesson is a *Kontrolinis darbas* (test)."
      : /tests?|kontrolin/i.test(q) ? "Two in the next two weeks:\n- **Fri 30 Oct**, Matematika: *Kontrolinis darbas*\n- **Wed 4 Nov**, Anglų kalba: *Žodžių diktantas*"
      : "From the TAMO data: nothing more on that.";
    if (opts.aiEmpty && kind === "ask") text = "";
    return provider === "openai"
      ? json({ id: "chatcmpl-test", choices: [{ message: { role: "assistant", content: text } }], usage: { prompt_tokens: 15000, completion_tokens: 150 } })
      : json({ id: "msg_test", type: "message", role: "assistant", content: [{ type: "text", text }], usage: { input_tokens: 15000, output_tokens: 150 } });
  }

  // ── WebView: one jsdom page per loadHTML; navigations go to shouldAllowRequest ──
  let shown = null;   // the WebView on screen
  class WebView {
    constructor() { this.shouldAllowRequest = null; this.dom = null; log.webviews = (log.webviews || 0) + 1; }
    async loadHTML(html, baseURL) {
      busy();
      if (this.dom) { try { this.dom.window.close(); } catch (e) {} }
      const kind = !/<script/i.test(html) ? "blank" : /window\.__boot = function/.test(html) ? "app" : "message";
      log.pages.push(kind);
      log.timeline.push("page " + kind);
      this.html = html;
      if (kind === "blank" && log.pages.length === 1) log.blankFirst = true;
      const vc = new VirtualConsole();
      vc.on("jsdomError", (e) => { if (!/Not implemented/.test(e.message)) log.jsErrors = (log.jsErrors || []).concat(String((e.detail && e.detail.stack) || e.stack || e.message).split("\n").slice(0, 4).join(" ")); });
      vc.on("error", (...a) => log.pageConsole.push(a.join(" ")));
      vc.on("warn", (...a) => log.pageConsole.push(a.join(" ")));
      const self = this;
      this.dom = new JSDOM(html, { runScripts: "dangerously", pretendToBeVisual: true, url: baseURL || "https://app.scriptable.local/", virtualConsole: vc,
        beforeParse(w) {
          const RD = w.Date;
          w.Date = class extends RD { constructor(...a) { if (a.length) super(...a); else super(RD.now() + offset); } static now() { return RD.now() + offset; } };
          w.matchMedia = (q) => ({ matches: !!opts.dark && /dark/.test(q), media: q, addEventListener() {}, removeEventListener() {}, addListener() {} });
          w.scrollTo = () => {};
          w.alert = (m) => log.pageAlerts.push(String(m));
          w.__scriptableNav = (url) => self._navigate(url);
        } });
    }
    _navigate(url) {
      busy();
      log.navigations.push(url);
      const allow = typeof this.shouldAllowRequest === "function" ? this.shouldAllowRequest({ url, navigationType: "linkActivated" }) : true;
      if (allow !== false && !/^tamo:/.test(url)) log.leftPage = (log.leftPage || []).concat(url);   // the window would have navigated away
    }
    present() { busy(); shown = this; log.presented = (log.presented || 0) + 1; return this._closed || (this._closed = new Promise((r) => { this._close = r; })); }
    async evaluateJavaScript(js) {
      busy();
      if (!this.dom) throw new Error("no page loaded");
      log.evals = (log.evals || []).concat(String(js).slice(0, 40));
      const fail = /^window\.bridgeReply && window\.bridgeReply\((\d+), false, (.*)\)$/s.exec(String(js));
      if (fail) log.bridgeFailures = (log.bridgeFailures || []).concat(fail[2].slice(0, 160));   // the script answered a page request with an error
      try { return this.dom.window.eval(js); }
      catch (e) { log.jsErrors = (log.jsErrors || []).concat("evaluateJavaScript: " + String(e.stack || e).split("\n")[0]); throw e; }
    }
  }

  const ctxConsole = { log: (...a) => log.console.push(a.join(" ")), warn: (...a) => log.console.push("warn: " + a.join(" ")),
    error: (...a) => errors.push("console.error: " + a.join(" ")) };
  const family = opts.widget ? (opts.family || "medium") : null;
  const env = {
    console: ctxConsole,
    FileManager: { local: () => localFm, iCloud: () => { log.icloudCalls++; if (opts.noICloud) errors.push("FileManager.iCloud() called on a phone without iCloud"); return icloudFm; } },
    Keychain: { contains: (k) => k in kc, get: (k) => { if (!(k in kc)) throw new Error("No item with key " + k); return kc[k]; }, set: (k, v) => { kc[k] = String(v); }, remove: (k) => { if (!(k in kc)) throw new Error("No item with key " + k); delete kc[k]; } },
    Request, Alert, WebView,
    Notification: class { constructor() { this.title = ""; this.body = ""; } async schedule() { log.notifications.push({ title: this.title, body: this.body, openURL: this.openURL, thread: this.threadIdentifier }); } static async removeAllPending() {} },
    Safari: { open: (url) => { log.safari.push(url); }, openInApp: async (url) => { log.safari.push(url); } },
    Photos: { fromLibrary: async () => { log.photos++; if (opts.photoCancel) throw new Error("cancelled"); return { _image: "photo", size: new Size(1200, 900) }; } },
    Script: { setWidget: (w) => log.widgets.push(w), setShortcutOutput: (v) => { log.shortcutOutput = v; }, complete: () => { log.completed = true; }, name: () => "Dienynas" },
    URLScheme: { forRunningScript: () => "scriptable:///run/Dienynas" },
    Device: { isUsingDarkAppearance: () => !!opts.dark, locale: () => "en_LT", language: () => "en", model: () => "iPhone" },
    UUID: { string: () => "8F2C1A9E-0000-4000-8000-00000000AB12" },
    Timer: { schedule: (ms, repeats, fn) => {
      const run = () => { try { fn(); } catch (e) { errors.push("TIMER " + (e.stack || e)); } };
      const t = Math.max(1, ms * scale), id = repeats ? setInterval(run, t) : setTimeout(run, t);
      return { invalidate: () => (repeats ? clearInterval(id) : clearTimeout(id)) };
    } },
    Data, Size, Rect, Point, Color, LinearGradient, Font, DrawContext, DateFormatter, ListWidget,
    config: { runsInApp: !family && opts.inApp !== false, runsInWidget: !!family && !family.startsWith("accessory"), runsInAccessoryWidget: !!family && family.startsWith("accessory"),
      runsWithSiri: false, runsFromHomeScreen: false, widgetFamily: family },
    args: { widgetParameter: opts.widgetParameter == null ? null : opts.widgetParameter, queryParameters: opts.query || {}, shortcutParameter: opts.shortcutParameter == null ? null : opts.shortcutParameter, plainTexts: opts.plainTexts || [], images: [], urls: [], fileURLs: [] },
    module: { filename: (opts.noICloud ? LOCAL : ICLOUD) + "/Dienynas.js", exports: {} },
  };
  const ctx = vm.createContext(env);
  vm.runInContext(`(() => { const RD = Date, off = ${offset}; class D extends RD { constructor(...a) { if (a.length) super(...a); else super(RD.now() + off); } static now() { return RD.now() + off; } } globalThis.Date = D; })();`, ctx);
  const ctxJSON = vm.runInContext("JSON", ctx);

  // ── helpers for the scenarios ──
  E.ctx = ctx;
  E.getDom = () => shown && shown.dom;
  E.html = () => shown && shown.html;
  E.$ = (s) => { const d = E.getDom(); return d ? d.window.document.querySelector(s) : null; };
  E.$$ = (s) => { const d = E.getDom(); return d ? [...d.window.document.querySelectorAll(s)] : []; };
  E.text = (s) => { const el = typeof s === "string" ? E.$(s) : s; return el ? el.textContent.replace(/\s+/g, " ").trim() : ""; };
  E.tap = (s) => {
    const el = typeof s === "string" ? E.$(s) : s;
    if (!el) throw new Error("nothing to tap: " + s);
    el.click();
    return el;
  };
  E.tapText = (sel, text) => { const el = E.$$(sel).find((x) => x.textContent.includes(text)); if (!el) throw new Error(`no ${sel} with "${text}"`); return E.tap(el); };
  E.input = (s, value, type = "change") => { const el = E.$(s); el.value = value; el.dispatchEvent(new (E.getDom().window.Event)(type, { bubbles: true })); return el; };
  E.finish = () => { if (shown && shown._close) shown._close(); };
  E.check = (ok, label) => { if (!ok) errors.push("CHECK FAILED: " + label); return ok; };
  E.until = async (fn, label, ms = 8000) => {
    const t0 = Date.now();
    for (;;) { let v; try { v = fn(); } catch (e) { v = null; } if (v) return v; if (Date.now() - t0 > ms) { errors.push("TIMED OUT waiting for " + label); return null; } await wait(20); }
  };
  // Waits until nothing has happened for a moment: no request in flight, no page loaded, no bridge call.
  // (a tap's bridge call starts a moment later, in a microtask, so it waits a little before looking)
  E.settle = async (quiet = 350, ms = 15000) => { await wait(40); const t0 = Date.now(); while (Date.now() - t0 < ms) { if (!inflight && Date.now() - lastActivity >= quiet) return; await wait(25); } errors.push("never settled"); };
  E.json = (p) => (p in files ? JSON.parse(String(files[p])) : null);
  E.settings = () => E.json(env.module.filename.startsWith(ICLOUD) ? SETTINGS : LOCAL + "/DienynasPlus/settings.json");
  E.requests = (re) => log.requests.filter((r) => re.test(r.url));
  E.toast = () => E.text("#aitoast");
  E.lastAlert = () => log.alerts[log.alerts.length - 1] || {};
  E.widgetText = (w = log.widgets[log.widgets.length - 1]) => { const out = []; (function walk(n) { if (!n) return; if (n.kind === "text") out.push(n.text); (n.children || []).forEach(walk); })(w); return out; };
  E.problems = () => errors.slice();
  return { E, env, ctx };
}

// Starts the script; returns { E, p }: E is the phone (files, Keychain, log, page helpers), p settles when the script ends.
async function run(opts = {}) {
  const { E, ctx } = makeEnv(opts);
  current = E;
  const p = vm.runInContext(`(async () => {\n${SRC}\n})()`, ctx, { filename: path.basename(SCRIPT) });
  p.catch((e) => E.errors.push("SCRIPT " + ((e && e.stack) || e)));
  return { E, p: Promise.resolve(p).catch(() => {}) };
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
// The line every scenario ends with; run.js reads it.
function report(E) {
  console.log("errors:", E.errors.length ? E.errors.join(" ; ") : "none", "| JS errors:", E.log.jsErrors || "none");
}

module.exports = { run, makeEnv, wait, report, quiet, releasesWithOffer, signedIn, withKey, KEYS, NOW, VERSION, RELEASES, ICLOUD, LOCAL, TMP, SETTINGS, local, hashKey, CHILDREN, roleKeyOf };
