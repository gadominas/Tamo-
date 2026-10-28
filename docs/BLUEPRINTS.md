# Blueprints

Dienynas+ (Tamo+) follows the shared blueprints in https://github.com/gadominas/app-blueprints.
The script's `BLUEPRINTS` block is the source of truth; this table mirrors it and adds deviations.

| Blueprint | Version | Since app version | Deviations |
| --- | --- | --- | --- |
| [in-app-updates](https://github.com/gadominas/app-blueprints/blob/in-app-updates-v1.0.0/blueprints/in-app-updates.md) | 1.0.0 | 1.4.0 | Release highlights may carry Lithuanian text (`lt`), shown when the app language is Lithuanian |
| [settings](https://github.com/gadominas/app-blueprints/blob/settings-v1.0.0/blueprints/settings.md) | 1.0.0 | 1.6.0 | The sheet follows the app language (Lithuanian labels for Appearance and all sections); the default headline font is rounded (SF Pro Rounded) rather than sans serif; sheet CSS is scoped under `#cfgsheet` because the app already uses `.seg`, `.sheet` and `.chip`; the old colour names are kept as aliases of the shared tokens, plus app colours `--mark`, `--markInk` and `--green` per palette; the Tiny layout is done with CSS on the existing rows (tap a row to expand); per-child grade scales live in `settings.gradeScales`; account actions (switch child, sign-in, sign out) sit in an Account section |
| [ai-configuration](https://github.com/gadominas/app-blueprints/blob/ai-configuration-v1.0.0/blueprints/ai-configuration.md) | 1.0.0 | 1.5.0 | The app's own Ask limits are tunables in the Settings registry; AI settings and usage live in `dienynas-plus-ai-settings.json` and `dienynas-plus-usage.json`; `aiCall` also accepts a whole conversation for Ask; no background AI jobs, so “What AI does” has no switch; the AI sheet's wording is English in both languages |
