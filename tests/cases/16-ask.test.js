// ✨ Ask: gathering everything TAMO has (unread messages stay unread), a suggested question and a typed follow-up with
// the whole conversation, what the prompt carries (grade scale, the time, never the child's name), the chat kept per
// child across launches, Refresh data and Clear memory.
const H = require("../harness");
(async () => {
  const key = H.roleKeyOf(H.CHILDREN[0]);
  const kc = H.withKey();
  let { E, p } = await H.run({ kc, settings: H.quiet({ gradeScales: { [key]: 7 } }) });
  await E.settle();
  const before = E.log.requests.length;
  E.tap('[data-tab="5"]');
  await E.until(() => /In this chat/.test(E.text(".mem")), "the data gathered");
  const gathered = E.log.requests.slice(before);
  console.log("A gathered:", E.text(".mem-p"));
  console.log("  weeks:", E.log.weeks.slice(-5).join(", "), "| requests:", gathered.length, "| message texts read:", E.log.tamoRead.join(","));
  E.check(!E.log.tamoRead.includes("9104") && !E.log.tamoRead.includes("9072"), "unread messages stay unread");
  console.log("  suggestions:", E.$$(".sugg button").map((b) => b.textContent).join(" | "));
  E.tap(E.$$(".sugg button").find((b) => /due tomorrow/.test(b.textContent)));
  await E.until(() => E.$(".bubble.assistant .badge-ai"), "the answer");
  console.log("B answer:", E.text(".bubble.assistant .badge-ai"), "|", E.text(".bubble.assistant").slice(0, 110));
  console.log("  formatted:", E.$$(".bubble.assistant b").map((b) => b.textContent).join(", "), "| list items:", E.$$(".bubble.assistant li").length);
  E.check(E.text(".bubble.assistant .badge-ai") === "✦ AI answer by Claude" && E.$$(".bubble.assistant li").length === 2, "labelled AI answer, bold and bullets");
  const ask = E.log.ai.find((a) => a.kind === "ask");
  const sys = ask.system;
  console.log("C prompt: grade scale", (sys.match(/"grade_scale":"([^"]+)"/) || [])[1], "| now:", (sys.match(/Now: ([^(]+)/) || [])[1].trim(), "| read message text included:", /trupmenas/.test(sys), "| unread text included:", /18 val/.test(sys));
  console.log("  child's name in the request:", /Ugnė|Pavyzdytė/.test(JSON.stringify(ask.body)), "| class:", (sys.match(/"class":"([^"]+)"/) || [])[1], "| max_tokens:", ask.body.max_tokens, "| model:", ask.body.model);
  E.check(/1–7/.test(sys) && /Thursday 2026-10-29, 10:32/.test(sys) && !/Ugnė|Pavyzdytė/.test(JSON.stringify(ask.body)) && !/18 val/.test(sys), "the child's own scale, today's date, no name, no unread text");
  E.getDom().window.document.querySelector("#q").value = "Any tests in the next two weeks?";
  E.tap("#send");
  await E.until(() => E.$$(".bubble.assistant .badge-ai").length === 2, "the second answer");
  const second = E.log.ai.filter((a) => a.kind === "ask")[1];
  console.log("D follow-up sent with the conversation:", second.body.messages.map((m) => m.role).join(" → "), "|", E.text(E.$$(".bubble.assistant")[1]).slice(0, 80));
  E.check(second.body.messages.length === 3, "the whole conversation goes with every question");
  const chatFile = H.local(`dienynas-plus-chat-${H.hashKey(key)}.json`);
  console.log("  kept on the phone:", E.json(chatFile).history.length, "lines | usage:", JSON.stringify(E.json(H.local("dienynas-plus-usage.json")).p.anthropic.features.ask));
  E.finish(); await p;

  ({ E, p } = await H.run({ kc, files: E.files }));
  await E.settle();
  const reqs = E.log.requests.length;
  E.tap('[data-tab="5"]'); await E.settle();
  console.log("E reopened: bubbles", E.$$(".bubble").length, "| asked TAMO again:", E.log.requests.length > reqs, "|", E.text(".mem-h"));
  E.check(E.$$(".bubble").length === 4 && E.log.requests.length === reqs, "the chat and its data come back without asking TAMO");
  E.tap("#memrefresh");
  await E.until(() => E.log.requests.length > reqs + 10, "a fresh gather");
  await E.settle();
  console.log("F Refresh data: asked TAMO", E.log.requests.length - reqs, "times");
  E.tap("#memclear");
  console.log("G Clear memory, first tap:", E.text("#memclear"));
  E.tap("#memclear");
  await E.until(() => !E.$(".bubble") && /In this chat/.test(E.text(".mem")), "cleared and gathered again");
  console.log("  cleared: bubbles", E.$$(".bubble").length, "| chat file:", E.json(chatFile) ? E.json(chatFile).history.length + " lines" : "deleted");
  E.check(!E.$(".bubble") && (!E.json(chatFile) || !E.json(chatFile).history.length), "two taps clear the conversation");
  E.finish(); await p;
  console.log("errors:", E.errors.length ? E.errors.join(" ; ") : "none", "| JS errors:", E.log.jsErrors || "none");
  process.exit(0);
})().catch((e) => { console.log("CRASH", e.stack); process.exit(1); });
