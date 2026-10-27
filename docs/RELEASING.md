# Releasing a new version

`releases.json` is the single source of truth for versions and release notes. The app reads it from GitHub to decide whether to offer an update, and uses it to pitch the update to users.

## Steps

1. **Bump the version** in `Dienynas.js`: `const VERSION = '1.5.0';`. Use [semantic versioning](https://semver.org): a new feature bumps the middle number, a fix-only release the last.
2. **Add a release at the top of `releases.json`**, with the same version.
3. **Regenerate the changelog**: `node tools/changelog.js`.
4. **Commit everything to `master` in one push**: the script, `releases.json` and `CHANGELOG.md`.

Users see the update the next time they open Dienynas. GitHub can take a few minutes to serve new files.

## Release entry format

```json
{
  "version": "1.5.0",
  "date": "2026-11-02",
  "title": "Short headline for the update sheet",
  "highlights": [
    { "icon": "🔔", "title": "Feature name", "text": "One sentence on what it does for the user." },
    { "icon": "⬆️", "title": "Feature name", "text": "One sentence on what it does for the user." },
    { "icon": "✨", "title": "Feature name", "text": "One sentence on what it does for the user." }
  ],
  "changes": ["Everything new, one line each"],
  "fixes": ["Every bug fixed, one line each"]
}
```

Optional, for Lithuanian users: add `"lt": { "title": "…" }` to the release and `"lt": { "title": "…", "text": "…" }` to each highlight. The update sheet uses them when the app is set to Lithuanian and falls back to English otherwise.

## Writing good highlights

The three highlights are the update pitch. They are the first thing a user reads before deciding to update.

- **Exactly three**, ordered by how much a user will care.
- **Title:** two to four words, naming the benefit rather than the implementation.
- **Text:** one sentence, under 100 characters, saying what the user can now do.
- **Icon:** one emoji.

If a user skipped several versions, the pitch shows the newest release's highlights first and fills any gaps from older releases they missed.

## Behaviour in the app

- Dienynas checks `releases.json` once per run, in the background, without slowing the start.
- **Update now** downloads the script over the current one; the user reopens Dienynas to start the new version.
- **Later**, or tapping outside the sheet, hides the pitch for two days.
- Users can turn checks off with `CHECK_UPDATES: false` in the `CONFIG` block at the top of `Dienynas.js`.
- Keep the version line exactly as `const VERSION = '…';` with single quotes, and never change `const APP_ID = 'dienynasplus';`. The updater uses both to confirm a download is a newer Dienynas before writing it.

## Testing an update

Temporarily set `VERSION` lower than the newest release in `releases.json` on GitHub and run the app: the update sheet should appear. To bring back an offer snoozed with Later, run `Keychain.remove('dienynasplus-update-snooze')` in a scratch Scriptable script.
