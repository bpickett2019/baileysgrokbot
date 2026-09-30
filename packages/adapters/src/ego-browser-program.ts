/** Fixed host-side program. Only JSON data, never agent JavaScript, is supplied to it. */
export const EGO_BROWSER_PROGRAM = String.raw`
let completed = 0;
let dispatched = false;
let page;
let label = input.page;
function allowed(url) {
  try {
    const parsed = new URL(url);
    return /^https?:$/.test(parsed.protocol) && !parsed.username && !parsed.password && input.allowedOrigins.includes(parsed.origin);
  } catch { return false; }
}
function elementsFor(tree) {
  const elements = [];
  for (const line of tree.split("\n")) {
    const ref = /\[ref=(\d+)(?=[,\]])/.exec(line);
    if (!ref) continue;
    const role = /^\s*([\w-]+)/.exec(line)?.[1] || "element";
    const name = /"([^"\n]*)"/.exec(line)?.[1] || "";
    elements.push({ ref: "e" + ref[1], role, name });
  }
  return elements;
}
async function observe() {
  const info = await page.info();
  if (!allowed(info.url)) throw new Error("The current Ego page is outside the configured origins. Ask the operator to review it; do not switch browsers.");
  if (info.dialog) throw new Error("A browser dialog needs human review in Ego.");
  const tree = String(await page.snapshot({ scope: "full_page" })).slice(0, 120000);
  const after = await page.info();
  if (after.url !== info.url || !allowed(after.url)) throw new Error("The page changed since observation. Take a fresh browser_snapshot before acting.");
  // Refs stay native inside Ego; expose the same eN notation as Rakazo's page tools.
  return { url: info.url, title: info.title || "", tree: tree.replace(/\[ref=(\d+)(?=[,\]])/g, "[e$1"), elements: elementsFor(tree) };
}
try {
  // Numeric ID only: never create/claim/recover a task space automatically.
  const task = await taskSpace(input.taskSpaceId);
  if (task.ownership !== "agent") throw new Error("Ego control belongs to the user. Wait for explicit handback.");
  page = task.page(label);
  if (input.command === "navigate") {
    if (!allowed(input.url)) throw new Error("Navigation origin is not configured.");
    dispatched = true;
    await page.goto(input.url, { waitUntil: "domcontentloaded", timeout: 20000 });
    dispatched = false;
  } else if (input.command === "act") {
    for (const action of input.actions) {
      const info = await page.info();
      if (!allowed(info.url) || info.url !== input.observedUrl) {
        throw new Error("The page changed since observation. Take a fresh browser_snapshot before acting.");
      }
      if (info.dialog) throw new Error("A browser dialog needs human review in Ego.");
      const selector = "@" + action.ref.slice(1);
      dispatched = true;
      let receipt;
      if (action.kind === "click") receipt = await page.click(selector);
      else receipt = await page.fill(selector, action.text, { clearFirst: action.kind === "fill" });
      completed += 1;
      dispatched = false;
      if (receipt?.dialog) throw new Error("A browser dialog needs human review in Ego. Do not replay the completed actions.");
      if (receipt?.popups?.length) {
        if (receipt.popups.length !== 1 || !/^p\d+$/.test(receipt.popups[0].label)) {
          throw new Error("Multiple or unmanaged popups need human review in Ego.");
        }
        label = receipt.popups[0].label;
        page = task.page(label);
        break; // Never replay remaining actions against a new tab.
      }
    }
  }
  const snapshot = await observe();
  const ok = input.command !== "act" || completed === input.actions.length;
  return { ...snapshot, ok, completed, uncertain: false, page: label,
    ...(ok ? {} : { error: "A popup opened. Inspect the new page before continuing with the remaining actions." }) };
} catch (error) {
  // SDK errors can contain supplied field values. Keep them out of agent/tool logs.
  const safe = [
    "The current Ego page is outside the configured origins. Ask the operator to review it; do not switch browsers.",
    "A browser dialog needs human review in Ego.",
    "Ego control belongs to the user. Wait for explicit handback.",
    "Navigation origin is not configured.",
    "The page changed since observation. Take a fresh browser_snapshot before acting.",
    "A browser dialog needs human review in Ego. Do not replay the completed actions.",
    "Multiple or unmanaged popups need human review in Ego.",
  ];
  return { ok: false, completed, uncertain: dispatched, page: label, url: "", title: "", tree: "", elements: [],
    error: safe.includes(error?.message) ? error.message : "Ego could not complete this step. Inspect Ego and its ownership state; ask for human help if needed. Do not replay uncertain actions or fall back to the sandbox browser." };
}
`;
