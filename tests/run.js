#!/usr/bin/env node
// Runs every scenario in tests/cases against the real Dienynas.js (see docs/TESTING.md).
//   node tests/run.js              all tests, one line each
//   node tests/run.js widget       only tests whose name contains "widget"
//   node tests/run.js -v widget    and print everything they print
// A test passes when it exits normally and reports no script errors, page errors, failed checks, unmocked requests or crash.
const { spawnSync } = require("child_process");
const fs = require("fs"), path = require("path");
const args = process.argv.slice(2), verbose = args.includes("-v") || args.includes("--verbose");
const filter = args.filter(a => !a.startsWith("-"));
const dir = path.join(__dirname, "cases");
const cases = fs.readdirSync(dir).filter(f => f.endsWith(".test.js")).sort().filter(f => !filter.length || filter.some(q => f.includes(q)));
if (!cases.length) { console.log("No tests match " + filter.join(" ")); process.exit(1); }
let failed = 0;
const started = Date.now();
for (const f of cases) {
  const t0 = Date.now();
  // The phone is in Vilnius: the script and its pages read local times
  const r = spawnSync(process.execPath, [path.join(dir, f)], { encoding: "utf8", timeout: 240e3, cwd: __dirname, env: Object.assign({}, process.env, { TZ: "Europe/Vilnius" }) });
  const out = (r.stdout || "") + (r.stderr || "");
  const lines = out.split("\n").filter(l => l && !/^\s+at |Not implemented/.test(l));
  // Every scenario ends with a line like "errors: none | JS errors: none"; anything else there is a failure
  const bad = lines.filter(l => /\bCRASH\b|^SCRIPT |^UNMOCKED |Uncaught/.test(l) || (/(^|\s)(errors|ERRORS|JS errors):/.test(l) && /(errors|ERRORS|JS errors):\s*(?!none)\S/.test(l)));
  const ended = lines.some(l => /^errors: /.test(l));
  const ok = r.status === 0 && !r.error && !bad.length && ended;
  if (!ok) failed++;
  console.log(`${ok ? "✓" : "✗"} ${f.replace(".test.js", "")}  ${((Date.now() - t0) / 1000).toFixed(1)}s${r.error ? "  (" + r.error.code + ")" : ""}`);
  if (!ok) for (const l of (bad.length ? bad : lines.slice(-6))) console.log("    " + l.slice(0, 400));
  if (verbose) for (const l of lines) console.log("    " + l.slice(0, 400));
}
console.log(`\n${cases.length - failed} of ${cases.length} passed in ${((Date.now() - started) / 1000).toFixed(0)}s`);
process.exit(failed ? 1 : 0);
