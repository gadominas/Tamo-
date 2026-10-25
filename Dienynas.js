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
 * Run as an app for the full UI; add it as a Scriptable widget for a glanceable "today" view.
 *
 * Unofficial: TAMO's terms of use do not cover third-party clients. Use with your own account only.
 */

const APP_NAME = "Dienynas+";
const ZONE = "Europe/Vilnius";
const MODERN = "https://api.tamo.lt/";
const LEGACY = "https://dienynas.tamo.lt/MobileServiceV3/";
const APP_GUID = "1166cfd3-1be5-4dca-aa64-5aff7bbb8acc"; // build constant the official Android app sends
const SESSION_TTL_MIN = 25;
const WIDGET_CACHE_MIN = 30;

const K = {
  user: "dienynasplus.username",
  pass: "dienynasplus.password",
  role: "dienynasplus.role",
  lang: "dienynasplus.lang",
  session: "dienynasplus.session",
  aiKey: "dienynasplus.openai-key",
  scale: "dienynasplus.grade-scale",
};

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
    req.timeoutInterval = 25;
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

// ───────────────────────────── language ─────────────────────────────

const LANG = () => (Keychain.contains(K.lang) ? Keychain.get(K.lang) : "en");
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
    aiKeyAdd: "Add OpenAI key for Ask",
    aiKeyRemove: "Remove OpenAI key",
    aiKeyTitle: "OpenAI API key",
    aiKeyMsg: "Used by Ask. It stays in this phone's Keychain and is only sent to OpenAI, together with the school data needed to answer.",
    aiKeyBad: "That doesn't look like an OpenAI key (it starts with sk-).",
    aiNoData: "School data hasn't loaded yet. Refresh and try again.",
    aiQuota: "OpenAI rate limit or quota reached. Try again in a minute, or check billing on platform.openai.com.",
    aiOffline: "Could not reach OpenAI. Check the internet connection.",
    aiEmpty: "OpenAI returned an empty answer. Try asking again.",
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
    aiKeyAdd: "Pridėti OpenAI raktą klausimams",
    aiKeyRemove: "Pašalinti OpenAI raktą",
    aiKeyTitle: "OpenAI API raktas",
    aiKeyMsg: "Naudojamas skiltyje „Klausk“. Saugomas šio telefono Keychain ir siunčiamas tik į OpenAI kartu su atsakymui reikalingais mokyklos duomenimis.",
    aiKeyBad: "Tai nepanašu į OpenAI raktą (jis prasideda sk-).",
    aiNoData: "Mokyklos duomenys dar neįkelti. Atnaujinkite ir bandykite dar kartą.",
    aiQuota: "Pasiektas OpenAI užklausų ar apmokėjimo limitas. Bandykite po minutės arba patikrinkite platform.openai.com.",
    aiOffline: "Nepavyko susisiekti su OpenAI. Patikrinkite interneto ryšį.",
    aiEmpty: "OpenAI grąžino tuščią atsakymą. Paklauskite dar kartą.",
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
:root{
  --paper:#EEF1F6; --card:#FFFFFF; --ink:#15203A; --muted:#5F6A84; --faint:#8D96AB; --line:#DCE1EA;
  --mark:#FFD84D; --markInk:#3B2F00; --red:#C8243A; --green:#14866A; --blue:#2450B8; --chip:#E4E9F2;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark){
  :root{ --paper:#0C111C; --card:#161E2E; --ink:#E8ECF4; --muted:#9AA4BA; --faint:#6E7891; --line:#253049;
    --mark:#F0C52E; --markInk:#2A2100; --red:#FF6B7D; --green:#3CC59E; --blue:#7FA3FF; --chip:#212B40; }
}
*{box-sizing:border-box;-webkit-tap-highlight-color:transparent}
html,body{margin:0;background:var(--paper);color:var(--ink);touch-action:pan-x pan-y;-webkit-user-select:none;user-select:none}
.body,.text,.detail p{-webkit-user-select:text;user-select:text}
body{font:16px/1.4 -apple-system,"SF Pro Text",system-ui,sans-serif;padding:env(safe-area-inset-top) 0 calc(78px + env(safe-area-inset-bottom));-webkit-text-size-adjust:100%}
button{font:inherit;color:inherit;background:none;border:0;padding:0;cursor:pointer}
button:focus-visible{outline:2px solid var(--blue);outline-offset:2px;border-radius:8px}
.num{font-family:ui-rounded,"SF Pro Rounded",-apple-system,sans-serif;font-variant-numeric:tabular-nums}
header.top{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;padding:18px 18px 6px}
.who{font-size:13px;color:var(--muted);line-height:1.3}
.who b{color:var(--ink);font-weight:600;font-size:15px;display:block}
.tools{display:flex;gap:6px}
.icon-btn{width:38px;height:38px;border-radius:19px;background:var(--card);display:grid;place-items:center;border:1px solid var(--line)}
.icon-btn svg{width:19px;height:19px;stroke:var(--ink);fill:none;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.icon-btn.spin svg{animation:spin 1s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
h1.date{font:800 30px/1.08 ui-rounded,"SF Pro Rounded",-apple-system,sans-serif;letter-spacing:-.02em;margin:4px 18px 2px}
.sub{margin:0 18px 14px;color:var(--muted);font-size:15px}
main{padding:0 14px}
section{margin:18px 0 0}
h2{font-size:19px;font-weight:700;margin:0 4px 8px;letter-spacing:-.01em;display:flex;justify-content:space-between;align-items:baseline}
h2 small{font-size:14px;font-weight:500;color:var(--muted)}
.panel{background:var(--card);border-radius:16px;border:1px solid var(--line);overflow:hidden}
.row{display:flex;gap:12px;padding:12px 14px;border-top:1px solid var(--line);align-items:flex-start;text-align:left;width:100%}
.row:first-child{border-top:0}
.row .main{flex:1;min-width:0}
.row .title{font-weight:600}
.row .meta{color:var(--muted);font-size:14px}
.row .body{font-size:15px;margin-top:3px;white-space:pre-wrap;overflow-wrap:anywhere}
.empty{padding:16px 14px;color:var(--muted);font-size:15px}
.bar{width:5px;align-self:stretch;border-radius:3px;flex:none}
.pill{display:inline-block;font-size:12.5px;font-weight:600;padding:2px 8px;border-radius:999px;background:var(--chip);color:var(--ink);margin:4px 4px 0 0;white-space:nowrap}
.pill.red{background:color-mix(in srgb,var(--red) 16%,transparent);color:var(--red)}
.pill.green{background:color-mix(in srgb,var(--green) 16%,transparent);color:var(--green)}
.pill.mark{background:var(--mark);color:var(--markInk)}
.pill.grade{font-family:ui-rounded,-apple-system,sans-serif;font-size:14px;padding:1px 9px}
.dot{width:9px;height:9px;border-radius:5px;background:var(--blue);flex:none;margin-top:7px}
.dot.off{background:transparent}
/* Now card: the one loud element */
.now{background:var(--mark);color:var(--markInk);border-radius:20px;padding:16px 18px;position:relative;overflow:hidden}
.now .k{font-size:14px;font-weight:600;opacity:.75}
.now .s{font:800 26px/1.1 ui-rounded,-apple-system,sans-serif;margin:2px 0 4px;letter-spacing:-.01em}
.now .m{font-size:15px;font-weight:500}
.now .progress{position:absolute;left:0;bottom:0;height:6px;background:var(--markInk);opacity:.85}
.now.quiet{background:var(--card);color:var(--ink);border:1px solid var(--line)}
.now.quiet .k{color:var(--muted);opacity:1}
/* Lesson timeline */
.lesson{display:flex;gap:12px;padding:11px 14px;border-top:1px solid var(--line);width:100%;text-align:left;cursor:pointer}
.lesson:first-child{border-top:0}
.lesson .n{width:30px;height:30px;border-radius:15px;display:grid;place-items:center;font-weight:700;font-size:15px;color:#fff;flex:none}
.lesson .when{font-size:13px;color:var(--muted)}
.lesson.past{opacity:.55}
.lesson.current{background:color-mix(in srgb,var(--mark) 28%,transparent)}
.lesson .more{display:none;margin-top:6px}
.lesson.open .more{display:block}
.detail{margin-top:8px;font-size:15px}
.detail b{font-weight:600;display:block;font-size:13px;color:var(--muted)}
.detail p{margin:2px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}
.file{display:inline-flex;gap:6px;align-items:center;font-size:14px;color:var(--blue);font-weight:600;margin:6px 10px 0 0}
.chips{display:flex;flex-wrap:wrap;gap:6px;padding:12px 14px}
.chip{display:inline-flex;align-items:center;gap:6px;background:var(--chip);border-radius:999px;padding:5px 11px;font-size:14px;font-weight:600}
.chip i{width:8px;height:8px;border-radius:4px;display:inline-block}
/* Segmented + week nav */
.seg{display:flex;background:var(--chip);border-radius:12px;padding:3px;margin:0 0 12px}
.seg button{flex:1;padding:7px 4px;border-radius:9px;font-size:14px;font-weight:600;color:var(--muted)}
.seg button.on{background:var(--card);color:var(--ink);box-shadow:0 1px 2px rgba(0,0,0,.12)}
.weeknav{display:flex;align-items:center;justify-content:space-between;margin:0 0 10px}
.weeknav .lbl{font-weight:700;font-size:17px;text-align:center}
.weeknav .lbl small{display:block;font-weight:500;color:var(--muted);font-size:13px}
.days{display:grid;grid-template-columns:repeat(var(--cols,5),1fr);gap:6px;margin:0 0 12px}
.day{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:8px 0 7px;text-align:center}
.day .w{font-size:12.5px;color:var(--muted);font-weight:600}
.day .d{font-size:20px;font-weight:800}
.day .c{font-size:11.5px;color:var(--faint)}
.day.on{background:var(--ink);border-color:var(--ink)}
.day.on .w,.day.on .d,.day.on .c{color:var(--card)}
.day.today .d{text-decoration:underline;text-decoration-color:var(--mark);text-decoration-thickness:4px;text-underline-offset:3px}
/* Message week chart */
.chart{display:grid;grid-template-columns:repeat(7,1fr);gap:6px;align-items:end;padding:14px 12px 10px}
.chart button{display:flex;flex-direction:column;align-items:center;gap:4px}
.chart .col{width:100%;max-width:34px;border-radius:8px 8px 4px 4px;background:var(--chip);position:relative;min-height:6px}
.chart .col.has{background:var(--blue)}
.chart .col .u{position:absolute;left:0;right:0;bottom:0;background:var(--mark);border-radius:0 0 4px 4px}
.chart .cnt{font-size:14px;font-weight:700}
.chart .w{font-size:12px;color:var(--muted);font-weight:600}
.chart button.on .w{color:var(--ink);text-decoration:underline;text-decoration-thickness:3px;text-decoration-color:var(--mark);text-underline-offset:3px}
/* Grades */
.avg{display:flex;align-items:center;gap:12px;padding:10px 14px;border-top:1px solid var(--line)}
.avg:first-child{border-top:0}
.avg .s{flex:1;font-weight:600;min-width:0}
.avg .track{flex:1.2;height:8px;border-radius:4px;background:var(--chip);overflow:hidden}
.avg .fill{height:100%;border-radius:4px}
.avg .v{width:40px;text-align:right;font-weight:800;font-size:17px}
/* Tab bar */
nav.tabs{position:fixed;left:0;right:0;bottom:0;display:flex;background:color-mix(in srgb,var(--card) 92%,transparent);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border-top:1px solid var(--line);padding:6px 4px calc(6px + env(safe-area-inset-bottom))}
nav.tabs button{flex:1;display:flex;flex-direction:column;align-items:center;gap:2px;font-size:11px;font-weight:600;color:var(--faint);position:relative;padding:4px 0}
nav.tabs svg{width:24px;height:24px;stroke:currentColor;fill:none;stroke-width:1.9;stroke-linecap:round;stroke-linejoin:round}
nav.tabs button.on{color:var(--blue)}
nav.tabs .badge{position:absolute;top:0;left:calc(50% + 6px);background:var(--red);color:#fff;font-size:11px;font-weight:700;border-radius:9px;min-width:18px;height:18px;padding:0 5px;display:grid;place-items:center}
/* Sheet */
.scrim{position:fixed;inset:0;background:rgba(0,0,0,.35);display:none;z-index:10}
.sheet{position:fixed;left:0;right:0;bottom:0;max-height:88vh;overflow:auto;background:var(--card);border-radius:20px 20px 0 0;padding:16px 18px calc(24px + env(safe-area-inset-bottom));transform:translateY(100%);visibility:hidden;transition:transform .25s ease,visibility 0s linear .25s;z-index:11}
.open-sheet .scrim{display:block}
.open-sheet .sheet{transform:none;visibility:visible;transition:transform .25s ease}
.sheet .x{float:right;font-weight:600;color:var(--blue)}
.sheet h3{font-size:20px;margin:28px 0 4px;line-height:1.25}
.sheet .meta{color:var(--muted);font-size:14px}
.sheet .text{white-space:pre-wrap;overflow-wrap:anywhere;font-size:16px;line-height:1.5;margin-top:14px}
.banner{margin:12px 4px 0;padding:10px 12px;border-radius:12px;background:color-mix(in srgb,var(--red) 12%,transparent);color:var(--red);font-size:14px}
.banner.info{background:var(--chip);color:var(--ink)}
footer{color:var(--faint);font-size:12.5px;text-align:center;margin:22px 0 8px}
/* Ask */
.icon-btn.on{background:var(--blue);border-color:var(--blue)}
.icon-btn.on svg{stroke:#fff}
.askwrap{display:flex;flex-direction:column;min-height:calc(100vh - 190px - env(safe-area-inset-top) - env(safe-area-inset-bottom))}
.chat{flex:1;display:flex;flex-direction:column;gap:10px;padding-top:14px}
.intro{color:var(--muted);font-size:15px;margin:2px 4px 12px}
.sugg{display:flex;flex-wrap:wrap;gap:8px}
.sugg button{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:8px 12px;font-size:15px;text-align:left}
.bubble{max-width:88%;padding:10px 13px;border-radius:18px;font-size:16px;line-height:1.45;overflow-wrap:anywhere;-webkit-user-select:text;user-select:text}
.bubble.user{align-self:flex-end;background:var(--blue);color:#fff;border-bottom-right-radius:6px;white-space:pre-wrap}
.bubble.assistant{align-self:flex-start;background:var(--card);border:1px solid var(--line);border-bottom-left-radius:6px}
.bubble.error{align-self:flex-start;background:color-mix(in srgb,var(--red) 12%,transparent);color:var(--red)}
.bubble p{margin:0 0 6px}.bubble p:last-child{margin:0}
.bubble ul{margin:4px 0 6px;padding-left:20px}.bubble li{margin:2px 0}
.typing{display:inline-flex;gap:4px;align-items:center}
.typing i{width:7px;height:7px;border-radius:4px;background:var(--faint);animation:blink 1.2s infinite}
.typing i:nth-child(2){animation-delay:.2s}.typing i:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,80%,100%{opacity:.25}40%{opacity:1}}
.mem{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:12px 14px;margin:10px 0 12px;font-size:14px}
.mem.err{color:var(--red)}
.mem-h{display:flex;justify-content:space-between;align-items:baseline;gap:8px}
.mem-h span{color:var(--faint);font-size:13px}
.mem-p{color:var(--muted);margin-top:4px;line-height:1.4}
.mem-a{display:flex;gap:18px;margin-top:8px}
.lnk{color:var(--blue);font-weight:600;font-size:14px}
.lnk.red{color:var(--red)}
.keycard{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:14px;font-size:15px}
.keycard p{margin:0 0 10px;color:var(--muted)}
.keyrow{display:flex;gap:8px}
.keyrow input{flex:1;min-width:0;font:16px -apple-system,sans-serif;padding:10px 12px;border-radius:12px;border:1px solid var(--line);background:var(--paper);color:var(--ink);-webkit-user-select:text;user-select:text}
.keyrow button,.newchat{background:var(--ink);color:var(--card);border-radius:12px;padding:10px 14px;font-weight:700}
.newchat{background:var(--chip);color:var(--ink);font-size:14px;padding:6px 12px;border-radius:999px}
.composer{position:sticky;bottom:calc(72px + env(safe-area-inset-bottom));display:flex;gap:8px;align-items:flex-end;padding:12px 0 8px;background:linear-gradient(to bottom,transparent,var(--paper) 35%)}
.composer textarea{flex:1;font:16px/1.35 -apple-system,"SF Pro Text",sans-serif;padding:10px 14px;border-radius:21px;border:1px solid var(--line);background:var(--card);color:var(--ink);resize:none;height:44px;max-height:130px;-webkit-user-select:text;user-select:text;outline:none}
.composer textarea:focus{border-color:var(--blue)}
.composer .send{width:44px;height:44px;border-radius:22px;background:var(--blue);display:grid;place-items:center;flex:none}
.composer .send:disabled{opacity:.4}
.composer .send svg{width:20px;height:20px;stroke:#fff;fill:none;stroke-width:2.4;stroke-linecap:round;stroke-linejoin:round}
.askhint{color:var(--faint);font-size:12.5px;text-align:center;margin:2px 0 0}
@media (prefers-reduced-motion: reduce){ .sheet{transition:none} .icon-btn.spin svg{animation:none} .typing i{animation:none;opacity:.6} }
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
      keyHelp: "Paste your OpenAI API key once. It stays in this phone's Keychain and is only sent to OpenAI, together with the school data needed to answer.",
      keySave: "Save", keyBad: "That doesn't look like an OpenAI key (it starts with sk-).", askFailed: (e) => `Couldn't answer: ${e}`,
      askHint: "AI answers can be wrong. Check important dates in TAMO.",
      memTitle: "In this chat",
      memLine: (i, range, from) => `Lessons: ${i.lessons} (${range}). Homework: ${i.homework}. Grades and assessments: ${i.grades}. Attendance marks: ${i.absences}. Messages: ${i.messages} (${i.bodies} with text). Calendar dates: ${i.events}. Since ${from}.`,
      memUpdated: (t) => `pulled ${t}`, memRefresh: "Refresh data", memClear: "Clear memory", memClearConfirm: "Tap again to clear",
      memNote: "The whole conversation is kept on this phone and sent with every question, so earlier answers aren't forgotten.",
      gathering: "Pulling everything from TAMO…", gatherFailed: (e) => `Couldn't pull the data: ${e}`,
      stages: { schedule: "Lessons", homework: "Homework", grades: "Grades and attendance", calendar: "School calendar", messages: "Messages" },
      scaleLbl: (m) => `Scale 1–${m}`,
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
      keyHelp: "Vieną kartą įklijuokite OpenAI API raktą. Jis saugomas šio telefono Keychain ir siunčiamas tik į OpenAI kartu su atsakymui reikalingais mokyklos duomenimis.",
      keySave: "Išsaugoti", keyBad: "Tai nepanašu į OpenAI raktą (jis prasideda sk-).", askFailed: (e) => `Nepavyko atsakyti: ${e}`,
      askHint: "DI atsakymai gali klysti. Svarbias datas pasitikrinkite TAMO.",
      memTitle: "Šiame pokalbyje",
      memLine: (i, range, from) => `Pamokos: ${i.lessons} (${range}). Namų darbai: ${i.homework}. Pažymiai ir vertinimai: ${i.grades}. Lankomumo žymos: ${i.absences}. Žinutės: ${i.messages} (su tekstu: ${i.bodies}). Kalendoriaus datos: ${i.events}. Nuo ${from}.`,
      memUpdated: (t) => `surinkta ${t}`, memRefresh: "Atnaujinti duomenis", memClear: "Išvalyti atmintį", memClearConfirm: "Paspauskite dar kartą",
      memNote: "Visas pokalbis saugomas šiame telefone ir siunčiamas su kiekvienu klausimu, todėl ankstesni atsakymai nepamirštami.",
      gathering: "Renkami visi TAMO duomenys…", gatherFailed: (e) => `Nepavyko surinkti duomenų: ${e}`,
      stages: { schedule: "Pamokos", homework: "Namų darbai", grades: "Pažymiai ir lankomumas", calendar: "Mokyklos kalendorius", messages: "Žinutės" },
      scaleLbl: (m) => `Skalė 1–${m}`,
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
    return `<div class="row">
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
    return `<div class="row">
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
      const chips = nd.lessons.map((l) => `<span class="chip"><i style="background:${color(l.subject)}"></i>${h(l.subject)}${l.label ? ` <span class="pill red" style="margin:0">${h(l.label)}</span>` : ""}</span>`).join("");
      const due = (D.homework || []).filter((i) => i.due === nd.date).sort(byDue);
      parts.push(section(T.prepFor(label), `<div class="panel"><div class="chips">${chips}</div>${due.length ? due.map(hwRow).join("") : ""}</div>`));
    }

    const soon = (D.homework || []).filter((i) => !i.done && i.due && dayDiff(D.today, i.due) <= 3 && dayDiff(D.today, i.due) >= -7 && (!nd || i.due !== nd.date)).sort(byDue);
    parts.push(section(T.dueSoon, panel(soon.map(hwRow), T.nothingDue)));

    const msgs = (D.messages || []).filter((m) => m.date === D.today);
    parts.push(section(T.messagesToday, panel(msgs.map(msgRow), T.noMessagesToday), `<button data-tab="3" style="color:var(--blue);font-weight:600">${h(T.seeAll)}</button>`));

    const checks = allDays()
      .filter((d) => d.date >= D.today)
      .flatMap((d) => d.lessons.filter(isCheck).map((l) => ({ d, l })));
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
    const bubbles = S.chat.map((m) => `<div class="bubble ${m.role}">${m.role === "assistant" ? md(m.text) : h(m.text)}</div>`);
    if (S.thinking) bubbles.push(`<div class="bubble assistant"><span class="typing"><i></i><i></i><i></i></span>${S.stage ? ` <span style="color:var(--muted);font-size:14px">${h(T.stages[S.stage] || "")}</span>` : ""}</div>`);
    const intro = `${memCard()}${!S.chat.length && !S.thinking
      ? `<p class="intro">${h(T.askIntro)}</p><div class="sugg">${T.askSugg.map((q) => `<button data-ask="${h(q)}">${h(q)}</button>`).join("")}</div>`
      : ""}`;
    const key = S.needKey
      ? `<div class="keycard"><p>${h(T.keyHelp)}</p><div class="keyrow"><input id="aikey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-..."><button id="savekey">${h(T.keySave)}</button></div></div>`
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
      S.chat.push({ role: "assistant", text: r.answer });
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
      <div class="who"><b>${h(D.child.title)}</b>${h(D.child.subtitle || "")}</div>
      <div class="tools">
        <button class="icon-btn ${S.tab === 5 ? "on" : ""}" data-tab="5" aria-label="ask"><svg viewBox="0 0 24 24"><path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg></button>
        <button class="icon-btn" id="refresh" aria-label="refresh"><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg></button>
        <button class="icon-btn" id="settings" aria-label="settings"><svg viewBox="0 0 24 24"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg></button>
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
    $("#app").innerHTML = `${head}<main>${banners.join("")}${screens[S.tab]()}${S.tab === 5 ? "" : `<footer>${h(T.updated(updated))}</footer>`}</main>${tabs}`;
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
    if (el.id === "savekey") {
      const key = ($("#aikey").value || "").trim();
      if (!/^sk-/.test(key)) return alert(T.keyBad);
      try {
        await call("setkey", { key });
      } catch (err) {
        return alert(err.message);
      }
      S.needKey = false;
      const q = S.pendingQ;
      S.pendingQ = "";
      return q ? ask(q) : render();
    }
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
      el.classList.add("spin");
      return call("refresh").catch(() => el.classList.remove("spin"));
    }
    if (el.id === "settings") return call("settings").catch(() => {});
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
  // keep the "now" card honest while the app stays open
  setInterval(() => {
    if (S.tab === 0 && !document.body.classList.contains("open-sheet")) render();
  }, 60000);
}

function buildHTML(data) {
  const payload = { ...data, lang: LANG() };
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<style>${CSS}</style>${NO_ZOOM}</head><body>
<div id="app"></div><div class="scrim"></div><div class="sheet" id="sheet"></div>
<script>window.DATA=${safeJSON(payload)};(${pageMain.toString()})();</script>
</body></html>`;
}

function messageHTML(title, message, buttons = []) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,minimum-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover"><style>${CSS}
  .center{min-height:80vh;display:flex;flex-direction:column;justify-content:center;padding:24px}
  .btn{display:block;margin-top:12px;padding:13px;border-radius:14px;background:var(--ink);color:var(--card);font-weight:700;text-align:center;width:100%}
  .btn.alt{background:var(--chip);color:var(--ink)}</style>${NO_ZOOM}</head><body style="padding-bottom:0">
  <div class="center"><h1 class="date" style="margin:0 0 8px">${esc(title)}</h1><p class="sub" style="margin:0 0 18px">${esc(message)}</p>
  ${buttons.map((b, i) => `<button class="btn ${i ? "alt" : ""}" onclick="location.href='tamo://${b.action}?id=0&p=%7B%7D'">${esc(b.label)}</button>`).join("")}</div></body></html>`;
}

// ───────────────────────────── ✨ Ask: chat over everything TAMO has (OpenAI Responses API) ─────────────────────────────

const AI = {
  MODEL: "gpt-5.4-mini",
  REASONING: "low", // 'low' keeps answers quick; raise for harder questions
  CONTEXT_MAX_AGE_H: 4, // older school data is re-pulled before the next question; the conversation is kept
  WEEKS_BACK: 2, // lesson weeks pulled around this week
  WEEKS_AHEAD: 2,
  MESSAGE_DAYS: 60, // message headers this far back
  BODY_DAYS: 45, // already-read messages this recent get their text pulled (unread ones stay unread)
  MAX_BODIES: 30,
};

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
  try {
    return Keychain.contains(K.scale) ? JSON.parse(Keychain.get(K.scale)) : {};
  } catch (_) {
    return {};
  }
}
const gradeMaxFor = (roleKey) => Number(gradeScales()[roleKey]) || 10;
function setGradeMax(roleKey, max) {
  const all = gradeScales();
  all[roleKey] = max;
  Keychain.set(K.scale, JSON.stringify(all));
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
  for (let i = -AI.WEEKS_BACK; i <= AI.WEEKS_AHEAD; i++) mondays.push(addDays(monday, i * 7));
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
  const messages = (await safe("messages", fetchMessages(api, addDays(today, -AI.MESSAGE_DAYS), 12))) || (base && base.messages) || [];
  const readable = messages.filter((m) => !m.unread && m.date >= addDays(today, -AI.BODY_DAYS)).slice(0, AI.MAX_BODIES);
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
  if (!Keychain.contains(K.aiKey)) return { needKey: true };
  const req = new Request("https://api.openai.com/v1/responses");
  req.method = "POST";
  req.timeoutInterval = 120;
  req.headers = { Authorization: `Bearer ${Keychain.get(K.aiKey)}`, "Content-Type": "application/json" };
  req.body = JSON.stringify({
    model: AI.MODEL,
    instructions: aiInstructions(aiContext(pack, opened, gradeMax), gradeMax),
    // the whole conversation, every time, so nothing said earlier is forgotten
    input: [...history.map((m) => ({ role: m.role, content: m.text })), { role: "user", content: question }],
    reasoning: { effort: AI.REASONING },
    store: false, // don't keep the child's school data on OpenAI's side
  });
  let res = null;
  try {
    res = await req.loadJSON();
  } catch (_) {
    if (!req.response) throw new Error(t("aiOffline"));
  }
  const code = req.response && req.response.statusCode;
  if (code === 401) {
    Keychain.remove(K.aiKey);
    return { needKey: true };
  }
  if (code === 429) throw new Error(t("aiQuota"));
  const errMsg = (res && res.error && res.error.message) || "";
  if (/context|too long|maximum.*tokens/i.test(errMsg)) throw new Error(t("aiTooLong"));
  if (code >= 400 || !res) throw new Error(errMsg || `OpenAI answered HTTP ${code}`);
  let text = res.output_text || "";
  if (!text && Array.isArray(res.output)) {
    text = res.output
      .flatMap((o) => o.content || [])
      .filter((c) => c.type === "output_text")
      .map((c) => c.text)
      .join("");
  }
  text = String(text).trim();
  if (!text) throw new Error(t("aiEmpty"));
  return { answer: text };
}

async function askKeyNative() {
  const a = new Alert();
  a.title = t("aiKeyTitle");
  a.message = t("aiKeyMsg");
  a.addSecureTextField("sk-...", "");
  a.addAction(t("save"));
  a.addCancelAction(t("cancel"));
  if ((await a.presentAlert()) === -1) return false;
  const key = a.textFieldValue(0).trim();
  if (!/^sk-/.test(key)) {
    const e = new Alert();
    e.message = t("aiKeyBad");
    e.addAction("OK");
    await e.presentAlert();
    return false;
  }
  Keychain.set(K.aiKey, key);
  return true;
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
  }

  // The conversation for the child currently shown, loaded from the phone the first time it's needed.
  chatFor(data) {
    const key = data && data.child && data.child.key;
    if (!key) return { v: 1, roleKey: "", history: [], pack: null };
    if (!this.chatState || this.chatState.roleKey !== key) this.chatState = loadChat(key);
    return this.chatState;
  }

  page(data, extra = {}) {
    const chat = this.chatFor(data);
    return buildHTML({
      ...data,
      chat: chat.history.map((m) => ({ role: m.role, text: m.text })),
      chatInfo: packInfo(chat.pack),
      gradeMax: gradeMaxFor(data.child && data.child.key),
      hasAiKey: Keychain.contains(K.aiKey),
      ...extra,
    });
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
    const fresh = chat.pack && Date.now() - chat.pack.builtAt < AI.CONTEXT_MAX_AGE_H * 3600000 && chat.pack.today === todayV();
    if (!force && fresh) return chat;
    chat.pack = await gatherAll(this.api, data, (stage) => this.progress(stage));
    saveChat(chat);
    return chat;
  }

  async start() {
    this.wv.shouldAllowRequest = (req) => this.route(req);
    const cached = readCache();
    this.data = cached;
    await this.wv.loadHTML(cached ? this.page(cached, { warnings: [] }) : messageHTML(APP_NAME, LANG() === "lt" ? "Įkeliama…" : "Loading…"));
    const shown = this.wv.present(true);
    await this.reload();
    await shown;
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

  async reload() {
    if (this.busy) return;
    this.busy = true;
    try {
      const data = await loadAll(this.api);
      saveCache(data);
      this.data = data;
      await this.wv.loadHTML(this.page(data));
    } catch (e) {
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
          await this.wv.loadHTML(this.page(cached, { warnings: [], stale: { at: stamp, error: e.message || String(e) } }));
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
    try {
      switch (action) {
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
          if (!Keychain.contains(K.aiKey)) return this.reply(q.id, false, "NEED_KEY");
          const chat = await this.ensurePack(false);
          const max = gradeMaxFor(chat.roleKey);
          const r = await aiAsk(chat.pack, this.msgBodies, chat.history, question, max);
          if (r.needKey) return this.reply(q.id, false, "NEED_KEY");
          const at = Date.now();
          chat.history.push({ role: "user", text: question, at }, { role: "assistant", text: r.answer, at: Date.now() });
          saveChat(chat);
          return this.reply(q.id, true, { answer: r.answer, info: packInfo(chat.pack) });
        }
        case "scale": {
          const data = this.data || readCache();
          await this.reply(q.id, true, {});
          if (data && (await pickGradeScale(data.child.key, data.child.title))) await this.wv.loadHTML(this.page(data, { warnings: [], startTab: params.tab }));
          return;
        }
        case "setkey": {
          const key = String(params.key || "").trim();
          if (!/^sk-/.test(key)) throw new Error(t("aiKeyBad"));
          Keychain.set(K.aiKey, key);
          return this.reply(q.id, true, {});
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
        case "settings":
          await this.reply(q.id, true, {});
          return this.settings();
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

  async settings() {
    const a = new Alert();
    a.title = t("settings");
    const actions = [];
    const session = this.api.session || (Keychain.contains(K.session) ? JSON.parse(Keychain.get(K.session)) : null);
    if (session && (session.roles || []).length > 1) actions.push(["switchChild", t("switchChild")]);
    const cur = this.data || readCache();
    if (cur) actions.push(["scale", `${t("scaleMenu")}: 1–${gradeMaxFor(cur.child.key)}`]);
    actions.push(["lang", t("language")], Keychain.contains(K.aiKey) ? ["aikeyRemove", t("aiKeyRemove")] : ["aikeyAdd", t("aiKeyAdd")]);
    actions.push(["web", t("openWeb")], ["login", t("changeLogin")], ["signout", t("signOut")]);
    actions.forEach(([, l]) => a.addAction(l));
    a.addCancelAction(t("cancel"));
    const i = await a.presentSheet();
    if (i < 0) return;
    const act = actions[i][0];
    if (act === "scale") {
      if (await pickGradeScale(cur.child.key, cur.child.title)) return this.wv.loadHTML(this.page(cur, { warnings: [] }));
      return;
    }
    if (act === "switchChild") {
      if (Keychain.contains(K.role)) Keychain.remove(K.role);
      forgetSession();
      clearCache();
      this.api = new Tamo(true);
      return this.reload();
    }
    if (act === "lang") {
      Keychain.set(K.lang, LANG() === "lt" ? "en" : "lt");
      const cached = readCache();
      if (cached) return this.wv.loadHTML(this.page(cached, { warnings: [] }));
      return this.reload();
    }
    if (act === "aikeyRemove") {
      Keychain.remove(K.aiKey);
      return this.data && this.wv.loadHTML(this.page(this.data, { warnings: [] }));
    }
    if (act === "aikeyAdd") {
      if (await askKeyNative()) return this.data && this.wv.loadHTML(this.page(this.data, { warnings: [] }));
      return;
    }
    if (act === "web") return Safari.open("https://dienynas.tamo.lt/");
    if (act === "login") {
      if (await askCredentials()) {
        forgetSession();
        clearCache();
        if (Keychain.contains(K.role)) Keychain.remove(K.role);
        this.api = new Tamo(true);
        return this.reload();
      }
      return;
    }
    if (act === "signout") {
      [K.user, K.pass, K.role, K.session, K.aiKey].forEach((k) => Keychain.contains(k) && Keychain.remove(k));
      deleteAllChats();
      this.chatState = null;
      clearCache();
      return this.wv.loadHTML(messageHTML(APP_NAME, t("signedOut")));
    }
  }
}

// ───────────────────────────── widget ─────────────────────────────

async function runWidget() {
  let data = readCache();
  if (!data || Date.now() - data.at > WIDGET_CACHE_MIN * 60000) {
    try {
      data = await loadAll(new Tamo(false));
      saveCache(data);
    } catch (_) {}
  }
  const w = new ListWidget();
  const ink = Color.dynamic(new Color("#15203A"), new Color("#E8ECF4"));
  const muted = Color.dynamic(new Color("#5F6A84"), new Color("#9AA4BA"));
  w.backgroundColor = Color.dynamic(new Color("#EEF1F6"), new Color("#0C111C"));
  w.url = URLScheme.forRunningScript();
  w.refreshAfterDate = new Date(Date.now() + 20 * 60000);
  const lt = LANG() === "lt";
  const line = (text, size, weight, c = ink) => {
    const x = w.addText(text);
    x.font = weight === "bold" ? Font.boldRoundedSystemFont(size) : Font.systemFont(size);
    x.textColor = c;
    x.lineLimit = 1;
    return x;
  };
  if (!data) {
    line(APP_NAME, 15, "bold");
    line(lt ? "Atidarykite, kad prisijungtumėte" : "Open the script to sign in", 12, "", muted);
    Script.setWidget(w);
    return;
  }
  const today = todayV();
  const day = (data.weeks["0"] || []).concat(data.weeks["1"] || []).find((d) => d.date === today);
  const p = vilniusParts(new Date(), { hour: "2-digit", minute: "2-digit" });
  const now = Number(p.hour) * 60 + Number(p.minute);
  const m = (s) => (s ? Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5)) : -1);
  const lessons = (day && day.lessons) || [];
  const cur = lessons.find((l) => m(l.start) <= now && now < m(l.end));
  const nxt = lessons.find((l) => m(l.start) > now);
  line(data.child.title, 12, "bold", muted);
  w.addSpacer(4);
  if (cur) {
    line(`${lt ? "Dabar" : "Now"} ${cur.start}–${cur.end}`, 11, "", muted);
    line(cur.subject, 17, "bold");
  } else if (nxt) {
    line(`${lt ? "Toliau" : "Next"} ${nxt.start}`, 11, "", muted);
    line(nxt.subject, 17, "bold");
  } else {
    line(lt ? (lessons.length ? "Pamokos baigėsi" : "Pamokų nėra") : lessons.length ? "Lessons over" : "No lessons", 16, "bold");
  }
  w.addSpacer();
  const tomorrow = addDays(today, 1);
  const dueTomorrow = data.homework.filter((i) => !i.done && i.due === tomorrow).length;
  const overdue = data.homework.filter((i) => !i.done && i.due < today && i.due >= addDays(today, -7)).length;
  const msgsToday = data.messages.filter((x) => x.date === today);
  const unread = data.messages.filter((x) => x.unread && x.date >= addDays(today, -6)).length;
  line(`📝 ${dueTomorrow} ${lt ? "rytoj" : "due tomorrow"}${overdue ? `, ${overdue} ${lt ? "vėluoja" : "late"}` : ""}`, 12, "");
  line(`✉️ ${msgsToday.length} ${lt ? "šiandien" : "today"}${unread ? `, ${unread} ${lt ? "neperskait." : "unread"}` : ""}`, 12, "");
  Script.setWidget(w);
}

// ───────────────────────────── entry ─────────────────────────────

async function main() {
  if (config.runsInWidget) return runWidget();
  if (!Keychain.contains(K.user) || !Keychain.contains(K.pass)) {
    if (!(await askCredentials())) return;
  }
  await new App().start();
}

if (!globalThis.__DIENYNAS_TEST__) {
  await main();
  Script.complete();
}
