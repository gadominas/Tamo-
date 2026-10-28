# Blueprints

Dienynas+ (Tamo+) follows the shared app blueprints in [gadominas/app-blueprints](https://github.com/gadominas/app-blueprints), so it looks and behaves like the other apps. Coding agents: read that repository's [AGENTS.md](https://github.com/gadominas/app-blueprints/blob/main/AGENTS.md) before changing these parts.

| Blueprint | Blueprint date | Applied in version | Deviations |
| --- | --- | --- | --- |
| [in-app-updates](https://github.com/gadominas/app-blueprints/blob/main/blueprints/in-app-updates.md) | 2026-10-27 | 1.1.0 | none |
| [ai-configuration](https://github.com/gadominas/app-blueprints/blob/main/blueprints/ai-configuration.md) | 2026-10-28 | 1.5.0 | The app's own Ask limits are named `ASK` (the blueprint owns `AI`); AI settings and usage live in `dienynas-plus-ai-settings.json` and `dienynas-plus-usage.json`; `aiCall` also accepts a whole conversation for Ask; no background AI jobs, so “What AI does” has no switch; the AI sheet's wording is English in both languages; Settings is a native ••• menu, whose “AI settings” entry opens the sheet |
