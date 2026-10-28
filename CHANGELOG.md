# Changelog

All notable changes to Dienynas+. Generated from `releases.json`; edit that file, not this one.

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
