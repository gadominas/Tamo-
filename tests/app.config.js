// Dienynas+'s per-app values for the app-blueprints testkit (recipes/testing.md › Per-app values). Starting point: packs only.
module.exports = {
  name: 'Dienynas+',
  script: '../Dienynas.js',
  folder: 'DienynasPlus',
  settings: { usageAsked: true, shareUsage: false, aiInvite: { off: true }, photosAsked: true },
  // Signed in (fake credentials): without them the app asks with an Alert before any window
  seed: () => ({ kc: { 'dienynasplus.username': 'demo.tevai', 'dienynasplus.password': 'not-a-real-password' } }),
  fresh: { kc: { 'dienynasplus.username': 'demo.tevai', 'dienynasplus.password': 'not-a-real-password' } },   // a first start, already signed in
  offline: ['https://'],   // the app's own hosts aren't faked yet: they fail like a phone without a connection
  legacyCases: true,
  // Offline with no saved diary the app shows its "Try again" page, which has no update sheet. Until TAMO's fixtures move
  // here from harness.js the update offer can't be checked (GitHub answers while TAMO doesn't: no real phone is like that).
  // The same holds for Settings: the Try again page has no Settings button. Built with's About sheet is checked by 13-settings.
  skipPacks: { 'in-app-updates': 'needs TAMO fixtures', settings: 'needs TAMO fixtures (13-settings checks Built with)' },
};
