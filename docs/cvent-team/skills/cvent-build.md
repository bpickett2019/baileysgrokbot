---
name: cvent-build
description: "Build a Cvent event end to end from any RR (Registration Requirements) workbook: parse and validate the RR, then configure registration, discounts, questions, website, comms and badges in the target event, verify everything, and leave it unpublished. One bot, one browser."
---

# cvent-build

RR workbook in → drafted, verified, **unpublished** Cvent event out. One bot, one browser, this skill.

## Principles (every run)

1. **Ask, don't guess.** Every value needs an RR cell or a user answer. Anything else is a question.
2. **Verify, then move on.** Make the smallest change you can check, save it, and read it back.
3. **Never repeat an uncertain write.** If you can't prove a write failed, stop and look before doing anything else.
4. **See before you click.** Never act on a screen you haven't observed in this step.
5. **Two tries, then switch; three, then stop.** Change driver after two failed attempts, and ask the user after three.
6. **Leave the path behind.** Record what worked so the next run is shorter.

## Hard rules

- **Never** publish, go live, launch or activate. Never send or schedule an email, delete, archive, or clone. The publish step belongs to a human.
- **Stay inside the target event.** Never change account libraries, themes, templates, users, contact types or account-level discounts.
- **Sandbox by default.** Use production only when the user names it for this run.
- **Discount codes** are written only by `cvent_discounts_apply`. Never create, edit, activate or import a discount code in the Cvent UI or by file upload.
- **Passwords** go in only through `fill_secret` or `request_takeover`. Never put them in chat, files, shell or Playwright.

## Files

Run `shell` with `cwd: "shared"`. File tools use `shared/...`.

```
cvent-builds/tools/rr.py, cvent_pw.py        tools (Appendix A, B; written by skill_files)
cvent-builds/<FP>/cells.json                  every RR cell exactly as stored (evidence)
            plan.json plan.md                the plan (source of truth)
            validation.md validation.json    errors block their section
            decisions.md                     user answers, quoted; override the plan
            agent_plan.json code_map.json    your mappings and patches
            assets/ assets.json              images pulled from the RR
            status.md                        progress
            expected.json readback.json      every planned value / what Cvent shows
            qa.md qa.json                    the full comparison
cvent-learnings/procedures.md                how each Cvent screen works (shared, all runs)
```

## 0. Start

1. **Tools.** Call `skill_files` with `{"name": "cvent-build"}` at the start of every run. It writes the two tools from the appendices exactly, so never retype them. Then run
   `python3 -c "import openpyxl, playwright" 2>/dev/null || pip install --user openpyxl playwright`.
   No browser download is needed; Playwright attaches to the existing Chrome.
2. **Intake.** Collect:
   - the RR attachment;
   - the target event (URL or exact title);
   - sandbox or production;
   - the mode: **build** (the event *is* the RR's show) or **test-target** (load the RR into an existing test event without renaming it or changing its dates or code).
3. **Fresh sign-in.** Every run starts with a fresh login:
   - If Cvent is already signed in, use its Log Out first.
   - `fill` the Account Name, then `fill_secret` the username and password from the saved login. If there's no saved login, use `request_secret` with `auth: login` at the Cvent sign-in origin.
   - For MFA or SSO, use `request_takeover`.
4. **Verify the target.** Snapshot the event's title, code, dates and environment. In build mode they must match the RR identity (FP code, name, dates); in test-target mode, the exact title the user gave. On a mismatch, stop.

## 1. Plan

```bash
python3 cvent-builds/tools/rr.py extract "<absolute .xlsx path>" cvent-builds/_new   # realpath the attachment first
python3 cvent-builds/tools/rr.py plan cvent-builds/_new
python3 cvent-builds/tools/rr.py images "<absolute .xlsx path>" cvent-builds/_new
```

Read the FP code from `plan.md` and rename `_new` to `<FP>`. Use `--keep-test-codes` on `plan` only if asked. Convert `.xls` to `.xlsx` first.

**Coverage.** `plan.md` lists each section as `parsed`, `needs_mapping`, `agent` or `absent`.

**Evidence.** Nothing in the RR is dropped. `cells.json` holds every non-empty cell exactly as stored: value, number format, hyperlink and comment. Plan text is the cell text verbatim, minus leading and trailing spaces. Never retype, tidy or shorten it.
- Percent-formatted cells read as percentage points (`100%`, not `1`).
- A date with no year is flagged on the tier (`inferred`) and in the gaps. Confirm it with the user.
- Cell comments are planner notes. Read them for any row you build.

**Legacy registration (`needs_mapping`).** Old reg types like `ATT Attendee` and `EO Expo Only`, usually with a NEW REG MAPPING tab and sometimes Member/Non-Member columns. Write `agent_plan.json`:
`{"notes": "...", "registration": {"price_tiers": [...], "admission_items": [...], "reg_types": [...], "paths": [...]}}`.
The shapes match `plan.json`, and every reg type, item and path carries `"source": "Sheet!A16"`. Copy names, codes and prices from `cells.json` exactly as stored.
- Use the RR's own names and codes: the mapping tab, then the `registration.lookups` lists. A code that exists nowhere in the RR gets `"code_source": "proposed"` and goes on the user's question list.
- Take prices from the old row that maps to each new type and item. Member/Non-Member columns become separate reg types only if the mapping tab names them. A cell holding two values is a question.
- Skip EXAMPLES rows, dropdown lists, and rows with no Registration Method. Old rows with no mapping row are listed in `notes` as questions, never dropped silently.
- "Staff Only" and "Reg Ops" types go on a planner-only path (`web_visible: false`).

**Small fixes on a parsed plan.** Patch rather than rewrite:
`{"registration": {"path_assignments": {"STAFF": "Internal"}, "admission_item_codes": {"Full Access": "FULL"}, "price_tier_dates": {"Tier 2": {"start": "2026-09-01", "end": "2026-10-14"}}}}`.
Patch only what the RR states or the user decided.

**Images.** `assets.json` lists every embedded picture with its tab and cell.
- `template: true` means a stock reference picture, often another show's. Never use it as this event's art.
- Show-specific images (badge samples, screenshots of Cvent lists) are evidence. Look at them with `open_path` before mapping badges or codes.
- A header or logo comes only from a file the user uploads, or a show-specific RR image the user confirms.

**Validate, then approve.** Run `python3 cvent-builds/tools/rr.py validate cvent-builds/<FP>`.
1. Send the user, in this order:
   - `plan.md`;
   - the errors from `validation.md` (real RR problems such as overlapping tiers, a name where a code belongs, or a type with no path);
   - the open questions.

   Use `ask_user` where 2–4 options fit.
2. For discount admission-item codes such as `EO-PB`, offer two options:
   - map to the item for all reg types;
   - hold those codes. They aren't created, and they're listed for a human (the API tool can't limit a code to reg types).
3. Write the answers to `decisions.md`, apply them as `agent_plan.json` patches and `code_map.json` (`{"CODE": {"admission_item": "..."}}`, accepted entries only), then re-run `plan` and `validate`.
4. **Get an explicit OK before any Cvent write.** A section with validation errors is skipped and reported as blocked.

## 2. Build (in this order; finish one screen area before the next)

Before each screen, read `procedures.md`. After each save, read the saved values back and append a row to `status.md`:
`piece | done/blocked/skipped | built/planned | evidence | notes`.

**Matching existing records.** Match by code, then by exact name.
- If it matches, leave it.
- If it differs, edit it in place and record before → after.
- If it isn't in the RR, leave it and list it as pre-existing.
- If it's missing, create it.

Never delete, deactivate or rename anything to make it fit. Re-runs must never duplicate.

**A. Event shell.** Set only the fields the RR states: time zone, venue, capacity, registration deadline, languages, contact. In test-target mode, never touch the title, code or dates.

**B. Registration** (event Registration area):
- **R1 Reg types:** use `name` and `code` exactly. `web_visible: false` means planner/staff only.
- **R2 Paths:** one per `paths` entry, with exactly its reg types and group registration as flagged. Planner-only paths get no public link. Every type sits on exactly one path; if a type has no path, R2 is blocked.
- **R3 Admission items:**
  - name and code as in the plan;
  - description = additional text, then the RR description;
  - associate exactly the item's `reg_types`, which is how most availability rules get enforced;
  - capacity unlimited unless the RR gives one.
- **R4 Pricing:**
  - One fee window per plan tier, from 12:00 AM on `start` to 11:59 PM on `end` in the event time zone, contiguous with no overlaps.
  - Set amounts for every type × item × tier. `0` is an explicit $0.
  - Reprint fees and GL codes are not admission fees.
  - Verify by filling every `fee|…` entry in `readback.json` from the screen, then running `verify` (step G). Fix any fee it lists before moving on.
- **R5 Optional items, sessions, add-ons:** from `items` (groups by `kind`).
  - If `items` is empty, skip R5 unless `decisions.md` names items.
  - Skip `sessionboard_sync` = Yes; Sessionboard syncs those.
  - `{member, non-member}` prices are charged by the `member_fee_types` / `nonmember_fee_types` lists.
- **R6 Advanced rules:** `admission_item_availability` is usually already enforced by R3's associations. Otherwise add an event rule limiting that type to `allowed_admission_items`. Add only rules the RR states. `question_display` rules belong to step C.
- **R7 Discount codes (API tool only):**
  - Build the work file (Appendix C2), then run `cvent_discounts_check` with `{eventId, eventTitle, file}`.
    - The event UUID is in the planner URL. Never guess it.
    - Show the user the counts and the `attention` list.
    - After their OK, run `cvent_discounts_apply` with the same arguments plus the check's `fileSha256`. Repeat until `notInThisCall` is 0.
  - **If the tools are missing,** save the `cvent_api` credential: ask the user for the client ID, then `request_secret` with `{"name": "cvent_api", "origin": "https://api-platform.cvent.com", "auth": {"type": "basic", "username": "<client ID>"}}`. The user types the secret into the protected card, and the tools appear on the next message. If they still don't appear, R7 is blocked: report it and move on.
  - **Stop rules:**
    - `uncertain` or `stoppedEarly`: stop R7 and ask the user to check that code in Cvent. Never retry it, and never recreate it in the UI.
    - `preserved_difference`: the existing code was left alone; report it.
    - `blocked` and held codes (`discount_blocked.json`): report them for a human. Don't work around them.
- **R8 Vouchers and group discounts:** build only what the RR's voucher or group tabs list. Never turn discount codes into vouchers, and never create a discount code here.

**C. Questions and approvals.** For each question, in RR order:
- set the text, type, answers in order, required flag, which reg types see it, and its page;
- build parent questions before dependents, and apply `display_when`;
- reuse the account's standard questions (contact fields) instead of duplicating them;
- configure approvals per the event flags and `other_tabs` (Approvals or Approval Site Parameters), with no emails sent.

**D. Website** (Site Designer; save drafts only):
- **W1 Theme:** use the exact theme named in the plan. If it isn't there, W1 is blocked; list what you saw. Apply the brand colors in order (primary, secondary, background, highlights) and run the contrast check (Appendix C3). Save to this event only; never save to the account library.
- **W2 Header:** logo or banner from approved assets only; upload with Playwright (`upload`). Add an "Already Registered?" link to the event's own modify/login page if the RR asks. Apply the header to all pages.
- **W3 Footer:** the attendee audience is the default footer. Other audiences get their own footer on their paths' pages. Show only `visible` links, with the RR label and exact URL in RR order; external links open in a new tab. Contact Us is a `mailto:` link, and `cvent-generated` links go to the built-in page.
- **W4 Body widgets on the landing page:**
  1. Event information: title, date and venue bound to event fields, plus Add to Calendar with the RR text.
  2. Text: show hours as written in the RR, with no invented copy.
  3. Image: approved assets only, with alt text = event name.
  4. Registration actions: one Register button per web-visible path, plus the already-registered link.
  5. Countdown timer: to the first event day, with the RR label.
  6. Social: one link per network listed.

  Skip a widget only if the RR has nothing for it, and say so. Add widgets with drag-and-drop through Playwright (`drag`) when there's no click-to-add.

**E. Comms, policies, integrations.**
- **Comms:** only the RR's Yes rows (`communications`). Configure them as draft or inactive; if Cvent turns on a trigger by itself, report it and ask.
- **Policies:** as the RR states them.
- **Tracking snippets** (for example GTM): paste them exactly as given.

**F. Badges and onsite.** Badge layouts per type use `badge_text`, the RR's badge tab and show-specific badge images. Apply reprint fees and onsite and Scan & Go settings from `other_tabs`. Never activate devices or launch onsite mode.

**G. QA (every value, not samples).**
1. Run `python3 cvent-builds/tools/rr.py expect cvent-builds/<FP>` (add `--test-target` in that mode) after the final `plan`. It writes:
   - `expected.json`: one check for every value the plan puts in Cvent;
   - `readback.json`: every check id, set to `null`.
2. For each id, read what Cvent actually shows and write it in. Read through the API where a tool can read it, and from the screen otherwise. Never copy from the plan.
   - Text and codes: the string Cvent shows.
   - Money: the amount.
   - Dates: `YYYY-MM-DD`.
   - Booleans: `true` or `false`.
   - Sets and lists: JSON arrays. Footer links are `"Label -> URL"` in page order.
   - `judge` checks (time zone, question type, display logic, comms): `{"observed": "<what Cvent shows>", "ok": true|false}`.
   - Discounts: run `cvent_discounts_check` again after the last apply. `verify` reads its results file, and every code must be `unchanged`.
3. Run `python3 cvent-builds/tools/rr.py verify cvent-builds/<FP>`. It writes `qa.md` and `qa.json`, and exits 1 unless every check passes.
   - Fix each `fail` in Cvent, re-read it, and run `verify` again.
   - `unread` is a fail: read it.
   - Checks in sections that validation blocked show as `blocked`.
   - A check is waived only when the user decided it. Quote the decision in `decisions.md` (including the check id), and add `{"<id>": "<reason>"}` to `qa_waivers.json`.
4. Send the user one final report covering:
   - the QA table from `qa.md`;
   - each blocker, with the exact UI message;
   - pre-existing items that aren't in the RR;
   - held discount codes;
   - what is left for a human, including publishing.

## Browser: drivers and guards

**Driver order:**
1. **Page tools** (Ego provider or Team Computer). `browser_snapshot`, then up to 24 independent edits in one `browser_act`, using only refs from that snapshot.
   - Break the batch before a save, navigation, dialog or dependent field.
   - Read `completed` and `uncertain`, and never replay either.
2. **Playwright fallback** (`cvent_pw.py`). It drives the same signed-in Chrome over CDP.
   - Use it for uploads, native dropdowns, drag-and-drop, iframe content the page tools can't see, and whenever a guard below trips.
   - `python3 cvent-builds/tools/cvent_pw.py snapshot` gives numbered refs (`p12`, `f1p3`) for every control in every frame, plus the page text.
   - `echo '{"steps":[{"kind":"select","ref":"p4","value":"Eastern"}]}' | python3 cvent-builds/tools/cvent_pw.py act` runs steps, stops at the first failure and returns a fresh snapshot.
   - Refs are valid only until the next snapshot.
   - It refuses publish, delete and send controls, and password and secret fields, and it drives only a Cvent tab. Field values never appear as element names, and secret-looking fields show only `***`.
   - It attaches to the Team Computer's Chrome. Under the Ego provider that Chrome isn't signed in, so it answers "No Cvent tab": go to `request_takeover` instead, unless the user gave a DevTools endpoint for this run (`CVENT_PW_CDP=<url> python3 …`).
3. **Desktop** (`computer_observe` / `computer_act`). Only with an image from this step.

**Guards** (log each trip in `status.md`):
- **Blind guard.** If an observation comes back with no image or an empty tree, do not act on coordinates. Switch to the Playwright text snapshot, and treat everything done since the last good observation as unverified: re-read those fields before continuing.
- **Loop guard.** The same action on the same target twice with no visible change means switch to the next driver. A third time means stop and ask the user (`request_takeover` or `ask_user`). Never switch drivers more than twice on one piece.
- **Dialogs.** A popup is a new decision point. Choose Save, never "Save & Publish". If Save isn't offered, stop and ask.
- **Timeouts.** After a failure or timeout, observe the current state before deciding what's left. Waits are bounded re-observations, not sleeps.

## Procedures (gets better every run)

After a verified save, append one line per screen to `cvent-learnings/procedures.md`:
`Screen | navigation path | exact labels clicked | required fields | driver that worked | gotchas`.

Fix wrong lines instead of adding contradictions. Never record event data, IDs or credentials. Follow these lines before improvising.

## Appendix C: snippets (shell, `cwd: "shared"`, replace `<FP>`)

**C2 Discount work file** (held codes go to `discount_blocked.json`, never to the UI).
```bash
python3 - <<'EOF'
import json, os, re
plan=json.load(open("cvent-builds/<FP>/plan.json"))
known={i["code"] for i in plan["registration"]["admission_items"]}
p="cvent-builds/<FP>/code_map.json"
cmap={k:v for k,v in (json.load(open(p)) if os.path.exists(p) else {}).items() if v}
M={"Subtract an amount":"BY_AMOUNT","Subtract a percentage":"BY_PERCENTAGE","Charge a fixed price":"FLAT_PRICE"}
A={"invitees and guests":"ALL","invitees":"PRIMARY","guests":"GUEST","":"ALL"}
iso=lambda v: v[:10] if re.fullmatch(r"\d{4}-\d{2}-\d{2}( .*)?", v or "") else None
out, held = [], []
for c in plan["discounts"]["codes"]:
    items, why = [], []
    for code in c["admission_items"]:
        m = cmap.get(code)
        if m and m.get("reg_types"): why.append(f"{code}: needs a reg-type limit")
        elif m: items.append(m["admission_item"])
        elif code in known: items.append(code)
        else: why.append(f"{code}: not an admission item")
    if c["method"] not in M: why.append(f"method {c['method']!r}")
    if not re.fullmatch(r"\d+(\.\d+)?", str(c["amount"])): why.append(f"amount {c['amount']!r}")
    if why:
        held.append({"code":c["code"],"why":why,"source":c["source"]}); continue
    s={"code":c["code"],"name":(c["name"] or c["code"])[:50],"method":M[c["method"]],"value":float(c["amount"]),
       "active":c["active"],"stackable":c["stackable"],
       "capacity":int(c["capacity"]) if str(c["capacity"]).isdigit() else -1,
       "audience":A.get(c["usable_by"].lower(),"ALL"),"includeGuestsTowardsCapacity":not c["count_guests"].lower().startswith("no"),
       "admissionItems":list(dict.fromkeys(items)),"source":c["source"]}
    for k,v in (("effectiveFrom",iso(c["effective_from"])),("effectiveTo",iso(c["effective_to"]))):
        if v: s[k]=v
    name=c["name"] or c["code"]
    note=" | ".join(x for x in ((f"RR name: {name}" if len(name)>50 else ""), c["internal_note"]) if x)
    if len(note)>300: held.append({"code":c["code"],"why":["name and note exceed Cvent's limits"],"source":c["source"]}); continue
    if note: s["note"]=note  # Cvent names stop at 50 characters; the full RR name rides in the note
    out.append(s)
json.dump({"discounts":out},open("cvent-builds/<FP>/discounts_api.json","w"),indent=1)
json.dump(held,open("cvent-builds/<FP>/discount_blocked.json","w"),indent=1)
print(len(out),"in work file ·",len(held),"held (see discount_blocked.json) ·",
      sum(len(x["name"])==50 and "RR name:" in x.get("note","") for x in out),"names shortened to 50 (full name in the note)")
EOF
```

**C3 Contrast check** (needs at least 4.5).
```bash
python3 -c "
import sys
def L(h):
    c=[int(h[i:i+2],16)/255 for i in (1,3,5)]; c=[x/12.92 if x<=0.03928 else ((x+0.055)/1.055)**2.4 for x in c]
    return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]
a,b=sorted([L(sys.argv[1]),L(sys.argv[2])],reverse=True); print(round((a+0.05)/(b+0.05),2))" '#BUTTON' '#TEXT'
```

## Appendix B: cvent_pw.py

```python file=shared/cvent-builds/tools/cvent_pw.py
#!/usr/bin/env python3
"""Playwright fallback for the bot computer's signed-in Chrome (same session, via CDP).

  python3 cvent_pw.py snapshot [--shot FILE]       numbered refs for every visible control, all frames
  python3 cvent_pw.py act [--shot FILE] < steps.json   run steps, then re-snapshot
  python3 cvent_pw.py shot FILE                     screenshot only

steps.json: {"steps": [{"kind": "click", "ref": "p12"}, ...]}
  kinds: click | fill (text) | select (value or label) | check (bool) | upload (path)
         | drag (ref -> to) | press (key) | scroll (dy) | wait (ms, max 10000)
Refs come only from the latest snapshot. The run stops at the first failed step.
Never use this for passwords (sign-in uses the page tools' fill_secret).
Attaches to the Team Computer's Chrome (CDP port 9221 + display number). Set CVENT_PW_CDP
to another DevTools endpoint only if the user gave it for this run.
"""
import json
import os
import re
import sys
import time
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright

PW_VERSION = 3
FORBIDDEN = re.compile(
    r"\b(publish|go live|launch|un-?publish|delete|remove|archive|cancel event|send|"
    r"invite|email (now|attendees)|activate event)\b",
    re.I,
)
REF_ATTR = "data-cvent-ref"

MARK = """
(prefix) => {
  const out = [];
  const sel = 'a,button,input,select,textarea,[role=button],[role=link],[role=tab],[role=menuitem],' +
    '[role=option],[role=checkbox],[role=radio],[role=combobox],[role=switch],[contenteditable=true],' +
    '[draggable=true],[role=treeitem],label';
  // Field values never become names; secret-looking fields never show a value at all.
  const SECRET = /pass|secret|token|otp|one-time|pin\b|cvv|card|ssn|api.?key/i;
  const isField = el => ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) || el.isContentEditable;
  const secret = el => el.type === 'password' ||
    SECRET.test([el.name, el.id, el.autocomplete, el.getAttribute('aria-label'), el.placeholder].join(' '));
  const nameOf = el => {
    const aria = el.getAttribute('aria-label');
    if (aria && aria.trim()) return aria;
    if (isField(el)) {
      const label = el.labels && el.labels[0] ? el.labels[0].innerText : '';
      if (['submit', 'button', 'reset'].includes(el.type)) return el.value || label;
      return label || el.placeholder || el.title || el.name || '';
    }
    return el.innerText || el.title || '';
  };
  let i = 0;
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    const st = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || st.visibility === 'hidden' || st.display === 'none') continue;
    const ref = prefix + (i++);
    el.setAttribute('data-cvent-ref', ref);
    const name = (nameOf(el) || '').replace(/\\s+/g, ' ').trim().slice(0, 80);
    const item = { ref, tag: el.tagName.toLowerCase(), role: el.getAttribute('role') || '', name };
    if (el.type) item.type = el.type;
    if (secret(el)) { if (el.value) item.value = '***'; }
    else if (isField(el) && el.value) item.value = String(el.value).slice(0, 80);
    if (el.tagName === 'SELECT') item.options = [...el.options].slice(0, 40).map(o => o.label);
    if (el.disabled) item.disabled = true;
    if (el.checked) item.checked = true;
    out.push(item);
  }
  const text = (document.body ? document.body.innerText : '').replace(/\\n{3,}/g, '\\n\\n').slice(0, 4000);
  return { items: out, text };
}
"""


def endpoint():
    if os.environ.get("CVENT_PW_CDP"):
        return os.environ["CVENT_PW_CDP"]
    m = re.search(r":(\d+)", os.environ.get("DISPLAY", ":0"))
    return f"http://127.0.0.1:{9221 + int(m.group(1) if m else 0)}"


def fail(message):
    print(json.dumps({"error": message}))
    sys.exit(1)


def connect(p):
    try:
        browser = p.chromium.connect_over_cdp(endpoint(), timeout=15000)
    except Exception as error:
        fail(f"No browser at {endpoint()}: {str(error)[:120]}")
    # Only ever drive a Cvent tab: anything else is not this build's browser.
    cvent = [pg for ctx in browser.contexts for pg in ctx.pages if (urlparse(pg.url or "").hostname or "").endswith(".cvent.com")]
    if not cvent:
        fail("No Cvent tab in this browser. Use request_takeover.")
    return browser, cvent[-1]


def snapshot(page, shot=None):
    frames = []
    for fi, frame in enumerate(page.frames):
        try:
            data = frame.evaluate(MARK, f"f{fi}p" if fi else "p")
        except Exception:
            continue
        if fi and not data["items"]:
            continue
        frames.append({"frame": fi, "url": frame.url[:200], "items": data["items"],
                       **({"text": data["text"]} if fi == 0 else {})})
    out = {"pw_version": PW_VERSION, "url": page.url, "title": page.title(), "frames": frames}
    if shot:
        page.screenshot(path=shot, full_page=False)
        out["screenshot"] = shot
    return out


def locate(page, ref):
    for frame in page.frames:
        loc = frame.locator(f"[{REF_ATTR}='{ref}']")
        if loc.count() == 1:
            return loc
    raise ValueError(f"ref {ref} not found; take a new snapshot")


def guard(loc, kind):
    if kind not in ("click", "check"):
        return
    label = loc.evaluate(
        "el => (el.getAttribute('aria-label') || el.innerText || "
        "(['submit', 'button', 'reset'].includes(el.type) ? el.value : '') || '').trim()")
    if FORBIDDEN.search(label or ""):
        raise PermissionError(f"refused: '{label[:60]}' looks like publish/delete/send; a human must do this")


def run_step(page, step):
    kind = step.get("kind")
    if kind == "wait":
        time.sleep(min(int(step.get("ms", 500)), 10000) / 1000)
        return
    if kind == "press":
        page.keyboard.press(step["key"])
        return
    if kind == "scroll":
        page.mouse.wheel(0, int(step.get("dy", 600)))
        return
    loc = locate(page, step["ref"])
    guard(loc, kind)
    if kind == "click":
        loc.click(timeout=10000)
    elif kind == "fill":
        if loc.evaluate("el => el.type === 'password' || /pass|secret|token|otp|one-time|cvv|api.?key/i"
                        ".test([el.name, el.id, el.autocomplete, el.getAttribute('aria-label')].join(' '))"):
            raise PermissionError("refused: password and secret fields are filled only with fill_secret")
        loc.fill(str(step.get("text", "")), timeout=10000)
    elif kind == "select":
        value = step.get("value")
        try:
            loc.select_option(value=value, timeout=5000)
        except Exception:
            loc.select_option(label=value, timeout=5000)
    elif kind == "check":
        loc.set_checked(bool(step.get("value", True)), timeout=10000)
    elif kind == "upload":
        path = os.path.abspath(step["path"])
        if not os.path.isfile(path):
            raise FileNotFoundError(path)
        loc.set_input_files(path, timeout=10000)
    elif kind == "drag":
        loc.drag_to(locate(page, step["to"]), timeout=15000)
    else:
        raise ValueError(f"unknown step kind {kind!r}")


def main():
    args = sys.argv[1:]
    if not args or args[0] not in ("snapshot", "act", "shot"):
        sys.exit(__doc__)
    shot = None
    if "--shot" in args:
        shot = args[args.index("--shot") + 1]
    with sync_playwright() as p:
        _browser, page = connect(p)  # never close: it is the user's live browser
        if args[0] == "shot":
            page.screenshot(path=args[1])
            print(json.dumps({"screenshot": args[1], "url": page.url}))
            return
        if args[0] == "snapshot":
            print(json.dumps(snapshot(page, shot)))
            return
        steps = json.load(sys.stdin).get("steps", [])[:24]
        done = []
        for i, step in enumerate(steps):
            try:
                run_step(page, step)
                done.append(i)
            except Exception as error:  # report, never retry
                page.wait_for_timeout(300)
                print(json.dumps({"completed": done, "failed": i, "error": str(error)[:300],
                                  "after": snapshot(page, shot)}))
                sys.exit(1)
        page.wait_for_timeout(500)
        print(json.dumps({"completed": done, "after": snapshot(page, shot)}))


if __name__ == "__main__":
    main()
```

## Appendix A: rr.py

```python file=shared/cvent-builds/tools/rr.py
#!/usr/bin/env python3
"""RR workbook -> Cvent build plan. Read-only; never touches Cvent.

  python3 rr.py extract  <rr.xlsx> <dir>   every sheet as tables -> extract.json, inventory.md, cells.json
  python3 rr.py plan     <dir>             known layouts -> plan.json, plan.md (+ merges agent_plan.json)
  python3 rr.py validate <dir>             checks plan.json -> validation.md; exit 1 on errors
  python3 rr.py images   <rr.xlsx> <dir>   embedded images -> assets/, assets.json (tab, cell, template flag)
  python3 rr.py expect   <dir> [--test-target]  one check per planned value -> expected.json, readback.json
  python3 rr.py verify   <dir>             readback.json vs expected.json -> qa.md, qa.json; exit 1 unless complete

Nothing is dropped: cells.json holds every non-empty cell exactly as stored (value,
number format, hyperlink, comment). Plan values keep the cell's text verbatim
except leading and trailing whitespace; matching alone ignores case and spacing.
Columns are found by header text, never fixed letters. Layouts the planner does
not recognise are marked needs_mapping in plan.json `coverage`, with the
extracted rows attached, for the agent to map into agent_plan.json.
"""
import datetime
import hashlib
import json
import os
import posixpath
import re
import sys
import zipfile
from decimal import Decimal

import openpyxl
from openpyxl.utils import get_column_letter

PARSER_VERSION = 6

EXCLUDE_TITLE = re.compile(r"\bold\b|dnu|do.?not.?use|archive|for ko\b", re.I)
PLACEHOLDER = re.compile(r"^\[.*\]$")
TEST_CODE = re.compile(r"^PPCTEST", re.I)
NA = {"", "n/a", "na", "none", "tbd", "-", "applicable dates", "not applicable"}
TIER_WORDS = re.compile(r"price tier|early|advance|onsite|on-site|online|standard|late|saver|pre-?show|"
                        r"super|priority|enrollment|last chance|bird|regular|final", re.I)
MEMBER = re.compile(r"^(member|m)$", re.I)
NONMEMBER = re.compile(r"^(non[- ]?member|nm|n)$", re.I)
MONTHS = {m.lower(): i for i, m in enumerate(
    ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
     "November", "December"], 1)}
MONTHS.update({k[:3]: v for k, v in list(MONTHS.items())})


# ------------------------------------------------------------------ helpers

def norm(v):
    if v is None:
        return ""
    if isinstance(v, datetime.datetime):
        return v.strftime("%Y-%m-%d") if (v.hour, v.minute) == (0, 0) else v.strftime("%Y-%m-%d %H:%M")
    if isinstance(v, (datetime.date, datetime.time)):
        return v.isoformat()
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).replace("\xa0", " ").replace("Â", "")
    return re.sub(r"[ \t]+", " ", s).strip()


def key(v):
    """Matching only: case, spacing, non-breaking spaces and the 'Â' encoding artifact ignored."""
    return re.sub(r"\s+", " ", str(v).replace("Â\xa0", " ").replace("\xa0", " ")).strip().lower()


def decimal_text(d):
    t = format(d, "f")
    return t.rstrip("0").rstrip(".") if "." in t else t


def text(c):
    """A cell as plan text: strings verbatim (outer whitespace removed), numbers exact
    (percent-formatted cells as percentage points with '%'), dates ISO."""
    v = c.value
    if v is None:
        return ""
    if isinstance(v, bool):
        return "TRUE" if v else "FALSE"
    if isinstance(v, (int, float)):
        d = Decimal(repr(v)) if isinstance(v, float) else Decimal(v)
        return decimal_text(d * 100) + "%" if "%" in (c.number_format or "") else decimal_text(d)
    if isinstance(v, datetime.datetime):
        return v.date().isoformat() if v.time() == datetime.time(0) else v.isoformat(sep=" ")
    if isinstance(v, (datetime.date, datetime.time)):
        return v.isoformat()
    return str(v).strip()


def blank(v):
    return key(v) in NA or bool(PLACEHOLDER.match(key(v)))


def yes(v):
    return key(v) in ("y", "yes", "x", "true", "activate", "required", "both")


def money(v):
    """'$1,008' -> '1008'; '15%' -> '15'; free text -> None (caller keeps raw).
    Binary float noise (99.99000000000001) is rounded off; real fractions of a cent are kept."""
    s = norm(v).replace("$", "").replace(",", "").strip()
    if s.endswith("%"):
        s = s[:-1].strip()
    if not re.fullmatch(r"\d+(\.\d+)?", s):
        return None
    d, q = Decimal(s), Decimal(s).quantize(Decimal("0.01"))
    return decimal_text(q) if d != q and abs(d - q) < Decimal("1e-9") else s


def initials(text):
    return "".join(w[0] for w in re.findall(r"[A-Za-z]+", text)).upper()


def ref(sheet, row, col=None):
    return f"{sheet}!{get_column_letter(col) if col else 'A'}{row}"


def parse_date(text, year_hint):
    t = text.strip().strip(".")
    m = re.fullmatch(r"(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?", t)
    if m:
        y = int(m.group(3)) if m.group(3) else None
        if y is not None and y < 100:
            y += 2000
        return (y, int(m.group(1)), int(m.group(2)))
    m = re.fullmatch(r"([A-Za-z]+)\.?\s+(\d{1,2})(?:,?\s*(\d{4}))?", t)
    if m and m.group(1).lower()[:3] in MONTHS:
        return (int(m.group(3)) if m.group(3) else None, MONTHS[m.group(1).lower()[:3]], int(m.group(2)))
    m = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", t)
    if m:
        return (int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def parse_range(text, year_hint):
    """Free-text tier window -> (start, end) ISO strings; start None = registration open."""
    t = norm(text).lower().replace("–", "-").replace("—", "-")
    if t in NA or not re.search(r"\d", t):
        return None
    t = re.sub(r"\b(thru|through|to|until)\b", "-", t)
    opens = bool(re.search(r"\b(reg(istration)? )?open\b", t))
    t = re.sub(r"\b(reg(istration)? )?open(s)?\b", "", t).strip(" -")
    isos = re.findall(r"\d{4}-\d{2}-\d{2}", t)
    parts = isos if len(isos) == 2 else [p.strip() for p in re.split(r"\s*-\s*", t) if p.strip()]
    if len(parts) == 1 and opens:
        parts = [None, parts[0]]
    if len(parts) != 2:
        return None
    a, b = (parse_date(p, year_hint) if p else None for p in parts)
    if parts[0] and not a:
        return None
    if not b:  # "September 28-30" -> second part is a bare day
        if a and re.fullmatch(r"\d{1,2}", parts[1]):
            b = (a[0], a[1], int(parts[1]))
        else:
            return None
    yb = b[0] or (a[0] if a and a[0] else year_hint)
    if yb is None:
        return None
    inferred = not b[0] or bool(a and not a[0])
    if a:
        ya = a[0] or (yb if (a[1], a[2]) <= (b[1], b[2]) else yb - 1)
        start = datetime.date(ya, a[1], a[2])
    else:
        start = None
    end = datetime.date(yb, b[1], b[2])
    if start and start > end:
        return None
    return (start.isoformat() if start else None, end.isoformat(), "year not written; event year used" if inferred else "")


# ------------------------------------------------------------------ extract

def header_rows_of(ws, anchor):
    """Header block = anchor row, plus the row above if it holds headers (>=3 cells,
    i.e. not a title), plus up to two sub-header rows below whose first non-empty
    cell is not in the anchor's first data column."""
    def cells(r):
        return {c.column: norm(c.value) for c in ws[r] if norm(c.value)}
    rows = []
    above = cells(anchor - 1) if anchor > 1 else {}
    if len(above) >= 3 and not any(len(v) > 120 for v in above.values()):
        rows.append(anchor - 1)
    rows.append(anchor)
    first_col = min(cells(anchor)) if cells(anchor) else 1
    for r in (anchor + 1, anchor + 2):
        cs = cells(r)
        # data rows carry the identifying first column or plain numbers (prices); header rows carry neither
        if not cs or first_col in cs or any(money(v) is not None for v in cs.values()):
            break
        rows.append(r)
    return rows


def compose_headers(ws, rows):
    merged = {}
    for rng in ws.merged_cells.ranges:
        if rng.min_row in rows:
            v = norm(ws.cell(rng.min_row, rng.min_col).value)
            for c in range(rng.min_col, rng.max_col + 1):
                merged[(rng.min_row, c)] = v
    levels = []
    for r in rows:
        lv = {}
        for c in ws[r]:
            v = merged.get((r, c.column)) or norm(c.value)
            if v:
                lv[c.column] = v
        levels.append(lv)
    cols = sorted({c for lv in levels for c in lv})
    # member/non-member splits: a column with only a deep label inherits the levels above from its left neighbour
    for i, c in enumerate(cols):
        deep = levels[-1].get(c, "")
        if (MEMBER.match(deep) or NONMEMBER.match(deep)) and all(not lv.get(c) for lv in levels[:-1]) and i:
            left = cols[i - 1]
            for lv in levels[:-1]:
                if lv.get(left):
                    lv[c] = lv[left]
    return {c: " | ".join(lv[c] for lv in levels if lv.get(c)) for c in cols}


def find_anchor(ws, predicate, scan=45):
    for row in ws.iter_rows(max_row=scan):
        for c in row:
            if predicate(norm(c.value).lower()):
                return c.row
    return None


ANCHORS = [
    ("reg_types", lambda v: v in ("reg code", "new reg code", "reg type", "reg type code", "cvent reg code",
                                  "current reg type", "new reg type") or v.startswith("reg code")),
    ("reg_mapping", lambda v: v.startswith("old - reg type") or v.startswith("old reg type") and False),
    ("discount_codes", lambda v: v == "discount code"),
    ("volume_discounts", lambda v: v == "threshold"),
    ("questions", lambda v: v.startswith("demo name")),
    ("items", lambda v: v.startswith("item code") or v.startswith("sessionboard sync")),
    ("vouchers", lambda v: "voucher" in v and "code" in v),
]


def classify(ws):
    t = ws.title.lower()
    if "event details" in t:
        return "event_details"
    if "helpful" in t or "social" in t:
        return "links"
    if "mapping" in t:
        return "reg_mapping"
    if "voucher" in t:
        return "vouchers"
    if "show question" in t:
        return "questions"
    if "discount" in t or "group" in t:
        return "discounts"
    if "session" in t or "optional" in t or "add-on" in t or "add on" in t or "membership" in t:
        return "items"
    if re.search(r"reg(istration)?\s*type|pricing", t):
        return "reg_types"
    for word in ("communication", "polic", "approval", "integration", "badge", "onsite", "access", "reference",
                "evaluation"):
        if word in t:
            return word
    return "unclassified"


def rows_of(ws, min_row=1, max_row=None):
    """Rows that hold a value, hyperlink or comment, in order. Reads stored cells only, so
    sheets formatted down to row 1,048,576 cost nothing extra."""
    if not hasattr(ws, "_rr_rows"):
        by_row = {}
        for (r, _), c in ws._cells.items():
            if c.value is not None or c.hyperlink is not None or c.comment is not None:
                by_row.setdefault(r, []).append(c)
        ws._rr_rows = [sorted(by_row[r], key=lambda c: c.column) for r in sorted(by_row)]
    for row in ws._rr_rows:
        if row[0].row >= min_row and (max_row is None or row[0].row <= max_row):
            yield row


def record(row):
    """One sheet row: verbatim text per column, plus hyperlinks and comments."""
    cells, links, notes = {}, {}, {}
    for c in row:
        col = get_column_letter(c.column)
        t = text(c)
        if t and t != "`":
            cells[col] = t
        if c.hyperlink is not None and (c.hyperlink.target or c.hyperlink.location):
            links[col] = c.hyperlink.target or f"#{c.hyperlink.location}"
        if c.comment is not None:
            notes[col] = c.comment.text
    if not (cells or links or notes):
        return None
    out = {"row": row[0].row, "cells": cells}
    if links:
        out["links"] = links
    if notes:
        out["comments"] = notes
    return out


def table(ws, role):
    anchor = None
    if role == "discounts":
        anchor = find_anchor(ws, lambda v: v == "discount code") or find_anchor(ws, lambda v: v == "threshold")
    elif role == "reg_mapping":
        anchor = find_anchor(ws, lambda v: v.startswith("old") and "reg type" in v)
    else:
        for name, pred in ANCHORS:
            if name == role or (role == "reg_types" and name == "reg_types"):
                anchor = find_anchor(ws, pred)
                break
    if not anchor:
        return None
    hrows = header_rows_of(ws, anchor)
    headers = compose_headers(ws, hrows)
    preamble = [r for r in (record(row) for row in rows_of(ws, 1, min(hrows) - 1)) if r]
    records, trailing, last = [], [], max(hrows)
    for row in rows_of(ws, max(hrows) + 1):
        rec = record(row)
        if not rec:
            continue
        if not rec["cells"]:  # hyperlink or comment only
            (trailing if trailing else records).append(rec)
            continue
        # after 15+ blank rows come dropdown source lists: kept as evidence, not read as data
        (trailing if trailing or (records and rec["row"] - last > 15) else records).append(rec)
        last = rec["row"]
    return {"anchor_row": anchor, "header_rows": hrows,
            "headers": {get_column_letter(c): h for c, h in headers.items()},
            "preamble": preamble, "records": records, "trailing": trailing}


def raw_rows(ws):
    return [r for r in (record(row) for row in rows_of(ws)) if r]


def lookup_tables(ws):
    """Small reference lists inside a sheet, e.g. 'Admission Items | CODES' or 'REG TYPES | REG CODES'."""
    found = {}
    for row in rows_of(ws):
        for c in row:
            v = norm(c.value).lower()
            if v in ("codes", "reg codes"):
                label_col = c.column - 1
                label = norm(ws.cell(c.row, label_col).value).lower()
                kind = "admission_items" if "admission" in label else "reg_types" if "reg" in label else None
                if not kind:
                    continue
                pairs, empty = {}, 0
                for r in range(c.row + 1, ws.max_row + 1):
                    name, code = text(ws.cell(r, label_col)), text(ws.cell(r, c.column))
                    if not name and not code:
                        empty += 1
                        if empty >= 15:
                            break
                        continue
                    empty = 0
                    if name and code:
                        pairs[name.split("\n")[0].strip()] = code
                found[kind] = pairs
    return found


def evidence(wb):
    """Every non-empty cell exactly as stored (cached values, as Excel last showed them),
    for citing and checking any plan value."""
    out = []
    for ws in wb.worksheets:
        cells = {}
        for row in rows_of(ws):
            for c in row:
                v = c.value
                e = {"v": v.isoformat() if isinstance(v, (datetime.date, datetime.time)) else v}
                if c.number_format and c.number_format != "General":
                    e["format"] = c.number_format
                if c.hyperlink is not None:
                    e["link"] = c.hyperlink.target or f"#{c.hyperlink.location}"
                if c.comment is not None:
                    e["comment"] = c.comment.text
                cells[c.coordinate] = e
        out.append({"title": ws.title, "state": ws.sheet_state,
                    "merged": [str(r) for r in ws.merged_cells.ranges], "cells": cells})
    return out


def extract(path, out_dir):
    wb = openpyxl.load_workbook(path, data_only=True)
    sheets = []
    for ws in wb.worksheets:
        role = classify(ws)
        entry = {"title": ws.title, "state": ws.sheet_state, "role": role,
                 "excluded": bool(EXCLUDE_TITLE.search(ws.title)) or ws.sheet_state != "visible"}
        artifacts = [c.coordinate for row in rows_of(ws) for c in row if isinstance(c.value, str) and "Â" in c.value]
        if artifacts:
            entry["encoding_artifacts"] = artifacts
        if role in ("event_details", "links"):
            entry["rows"] = raw_rows(ws)
        elif role in ("reg_types", "reg_mapping", "discounts", "questions", "items", "vouchers"):
            entry["table"] = table(ws, role)
            entry["lookups"] = lookup_tables(ws) if role == "reg_types" else {}
            if not entry["table"]:
                entry["rows"] = raw_rows(ws)
        else:
            entry["rows"] = raw_rows(ws)
        sheets.append(entry)
    ext = {"parser_version": PARSER_VERSION, "source_file": os.path.basename(path), "sheets": sheets}
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "extract.json"), "w") as f:
        json.dump(ext, f, indent=1)
    with open(os.path.join(out_dir, "cells.json"), "w") as f:
        json.dump({"source_file": ext["source_file"], "sheets": evidence(wb)}, f, default=str)
    lines = [f"# Inventory: {ext['source_file']}", "", "| Sheet | Role | Used | Header rows | Data rows |", "|---|---|---|---|---|"]
    for s in sheets:
        t = s.get("table")
        lines.append(f"| {s['title']} | {s['role']} | {'no (' + ('hidden' if s['state'] != 'visible' else 'old/DNU') + ')' if s['excluded'] else 'yes'} | "
                     f"{t['header_rows'] if t else '-'} | {len(t['records']) if t else len(s.get('rows', []))} |")
    with open(os.path.join(out_dir, "inventory.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))


# ------------------------------------------------------------------ images

# SHA-256 prefixes of stock pictures RR templates carry (onsite screen examples from
# other shows, the badge font chart). They are references, never this show's art.
TEMPLATE_IMAGES = {
    "012198403e14a2a3",
    "1d4524cd59e6d807",
    "20a9631ba4980a02",
    "2fa526dc36e2d579",
    "3726cf2c598a1ad7",
    "51f630768f2f86ca",
    "540a5fb874165eaf",
    "57f1138d841db1ed",
    "7363443f7a6b08cc",
    "7edd7e7fc03e65d0",
    "9e08b52da048dcfa",
    "c5417b32e6197df0",
    "d91bbf8276e2c5d7",
}


def images(path, out_dir):
    """Extract every embedded image with the tab and cell it sits on. Nothing here is
    used as event art without a human OK: RR templates embed other shows' screenshots."""
    z = zipfile.ZipFile(path)
    names = set(z.namelist())
    read = lambda p: z.read(p).decode("utf-8", "replace")
    rels = {}
    for m in re.finditer(r"<Relationship ([^>]*)/?>", read("xl/_rels/workbook.xml.rels")):
        a = dict(re.findall(r'(\w+)="([^"]*)"', m.group(1)))
        rels[a.get("Id")] = a.get("Target", "")
    found, seen = [], {}
    for m in re.finditer(r"<sheet ([^>]*)/?>", read("xl/workbook.xml")):
        a = dict(re.findall(r'([\w:]+)="([^"]*)"', m.group(1)))
        sheet = a.get("name", "").replace("&amp;", "&")
        sheet_rels = f"xl/worksheets/_rels/{posixpath.basename(rels.get(a.get('r:id'), ''))}.rels"
        if sheet_rels not in names:
            continue
        for drawing in re.findall(r'Target="\.\./drawings/(drawing\d+\.xml)"', read(sheet_rels)):
            media = {}
            drawing_rels = f"xl/drawings/_rels/{drawing}.rels"
            if drawing_rels in names:
                for mm in re.finditer(r"<Relationship ([^>]*)/?>", read(drawing_rels)):
                    aa = dict(re.findall(r'(\w+)="([^"]*)"', mm.group(1)))
                    media[aa.get("Id")] = posixpath.basename(aa.get("Target", ""))
            body = read(f"xl/drawings/{drawing}")
            for anchor in re.findall(r"<xdr:(?:twoCellAnchor|oneCellAnchor|absoluteAnchor).*?"
                                     r"</xdr:(?:twoCellAnchor|oneCellAnchor|absoluteAnchor)>", body, re.S):
                embed = re.search(r'r:embed="([^"]+)"', anchor)
                if not embed or not media.get(embed.group(1)):
                    continue
                file = media[embed.group(1)]
                data = z.read(f"xl/media/{file}")
                digest = hashlib.sha256(data).hexdigest()
                col, row = re.search(r"<xdr:col>(\d+)", anchor), re.search(r"<xdr:row>(\d+)", anchor)
                cell = f"{get_column_letter(int(col.group(1)) + 1)}{int(row.group(1)) + 1}" if col and row else ""
                if digest not in seen:
                    slug = re.sub(r"[^A-Za-z0-9]+", "-", sheet).strip("-")[:30]
                    seen[digest] = f"{len(seen) + 1:02d}-{slug}{os.path.splitext(file)[1]}"
                    os.makedirs(os.path.join(out_dir, "assets"), exist_ok=True)
                    with open(os.path.join(out_dir, "assets", seen[digest]), "wb") as f:
                        f.write(data)
                template = digest[:16] in TEMPLATE_IMAGES
                found.append({"file": f"assets/{seen[digest]}", "sheet": sheet, "cell": cell,
                              "bytes": len(data), "sha256": digest, "template": template,
                              "use": "reference only (template)" if template else "review: show-specific"})
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "assets.json"), "w") as f:
        json.dump(found, f, indent=1)
    for item in found:
        print(f"{item['file']}  {item['sheet']}!{item['cell']}  {item['use']}")
    if not found:
        print("No embedded images.")


# ------------------------------------------------------------------ plan: shared

class Ctx:
    def __init__(self, ext):
        self.ext, self.gaps, self.questions, self.grouped = ext, [], [], {}
        self.year = None
        self.event_end = None

    def gap(self, msg, where=None):
        """Same message from many rows collapses to one line with a count and examples."""
        if where is None:
            if msg not in self.gaps:
                self.gaps.append(msg)
            return
        self.grouped.setdefault(msg, []).append(where)

    def all_gaps(self):
        out = list(self.gaps)
        for msg, wh in self.grouped.items():
            ex = ", ".join(wh[:5]) + (f" … (+{len(wh) - 5} more)" if len(wh) > 5 else "")
            out.append(f"{msg} — {len(wh)} row(s): {ex}")
        return out

    def ask(self, msg):
        if msg not in self.questions:
            self.questions.append(msg)

    def sheets(self, role, usable=True):
        return [s for s in self.ext["sheets"] if s["role"] == role and (not usable or not s["excluded"])]


def hcol(headers, *patterns, exclude=()):
    """First column whose header matches every regex in patterns and none in exclude."""
    for col, h in headers.items():
        hl = h.lower()
        if all(re.search(p, hl) for p in patterns) and not any(re.search(x, hl) for x in exclude):
            return col
    return None


def kv_rows(rows):
    out = []
    for r in rows:
        c = r["cells"]
        if c.get("A"):
            out.append((key(c["A"]), c.get("B", ""), c.get("C", ""), r["row"]))
    return out


def kv_get(pairs, prefix):
    for k, v, n, row in pairs:
        if k.startswith(prefix):
            return v, n, row
    return "", "", None


# ------------------------------------------------------------------ plan: event + website

def plan_event(ctx):
    s = (ctx.sheets("event_details") or [None])[0]
    if not s:
        ctx.gap("No Event Details sheet; identity key unknown.")
        return {}, []
    pairs = kv_rows(s["rows"])
    g = lambda p: kv_get(pairs, p)[0]
    n = lambda p: kv_get(pairs, p)[1]
    dates = g("event dates") or " / ".join(x for x in (g("expo hall dates"), g("conference dates")) if x)
    m = re.search(r"(20\d{2})", dates) or re.search(r"(20\d{2})", g("event name"))
    ctx.year = int(m.group(1)) if m else None
    ends = [parse_range(part, ctx.year) for part in re.split(r" / |\n", dates)]
    ends = [e[1] for e in ends if e]
    if any(e and e[2] for e in [parse_range(part, ctx.year) for part in re.split(r" / |\n", dates)]):
        ctx.gap(f"Event dates '{dates}' do not all carry a year; the event year was used.")
    if not ends:  # "November 13 - 15, 2026"
        mm = re.search(r"([A-Za-z]+)\.?\s+\d{1,2}\s*-\s*(?:([A-Za-z]+)\.?\s+)?(\d{1,2}),?\s*(\d{4})", dates)
        if mm and mm.group(1).lower()[:3] in MONTHS:
            mon = MONTHS[(mm.group(2) or mm.group(1)).lower()[:3]]
            ends = [datetime.date(int(mm.group(4)), mon, int(mm.group(3))).isoformat()]
    ctx.event_end = max(ends) if ends else None
    paths_section, in_paths = [], False
    for k, v, note, row in pairs:
        if k.startswith("registration paths"):
            in_paths = True
            continue
        if in_paths:
            if k.startswith("do you") or k.startswith("already") or "?" in k:
                break
            paths_section.append({"name": k.title(), "enabled": yes(v), "notes": note})
    ev = {
        "name": g("event name"), "fp_code": g("event fp code"), "location": g("event location"),
        "timezone": g("time zone"), "dates_display": dates, "show_hours": [h for h in re.split(r"\n|;", g("show hours")) if h.strip()],
        "type": g("type of event"), "user_group": g("event user group"),
        "approval": {"enabled": yes(g("do you use the approval")), "reg_types": n("do you use the approval")},
        "pre_approval": {"enabled": yes(g("do you have pre-approval")), "reg_types": n("do you have pre-approval")},
        "advanced_prereg": {"enabled": yes(g("do you have advanced pre-reg")), "reg_types": n("do you have advanced pre-reg")},
        "group_discounts": yes(g("do you offer group discounts")),
        "invitation_forwarding": yes(g("do you want to include invitation forwarding")),
        "photo_badging": yes(g("will you use photo badging")),
        "registration_paths_section": paths_section,
    }
    for k in ("name", "fp_code", "dates_display"):
        if not ev[k]:
            ctx.gap(f"Identity key component missing: {k}")
    return ev, pairs


def plan_website(ctx, pairs):
    g = lambda p: kv_get(pairs, p)[0]
    n = lambda p: kv_get(pairs, p)[1]
    colors = re.findall(r"#[0-9A-Fa-f]{6}\b", g("branding colors"))
    if g("branding colors") and not colors:
        ctx.gap("Brand colors present but no #RRGGBB hex codes parsed.")
    site = {"theme": {"name": g("event theme"), "progress_bar_note": n("event theme"), "brand_colors": colors,
                      "style_guide_source": g("brand style guide")},
            "header": {"assets_provided": False, "already_registered_link": yes(g("already registered link"))},
            "footers": {}, "body": {}}
    countdown, social = {"enabled": False, "label": ""}, []
    s = (ctx.sheets("links") or [None])[0]
    if s:
        section = None
        for r in s["rows"]:
            c = r["cells"]
            a, b, url = c.get("A", ""), c.get("B", ""), c.get("C", "")
            link = r.get("links", {}).get("C", "")
            if link and not re.match(r"(?i)^(https?://|mailto:)", url):
                url = link  # the cell shows a label; the hyperlink holds the address
            al = key(a)
            m = re.match(r"footer options\s*-\s*(.+)", al)
            if m:
                section = ("footer", m.group(1).strip())
                site["footers"][section[1]] = []
                continue
            if al.startswith("countdown"):
                section = ("countdown",)
                continue
            if al.startswith("social media url"):
                section = ("social",)
                continue
            if not a or al in ("footer options", "social media type") or al.startswith("for all") or al.startswith("if you want"):
                continue
            if section and section[0] == "footer":
                mail = re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", url)
                link = {"label": re.sub(r"\s*\(.*?only\)\s*", "", a.split("\n")[0]).strip(), "visible": yes(b),
                        "url": url if url.startswith("http") else (f"mailto:{mail.group(0)}" if mail else
                                                                   "cvent-generated" if "cvent will provide" in key(url) else ""),
                        "source": ref(s["title"], r["row"])}
                if link["visible"] and not link["url"]:
                    ctx.gap(f"Footer link '{link['label']}' ({section[1]}) is Yes but has no URL ({link['source']}).")
                site["footers"][section[1]].append(link)
            elif section and section[0] == "countdown":
                if "appear" in al:
                    countdown["enabled"] = yes(b)
                elif "text" in al:
                    countdown["label"] = b
            elif section and section[0] == "social" and url.startswith("http") and key(b) not in ("no", "n"):
                social.append({"network": a, "url": url, "source": ref(s["title"], r["row"])})
    first_day = None
    m = re.search(r"([A-Za-z]+)\.?\s+(\d{1,2})\b.*?(\d{4})", ctx_dates := g("event dates") or g("expo hall dates") or g("conference dates"))
    if m and m.group(1).lower()[:3] in MONTHS:
        first_day = datetime.date(int(m.group(3)), MONTHS[m.group(1).lower()[:3]], int(m.group(2))).isoformat()
    else:
        m = re.search(r"(\d{1,2})/(\d{1,2})/(\d{2,4})", ctx_dates)
        if m:
            y = int(m.group(3)) + (2000 if len(m.group(3)) == 2 else 0)
            first_day = datetime.date(y, int(m.group(1)), int(m.group(2))).isoformat()
    if countdown["enabled"] and not first_day:
        ctx.gap(f"Countdown is on but the first event day could not be read from '{ctx_dates}'.")
    if site["theme"]["style_guide_source"]:
        ctx.gap("Header/logo art lives at the style-guide link; upload the files or the header image stays blocked.")
    site["body"] = {
        "event_information": {"title": g("event name"), "dates": ctx_dates, "location": g("event location"),
                              "show_hours": [h for h in re.split(r"\n|;", g("show hours")) if h.strip()],
                              "add_to_calendar": {"enabled": yes(g("calendar reminder")), "text": n("calendar reminder")}},
        "text": {"blocks": []},
        "image": {"assets_provided": False},
        "registration_actions": {"register_buttons": "one per web-visible path",
                                 "already_registered": yes(g("already registered link"))},
        "countdown_timer": {**countdown, "target": "first day of event", "target_date": first_day},
        "social_media": social,
    }
    return site


# ------------------------------------------------------------------ plan: price columns

def price_columns(ctx, headers, after=None, stop_patterns=(r"reprint", r"gl code", r"notes", r"web page", r"configured",
                                                            r"which admission", r"which reg", r"display on", r"badge")):
    """Tier columns: header mentions a tier word or a date window. Returns
    [{col, tier, variant, start, end, label}] plus tiers [{name,start,end}]."""
    cols = []
    for col, h in headers.items():
        hl = h.lower()
        if (any(re.search(p, hl) for p in stop_patterns) and "price tier" not in hl) or "?" in hl \
                or re.search(r"eligible|reprint", hl):
            continue
        parts = [p.strip() for p in h.split(" | ")]
        variant = None
        if parts and (MEMBER.match(parts[-1]) or NONMEMBER.match(parts[-1])):
            variant = "member" if MEMBER.match(parts[-1]) else "non-member"
            parts = parts[:-1]
        window = None
        labels = []
        for p in parts:
            for sub in [x.strip() for x in re.split(r" / |\n", p) if x.strip()]:
                rng = parse_range(sub, ctx.year)
                if not rng and re.search(r"(?i)open\s*-\s*(show|event) close", sub) and ctx.event_end:
                    rng = (None, ctx.event_end, "end is the event's last day ('show close')")
                if rng and not window:
                    window = rng
                elif not re.fullmatch(r"(?i)price tier \d+", sub) and not re.search(r"\d+/\d+", sub) \
                        and sub.lower() not in NA and not re.search(r"(?i)applicable dates|n/a", sub):
                    labels.append(re.sub(r"(?i)^price tier \d+\s*-\s*", "", sub))
        is_tier = bool(TIER_WORDS.search(hl)) or window is not None
        if not is_tier:
            continue
        cols.append({"col": col, "label": labels[0] if labels else "", "window": window, "variant": variant,
                     "raw": h, "tier_hint": (re.search(r"(?i)price tier (\d+)", h) or [None, None])[1]})
    tiers = []
    for c in cols:
        tkey = (c["label"], c["window"][:2] if c["window"] else None) if c["window"] or c["label"] else (c["raw"], None)
        t = next((t for t in tiers if t["_key"] == tkey), None)
        if not t:
            name = c["label"] or (f"Tier {c['tier_hint']}" if c["tier_hint"] else f"Tier {len(tiers) + 1}")
            if c["window"] and not c["label"]:
                name = f"Tier {c['tier_hint'] or len(tiers) + 1}"
            t = {"_key": tkey, "name": name, "start": c["window"][0] if c["window"] else None,
                 "end": c["window"][1] if c["window"] else None, "header": c["raw"],
                 "inferred": c["window"][2] if c["window"] else ""}
            tiers.append(t)
        c["tier"] = t["name"]
    return cols, tiers


def drop_unused_tiers(ctx, tiers, priced_rows, where):
    """Tiers with no date window whose every price is 0 are template leftovers
    ('applicable dates'): remove them and their $0 prices."""
    keep = []
    for t in tiers:
        vals = [pr[t["name"]] for pr in priced_rows if t["name"] in pr]
        template = re.search(r"(?i)applicable dates|\bn/a\b", t["header"]) or re.fullmatch(r"(?i)price tier \d+", t["header"].strip())
        if template and not t["end"] and not t["start"] and vals and all(v == "0" for v in vals):
            for pr in priced_rows:
                pr.pop(t["name"], None)
            ctx.gap(f"{where}: dropped undated tier '{t['name']}' (only $0 prices; template leftover).")
            continue
        keep.append(t)
    return keep


def finish_tiers(ctx, tiers, used, where):
    out = []
    for t in tiers:
        if t["name"] not in used:
            continue
        if not t["end"]:
            ctx.gap(f"{where}: price tier '{t['name']}' has no readable date window ('{t['header']}').")
        out.append({k: t[k] for k in ("name", "start", "end")} | ({"inferred": t["inferred"]} if t.get("inferred") else {}))
        if t.get("inferred"):
            ctx.gap(f"{where}: tier '{t['name']}' dates — {t['inferred']} (header '{t['header']}'); confirm.")
    for a, b in zip(out, out[1:]):
        if a["end"] and b["start"]:
            d = (datetime.date.fromisoformat(b["start"]) - datetime.date.fromisoformat(a["end"])).days
            if d != 1:
                ctx.gap(f"{where}: tiers '{a['name']}' and '{b['name']}' are not contiguous ({a['end']} → {b['start']}).")
    return out


def read_prices(ctx, cells, pcols, where):
    prices = {}
    for c in pcols:
        raw = cells.get(c["col"], "")
        if blank(raw):
            continue
        val = money(raw)
        if val is None:
            ctx.gap("non-numeric price; confirm the amount", f"{where} {c['tier']}: '{raw}'")
            val = {"raw": raw}
        if c["variant"]:
            prices.setdefault(c["tier"], {})[c["variant"]] = val
        else:
            prices[c["tier"]] = val
    return prices


# ------------------------------------------------------------------ plan: registration

def pick_reg_sheet(ctx):
    cands = [s for s in ctx.sheets("reg_types") if s.get("table")]
    def score(s):
        h = " ".join(s["table"]["headers"].values()).lower()
        new = "activate" in h and "admission item" in h
        rows = len(s["table"]["records"])
        return (new, "new" in s["title"].lower(), rows)
    cands.sort(key=score, reverse=True)
    return cands[0] if cands else None


def plan_registration(ctx):
    s = pick_reg_sheet(ctx)
    if not s:
        ctx.gap("No usable registration types sheet found.")
        return {}, "absent"
    t, title = s["table"], s["title"]
    H = t["headers"]
    code_c = (hcol(H, r"\bnew reg code\b") or hcol(H, r"\breg(istration)? code\b", exclude=[r"admission", r"cvent reg code"])
              or hcol(H, r"reg type code"))
    status_c = hcol(H, r"activate")
    ai_c = (hcol(H, r"(^|\| )admission item$") or hcol(H, r"^admission item$")
            or hcol(H, r"which admission items"))
    new_format = bool(code_c and (ai_c or hcol(H, r"admission item code")))
    if new_format:
        legacy_cell = re.compile(r"^[A-Z]{2,5} [A-Z][a-z]")  # "EO Expo Only", "EX Exhibitor"
        sample = [r["cells"] for r in t["records"] if r["cells"].get(code_c)][:40]
        hits = sum(1 for c in sample if legacy_cell.match(c.get(code_c, "")) or legacy_cell.match(c.get(ai_c or "", "")))
        split = any(re.search(r"\| (member|non-?member|m|n)$", h.lower()) for h in H.values())
        if not sample or hits > len(sample) / 3 or split:
            new_format = False
    if new_format and not status_c:
        ctx.gap(f"'{title}' has no ACTIVATE column; every row with a code is treated as active.")
    if not new_format:
        return {"source_sheet": title, "layout": "legacy", "headers": H, "lookups": s.get("lookups", {}),
                "rows": t["records"], "mapping": [m.get("table") for m in ctx.sheets("reg_mapping")]}, "needs_mapping"

    C = {"code": code_c, "status": status_c, "ai": ai_c,
         "name": hcol(H, r"reg type name"), "old": hcol(H, r"old reg type|current cvent reg|current reg type"),
         "ai_code": hcol(H, r"admission item code"), "ai_text": hcol(H, r"admission item additional text"),
         "ai_desc": hcol(H, r"admission item description"), "group": hcol(H, r"register another"),
         "path": hcol(H, r"registration path"), "badge": hcol(H, r"badge description"),
         "method": hcol(H, r"registration method"), "approval": hcol(H, r"approval needed|pended\?"),
         "pre": hcol(H, r"pre-approval"), "adv": hcol(H, r"advanced pre-reg"), "reprint": hcol(H, r"reprint"),
         "gl": hcol(H, r"gl code"), "notes": hcol(H, r"^notes|\| notes")}
    pcols, tiers = price_columns(ctx, H)
    lookup = {key(k): v for k, v in s.get("lookups", {}).get("admission_items", {}).items()}
    reg_types, items, paths, skipped, used = {}, {}, {}, [], set()
    for rec in t["records"]:
        cells, row = rec["cells"], rec["row"]
        v = lambda k: cells.get(C[k], "") if C[k] else ""
        code, ai = v("code"), v("ai")
        if not code or not (ai or v("ai_code")) or code.upper() in ("REG CODE", "REG CODES"):
            continue
        status = v("status").upper() if C["status"] else "ACTIVATE"
        if status not in ("ACTIVATE", "REQUIRED"):
            skipped.append({"code": code, "admission_item": ai, "status": status or "(blank)", "source": ref(title, row)})
            continue
        where = f"{title} row {row} ({code})"
        if re.search(r"\s", code.strip()):
            ctx.gap(f"{where}: reg code cell holds more than one code ('{code}'); split it during review.")
            code = code.split()[-1]
        aic = v("ai_code").strip() or lookup.get(key(ai), "")
        if not aic:
            near = [f"{n} = {c}" for n, c in s.get("lookups", {}).get("admission_items", {}).items()
                    if ai and (key(n).startswith(key(ai)) or key(ai).startswith(key(n)))]
            ctx.gap("admission item has no code; confirm one in review",
                    f"'{ai}' ({ref(title, row)}{'; RR list suggests ' + ', '.join(near) if near else ''})")
            aic = ai
        prices = read_prices(ctx, cells, pcols, where)
        used.update(prices)
        rt = reg_types.setdefault(code, {
            "code": code, "name": v("name") or code, "labels": [], "path": v("path"),
            "web_visible": "staff only" not in key(v("method")), "method": v("method"), "status": status,
            "group_registration": False, "approval": False, "pre_approval": False, "advanced_prereg": False,
            "badge_text": [], "admission_items": {}, "source": ref(title, row)})
        if v("old") and v("old") not in rt["labels"]:
            rt["labels"].append(v("old"))
        if v("badge") and v("badge") not in rt["badge_text"]:
            rt["badge_text"].append(v("badge"))
        for flag, col in (("group_registration", "group"), ("approval", "approval"), ("pre_approval", "pre"),
                          ("advanced_prereg", "adv")):
            if rt["admission_items"] and rt[flag] != yes(v(col)):
                ctx.gap(f"{where}: '{flag}' differs between this reg type's rows; set to Yes, confirm.")
            rt[flag] = rt[flag] or yes(v(col))
        if aic in rt["admission_items"] and rt["admission_items"][aic]["prices"] != prices:
            ctx.gap(f"{where}: admission item {aic} listed twice with different prices; first row kept.")
        rt["admission_items"].setdefault(aic, {"prices": prices, "reprint_fee": v("reprint"), "gl_code": v("gl"),
                                               "source": ref(title, row)})
        it = items.setdefault(aic, {"code": aic, "name": ai or aic, "additional_text": "", "description": "",
                                    "reg_types": [], "source": ref(title, row)})
        it["additional_text"] = it["additional_text"] or v("ai_text")
        it["description"] = it["description"] or v("ai_desc")
        if code not in it["reg_types"]:
            it["reg_types"].append(code)
        if v("path"):
            p = paths.setdefault(key(v("path")), {"name": v("path"), "reg_types": [], "web_visible": False,
                                                  "group_registration": False})
            if v("path") != p["name"]:
                ctx.gap("path name is spelled differently across rows; the first spelling is used",
                        f"'{v('path')}' vs '{p['name']}' ({ref(title, row)})")
            rt["path"] = p["name"]
            if code not in p["reg_types"]:
                p["reg_types"].append(code)
            p["web_visible"] = p["web_visible"] or rt["web_visible"]
            p["group_registration"] = p["group_registration"] or rt["group_registration"]
    for rt in reg_types.values():
        if not rt["path"]:
            ctx.gap(f"Reg type {rt['code']} has no registration path ({rt['source']}); assign it during review.")
        if len(rt["labels"]) > 1:
            ctx.gap(f"Reg type code {rt['code']} is shared by RR rows {rt['labels']}; Cvent gets one type.")
    rules = []
    for rt in reg_types.values():
        allowed = list(rt["admission_items"])
        if set(allowed) != set(items):
            rules.append({"kind": "admission_item_availability", "reg_type": rt["code"], "allowed_admission_items": allowed})
    priced = [d["prices"] for rt in reg_types.values() for d in rt["admission_items"].values()]
    tiers = drop_unused_tiers(ctx, tiers, priced, title)
    used = {k for pr in priced for k in pr}
    reg = {"source_sheet": title, "layout": "standard",
           "price_tiers": finish_tiers(ctx, tiers, used, title),
           "paths": list(paths.values()), "reg_types": list(reg_types.values()),
           "admission_items": list(items.values()), "skipped_rows": skipped, "advanced_rules": rules}
    return reg, "parsed" if reg_types else "needs_mapping"


# ------------------------------------------------------------------ plan: items, discounts, vouchers, questions

def plan_items(ctx):
    out = []
    for s in ctx.sheets("items"):
        t = s.get("table")
        if not t:
            continue
        H, title = t["headers"], s["title"]
        kind = ("membership" if "membership" in title.lower() else "optional" if "optional" in title.lower()
                else "add-on" if "add" in title.lower() else "session")
        C = {"code": hcol(H, r"item code"), "title": hcol(H, r"item title"), "desc": hcol(H, r"description"),
             "capacity": hcol(H, r"capacity|allotment|limit"), "sdate": hcol(H, r"start date"), "stime": hcol(H, r"start time"),
             "edate": hcol(H, r"end date"), "etime": hcol(H, r"end time"),
             "buy": hcol(H, r"which admission items can purchase|which reg ?types can view|what reg ?types can view"),
             "incl": hcol(H, r"included|have this session"), "itin": hcol(H, r"itinerary"),
             "visible": hcol(H, r"visible on reg"), "sync": hcol(H, r"sessionboard sync"),
             "member_types": hcol(H, r"charged member"), "nonmember_types": hcol(H, r"charged non-member"),
             "max": hcol(H, r"max number"), "ticket": hcol(H, r"ticket print"), "gl": hcol(H, r"gl code")}
        pcols, tiers = price_columns(ctx, H, stop_patterns=(r"which", r"what", r"gl code", r"notes", r"display",
                                                            r"configured", r"price difference", r"item ", r"start", r"end"))
        rows, used = [], set()
        for rec in t["records"]:
            c, row = rec["cells"], rec["row"]
            v = lambda k: c.get(C[k], "") if C[k] else ""
            if not v("title") or blank(v("title")) or (C["code"] and blank(v("code")) and not v("desc")):
                continue
            prices = read_prices(ctx, c, pcols, f"{title} row {row}")
            used.update(prices)
            rows.append({"kind": kind, "code": "" if blank(v("code")) else v("code"), "title": v("title"),
                         "description": v("desc"), "capacity": v("capacity"), "start": f"{v('sdate')} {v('stime')}".strip(),
                         "end": f"{v('edate')} {v('etime')}".strip(), "prices": prices,
                         "purchasable_by": v("buy"), "included_for": v("incl"), "display_on_itinerary": v("itin"),
                         "visible_on_site": v("visible"), "sessionboard_sync": v("sync"),
                         "member_fee_types": v("member_types"), "nonmember_fee_types": v("nonmember_types"),
                         "max_per_registrant": v("max"), "prints_ticket": v("ticket"), "gl_code": v("gl"),
                         "source": ref(title, row)})
        for r in rows:
            if not r["code"]:
                ctx.gap("item has no item code", f"{r['title']} ({r['source']})")
        if rows:
            tiers = drop_unused_tiers(ctx, tiers, [r["prices"] for r in rows], title)
            used = {k for r in rows for k in r["prices"]}
            out.append({"sheet": title, "kind": kind, "price_tiers": finish_tiers(ctx, tiers, used, title), "items": rows})
    return out


def normalize_method(text):
    t = text.lower()
    if not t:
        return ""
    if "percent" in t:
        return "Subtract a percentage"
    if re.search(r"fixed|set ?fee|flat|charge", t):
        return "Charge a fixed price"
    if re.search(r"amount|off|subtract|dollar", t):
        return "Subtract an amount"
    return ""


def plan_discounts(ctx, reg, keep_test):
    codes, volume, dropped, placeholders, headers = [], [], [], 0, []
    for s in ctx.sheets("discounts"):
        t = s.get("table")
        if not t:
            continue
        H, title = t["headers"], s["title"]
        if hcol(H, r"^discount code$"):
            headers = headers or list(H.values())
            C = {k: hcol(H, p) for k, p in {
                "name": r"^name$", "code": r"^discount code$", "type": r"discount type", "method": r"^method$",
                "amount": r"amount", "from": r"effective from", "to": r"effective to", "capacity": r"^capacity",
                "stackable": r"stackable", "usable": r"can be used by", "guests": r"counts guests", "active": r"^active",
                "note": r"internal note", "items": r"admission items", "sessions": r"^sessions", "optional": r"optional items"}.items()}
            group = ""
            for rec in t["records"]:
                c, row = rec["cells"], rec["row"]
                v = lambda k: "" if blank(c.get(C[k], "")) and k not in ("code", "name") else c.get(C[k], "") if C[k] else ""
                name, code = v("name"), v("code")
                if name and not code and not v("amount"):
                    group = name
                    continue
                if not code:
                    continue
                if PLACEHOLDER.match(code):
                    placeholders += 1
                    continue
                if TEST_CODE.match(code) and not keep_test:
                    dropped.append(code)
                    continue
                method = normalize_method(v("method"))
                if v("method") and not method:
                    ctx.gap(f"discount method '{v('method')}' is not a Cvent method", ref(title, row))
                amount = money(v("amount"))
                if v("amount").endswith("%") and method and method != "Subtract a percentage":
                    ctx.gap("discount amount is a percent but the method is not a percentage", f"{code} ({ref(title, row)})")
                if amount is None:
                    ctx.gap("discount amount is not a number", f"{code} '{v('amount')}' ({ref(title, row)})")
                codes.append({"sheet": title, "group": group, "name": name, "code": code, "type": v("type"),
                              "method": method, "amount": amount if amount is not None else v("amount"),
                              "effective_from": v("from"), "effective_to": v("to"), "capacity": v("capacity"),
                              "stackable": yes(v("stackable")), "usable_by": v("usable"), "count_guests": v("guests"),
                              "active": key(v("active")) != "no", "internal_note": v("note"),
                              "admission_items": [x.strip() for x in re.split(r"[,\n]", v("items")) if x.strip()],
                              "sessions": v("sessions"), "optional_items": v("optional"),
                              "raw": {H[k]: c.get(k, "") for k in H}, "source": ref(title, row)})
        elif hcol(H, r"threshold"):
            for rec in t["records"]:
                c = rec["cells"]
                d = {H[k]: c.get(k, "") for k in H}
                low = {k.lower(): v for k, v in d.items()}
                if low.get("name") and not blank(low["name"]) and not blank(low.get("threshold", "")):
                    volume.append(d | {"source": ref(title, rec["row"])})
    seen = set()
    for d in codes:
        if d["code"].upper() in seen:
            ctx.gap("duplicate discount code", f"{d['code']} ({d['source']})")
        seen.add(d["code"].upper())
        if len(d["code"]) > 15:
            ctx.gap("discount code longer than 15 characters", f"{d['code']} ({d['source']})")
    known = {i["code"] for i in reg.get("admission_items", [])}
    unknown = sorted({c for d in codes for c in d["admission_items"]} - known)
    mapping = {}
    if known:
        for code in unknown:
            mapping[code] = resolve_code(code, reg.get("admission_items", []), reg.get("reg_types", []))
        if unknown:
            ctx.ask(f"{len(unknown)} discount admission-item codes are not admission items in the plan: "
                    f"{', '.join(unknown[:25])}{'…' if len(unknown) > 25 else ''}. Suggested mappings are in "
                    f"discounts.admission_item_code_map; confirm before building.")
    vouchers = []
    for s in ctx.sheets("vouchers"):
        t = s.get("table")
        rows = t["records"] if t else s.get("rows", [])
        vouchers += [{"sheet": s["title"], "row": r["row"], "cells": r["cells"]} for r in rows]
    return {"codes": codes, "template_headers": headers, "dropped_test_codes": dropped,
            "dropped_placeholder_rows": placeholders, "admission_item_code_map": mapping,
            "group_discounts": volume, "vouchers": vouchers}


def resolve_code(code, items, reg_types):
    """Suggest a mapping for a code like GA-SB -> admission item 'GA'/'General Admission' for the reg type 'SB'."""
    head, _, tail = code.partition("-")
    item = next((i["code"] for i in items if head.upper() in (i["code"].upper(), initials(i["name"]))), None)
    if not item:
        return None
    if not tail:
        return {"admission_item": item, "reg_types": []}
    tail = tail.upper()
    rts = [rt["code"] for rt in reg_types if rt["code"].upper() == tail
           or any(initials(lbl) == tail for lbl in rt["labels"] + [rt["name"].split("|")[-1]])]
    rts += [rt["code"] for rt in reg_types if rt["code"] not in rts and any(rt["code"] == f"{c}PRE" for c in rts)]
    return {"admission_item": item, "reg_types": rts} if rts else None


def plan_questions(ctx):
    qs = []
    for s in ctx.sheets("questions"):
        t = s.get("table")
        if not t:
            ctx.gap(f"'{s['title']}' has no 'Demo Name' header; questions not parsed.")
            continue
        H, title = t["headers"], s["title"]
        C = {k: hcol(H, p) for k, p in {
            "page": r"page displayed", "code": r"demo name", "scope": r"company or individual", "text": r"question text",
            "acode": r"answer code", "atext": r"answer text", "appearance": r"question appearance",
            "required": r"required", "reg_types": r"list reg types", "visible": r"visible online",
            "determines": r"determine reg type", "trigger": r"trigger", "notes": r"^notes|\| notes"}.items()}
        cur = None
        for rec in t["records"]:
            c, row = rec["cells"], rec["row"]
            v = lambda k: c.get(C[k], "") if C[k] else ""
            if v("text") and (v("code") or v("appearance") or v("page")):
                cur = {"code": v("code").upper(), "page": v("page"), "scope": v("scope"), "text": v("text"),
                       "appearance": v("appearance"), "required": yes(v("required")), "reg_types": v("reg_types"),
                       "visible_online": v("visible"), "trigger": v("trigger"), "notes": v("notes"),
                       "answers": [], "display_when": [], "source": ref(title, row)}
                if not cur["code"]:
                    ctx.gap("question has no demo name/code", cur["source"])
                qs.append(cur)
            elif cur and (v("acode") or v("atext")):
                cur["answers"].append({"code": v("acode"), "text": v("atext"), "reg_types": v("determines"),
                                       "source": ref(title, row)})
    for q in qs:
        for src in (q["trigger"], q["reg_types"]):
            m = re.match(r"(?i)^(?:if\s+)?([A-Z][A-Z0-9]*)\s*=\s*(.+)$", src or "")
            if m:
                ans = [a for a in re.findall(r"\b[A-Z0-9]+\b", m.group(2).upper()) if a not in ("AND", "OR")]
                q["display_when"].append([m.group(1).upper(), ans])
    return qs


def other_tabs(ctx):
    out = {}
    for s in ctx.ext["sheets"]:
        if s["excluded"] or s["role"] in ("event_details", "links", "reg_types", "reg_mapping", "discounts",
                                          "questions", "items", "vouchers"):
            continue
        out[s["title"]] = s.get("rows", [])
    return out


def communications(tabs):
    for title, rows in tabs.items():
        if "communication" in title.lower():
            return [{"type": r["cells"]["A"], "notes": r["cells"].get("C", ""), "source": ref(title, r["row"])}
                    for r in rows if r["cells"].get("A") and yes(r["cells"].get("B", ""))]
    return []


def family(ext):
    titles = " ".join(s["title"].lower() for s in ext["sheets"])
    a = "approvals" in titles and ("sessions" in titles or "optional" in titles)
    b = "approval site parameters" in titles or "sessions_add" in titles or "access & reports" in titles
    return "A" if a and not b else "B" if b and not a else "ambiguous"


def merge_agent(plan, out_dir):
    """Apply agent_plan.json. Each change cites a source cell or a decision.

    registration.reg_types / admission_items / paths / price_tiers: full replacement
        (legacy layouts; every reg type needs `source`).
    registration.path_assignments: {"REGCODE": "Path name"}
    registration.admission_item_codes: {"current code or name": "NEWCODE"}
    registration.price_tier_dates: {"Tier name": {"start": "YYYY-MM-DD" | null, "end": "YYYY-MM-DD"}}
    any other top-level key (items, discounts, website, ...): replaces that plan section.
    `notes`: free text, copied to plan.agent_notes.
    """
    path = os.path.join(out_dir, "agent_plan.json")
    if not os.path.exists(path):
        return
    agent = json.load(open(path))
    reg = plan.setdefault("registration", {})
    patch = agent.pop("registration", {})
    plan["agent_notes"] = agent.pop("notes", "")
    for section in ("reg_types", "admission_items", "paths", "price_tiers"):
        if section in patch:
            reg[section] = patch[section]
            reg["layout"] = "agent"
    for old, new in patch.get("admission_item_codes", {}).items():
        for it in reg.get("admission_items", []):
            if it["code"] == old:
                it["code"] = new
        for rt in reg.get("reg_types", []):
            if old in rt.get("admission_items", {}):
                rt["admission_items"][new] = rt["admission_items"].pop(old)
    merged = {}
    for it in reg.get("admission_items", []):
        if it["code"] in merged:
            merged[it["code"]]["reg_types"] = sorted(set(merged[it["code"]]["reg_types"]) | set(it["reg_types"]))
        else:
            merged[it["code"]] = it
    if merged:
        reg["admission_items"] = list(merged.values())
    for name, d in patch.get("price_tier_dates", {}).items():
        for t in reg.get("price_tiers", []):
            if t["name"] == name:
                t.update({k: d[k] for k in ("start", "end") if k in d})
    if patch.get("path_assignments"):
        for rt in reg.get("reg_types", []):
            if rt["code"] in patch["path_assignments"]:
                rt["path"] = patch["path_assignments"][rt["code"]]
        paths = {}
        for rt in reg.get("reg_types", []):
            if rt.get("path"):
                p = paths.setdefault(rt["path"], {"name": rt["path"], "reg_types": [], "web_visible": False,
                                                  "group_registration": False})
                p["reg_types"].append(rt["code"])
                p["web_visible"] = p["web_visible"] or rt.get("web_visible", True)
                p["group_registration"] = p["group_registration"] or rt.get("group_registration", False)
        reg["paths"] = list(paths.values())
    if reg.get("reg_types"):
        codes = {i["code"] for i in reg.get("admission_items", [])}
        reg["advanced_rules"] = [r for r in reg.get("advanced_rules", []) if r["kind"] != "admission_item_availability"] + [
            {"kind": "admission_item_availability", "reg_type": rt["code"], "allowed_admission_items": list(rt["admission_items"])}
            for rt in reg["reg_types"] if set(rt["admission_items"]) != codes]
    if patch:
        plan["coverage"]["registration"] = "agent" if reg.get("layout") == "agent" else "parsed+agent"
    for section, val in agent.items():
        plan[section] = val
        plan["coverage"][section] = "agent"


def build_plan(out_dir, keep_test=False):
    ext = json.load(open(os.path.join(out_dir, "extract.json")))
    ctx = Ctx(ext)
    ev, pairs = plan_event(ctx)
    site = plan_website(ctx, pairs)
    reg, reg_cov = plan_registration(ctx)
    items = plan_items(ctx)
    tabs = other_tabs(ctx)
    plan = {
        "parser_version": PARSER_VERSION, "source_file": ext["source_file"], "family": family(ext),
        "sheets": [{"title": s["title"], "role": s["role"], "used": not s["excluded"]} for s in ext["sheets"]],
        "event": ev, "website": site, "registration": reg,
        "items": items,
        "discounts": plan_discounts(ctx, reg if reg_cov == "parsed" else {}, keep_test),
        "questions": plan_questions(ctx),
        "other_tabs": tabs, "communications": communications(tabs),
        "coverage": {"event": "parsed" if ev else "absent", "website": "parsed", "registration": reg_cov,
                     "items": "parsed" if items else "absent", "questions": "parsed"},
    }
    if reg_cov == "needs_mapping":
        ctx.ask("Registration uses a legacy layout (old reg types plus a mapping tab). The agent must map it into "
                "agent_plan.json (see the skill), then re-run plan and validate.")
    if any(s["role"] == "unclassified" and not s["excluded"] and s.get("rows") for s in ext["sheets"]):
        names = [s["title"] for s in ext["sheets"] if s["role"] == "unclassified" and not s["excluded"] and s.get("rows")]
        ctx.gap(f"Unclassified tabs with content (review by hand): {', '.join(names)}.")
    for sh in ext["sheets"]:
        if sh.get("encoding_artifacts") and not sh["excluded"]:
            refs = sh["encoding_artifacts"]
            ctx.gap(f"'{sh['title']}' has text with the 'Â' encoding artifact ({', '.join(refs[:5])}"
                    f"{'…' if len(refs) > 5 else ''}); it is typed as written unless corrected in review.")
    if plan["family"] == "ambiguous":
        ctx.ask("Workbook family is ambiguous (A vs B); confirm which approval/sessions tabs apply.")
    plan["gaps"], plan["open_questions"] = ctx.all_gaps(), ctx.questions
    merge_agent(plan, out_dir)
    if plan["coverage"].get("registration") in ("agent", "parsed+agent"):
        plan["open_questions"] = [q for q in plan["open_questions"] if not q.startswith("Registration uses a legacy")]
        plan["gaps"].insert(0, "Gaps above the agent mapping were computed before agent_plan.json was applied; validation.md is current.")
    with open(os.path.join(out_dir, "plan.json"), "w") as f:
        json.dump(plan, f, indent=1)
    md = plan_md(plan)
    with open(os.path.join(out_dir, "plan.md"), "w") as f:
        f.write(md)
    print(md)


def plan_md(p):
    ev, reg, site, disc = p["event"], p["registration"], p["website"], p["discounts"]
    L = [f"# Build plan: {ev.get('name', '?')}", "",
         f"Identity key: FP {ev.get('fp_code')} · {ev.get('name')} · {ev.get('dates_display')} · {ev.get('timezone')}",
         f"Workbook family: {p['family']} · coverage: " + ", ".join(f"{k}={v}" for k, v in p["coverage"].items()), "",
         "## Website",
         f"- Theme: {site['theme']['name'] or '(none)'} · colors {', '.join(site['theme']['brand_colors']) or '(none)'}",
         f"- Already-registered link: {'yes' if site['header']['already_registered_link'] else 'no'} · logo/banner: not provided"]
    for aud, links in site["footers"].items():
        L.append(f"- Footer ({aud}): " + (", ".join(l["label"] for l in links if l["visible"]) or "none"))
    b = site["body"]
    L += [f"- Countdown: {'on' if b['countdown_timer']['enabled'] else 'off'} · social links: {len(b['social_media'])}", "",
          "## Registration"]
    if reg.get("layout") == "legacy":
        L.append(f"- **Needs mapping:** '{reg['source_sheet']}' uses the legacy layout ({len(reg['rows'])} rows). "
                 "The agent maps it into agent_plan.json.")
    else:
        L += ["- Price tiers: " + ("; ".join(f"{t['name']} {t['start'] or 'open'}→{t['end'] or '?'}" for t in reg.get("price_tiers", [])) or "none"),
              f"- Paths ({len(reg.get('paths', []))}): " + "; ".join(f"{x['name']} [{', '.join(x['reg_types'])}]{'' if x['web_visible'] else ' (planner-only)'}" for x in reg.get("paths", [])),
              f"- Reg types: {len(reg.get('reg_types', []))} · admission items: {len(reg.get('admission_items', []))} "
              f"({', '.join(i['code'] for i in reg.get('admission_items', []))}) · skipped rows: {len(reg.get('skipped_rows', []))}",
              f"- Advanced rules: {len(reg.get('advanced_rules', []))}"]
    L += [f"- Items: " + ("; ".join(f"{g['sheet']}: {len(g['items'])} {g['kind']}" for g in p["items"]) or "none"),
          f"- Discount codes: {len(disc['codes'])} (dropped test codes: {', '.join(disc['dropped_test_codes']) or 'none'}) · "
          f"volume discounts: {len(disc['group_discounts'])} · voucher rows: {len(disc['vouchers'])}",
          f"- Questions: {len(p['questions'])} · communications (Yes): {len(p['communications'])}"]
    if reg.get("reg_types"):
        L += ["", "## Reg types", "", "| Code | Name | Path | Web | Admission items and prices |", "|---|---|---|---|---|"]
        for rt in reg["reg_types"]:
            pr = "; ".join(f"{k}: " + "/".join(json.dumps(v) if isinstance(v, dict) else str(v) for v in d["prices"].values())
                           for k, d in rt["admission_items"].items())
            L.append(f"| {rt['code']} | {rt['name']} | {rt.get('path', '')} | {'yes' if rt.get('web_visible', True) else 'staff'} | {pr} |")
    L += ["", "## Gaps", *([f"- {g}" for g in p["gaps"]] or ["- none"]),
          "", "## Open questions (answer before any Cvent write)", *([f"- {q}" for q in p["open_questions"]] or ["- none"])]
    return "\n".join(L) + "\n"


# ------------------------------------------------------------------ validate

def validate(out_dir):
    """Errors are grouped by build section; a section with errors must not be built.
    Writes validation.json ({section: {errors, warnings}}) and validation.md."""
    p = json.load(open(os.path.join(out_dir, "plan.json")))
    cmap_path = os.path.join(out_dir, "code_map.json")
    cmap = {k: v for k, v in (json.load(open(cmap_path)) if os.path.exists(cmap_path) else {}).items() if v}
    res = {k: {"errors": [], "warnings": []} for k in ("identity", "website", "registration", "items", "discounts", "questions")}
    E = lambda sec, m: res[sec]["errors"].append(m)
    W = lambda sec, m: res[sec]["warnings"].append(m)
    reg = p.get("registration", {})
    for k in ("name", "fp_code"):
        if not p.get("event", {}).get(k):
            E("identity", f"Event identity is missing {k}.")
    if p["coverage"].get("registration") == "needs_mapping":
        E("registration", "Registration uses the legacy layout and is not mapped yet: write agent_plan.json, then re-run plan.")
    tiers = {t["name"]: t for t in reg.get("price_tiers", [])}
    ordered = [t for t in reg.get("price_tiers", []) if t.get("end")]
    for t in tiers.values():
        if not t.get("end"):
            E("registration", f"Price tier '{t['name']}' has no end date.")
        if t.get("start") and t.get("end") and t["start"] > t["end"]:
            E("registration", f"Price tier '{t['name']}' starts after it ends.")
    for a, b in zip(ordered, ordered[1:]):
        if b.get("start") and b["start"] <= a["end"]:
            E("registration", f"Price tiers '{a['name']}' and '{b['name']}' overlap ({a['end']} / {b['start']}).")
    items = {i["code"]: i for i in reg.get("admission_items", [])}
    by_name = {}
    for i in items.values():
        by_name.setdefault(key(i["name"]), []).append(i["code"])
    for name, codes in by_name.items():
        if len(codes) > 1:
            W("registration", f"Admission item name '{name}' is shared by codes {codes}; confirm they are distinct items "
                              f"(additional text should tell them apart).")
    decisions = open(os.path.join(out_dir, "decisions.md")).read() if os.path.exists(os.path.join(out_dir, "decisions.md")) else ""
    for i in items.values():
        if i.get("code_source") == "proposed" and i["code"] not in decisions:
            W("registration", f"Admission item code {i['code']} was proposed by the agent; record the user's OK in decisions.md.")
        if not re.fullmatch(r"[A-Za-z0-9_|-]{2,40}", i["code"]):
            E("registration", f"Admission item code '{i['code']}' is a name, not a code.")
    paths = {x["name"]: x for x in reg.get("paths", [])}
    agent = reg.get("layout") == "agent"
    seen = set()
    for rt in reg.get("reg_types", []):
        c = rt.get("code", "")
        if not re.fullmatch(r"[A-Za-z0-9_-]{2,40}", c):
            E("registration", f"Reg type code '{c}' is not a single code.")
        if c in seen:
            E("registration", f"Reg type code {c} appears twice.")
        seen.add(c)
        if agent and not rt.get("source"):
            E("registration", f"Reg type {c} has no source cell.")
        if not rt.get("path"):
            E("registration", f"Reg type {c} has no registration path.")
        elif rt["path"] not in paths:
            E("registration", f"Reg type {c} names path '{rt['path']}', which is not in paths.")
        if not rt.get("admission_items"):
            E("registration", f"Reg type {c} has no admission items.")
        for aic, d in rt.get("admission_items", {}).items():
            if aic not in items:
                E("registration", f"Reg type {c} uses admission item '{aic}', which is not defined.")
            for tier, val in d.get("prices", {}).items():
                if tier not in tiers:
                    E("registration", f"Reg type {c} / {aic} has a price for unknown tier '{tier}'.")
                if isinstance(val, dict) and "raw" not in val:
                    E("registration", f"Reg type {c} / {aic} / {tier}: member/non-member prices must be split into "
                                      f"separate reg types during mapping.")
                    continue
                vals = [val]
                for x in vals:
                    if isinstance(x, dict) or x is None or not re.fullmatch(r"\d+(\.\d+)?", str(x)):
                        E("registration", f"Reg type {c} / {aic} / {tier}: price {x!r} is not a number.")
                    elif re.fullmatch(r"\d+\.\d{3,}", str(x)):
                        E("registration", f"Reg type {c} / {aic} / {tier}: price {x} has fractions of a cent.")
    import difflib
    names = list(paths)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            if difflib.SequenceMatcher(None, a.lower(), b.lower()).ratio() > 0.85:
                W("registration", f"Path names '{a}' and '{b}' look like the same path (typo?).")
    for x in paths.values():
        for c in x.get("reg_types", []):
            if c not in seen:
                E("registration", f"Path '{x['name']}' lists unknown reg type {c}.")
    for g in p.get("items", []):
        for it in g["items"]:
            for tier, val in it["prices"].items():
                if isinstance(val, dict) and "raw" in val:
                    E("items", f"{it['source']}: item '{it['title']}' price '{val['raw']}' is not a number.")
            if not it["code"]:
                W("items", f"{it['source']}: item '{it['title']}' has no code.")
    known = set(items)
    blocked = []
    for d in p.get("discounts", {}).get("codes", []):
        if not re.fullmatch(r"\d+(\.\d+)?", str(d.get("amount", ""))):
            E("discounts", f"Discount {d['code']} ({d['source']}): amount {d.get('amount')!r} is not a number.")
        if not d.get("method"):
            E("discounts", f"Discount {d['code']} ({d['source']}): no usable method.")
        elif d["method"] == "Subtract a percentage" and re.fullmatch(r"\d+(\.\d+)?", str(d.get("amount", ""))) \
                and not 0 < float(d["amount"]) <= 100:
            E("discounts", f"Discount {d['code']} ({d['source']}): {d['amount']}% is not a percentage between 0 and 100.")
        if known and [c for c in d["admission_items"] if c not in known and c not in cmap]:
            blocked.append(d["code"])
    if blocked:
        W("discounts", f"{len(blocked)} codes reference admission-item codes that are neither in the plan nor in "
                       f"code_map.json and will be blocked: {', '.join(blocked[:10])}{'…' if len(blocked) > 10 else ''}")
    for aud, links in p.get("website", {}).get("footers", {}).items():
        for l in links:
            if l["visible"] and not re.match(r"^(https?://|mailto:|cvent-generated$)", l["url"] or ""):
                E("website", f"Footer ({aud}) link '{l['label']}' is visible but has no URL.")
    for q in p.get("questions", []):
        if not q["code"]:
            W("questions", f"{q['source']}: question has no demo code.")
    if p.get("open_questions") and not os.path.exists(os.path.join(out_dir, "decisions.md")):
        W("identity", f"{len(p['open_questions'])} open questions and no decisions.md yet.")
    with open(os.path.join(out_dir, "validation.json"), "w") as f:
        json.dump(res, f, indent=1)
    total = sum(len(r["errors"]) for r in res.values())
    lines = ["# Validation", "", f"Errors: {total}. A section with errors is not built until they are resolved.", "",
             "| Section | Errors | Warnings |", "|---|---|---|"]
    lines += [f"| {k} | {len(r['errors'])} | {len(r['warnings'])} |" for k, r in res.items()]
    for k, r in res.items():
        if r["errors"] or r["warnings"]:
            lines += ["", f"## {k}", *[f"- ERROR: {e}" for e in r["errors"][:40]],
                      *([f"- … {len(r['errors']) - 40} more errors in validation.json"] if len(r["errors"]) > 40 else []),
                      *[f"- warning: {w}" for w in r["warnings"][:20]]]
    with open(os.path.join(out_dir, "validation.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))
    return 1 if total else 0


# ------------------------------------------------------------------ QA: expect + verify

def ws(v):
    """Comparison text: spacing and non-breaking spaces ignored, case kept."""
    return re.sub(r"\s+", " ", str(v).replace("Â\xa0", " ").replace("\xa0", " ")).strip()


def expected_checks(p, out_dir, test_target=False):
    """One check per value the build puts in Cvent. Kinds: text, code, money, date, bool, set, list,
    contains (all parts appear), judge (needs {"observed", "ok"}), not_live, discount."""
    C = []
    add = lambda cid, section, kind, exp, src="": C.append(
        {"id": cid, "section": section, "kind": kind, "expected": exp, **({"source": src} if src else {})})
    ev = p.get("event", {})
    add("event|status", "identity", "not_live", "not launched or published")
    if not test_target:
        for f, kind in (("name", "text"), ("fp_code", "code")):
            if ev.get(f):
                add(f"event|{f}", "identity", kind, ev[f])
        for f in ("timezone", "location", "dates_display"):
            if ev.get(f):
                add(f"event|{f}", "identity", "judge", ev[f])
    reg = p.get("registration", {})
    if reg.get("layout") != "legacy":
        for t in reg.get("price_tiers", []):
            for f in ("start", "end"):
                if t.get(f):
                    add(f"tier|{t['name']}|{f}", "registration", "date", t[f])
        for x in reg.get("paths", []):
            add(f"path|{x['name']}|reg_types", "registration", "set", x["reg_types"])
            add(f"path|{x['name']}|public", "registration", "bool", bool(x.get("web_visible")))
            add(f"path|{x['name']}|group_registration", "registration", "bool", bool(x.get("group_registration")))
        for rt in reg.get("reg_types", []):
            c, src = rt["code"], rt.get("source", "")
            add(f"reg_type|{c}|name", "registration", "text", rt.get("name") or c, src)
            add(f"reg_type|{c}|path", "registration", "text", rt.get("path", ""), src)
            for flag in ("approval", "pre_approval", "advanced_prereg"):
                add(f"reg_type|{c}|{flag}", "registration", "bool", bool(rt.get(flag)), src)
            for aic, d in rt.get("admission_items", {}).items():
                for tier, val in d.get("prices", {}).items():
                    if isinstance(val, dict):
                        continue  # validation blocks unresolved prices
                    add(f"fee|{c}|{aic}|{tier}", "registration", "money", val, d.get("source", src))
        for it in reg.get("admission_items", []):
            src = it.get("source", "")
            add(f"admission_item|{it['code']}|name", "registration", "text", it["name"], src)
            add(f"admission_item|{it['code']}|reg_types", "registration", "set", it["reg_types"], src)
            parts = [x for x in (it.get("additional_text"), it.get("description")) if x]
            if parts:
                add(f"admission_item|{it['code']}|description", "registration", "contains", parts, src)
    for g in p.get("items", []):
        for it in g["items"]:
            if yes(it.get("sessionboard_sync", "")):
                continue
            k, src = it["code"] or it["title"], it["source"]
            add(f"item|{k}|title", "items", "text", it["title"], src)
            if it.get("capacity") and not blank(it["capacity"]):
                add(f"item|{k}|capacity", "items", "judge", it["capacity"], src)
            for tier, val in it["prices"].items():
                for variant, v in (val.items() if isinstance(val, dict) and "raw" not in val else [("", val)]):
                    if not isinstance(v, dict):
                        add(f"item|{k}|price|{tier}{'|' + variant if variant else ''}", "items", "money", v, src)
    work = os.path.join(out_dir, "discounts_api.json")
    if os.path.exists(work):
        for d in json.load(open(work)).get("discounts", []):
            add(f"discount|{d['code']}", "discounts", "discount", "unchanged", d.get("source", ""))
    for q in p.get("questions", []):
        k, src = q["code"] or q["source"], q["source"]
        add(f"question|{k}|text", "questions", "text", q["text"], src)
        add(f"question|{k}|required", "questions", "bool", bool(q["required"]), src)
        if q.get("appearance"):
            add(f"question|{k}|type", "questions", "judge", q["appearance"], src)
        if q["answers"]:
            add(f"question|{k}|answers", "questions", "list", [a["text"] or a["code"] for a in q["answers"]], src)
        if q.get("reg_types"):
            add(f"question|{k}|reg_types", "questions", "judge", q["reg_types"], src)
        if q["display_when"]:
            add(f"question|{k}|display_when", "questions", "judge", q["display_when"], src)
    site = p.get("website", {})
    if site.get("theme", {}).get("name"):
        add("website|theme", "website", "text", site["theme"]["name"])
    for aud, links in site.get("footers", {}).items():
        add(f"website|footer|{aud}", "website", "list",
            [f"{l['label']} -> {l['url']}" for l in links if l["visible"]])
    body = site.get("body", {})
    if body:
        add("website|header|already_registered_link", "website", "bool", bool(site["header"]["already_registered_link"]))
        add("website|register_buttons", "website", "set",
            [x["name"] for x in reg.get("paths", []) if x.get("web_visible")])
        cd = body["countdown_timer"]
        add("website|countdown|enabled", "website", "bool", bool(cd["enabled"]))
        if cd["enabled"] and cd.get("label"):
            add("website|countdown|label", "website", "text", cd["label"])
        cal = body["event_information"]["add_to_calendar"]
        add("website|add_to_calendar|enabled", "website", "bool", bool(cal["enabled"]))
        add("website|social", "website", "set", [x["url"] for x in body.get("social_media", [])])
    for cm in p.get("communications", []):
        add(f"comm|{cm['type']}|draft", "comms", "judge", "configured, not sent or scheduled", cm["source"])
    return C


def expect(out_dir, test_target=False):
    p = json.load(open(os.path.join(out_dir, "plan.json")))
    checks = expected_checks(p, out_dir, test_target)
    counts = {}
    for c in checks:
        counts[c["id"]] = counts.get(c["id"], 0) + 1
    for c in checks:  # the RR repeats a name: tell the records apart by their source cell
        if counts[c["id"]] > 1:
            c["id"] = f"{c['id']}@{c.get('source', '?')}"
    ids = [c["id"] for c in checks]
    with open(os.path.join(out_dir, "expected.json"), "w") as f:
        json.dump({"test_target": test_target, "checks": checks}, f, indent=1)
    path = os.path.join(out_dir, "readback.json")
    old = json.load(open(path)) if os.path.exists(path) else {}
    with open(path, "w") as f:
        json.dump({i: old.get(i) for i in ids if not i.startswith("discount|")}, f, indent=1)
    by = {}
    for c in checks:
        by[c["section"]] = by.get(c["section"], 0) + 1
    print(f"{len(checks)} checks: " + ", ".join(f"{k} {v}" for k, v in by.items()))
    print("Fill readback.json with what Cvent shows (null = not read). Discount checks come from the "
          "latest cvent_discounts_check results file.")


def same(c, obs):
    k, exp = c["kind"], c["expected"]
    if k == "judge":
        return isinstance(obs, dict) and bool(ws(obs.get("observed", ""))) and obs.get("ok") is True
    if k == "not_live":
        o = key(obs)
        return bool(o) and not re.search(r"(?<!not )(?<!un)\b(active|live|launched|published)\b", o)
    if k == "bool":
        return (obs if isinstance(obs, bool) else yes(obs) if key(obs) in ("yes", "no", "y", "n", "true", "false") else None) is exp
    if k == "money":
        a, b = money(exp), money(obs)
        return a is not None and b is not None and Decimal(a) == Decimal(b)
    if k == "date":
        return str(obs)[:10] == exp
    if k == "code":
        return ws(obs).upper() == ws(exp).upper()
    if k == "set":
        return isinstance(obs, list) and sorted({ws(x).upper() for x in obs}) == sorted({ws(x).upper() for x in exp})
    if k == "list":
        return isinstance(obs, list) and [ws(x) for x in obs] == [ws(x) for x in exp]
    if k == "contains":
        return all(key(x) in key(obs) for x in exp)
    if k == "discount":
        return obs == "unchanged"
    return ws(obs) == ws(exp)


def verify(out_dir):
    E = json.load(open(os.path.join(out_dir, "expected.json")))
    rb_path = os.path.join(out_dir, "readback.json")
    rb = json.load(open(rb_path)) if os.path.exists(rb_path) else {}
    val = json.load(open(os.path.join(out_dir, "validation.json")))
    blocked = {sec for sec, r in val.items() if r["errors"]}
    decisions = open(os.path.join(out_dir, "decisions.md")).read() if os.path.exists(os.path.join(out_dir, "decisions.md")) else ""
    wpath = os.path.join(out_dir, "qa_waivers.json")
    waivers = json.load(open(wpath)) if os.path.exists(wpath) else {}
    work = os.path.join(out_dir, "discounts_api.json")
    disc, disc_note = {}, ""
    checked = os.path.join(out_dir, "discounts_api.checked.json")
    if os.path.exists(checked) and os.path.exists(work):
        r = json.load(open(checked))
        if r.get("fileSha256") == hashlib.sha256(open(work, "rb").read()).hexdigest():
            disc = {o["code"]: o["status"] for o in r.get("outcomes", [])}
        else:
            disc_note = "discounts_api.checked.json is for an older work file; run cvent_discounts_check again."
    results = []
    for c in E["checks"]:
        sec = "identity" if c["section"] == "identity" else c["section"]
        obs = disc.get(c["id"].split("|", 1)[1]) if c["kind"] == "discount" else rb.get(c["id"])
        if sec in blocked and sec != "identity":
            status = "blocked"
        elif c["id"] in waivers and c["id"] in decisions and ws(waivers[c["id"]]):
            status = "waived"
        elif obs is None:
            status = "unread"
        else:
            status = "pass" if same(c, obs) else "fail"
        results.append({**c, "observed": obs, "status": status})
    n = {k: sum(r["status"] == k for r in results) for k in ("pass", "fail", "unread", "waived", "blocked")}
    complete = n["fail"] == 0 and n["unread"] == 0
    with open(os.path.join(out_dir, "qa.json"), "w") as f:
        json.dump({"complete": complete, "counts": n, "results": results}, f, indent=1)
    secs = sorted({r["section"] for r in results})
    L = ["# QA", "", f"**{'COMPLETE' if complete else 'NOT COMPLETE'}** — every planned value checked against Cvent.", "",
         "| Section | Pass | Fail | Unread | Waived | Blocked |", "|---|---|---|---|---|---|"]
    for sec in secs:
        rs = [r for r in results if r["section"] == sec]
        L.append(f"| {sec} | " + " | ".join(str(sum(r['status'] == k for r in rs)) for k in ("pass", "fail", "unread", "waived", "blocked")) + " |")
    if disc_note:
        L += ["", f"- {disc_note}"]
    for k in ("fail", "unread"):
        rs = [r for r in results if r["status"] == k]
        if rs:
            L += ["", f"## {k} ({len(rs)})"]
            L += [f"- `{r['id']}` expected {json.dumps(r['expected'])[:120]}"
                  + (f", Cvent shows {json.dumps(r['observed'])[:120]}" if k == "fail" else "")
                  + (f" ({r['source']})" if r.get("source") else "") for r in rs[:200]]
            if len(rs) > 200:
                L.append(f"- … {len(rs) - 200} more in qa.json")
    with open(os.path.join(out_dir, "qa.md"), "w") as f:
        f.write("\n".join(L) + "\n")
    print("\n".join(L[:12 + len(secs)]))
    return 0 if complete else 1


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) >= 1 and args[0] == "extract" and len(args) == 3:
        extract(args[1], args[2])
    elif len(args) == 2 and args[0] == "plan":
        build_plan(args[1], "--keep-test-codes" in sys.argv)
    elif len(args) == 2 and args[0] == "validate":
        sys.exit(validate(args[1]))
    elif len(args) == 3 and args[0] == "images":
        images(args[1], args[2])
    elif len(args) == 2 and args[0] == "expect":
        expect(args[1], "--test-target" in sys.argv)
    elif len(args) == 2 and args[0] == "verify":
        sys.exit(verify(args[1]))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
```
