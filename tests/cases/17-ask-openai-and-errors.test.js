// ✨ Ask with OpenAI (a system message, no max_tokens), what the person sees when the AI fails (rate limit, too long,
// empty answer), and a key that's gone: the question waits, AI settings opens, and it's asked once a key is added.
const H = require("../harness");
(async () => {
  const kc = H.signedIn({ DIENYNASPLUS_OPENAI_KEY: H.KEYS.openai });
  const o = { kc, settings: H.quiet() };
  const { E, p } = await H.run(o);
  await E.settle();
  E.tap('[data-tab="5"]');
  await E.until(() => /In this chat/.test(E.text(".mem")), "gathered");
  const ask = async (q, n) => { E.getDom().window.document.querySelector("#q").value = q; E.tap("#send"); await E.until(() => E.$$(".bubble.assistant .badge-ai, .bubble.error").length >= n, "answer " + n); };
  await ask("What's due tomorrow?", 1);
  const req = E.log.ai.find((a) => a.kind === "ask");
  console.log("A OpenAI:", E.text(".bubble.assistant .badge-ai"), "| roles sent:", req.body.messages.map((m) => m.role).join(" → "), "| max_tokens:", req.body.max_tokens, "| model:", req.body.model, "| own key:", req.key === H.KEYS.openai);
  E.check(req.provider === "openai" && req.body.max_tokens === undefined && req.body.messages[0].role === "system", "OpenAI gets a system message and no max_tokens");
  const errs = [];
  for (const [label, set] of [["rate limit", () => { o.aiError = "Rate limit reached for requests"; }], ["too long", () => { o.aiError = "This model's maximum context length is 128000 tokens"; }], ["empty", () => { o.aiError = null; o.aiEmpty = true; }]]) {
    set();
    await ask("How are the maths grades going?", 2 + errs.length);
    const e = E.$$(".bubble.error").slice(-1)[0];
    errs.push(label + ": " + E.text(e));
  }
  console.log("B what the person sees:\n    " + errs.join("\n    "));
  E.check(/rate limit or quota/.test(errs[0]) && /grown too long.*Clear memory/.test(errs[1]) && /empty answer/.test(errs[2]), "plain words for each failure");
  console.log("  failed questions kept in the chat file:", E.json(H.local(`dienynas-plus-chat-${H.hashKey(H.roleKeyOf(H.CHILDREN[0]))}.json`)).history.length / 2, "(only answered ones)");
  o.aiEmpty = false;
  delete E.kc.DIENYNASPLUS_OPENAI_KEY;   // the key is gone (removed on another run)
  await ask("Any tests in the next two weeks?", 0);
  await E.until(() => E.$(".keycard"), "the key card");
  console.log("C no key:", E.text(".keycard"), "| question waits, not in the chat:", !E.$$(".bubble.user").some((b) => /tests/.test(b.textContent)));
  E.tap("#aiopen");
  await E.until(() => E.$('#aisheet [data-aiact="aikey"]'), "AI settings");
  E.alert([H.KEYS.openai]);
  E.tap('#aisheet .aicard.active [data-aiact="aikey"]');
  await E.until(() => E.log.ai.slice(-1)[0].question === "Any tests in the next two weeks?", "the waiting question asked");
  await E.settle();
  console.log("D key added → the waiting question was asked:", E.log.ai.slice(-1)[0].question, "| behind the sheet the app shows:", E.text("h1.date"));
  E.tap('#aisheet [data-aiact="aiclose"]');
  E.tap('[data-tab="5"]');
  await E.until(() => E.$$(".bubble.assistant .badge-ai").length >= 2, "the answer in Ask");
  console.log("  back in Ask:", E.text(E.$$(".bubble.assistant").slice(-1)[0]).slice(0, 60));
  E.check(E.$$(".bubble.user").some((b) => /tests/.test(b.textContent)) && !E.$(".keycard"), "the question is answered once a key exists");
  E.finish(); await p;
  console.log("errors:", E.errors.length ? E.errors.join(" ; ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
