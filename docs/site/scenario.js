// Screenshot scenario for Dienynas+ (repo-site, see github.com/gadominas/app-blueprints/tree/main/repo-site).
//
//   node app-blueprints/repo-site/tools/capture.js ../Tamo-
//
// Everything here is invented: the pupil (Ugnė Pavyzdytė, "example"), the teachers, the school
// (Pavyzdžių progimnazija) and every lesson, grade and message. The app signs in with fake details
// and every TAMO, AI and GitHub request is answered from the fixtures below; nothing reaches the network.
'use strict';
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DOCS = '/var/mobile/Library/Mobile Documents/iCloud~dk~simonbs~Scriptable/Documents';
const LOCAL = '/var/mobile/Containers/Data/Application/SCRIPTABLE/Documents';
const NOW = Date.UTC(2026, 9, 29, 8, 32);   // Thursday 29 October 2026, 10:32 in Vilnius: the third lesson is on

// ───────── dates ─────────
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const dow = (d) => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7;   // 0 = Monday
const TODAY = '2026-10-29';
// Vilnius local time → UTC ("…Utc" fields). Summer time ended on 25 October 2026.
function utc(date, hhmm) {
  const off = date < '2026-10-25' ? 3 : 2;
  const [h, m] = hhmm.split(':').map(Number);
  const t = Date.parse(date + 'T00:00:00Z') + ((h - off) * 60 + m) * 6e4;
  return new Date(t).toISOString().slice(0, 19);
}

// ───────── the invented class ─────────
const CHILD = { title: 'Ugnė Pavyzdytė', subtitle: '5A klasė' };
const CHILD2 = { title: 'Jonas Pavyzdys', subtitle: '2B klasė' };   // a younger brother: shows the children row at the top
// The app's own file-name hash (Dienynas.js › hashKey), for files kept per child.
function hashKey(s) { let x = 5381; for (const c of String(s)) x = ((x * 33) ^ c.codePointAt(0)) >>> 0; return x.toString(36); }
// Ugnė's photo: an invented illustration made for these screenshots (docs/site/avatar-demo.jpg), not a real child.
const AVATAR = path.join(__dirname, 'avatar-demo.jpg');
const TIMES = [['08:00', '08:45'], ['08:55', '09:40'], ['10:00', '10:45'], ['11:05', '11:50'], ['12:00', '12:45'], ['13:00', '13:45']];
const TEACH = {
  'Matematika': 'Rasa Skaičiūtė',
  'Lietuvių kalba ir literatūra': 'Jūratė Žodelienė',
  'Anglų kalba': 'Laura Kalbaitė',
  'Gamtos mokslai': 'Tomas Gamtelis',
  'Istorija': 'Darius Praeitis',
  'Fizinis ugdymas': 'Mantas Bėgūnas',
  'Muzika': 'Gintarė Natelė',
  'Dailė': 'Eglė Spalvienė',
  'Informatika': 'Paulius Kodelis',
  'Technologijos': 'Ona Meistrienė',
  'Etika': 'Aušra Dorienė',
};
const AVG = { 'Matematika': '8,7', 'Lietuvių kalba ir literatūra': '8,4', 'Anglų kalba': '9,3', 'Gamtos mokslai': '9,0', 'Istorija': '8,0', 'Informatika': '9,5', 'Dailė': '9,8', 'Muzika': '9,6', 'Technologijos': '9,2' };
const WEEK = [
  ['Lietuvių kalba ir literatūra', 'Matematika', 'Anglų kalba', 'Istorija', 'Technologijos', 'Technologijos'],
  ['Matematika', 'Lietuvių kalba ir literatūra', 'Gamtos mokslai', 'Anglų kalba', 'Fizinis ugdymas'],
  ['Lietuvių kalba ir literatūra', 'Matematika', 'Informatika', 'Anglų kalba', 'Etika', 'Muzika'],
  ['Matematika', 'Lietuvių kalba ir literatūra', 'Anglų kalba', 'Gamtos mokslai', 'Fizinis ugdymas', 'Dailė'],
  ['Lietuvių kalba ir literatūra', 'Matematika', 'Istorija', 'Anglų kalba', 'Muzika'],
];
const TOPICS = {
  'Matematika': ['Trupmenų palyginimas', 'Trupmenų sudėtis', 'Trupmenų atimtis', 'Mišrieji skaičiai', 'Dešimtainės trupmenos'],
  'Lietuvių kalba ir literatūra': ['Pasakos sandara', 'Daiktavardžio linksniai', 'Liaudies pasakos veikėjai', 'Rašinys apie rudenį', 'Veiksmažodžio laikai'],
  'Anglų kalba': ['Unit 2: My day', 'Unit 3: Animals', 'Present Simple questions', 'Unit 3: Wild animals', 'Reading: At the zoo'],
  'Gamtos mokslai': ['Augalo dalys', 'Rudens medžiai', 'Lapų spalvos', 'Sėklų plitimas', 'Medžių pažinimas'],
  'Istorija': ['Kas yra istorija?', 'Istoriniai šaltiniai', 'Laiko juosta', 'Senovės gyvenvietės', 'Piliakalniai'],
  'Fizinis ugdymas': ['Bėgimas ištvermei', 'Kamuolio perdavimai', 'Estafetės', 'Krepšinio pagrindai'],
  'Informatika': ['Failai ir aplankai', 'Algoritmai kasdienybėje', 'Scratch: judėjimas'],
  'Muzika': ['Ritmas ir metras', 'Liaudies dainos', 'Dainavimas dviem balsais'],
  'Dailė': ['Rudens spalvos akvarele', 'Natiurmortas', 'Spalvų maišymas'],
  'Technologijos': ['Popieriaus lankstymas', 'Medžiagų savybės', 'Rudens dekoracija'],
  'Etika': ['Draugystė', 'Pagarba kitam', 'Mano vertybės'],
};
// Labels on particular lessons (tests and checks), marks given and formative assessments.
const LABELS = {
  '2026-10-30|Matematika': ['Kontrolinis darbas', true],
  '2026-11-04|Anglų kalba': ['Žodžių diktantas', true],
  '2026-11-10|Gamtos mokslai': ['Apklausa', true],
  '2026-10-22|Lietuvių kalba ir literatūra': ['Savarankiškas darbas', true],
};
const TOPIC_OVERRIDE = {
  '2026-10-30|Matematika': 'Trupmenų sudėtis ir atimtis',
  '2026-11-04|Anglų kalba': 'Unit 3: Animals (words)',
  '2026-11-10|Gamtos mokslai': 'Rudens medžiai ir jų lapai',
};
const HOLIDAYS = { '2026-11-02': 'Vėlinės (poilsio diena)' };

// ── grades, attendance and formative assessments since 1 September ──
const GRADES = [
  ['2026-09-10', 'Matematika', '8'], ['2026-09-15', 'Anglų kalba', '9'], ['2026-09-17', 'Lietuvių kalba ir literatūra', '8'],
  ['2026-09-22', 'Gamtos mokslai', '9'], ['2026-09-24', 'Matematika', '7', 'Kontrolinis darbas'], ['2026-09-29', 'Istorija', '8'],
  ['2026-10-01', 'Anglų kalba', '10'], ['2026-10-02', 'Lietuvių kalba ir literatūra', '9'], ['2026-10-06', 'Informatika', '10'],
  ['2026-10-08', 'Matematika', '9'], ['2026-10-09', 'Dailė', '10'], ['2026-10-13', 'Gamtos mokslai', '9'],
  ['2026-10-14', 'Muzika', '10'], ['2026-10-15', 'Lietuvių kalba ir literatūra', '7', 'Diktantas'], ['2026-10-16', 'Istorija', '8'],
  ['2026-10-20', 'Anglų kalba', '9', 'Testas'], ['2026-10-21', 'Informatika', '9'], ['2026-10-22', 'Lietuvių kalba ir literatūra', '8', 'Savarankiškas darbas'],
  ['2026-10-23', 'Matematika', '8'], ['2026-10-26', 'Technologijos', '9'], ['2026-10-27', 'Anglų kalba', '10'],
  ['2026-10-29', 'Matematika', '9'],
];
const ATTEND = [['2026-10-14', 'Fizinis ugdymas', 'n'], ['2026-10-26', 'Istorija', 'p']];
const FORMATIVES = [
  ['2026-10-07', 'Gamtos mokslai', 'Labai gerai', 'Kaupiamasis vertinimas'], ['2026-10-19', 'Matematika', '85 %', 'Kaupiamasis vertinimas'],
  ['2026-10-21', 'Dailė', 'Puikiai', 'Kaupiamasis vertinimas'], ['2026-10-28', 'Lietuvių kalba ir literatūra', 'Puikiai', 'Kaupiamasis vertinimas'],
];

// ── homework (TAMO "darbai") ──
const HOMEWORK = [
  { s: 'Matematika', set: '2026-10-27', due: '2026-10-30', t: 'Pasikartoti trupmenų sudėtį ir atimtį: vadovėlis p. 48–49, 3–7 užd.' },
  { s: 'Lietuvių kalba ir literatūra', set: '2026-10-28', due: '2026-10-30', t: 'Perskaityti pasaką „Eglė žalčių karalienė“ iki 5 skyriaus.' },
  { s: 'Muzika', set: '2026-10-23', due: '2026-10-30', t: 'Išmokti dainos „Rudenėlis“ pirmą posmą.' },
  { s: 'Dailė', set: '2026-10-22', due: '2026-10-29', t: 'Atsinešti akvarelinius dažus, teptukus ir A3 lapą.' },
  { s: 'Istorija', set: '2026-10-23', due: '2026-10-28', t: 'Užpildyti darbo sąsiuvinį p. 15 (laiko juosta).' },
  { s: 'Anglų kalba', set: '2026-10-29', due: '2026-11-03', t: 'Workbook p. 22, ex. 1–3. Learn the words of Unit 3.' },
  { s: 'Gamtos mokslai', set: '2026-10-29', due: '2026-11-05', t: 'Paruošti pristatymą apie rudens medžius (3–4 skaidrės).', f: 'Pristatymo planas.pdf' },
  { s: 'Informatika', set: '2026-10-28', due: '2026-11-04', t: 'Scratch: sukurti veikėją, kuris eina ratu.' },
  { s: 'Matematika', set: '2026-10-22', due: '2026-10-27', t: 'Vadovėlis p. 44, 1–4 užd.', done: '2026-10-26' },
  { s: 'Lietuvių kalba ir literatūra', set: '2026-10-21', due: '2026-10-26', t: 'Parašyti 5 sakinius apie rudenį.', done: '2026-10-25' },
  { s: 'Anglų kalba', set: '2026-10-20', due: '2026-10-22', t: 'Workbook p. 18, ex. 2.', done: '2026-10-21' },
  { s: 'Gamtos mokslai', set: '2026-10-13', due: '2026-10-20', t: 'Surinkti 5 skirtingų medžių lapus.', done: '2026-10-19' },
  { s: 'Matematika', set: '2026-10-06', due: '2026-10-08', t: 'Vadovėlis p. 36, 2–6 užd.', done: '2026-10-07' },
  { s: 'Istorija', set: '2026-10-09', due: '2026-10-16', t: 'Paklausti senelių, kokių daiktų iš praeities turime namie.', done: '2026-10-15' },
].map((x, i) => Object.assign(x, { id: `hw${i + 1}` }));

// ── the timetable, week by week ──
function lessonsOn(date) {
  const d = dow(date);
  if (d > 4 || HOLIDAYS[date] || date < '2026-09-01') return [];
  const week = Math.floor((Date.parse(date) - Date.parse('2026-09-07')) / (7 * 864e5));
  return WEEK[d].map((s, i) => {
    const key = `${date}|${s}`;
    const n = i + 1;
    const topics = TOPICS[s] || [''];
    const ev = {
      id: `${date}-${n}`,
      eventIcon: { content: String(n) },
      timeFromUtc: utc(date, TIMES[i][0]),
      timeToUtc: utc(date, TIMES[i][1]),
      eventTitle: { content: s },
      eventSubtitle: { content: TEACH[s] },
      eventDescription: { content: TOPIC_OVERRIDE[key] || topics[((week % topics.length) + topics.length + i) % topics.length] },
      eventDetails: [],
    };
    if (LABELS[key]) {
      ev.eventLabel = { content: LABELS[key][0], styleRef: LABELS[key][1] ? 'label-important' : 'label' };
      ev.eventHighlight = { styleRef: 'important' };
    }
    const marks = GRADES.filter((g) => g[0] === date && g[1] === s).map((g) => ({ contentType: 'text', content: g[2] }))
      .concat(ATTEND.filter((a) => a[0] === date && a[1] === s).map((a) => ({ contentType: 'text', content: a[2] })));
    if (marks.length) ev.rightIconsTop = marks;
    if (date === '2026-10-26' && s === 'Technologijos' && n === 5) ev.rightIconsBottom = [{ contentType: 'icon', content: 'icon-positive' }];
    const forms = FORMATIVES.filter((f) => f[0] === date && f[1] === s);
    if (forms.length) ev.formatives = forms.map((f) => ({ date: f[0], title: f[2], type: f[3] }));
    if (AVG[s] && date <= TODAY) ev.bottomIconsRight = [{ key: 'average', content: AVG[s] }];
    HOMEWORK.filter((h) => h.set === date && h.s === s && !ev._hw).forEach((h) => {
      ev._hw = true;
      ev.eventDetails.push({ key: 'homework', title: { content: 'Namų darbai' }, body: { content: h.t }, files: h.f ? [{ fileName: h.f, fileSid: 'demo-' + h.id }] : [] });
    });
    if (key === '2026-10-30|Matematika') ev.eventDetails.push({ key: 'note', title: { content: 'Pastaba' }, body: { content: 'Atsinešti liniuotę ir pieštuką.' } });
    delete ev._hw;
    return ev;
  });
}
const weekPayload = (monday) => ({
  isSuccess: true,
  days: [0, 1, 2, 3, 4].map((i) => { const date = addDays(monday, i); return { date: date + 'T00:00:00', events: lessonsOn(date) }; }),
  formatives: [],
});

const inRange = (d, a, b) => (!a || d >= a) && (!b || d <= b);
const lessonIdOf = (h) => { const i = WEEK[dow(h.set)] ? WEEK[dow(h.set)].indexOf(h.s) : -1; return `${h.set}-${i + 1}`; };
const darbai = (q) => ({
  isSuccess: true,
  items: q.workType === 'class'
    ? lessonsOnRange(q.dateFrom, q.dateTo).map((l) => ({ lessonId: l.id, thingName: l.eventTitle.content, homeWork: 'Klasėje: ' + l.eventDescription.content, date: l.timeFromUtc.slice(0, 10), deadline: l.timeFromUtc.slice(0, 10), completionDate: l.timeFromUtc.slice(0, 10) }))
    : HOMEWORK.filter((h) => inRange(h.set, q.dateFrom, q.dateTo) || inRange(h.due, q.dateFrom, q.dateTo)).map((h) => ({
      lessonId: lessonIdOf(h), thingName: h.s, homeWork: h.t, date: h.set + 'T00:00:00', deadline: h.due + 'T00:00:00',
      completionDate: h.done ? h.done + 'T18:20:00' : null, files: h.f ? [{ fileName: h.f, fileSid: 'demo-' + h.id }] : [],
    })),
});
function lessonsOnRange(a, b) {
  const out = [];
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(...lessonsOn(d));
  return out;
}
const diary = (q) => ({
  isSuccess: true,
  items: GRADES.filter((g) => inRange(g[0], q.dateFrom, q.dateTo)).map((g) => ({ subjectDate: g[0] + 'T00:00:00', subject: g[1], assessmentValue: g[2], assessmentType: g[3] || '' }))
    .concat(ATTEND.filter((a) => inRange(a[0], q.dateFrom, q.dateTo)).map((a) => ({ subjectDate: a[0] + 'T00:00:00', subject: a[1], attendanceValue: a[2] }))),
  formativeGrades: FORMATIVES.filter((f) => inRange(f[0], q.dateFrom, q.dateTo)).map((f) => ({ date: f[0], subject: f[1], title: f[2], type: f[3] })),
});
const ALLDAY = [
  { t: 'Vėlinės (poilsio diena)', from: '2026-11-02', to: '2026-11-02', l: 'Poilsio diena' },
  { t: 'Kalėdų atostogos', from: '2026-12-23', to: '2027-01-02', l: 'Atostogos' },
];
const allDay = (q) => ({
  isSuccess: true,
  allDayEvents: ALLDAY.filter((e) => e.to >= (q.dateFrom || '') && e.from <= (q.dateTo || '9999')).map((e) => ({
    eventTitle: { content: e.t }, eventLabel: { content: e.l }, eventSubtitle: { content: '' },
    timeFromUtc: utc(e.from, '00:00'), timeToUtc: utc(e.to, '23:59'),
  })),
});
const FEED = {
  isSuccess: true,
  result: [
    { id: 'f1', eventId: '1', date: '2026-10-29T08:50:00', eventDetails: { ThingName: 'Matematika', Date: '2026-10-29', Value: '9' } },
    { id: 'f2', eventId: '10', date: '2026-10-28T14:10:00', eventDetails: { ThingName: 'Lietuvių kalba ir literatūra', Date: '2026-10-28', Vertinimas: 'Puikiai', Tipas: 'Kaupiamasis vertinimas' } },
    { id: 'f3', eventId: '1', date: '2026-10-27T13:30:00', eventDetails: { ThingName: 'Anglų kalba', Date: '2026-10-27', Value: '10' } },
    { id: 'f4', eventId: '8', date: '2026-10-26T15:05:00', eventDetails: { ThingName: 'Technologijos', Date: '2026-10-26', Type: 'Pagyrimas', Value: 'Labai kruopščiai atliktas rudens dekoracijos darbas.' } },
    { id: 'f5', eventId: '2', date: '2026-10-26T11:30:00', eventDetails: { ThingName: 'Istorija', Date: '2026-10-26', Type: '2' } },
    { id: 'f6', eventId: '4', date: '2026-10-29T10:50:00', eventDetails: { ThingName: 'Anglų kalba', Date: '2026-10-29', HomeWork: 'Workbook p. 22, ex. 1–3. Learn the words of Unit 3.', Deadline: '2026-11-03' } },
  ],
};

// ── messages ──
const MSGS = [
  { id: '9104', d: '2026-10-29T09:14:00', s: 'Ekskursija į Gamtos muziejų lapkričio 12 d.', from: 'Asta Klasiokienė', role: 'Klasės vadovė', unread: true, files: true,
    body: 'Gerbiami tėveliai,\n\nlapkričio 12 d. (ketvirtadienį) 5A klasė vyks į Gamtos muziejų. Išvykstame 9.00 nuo mokyklos, grįžtame apie 13.30. Bilieto kaina 4 €.\n\nPrašome iki lapkričio 6 d. grąžinti pasirašytą sutikimo formą (prisegta).\n\nAčiū!\nAsta Klasiokienė', att: 'Sutikimo forma.pdf' },
  { id: '9101', d: '2026-10-29T07:48:00', s: 'Penktadienio pamokų laikas', from: 'Pavyzdžių progimnazija', role: 'Administracija', body: 'Penktadienį, spalio 30 d., pamokos vyks įprastu laiku. Po 5 pamokos – klasių valandėlės.' },
  { id: '9087', d: '2026-10-28T16:02:00', s: 'Kontrolinis darbas penktadienį', from: 'Rasa Skaičiūtė', role: 'Matematikos mokytoja',
    body: 'Laba diena,\n\npenktadienį rašysime kontrolinį darbą apie trupmenų sudėtį ir atimtį. Pasikartoti galima pagal vadovėlio p. 44–49 uždavinius.\n\nSėkmės!' },
  { id: '9080', d: '2026-10-28T12:30:00', s: 'Klasės fotografavimas', from: 'Asta Klasiokienė', role: 'Klasės vadovė', group: true, body: 'Lapkričio 3 d. per 2 pamoką vyks klasės fotografavimas. Prašome vaikams apsirengti šventiškai.' },
  { id: '9072', d: '2026-10-27T18:41:00', s: 'Tėvų susirinkimas lapkričio 5 d.', from: 'Asta Klasiokienė', role: 'Klasės vadovė', unread: true, important: true },
  { id: '9065', d: '2026-10-26T14:15:00', s: 'Bibliotekos knygų grąžinimas', from: 'Mokyklos biblioteka', role: 'Bibliotekininkė', body: 'Primename grąžinti iki spalio 30 d. paimtas knygas.' },
  { id: '9051', d: '2026-10-23T11:05:00', s: 'Rudens krosas', from: 'Mantas Bėgūnas', role: 'Fizinio ugdymo mokytojas', body: 'Ačiū visiems dalyvavusiems rudens krose! Rezultatai skelbiami mokyklos stende.' },
  { id: '9032', d: '2026-10-20T10:12:00', s: 'Anglų kalbos olimpiada', from: 'Laura Kalbaitė', role: 'Anglų kalbos mokytoja', body: 'Norintys dalyvauti mokyklos anglų kalbos olimpiadoje, užsiregistruokite iki lapkričio 10 d.' },
  { id: '9010', d: '2026-10-15T08:30:00', s: 'Sveikatos savaitė', from: 'Visuomenės sveikatos specialistė', role: 'Specialistė', body: 'Kitą savaitę mokykloje vyks sveikatos savaitė.' },
  { id: '8977', d: '2026-10-08T17:20:00', s: 'Rugsėjo mėnesio pasiekimai', from: 'Asta Klasiokienė', role: 'Klasės vadovė', body: 'Rugsėjo mėnesio pažymių suvestinė jau matoma dienyne.' },
];
const msgItem = (m) => ({ id: m.id, sid: 'sid-' + m.id, messageTypeId: '1', date: m.d, subject: m.s, senderPerson: m.from, senderPersonTitle: m.role,
  readDate: m.unread ? null : m.d, isImportant: !!m.important, isStarred: false, hasAttachments: !!m.files });

// ── AI ──
const ANSWERS = [
  [/due tomorrow/i, 'Tomorrow, **Friday 30 October**, three things are due:\n- **Matematika**: *vadovėlis p. 48–49, 3–7 užd.* (textbook pp. 48–49, tasks 3–7, adding and subtracting fractions)\n- **Lietuvių kalba ir literatūra**: read „Eglė žalčių karalienė“ up to chapter 5\n- **Muzika**: learn the first verse of „Rudenėlis“\nThe maths lesson is a *Kontrolinis darbas* (test), so the textbook tasks are good practice.'],
  [/tests?|kontrolin/i, 'Yes, three in the next two weeks:\n- **Fri 30 Oct**, Matematika: *Kontrolinis darbas* (test) on adding and subtracting fractions\n- **Wed 4 Nov**, Anglų kalba: *Žodžių diktantas* (word dictation), Unit 3: Animals\n- **Tue 10 Nov**, Gamtos mokslai: *Apklausa* (quiz) on autumn trees\nMonday 2 November is a day off (*Vėlinės*).'],
];
function aiReply(req) {
  const j = req.json() || {};
  const msgs = j.messages || [];
  const q = String((msgs[msgs.length - 1] || {}).content || '');
  const hit = ANSWERS.find(([re]) => re.test(q));
  const text = hit ? hit[1] : 'OK';
  return { json: { id: 'msg_demo', type: 'message', role: 'assistant', model: j.model, content: [{ type: 'text', text }], usage: { input_tokens: 15840 + msgs.length * 120, output_tokens: hit ? 160 : 2 } } };
}
// Token usage over the last few weeks (counted per local day).
function usageSeed() {
  const days = {};
  const per = [0, 2, 0, 1, 3, 0, 0, 2, 1, 0, 4, 2, 0, 1, 2, 0, 3, 1, 0, 2, 3];
  let calls = 0, tin = 0, tout = 0;
  per.forEach((n, i) => {
    if (!n) return;
    const d = addDays(TODAY, -(per.length - 1 - i));
    const x = { calls: n, in: n * 15200 + i * 310, out: n * 180 + i * 7 };
    days[d] = x; calls += x.calls; tin += x.in; tout += x.out;
  });
  const test = { calls: 1, in: 14, out: 2 };
  return {
    since: Date.UTC(2026, 9, 8, 7),
    p: { anthropic: { calls: calls + 1, in: tin + 14, out: tout + 2,
      models: { 'claude-haiku-5-5': { calls: calls + 1, in: tin + 14, out: tout + 2 } },
      features: { ask: { calls, in: tin, out: tout }, test },
      days } },
  };
}

// ── releases.json: the repository's own, plus a next version only in the update-sheet shot ──
const RELEASES = JSON.parse(fs.readFileSync(path.join(ROOT, 'releases.json'), 'utf8'));
function releasesWithOffer() {
  const r = JSON.parse(JSON.stringify(RELEASES));
  // Always one minor version ahead of the newest release, so the app has something to offer.
  const [maj, min] = String(r.releases[0].version).split('.').map(Number);
  r.releases.unshift({
    version: `${maj}.${min + 1}.0`, date: '2026-11-12', title: 'Ready for the week',
    highlights: [
      { icon: '🎒', title: 'Pack for tomorrow', text: "Tomorrow's subjects and what's due, as a checklist you can tick off." },
      { icon: '🔔', title: 'Quieter checks', text: 'Scheduled checks group news per child and skip empty runs.' },
      { icon: '✨', title: 'Ask remembers more', text: 'Ask keeps longer conversations before asking you to clear its memory.' },
    ],
    changes: [],
  });
  return r;
}

module.exports = {
  app: { name: 'Dienynas+', script: 'Dienynas.js', accent: '#60A5FA' },
  now: NOW,
  locale: 'en_US', timezone: 'Europe/Vilnius',
  settle: 3900,   // the launch screen (2.9 s), then the page with fresh TAMO data
  fixtures: (shot) => ({
    files: Object.assign({
      [DOCS + '/DienynasPlus/settings.json']: { lang: shot.lt ? 'lt' : 'en', checkUpdates: true, theme: 'auto', density: 'comfortable', font: 'sans', textSize: 1, gradeScales: {}, cfg: {}, usageAsked: true },
      [LOCAL + '/dienynas-plus-ai-settings.json']: { aiProvider: 'anthropic', ai: true, models: { anthropic: { at: NOW - 3 * 864e5, list: [
        { id: 'claude-opus-5-5', name: 'Claude Opus 5.5' }, { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }, { id: 'claude-haiku-5-5', name: 'Claude Haiku 5.5' }] } } },
      [LOCAL + '/dienynas-plus-usage.json']: usageSeed(),
      [LOCAL + '/dienynas-plus-avatar-' + hashKey(CHILD.title + '|' + CHILD.subtitle) + '.jpg']: fs.readFileSync(AVATAR),
    }, shot.files || {}),
    keychain: Object.assign({
      'dienynasplus.username': 'demo.tevai',          // fake sign-in; the fixtures accept anything
      'dienynasplus.password': 'not-a-real-password',
      'dienynasplus.role': CHILD.title + '|' + CHILD.subtitle,   // the child picked last time (two children on the account)
      DIENYNASPLUS_ANTHROPIC_KEY: 'sk-ant-demo-0000000000001234',
    }),
    alerts: [],
    routes: [
      // GitHub: update check and the widget's logo tile
      { match: /releases\.json/, respond: () => ({ json: shot.update ? releasesWithOffer() : RELEASES }) },
      { match: /icon-1024\.png/, respond: { file: path.join(ROOT, 'docs', 'icon-1024.png') } },
      // TAMO sign-in (MobileServiceV3) and roles
      { match: 'MobileServiceV3/AuthenticateV2', respond: { json: { Status: '1', ErrorCode: '0', Result: { authToken: 'demo-token-0001', userRoleIsAllowed: true, personId: '100200', role: '3', firstName: 'Demo', lastName: 'Tėvai' } } } },
      { match: 'core/app/settings/StyleRef', respond: { json: { isSuccess: true } } },
      { match: 'core/app/roles', respond: { json: { isSuccess: true, roles: [{ id: 'role-demo-1', title: CHILD.title, subtitle: CHILD.subtitle, active: true, childStudentId: '300400' },
        { id: 'role-demo-2', title: CHILD2.title, subtitle: CHILD2.subtitle, active: false, childStudentId: '300401' }] } } },
      // TAMO data (api.tamo.lt)
      { match: 'v2/app/calendar/events', respond: (req) => ({ json: weekPayload(new URL(req.url).searchParams.get('date').slice(0, 10)) }) },
      { match: 'core/app/darbai', respond: (req) => ({ json: darbai(Object.fromEntries(new URL(req.url).searchParams)) }) },
      { match: 'core/app/feeds', respond: { json: FEED } },
      { match: 'core/app/dienynas', respond: (req) => ({ json: diary(Object.fromEntries(new URL(req.url).searchParams)) }) },
      { match: 'core/app/calendar/events/allDay', respond: (req) => ({ json: allDay(Object.fromEntries(new URL(req.url).searchParams)) }) },
      { match: /messaging\/messages\/received\/\d+\/\d+/, respond: (req) => {
        const id = /received\/\d+\/(\d+)/.exec(req.url)[1];
        const msg = MSGS.find((x) => x.id === id) || {};
        return { json: { item: { body: msg.body || msg.s || '', attachments: msg.att ? [{ name: msg.att, sid: 'att-' + msg.id }] : [], recipientSets: [{ title: '5A klasės tėvai' }] } } };
      } },
      { match: 'messaging/messages/group/received', respond: { json: { items: MSGS.filter((m) => m.group).map(msgItem) } } },
      { match: 'messaging/messages/received', respond: (req) => ({ json: { items: new URL(req.url).searchParams.get('page') === '1' ? MSGS.filter((m) => !m.group).map(msgItem) : [] } }) },
      // AI (Claude) and the model list
      { match: 'api.anthropic.com/v1/messages', respond: async (req) => { await new Promise((r) => setTimeout(r, 700)); return aiReply(req); } },
      { match: 'api.anthropic.com/v1/models', respond: { json: { data: [{ id: 'claude-haiku-5-5', display_name: 'Claude Haiku 5.5', created_at: '2026-09-01T00:00:00Z' }] } } },
    ],
  }),
  shots: [
    { id: '01-today', label: 'The school day at a glance', caption: 'The lesson on now, the rest of today, and what to prepare for tomorrow.' },
    { id: '02-ask', label: 'Ask about the week', caption: 'Ask in English or Lithuanian; answers come only from what TAMO holds.',
      run: async (h) => {
        await h.tap('[data-tab="5"]', { after: 2500 });
        await h.tap('text=Any tests in the next two weeks?', { after: 2600 });
        await h.scrollTo(0);
      } },
    { id: '03-homework', label: 'Homework by due date', caption: 'Overdue work in red, work due soon highlighted, files a tap away.',
      run: async (h) => { await h.tap('[data-tab="2"]'); } },
    { id: '04-schedule', label: 'The week, lesson by lesson', caption: 'Tap a lesson for its teacher, topic, homework and subject average.',
      run: async (h) => {
        await h.tap('[data-tab="1"]');
        await h.tap('.lesson.current');
        await h.scrollTo('.weeknav', 10);
      } },
    { id: '05-messages', label: 'A week of messages', caption: 'Messages per day for the last 7 days; the yellow part is unread.',
      run: async (h) => { await h.tap('[data-tab="3"]'); } },
    { id: '06-grades', label: 'Grades and averages', caption: 'Subject averages for 30 days on your school’s grade scale.',
      run: async (h) => { await h.tap('[data-tab="4"]'); } },
    { id: '07-lithuanian', label: 'In Lithuanian too', caption: 'Switch between Lithuanian and English in Settings › General.', lt: true,
      run: async (h) => { await h.scrollTo('main section:nth-of-type(3)', 18); } },
    { id: '08-children', label: 'Switch children in one tap', caption: 'Each child’s photo stays at the top and shrinks as you scroll; tap one to switch.',
      run: async (h) => {
        await h.tap('[data-tab="1"]');
        await h.tap('.lesson.current');
        await h.scrollTo(330);   // scrolled: the header and the children row shrink
      } },
    { id: '09-launch', label: 'Launch screen', caption: 'The calendar draws itself for a moment; a tap skips it.', settle: 800 },
    { id: '10-settings', label: 'Settings', caption: 'Six palettes or Auto, three layouts, text size and headline font.',
      run: async (h) => { await h.tap('#settings', { after: 900 }); } },
    { id: '11-ai-key', label: 'Your own AI key', caption: 'A Claude or OpenAI key, kept in the iOS Keychain; pick any model it can use.',
      run: async (h) => {
        await h.tap('#settings', { after: 900 });
        await h.tap('[data-act="ai-open"]', { after: 1200 });
        await h.eval(() => document.querySelector('#aisheet [data-aiact="aitest"][data-v="anthropic"]').click());
        await h.wait(1500);
      } },
    { id: '12-ai-usage', label: 'What Ask costs', caption: 'Tokens per day, feature and model, counted from what the provider reports.',
      run: async (h) => {
        await h.tap('#settings', { after: 900 });
        await h.tap('[data-act="ai-open"]', { after: 1200 });
        await h.scrollEl('#aisheet', 760);
      } },
    { id: '13-update', label: 'Updates itself', caption: 'A new version shows its three best features; Later waits two days.', update: true,
      settle: 7000 },   // the app checks for updates 3.5 s after its first screen, which comes after the launch screen
    { id: '14-dark', label: 'Dark mode', caption: 'Follows the iPhone with Auto colours, or pick Slate or Night.', dark: true,
      run: async (h) => {
        await h.tap('[data-tab="3"]');
        await h.tap('[data-msg*="9104"]', { after: 1200 });
      } },
    { id: '15-widget', label: 'Today on the Home Screen', caption: 'The lesson now and next, homework due tomorrow and today’s messages.', widget: 'medium' },
  ],
};
