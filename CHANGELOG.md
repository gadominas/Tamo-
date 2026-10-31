# Changelog

All notable changes to Dienynas+. Generated from `releases.json`; edit that file, not this one.

## 1.14.0 (2026-11-01): Log out any time

- 🚪 **Quick log out**: Tap the selected child's photo at the top and choose Log out.
- 🧹 **Leaves nothing behind**: Sign-in, children's data and photos, chats and AI keys are removed from the phone.
- 🔑 **Sign straight back in**: A Sign in button right after logging out; no need to restart the script.

**Changes**

- Log out in the selected child's menu (tap their photo), with a confirmation that says what is removed
- Settings › Account: Sign out and forget password is now Log out, with what it removes spelled out
- After logging out, a Sign in button signs in again in place
- Logging out also resets the add-photos suggestion for the next account

**Fixes**

- Signing out ended on "Run the script again to sign in" with no way forward

## 1.13.0 (2026-11-01): Room for every child

- 👨‍👩‍👧‍👦 **Up to four children**: With several children the top shows just their photos, so up to four fit.
- 🖼️ **Photos on first launch**: A card on Today helps you add a photo for each child the first time.
- 🔤 **Short names until then**: A child without a photo shows initials and a short first name.

**Changes**

- Several children: the header shows only round photos, in a fixed order; children without a photo show initials and their first name; up to four fit beside the buttons at 375 px
- Add a photo for each child: a card on Today the first time there are several children and some lack a photo; tap a child to pick one; Not now hides it for good
- One child: the header still shows the photo with the full name and class

**Fixes**

- Long names pushed the other children's photos off the header or squeezed them

## 1.12.1 (2026-11-01): Rounder photos

- ⭕ **Whole photo ring**: The selected child's photo and its ring now show as a full circle.
- ↔️ **Room to scroll**: With several children, the photo row scrolls without cutting any edges.
- 🌙 **Same in dark mode**: The ring stays whole in light and dark mode, at the top and while scrolling.

**Fixes**

- The selected child's photo ring was cut off at the top and left by the children row; the row now leaves room for it on every side

## 1.12.0 (2026-11-01): Switch children with one tap

- 👧 **One-tap child switch**: Every child's photo sits at the top; tap one to switch straight away.
- 🖼️ **Photos from your album**: Give each child a photo from your album so you always know whose diary it is.
- 🔔 **News you can find**: Everything a check reports stays on Today until you mark it as seen.

**Changes**

- Children row in the header (photo or initials): tap another child to switch on the same sign-in; their saved data shows at once while fresh data loads
- Tap the selected child to choose, change or remove a photo from the album (square crop, kept on the phone); it replaces the logo in the header
- The header stays on top and shrinks while scrolling
- Saved diary kept per child; Settings › Account › Switch child lists the children instead of signing in again
- New since last check on Today, with every item a check announced; tap a message to open it, a grade or homework to jump to its tab; Mark all as seen clears it
- The news popup appears inside the app on start and after Refresh, instead of a system alert
- Screenshots: a second invented child, an invented photo, a new Switch children card

**Fixes**

- Old teacher notes and absences could be announced again as new: TAMO's notification feed has no ids, so they're now matched by content
- Items older than 21 days are never announced as new
- Popup items that couldn't be found anywhere in the app
- Screenshots: the update card offered an old version (1.9.0), so the update sheet no longer appeared

## 1.11.0 (2026-10-31): Anonymous usage, if you agree

- 📊 **Help shape Dienynas+**: If you agree, Dienynas+ sends anonymous counts of the features you use. Nothing else.
- 🔒 **Anonymous by design**: A random ID made on your phone, never your content, names or accounts.
- 🎛️ **Your choice, any time**: Settings › Privacy turns it on or off, and Send test shows what happened.

**Changes**

- Anonymous usage analytics (app-blueprints · usage-analytics 1.1.0): opt-in, anonymous counts to PostHog's US cloud, with a one-time question and Settings › Privacy (switch and Send test)
- Events: app_open (layout, theme, ai_key, language), tab_viewed (tab), data_refreshed, message_opened, file_opened, ask_answered (provider), child_switched, app_updated
- Never sent: grades, subjects, messages, names, questions or answers, files or your TAMO account

## 1.10.0 (2026-10-31): Clearer Settings

- 🗂️ **Sections you can see**: Each Settings section now sits in its own card, so you can tell where it starts and ends.
- 🔤 **Quieter headings**: Section names are small grey capitals, so they no longer look like settings.
- 🎨 **In every palette**: The cards follow your colours, text size and layout, light or dark.

**Changes**

- Settings (app-blueprints · settings 1.1.0): each section's rows sit in one card, with a thin border and a slightly lighter background, under a small muted uppercase heading
- The changed-count line and a section's explanation sit outside the cards; Built with is a card too

## 1.9.0 (2026-10-30): Opens every time

- 🚀 **Opens every time**: Opening from the widget, with quick taps or slow iCloud no longer leaves a blank screen.
- ✦ **Meet Ask**: Without an AI key, a short card now and then shows what ✨ Ask can do and leads to AI settings.
- 🧾 **A start-up log**: Settings › Updates › Start-up log shows what happened the last times the app opened.

**Changes**

- Safe start-up (app-blueprints · recipes/safe-startup 1.1.0): the app shows an empty dark window first, then the launch screen and a "Loading your diary…" placeholder inside it, and only then reads the saved diary and hands it to the page
- Only settings are read before the window, and an iCloud read gives up after 10 s instead of waiting for ever; settings and AI token usage that couldn't be read are never saved over
- A settings or AI token usage file that arrived damaged (not valid JSON) is kept as <name>.broken-<time>.json next to it and started fresh, and a short note says so (in English or Lithuanian); saving then carries on as usual
- Every page load (fresh data from TAMO, a new language or grade scale) gets its data after the page is on screen, the Ask conversation in pieces, each step with a time limit
- One window at a time: quick taps on the widget open one window, and a new run never waits more than 1.5 s for an older one
- TAMO is asked 0.7 s after the first screen, the update check runs at 3.5 s and the widget icon is fetched at 6 s, so none of them competes with the first frame
- A short start-up log is kept on this iPhone (timings only: no names, school data or sign-in details) and shown in Settings › Updates › Start-up log; a start-up that stalls for 25 s or fails says so on screen
- AI invitation (app-blueprints · ai-invitation 1.2.1): without an AI key, a card names three things ✨ Ask does (ask anything about the school week, what's due tomorrow and what to pack, teachers' messages summed up), in English or Lithuanian; Turn on AI opens AI settings with Add key highlighted on the provider in use
- The invitation appears at most every 3 days (weekly after the fourth Later), never over the launch screen, a sheet or a message, never on a launch that offers an update, and Don't remind me again ends it; removing the last key invites again from the next launch
- Settings › Built with lists AI invitation 1.2.1; docs/BLUEPRINTS.md records the safe-startup recipe 1.1.0

**Fixes**

- A blank screen when opening Dienynas+ from its widget, after several quick taps, or with iCloud slow or offline
- With iCloud slow or offline, opening the app could save default settings over the saved ones (an unread settings file looked like a first run)
- A damaged settings or usage file no longer stops Dienynas+ from saving: it is copied aside and started fresh, instead of every later change being lost
- Turn on AI in the invitation highlights Add key on the card of the provider in use

## 1.8.0 (2026-10-29): Today at a glance

- 🧩 **A widget that matches**: The logo, the child's name and the lesson now or next, in the frame all the apps share.
- 📝 **The day in one look**: Homework due tomorrow, today's messages and the lessons left, with no grades or message text.
- 👧 **One widget per child**: Type a child's name in the widget's Parameter; old data shows when it was updated.

**Changes**

- Home Screen widget redrawn in the shared widget frame (app-blueprints · widgets 1.0.0): Dienynas+ logo tile and name on the brand's dark ground, the child's first name as a badge, the current lesson ("Now 12:15–13:00") or the next one ("Next 13:10") with the lesson after it, then homework due tomorrow (and late), today's messages (and unread) and the rest of today's lessons; the footer says how many lessons are left today
- Small, medium, large and the three Lock Screen sizes; every widget string follows the app language (Lithuanian or English)
- Widget parameter: a child's name picks that child when the account has more than one; each child's widget data is saved when the app shows that child
- The widget keeps its own small snapshot (lesson times and subjects, homework due dates, message dates): no grades, no message text, no sign-in details; it is saved after TAMO answers in the app or in the Shortcuts check and emptied on sign-out
- The widget still asks TAMO itself when its data is older than Settings › Widget › "Widget reuses data younger than", now within one TAMO request time limit in total, and shows the last snapshot when TAMO doesn't answer in time
- New setting: Settings › Widget › "Mark the widget as out of date after" (12 hours by default); older data reads "⟳ Updated …" in amber
- Widget runs never build the app's screen and never show an error: a problem gives "Open to sign in" or a plain "Tap to open" tile
- Follows the shared widgets blueprint 1.0.0; Settings › Built with lists it

## 1.7.0 (2026-10-29): Messages. Homework. Calm.

- 📅 **A logo of its own**: A week calendar with a teal homework day and a blue plus on the selected day.
- 🎬 **Launch screen**: The calendar draws itself and the tagline appears for about 2 seconds; tap to skip.
- ✨ **Branded everywhere**: The logo sits in the header, on the loading and sign-in screens and in the README.

**Changes**

- New Dienynas+ logo (calendar plus): docs/logo.svg and a 1024 px app icon, docs/icon-1024.png
- Launch screen shown for 2.4 s with a short animation and the tagline "Messages. Homework. Calm." ("Žinutės. Užduotys. Ramybė." in Lithuanian); tap to skip; still with Reduce Motion
- Follows the shared launch-screen blueprint 1.0.0; Settings › Built with lists it
- Logo mark in the header next to the child's name, the logo on the loading, sign-in and error screens, and at the top of the README
- Fresh data waits for the launch screen to fade before it replaces the saved diary, so the launch screen is never cut short

## 1.6.0 (2026-10-28): Make it yours

- 🎨 **Colours and layout**: Six colour palettes or Auto, plus Comfortable, Compact or a one-line Tiny layout.
- 🔠 **Text size and font**: Pick Small to Larger text and a rounded or serif font for headings.
- 🎛 **All settings in one place**: Language, grade scale, Ask, account and updates, with Reset for every number.

**Changes**

- New Settings sheet (sliders icon) replaces the ••• menu: Appearance, General, Grades, Ask, Account, Updates, tunables and Built with; changes apply at once
- Appearance shared with the other apps: Auto plus six palettes (TAMO blue in all), Comfortable, Compact or Tiny layout, four text sizes, rounded or serif headings
- Tiny layout: one line per lesson, homework item and message; tap an item to see all of it
- Tunables with ranges and Reset: what Ask reads (weeks, messages, refresh age), TAMO time limit, widget refresh and cache
- The Settings sheet follows the app language (Lithuanian or English)
- Language and grade scales move from the Keychain to settings.json in iCloud Drive › Scriptable › DienynasPlus; your choices move over automatically
- Check for updates now, in Settings › Updates
- The widget uses the palette chosen in Settings
- Built with: the blueprints this app follows, with links to read them

## 1.5.0 (2026-10-28): Ask with Claude or OpenAI

- 🤖 **Claude or OpenAI**: ✨ Ask answers now work with either provider. Switch any time in AI settings.
- 🧠 **Pick any model**: Load the models your own key can use, choose one and test the connection.
- 📊 **See your token usage**: Tokens per day, feature and model, so you always know what AI costs you.

**Changes**

- New AI settings sheet (••• › AI settings): Claude and OpenAI keys, model picker loaded from your key, connection test, token usage per day, feature and model
- Keys are entered in a native secure prompt and stored in the iOS Keychain; the page only ever sees them masked
- ✨ Ask goes through one shared AI call, following the app-blueprints AI configuration, and keeps the whole conversation with either provider
- The ✨ Ask tab stays hidden until a key is saved
- Every Ask answer is labelled with the provider that wrote it
- Your existing OpenAI key moves over automatically
- The thinking-effort setting is gone: choose a model instead

## 1.4.0 (2026-10-27): Never miss an update

- 🔔 **Update reminders**: The app tells you when a new version is out, and waits two days if you tap Later.
- ⬆️ **One-tap update**: Update right from the app. No need to run the installer again.
- ✨ **See what's new first**: Every update shows its three best features before you install it.

**Changes**

- Update check on start, with an update sheet showing the release's three highlights
- Later, or tapping outside the sheet, snoozes the offer for two days (CONFIG.CHECK_UPDATES turns checks off)
- Update now downloads the script over the running one after checking it's this app and actually newer
- Version shown at the bottom of every screen
- releases.json as the single source of release notes; CHANGELOG.md generated from it by tools/changelog.js
- install.js installer and a shorter Install section near the top of the README

## 1.3.0 (2026-10-25): Know the moment something's new

- 🔔 **New-items alerts**: Scheduled checks tell you about new homework, grades, messages and teacher notes.
- 💬 **Popup or notification**: See news as a popup in Scriptable, or as a notification in the background.
- 🙈 **No repeats**: Each item is shown once, and the first check only records what's already there.

**Changes**

- Run with the parameter check (Shortcuts) or ?check=1 to look for new homework, grades, messages and teacher notes
- Popup alert inside Scriptable, notification in the background, same text as the Shortcut output
- Opening the app also pops up anything new since the last run

## 1.2.1 (2026-10-25): A tidier Today screen

- 🎒 **One chip per subject**: Double lessons no longer show the same subject twice under Get ready.
- 🏷️ **Labels kept**: Test and project labels stay on the subject's single chip.
- 📋 **Cleaner tests list**: Upcoming tests appear once, even when marked on both lessons of a double.

**Fixes**

- Get ready for…: duplicate subject chips from double lessons
- Tests and checks ahead: duplicate entries for the same subject and label on one day

## 1.2.0 (2026-10-25): Ask knows everything, and remembers

- 🧠 **Ask pulls everything**: A chat starts with all homework, grades and attendance since 1 September.
- 💾 **Remembers the chat**: Follow-up questions work, and the conversation is still there tomorrow.
- 🔢 **1–7 grade scale**: Pick each child's grading scale so averages and Ask judge grades correctly.

**Changes**

- Ask gathers 5 weeks of lessons, homework and grades since 1 September, classwork, calendar, notices and messages
- Whole conversation sent with every question and saved per child on the phone
- Clear memory button (tap twice) and Refresh data
- Grade scale per child (1–10, 1–7, 1–5 or custom) from the Grades tab or the ••• menu

## 1.1.0 (2026-10-23): Ask about the school week

- ✨ **Ask in your words**: Ask what's due, which tests are coming or what the school wrote.
- 🔒 **Your key stays put**: Your OpenAI key is saved once in the iPhone Keychain, only sent to OpenAI.
- 🗣️ **Lithuanian or English**: Answers come in the language you ask in, quoting school text as written.

**Changes**

- ✨ Ask chat screen with suggested questions, using the OpenAI Responses API

## 1.0.0 (2026-10-23): First release

- 📅 **Today on one screen**: Current lesson, what to prepare for tomorrow, homework due and today's messages.
- 📝 **Homework by due date**: All homework grouped by due date, with overdue work marked.
- ✉️ **Messages per day**: A 7-day chart of messages, grouped by day, with unread ones highlighted.

**Changes**

- Today, Schedule, Homework, Messages and Grades screens, Lithuanian and English, light and dark
- Home-screen widget, offline cache, several children on one account
- Credentials kept in the iOS Keychain
