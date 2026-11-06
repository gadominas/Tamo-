# Testing Dienynas+

Dienynas+ is one Scriptable script, so it can't run in a normal test runner. The `tests/` folder runs the **real `Dienynas.js`** in Node instead, with Scriptable's APIs replaced by stand-ins, and taps through the app the way a person would. The same setup draws raw screenshots of the main screens.

## Run the tests

```sh
cd tests
npm install          # jsdom; Playwright is optional, only for screenshots
node run.js          # all 22 scenarios, one line each (about 70 seconds)
node run.js widget   # only those whose name contains "widget"
node run.js -v 16    # one scenario, printing everything it checks
```

A scenario **passes** when it finishes and reports no failed check, no error from the script or the page, no request without a fixture, and no crash. Every scenario also prints what it saw at each step (A, B, C…): read those lines with `-v` after a change. The checks catch what must hold; the printed lines show the rest (wording, counts, order).

Run them all before every release (see [RELEASING.md](RELEASING.md)); a release goes out only with 22 of 22 passing. To test another copy of the script, set `DIENYNAS_SCRIPT=/path/to/Dienynas.js` (its `releases.json` is read from the same folder).

## How it works

**`tests/harness.js`** loads `Dienynas.js` into its own Node `vm` context, with stand-ins for everything Scriptable provides. Because the context is separate, the browser APIs Scriptable doesn't have (`setTimeout`, `URL`, `fetch`, `atob`, `TextEncoder`…) don't exist there either: the script fails here as it would on the phone if it used one.

| Scriptable | Stand-in |
|---|---|
| `WebView` | a [jsdom](https://github.com/jsdom/jsdom) page per `loadHTML`; `evaluateJavaScript` runs in it, and every navigation the page makes (`tamo://…` bridge calls, tapped `https://` links) goes to the script's `shouldAllowRequest`, as on the phone. The empty first window, the app page and the sign-in or error pages are logged in `E.log.pages` |
| `Request` | answers only from built-in fixtures, by URL: TAMO's sign-in (`MobileServiceV3/AuthenticateV2`, `GetFileUrl`), roles and every `api.tamo.lt` endpoint the app reads, Claude and OpenAI (messages, chat completions, model lists), GitHub (`releases.json`, the script for updates, the logo tile) and PostHog. A request without a fixture fails the scenario (`UNMOCKED …`) |
| `FileManager` | files in memory (`E.files`), at the phone's real iCloud and local paths, with options for iCloud never delivering a file (`slowCloud`), a damaged file (write it into `files`), an empty first window (always), and a phone without iCloud (`noICloud`: any call to iCloud fails the scenario) |
| `Keychain` | in memory (`E.kc`); keys and passwords are fake |
| `Alert` | answers the test queues with `E.alert(…)` or `alerts: […]`: an array of text field values, a button's index or its label, or `"cancel"`. An unanswered prompt counts as Cancel. Every prompt is kept in `E.log.alerts` (title, buttons, fields, whether it came over the window) |
| `Notification`, `Safari`, `Photos`, `Script`, `ListWidget`, `DrawContext`, `Data`, `UUID`, `Device`… | record what happened in `E.log` (notifications, opened links, Shortcut output, widget trees) |
| `Timer` | real timers, 20 times faster (`timeScale`), so the deferred refresh, update check and iCloud time limits run in milliseconds |
| `config`, `args`, `module` | app, widget (`widget`, `family`), Shortcuts check (`query`, `shortcutParameter`, `inApp`) and the script's path (iCloud or the phone) |

The clock is fixed at **Thursday 29 October 2026, 10:32 in Vilnius** (`now` moves it), both in the script and in its pages, so the third lesson is on. TAMO's fixtures are an invented pupil, Ugnė Pavyzdytė (5A), and her brother Jonas (2B, with `tamo: { children: 2 }`): a five-lesson timetable for any week, homework (due tomorrow, overdue, done, a teacher's "-" placeholder), grades, attendance, a feed, a holiday, and messages (read, unread, important, a class-group one, one with an attachment and a link). `tamo: { down, fail: [path], deny: [path], badLogin }` simulates TAMO being unreachable, failing or refusing; `E.tamo` holds the data, so a test can add new items mid-run.

**The AI is simulated**: the Claude and OpenAI fixtures recognise the connection test and ✨ Ask's prompt, answer the question with fixed text, and keep every request in `E.log.ai` so a test can check what was sent (the grade scale, today's date, no child's name, no text of unread messages). `aiError` and `aiEmpty` make them fail.

`run(opts)` starts the script and returns `{ E, p }`, as in Stockit: `E.$`, `E.tap`, `E.text` and `E.input` work on the page on screen, `E.settle()` waits until nothing is happening, `E.until(fn, label)` waits for something, `E.check(ok, label)` records a failed check, `E.files`, `E.kc` and `E.log` are the phone and what the script did, `E.finish()` closes the app, and `p` settles when the script ends. Problems from every run in one scenario add up in `E.errors`.

## The scenarios

| Test | Covers |
|---|---|
| 01 first-start | The native sign-in prompt before the window, "Whose diary?", the loading placeholder, Today; cancelling opens nothing |
| 02 safe-startup | The empty first window, booting from handed-over data (the chat in pieces), iCloud never delivering `settings.json`, damaged files kept aside and saving again, another window holding the lock, the widget run, the start-up log |
| 03 no-icloud | A phone without iCloud: nothing touches iCloud, settings and updates stay on the phone |
| 04 today | The lesson now, today's lessons, getting ready for tomorrow, homework to do, today's messages, tests ahead, new this week; before and after school, a holiday, Lithuanian |
| 05 schedule | Week days, a lesson's details and attachment, next week with a day off, a week loaded on demand, a week that fails |
| 06 homework | Due-date groups, To do / All / Done, overdue, the badge, placeholders hidden, files |
| 07 messages | The 7-day chart and unread, day filter, opening a message (marked read), links and attachments in Safari, the class group, a failed message |
| 08 grades | Averages, recent grades, formative assessments, attendance, the grade scale (1–7, Other…) |
| 09 children | The row of children, the add-photos card, switching child (same sign-in; saved data first), a scale per child, removing a photo |
| 10 refresh-and-news | Refresh, the new-items popup, New since last check, opening items, Mark all as seen, nothing older than 21 days |
| 11 offline-and-errors | Offline with and without saved data (the saved diary is never overwritten), failing and refused sections, an expired session |
| 12 bad-login | TAMO refuses the password: Change sign-in details (cancel, then new details), Try again |
| 13 settings | Section order, appearance, tunables (steps, clamping, Reset, Reset all), grade scale, Updates, Built with, refused keys and links, language on Done, no keys in settings |
| 14 account-logout | Switch child and change sign-in details from Settings; Log out with two taps removes everything about the account; Sign in again |
| 15 ai-settings | Add a key, models, Test connection, pick a model, use OpenAI, remove keys with two taps, token usage, masked keys, the old 1.4 key migrated |
| 16 ask | Gathering everything (unread stays unread), suggested and typed questions with the whole conversation, the prompt's contents, the chat kept across launches, Refresh data, Clear memory |
| 17 ask-openai-and-errors | OpenAI requests, rate limit, too long, empty answer, a question waiting for a key |
| 18 ai-invitation | The card after the launch screen, Later (3 days), Turn on AI, Don't remind me again, Lithuanian, never with an update offer |
| 19 updates | The offer and its highlights, Later (no check for 2 days), Check now, a stale or broken download, Update now, offers off, Lithuanian |
| 20 scheduled-check | Shortcuts "check": no sign-in, first check, nothing new, notification and Shortcut output, Open from the in-app alert, refused sign-in, offline |
| 21 widget | Every size, Open to sign in, refresh when old, amber "Updated …", a child by name, Lithuanian, the saved diary as fallback, no grades or message text |
| 22 usage-analytics | The one-time question, No, Yes and what is sent (anonymous only), the test button, turning it off |

## Add a test

Copy the closest scenario in `tests/cases/` to `NN-what-it-covers.test.js` and keep its shape: start with `H.run()`, `await E.settle()`, tap through, print one line per step (A, B, C…), add an `E.check` for what must hold, and end with `console.log("errors:", …, "| JS errors:", E.log.jsErrors || "none")`, which is what `run.js` reads. Use `H.signedIn()`, `H.withKey()` and `H.quiet()` (settings that keep the one-time cards out of the way) to start from a known phone. If Dienynas+ calls a new endpoint or service, add its fixture to `harness.js` next to the others (match on the URL, answer with the smallest realistic JSON shaped like the real response) and record what the test needs in `E.log`. For a new AI feature, recognise its prompt in `aiRoute` and keep the request.

## Screenshots

```sh
cd tests
npm install playwright && npx playwright install chromium   # once
node screens/run.js       # PNGs in <tmp>/dienynas-screens/shots, or $DIENYNAS_SHOTS
```

`screens/run.js` builds the main screens with the harness (Today, Ask, Homework, Schedule, Messages, Grades, Lithuanian, the children's card, Settings, AI settings, the update sheet, dark mode, and the widget in three sizes), saves each page without its scripts, and has Chromium draw it at 390 × 844 points, 2×. Use them to look at a change. The README's labelled cards are made separately by [repo-site](https://github.com/gadominas/app-blueprints/tree/main/repo-site) from `docs/site/scenario.js`.

## What it doesn't cover

Real network answers (TAMO's API is undocumented and can change; check on the phone after a change there, and the AI providers change their models), how iOS and WebKit draw the page, native alerts, notifications and widgets (the widget is checked as a tree of texts and colours, not pixels), real iCloud timing, the photo picker and cropping, opening files in Safari, Shortcuts automations themselves, the installer (`install.js`), the page's minute-by-minute "now" refresh, and speed on a real phone. Those are checked on the iPhone before a release.
