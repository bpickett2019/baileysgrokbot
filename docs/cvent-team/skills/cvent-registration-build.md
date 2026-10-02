---
name: cvent-registration-build
description: "Build Cvent registration from an approved RR plan: registration types, paths, admission items, pricing tiers, optional items, advanced rules, discount codes and vouchers. Idempotent; edits in place; never deletes or publishes."
---

# cvent-registration-build — Types, paths, items, pricing, rules, discounts

## Before you start

You need:
- an approved `shared/cvent-builds/<FP>/plan.json`;
- `decisions.md`, whose answers override the plan;
- the browser lock;
- the target event verified as described in `/cvent-rr-event-build`.

For tool rules, read `/cvent-team-browser` (computer provider) or
`/cvent-ego-navigation` (Ego provider).

Shell commands run with `cwd: "shared"`; the paths in the snippets below are
relative to it. File tools use `shared/...`.

**Gate:** read `shared/cvent-builds/<FP>/validation.json`. If `registration` has
errors, build none of R1–R6. If `discounts` has errors, skip R7. If `items` has
errors, skip R5. Report each blocked step with the errors verbatim. Every plan
entry has a `source` cell; quote it in `status.md` when something looks wrong.

Hard rules:
- No publish, activate, delete or clone.
- Change only the target event.
- Never touch account-level libraries (account reg types, fee templates, global
  discounts).
- If an open question in `plan.md` has no answer in `decisions.md`, the
  sub-steps that depend on it are blocked. Everything else proceeds.

## Learnings

Before acting, read `shared/cvent-learnings/registration.md`. After each step is
saved and verified, append the navigation path, exact labels, required fields,
validation messages (verbatim) and any control that needed desktop actions. Never
record event data or credentials.

## Idempotency (this matters on cloned test events)

Before creating anything, list what already exists on that screen. Match by code
first, then by exact name.

- **Exists and matches:** leave it alone and mark it verified.
- **Exists but differs:** edit it in place to match the plan, recording before →
  after in `status.md`.
- **Exists but isn't in the plan:** leave it untouched and list it under
  "pre-existing, not in RR" in the report. Never delete, deactivate or rename it.
- **Missing:** create it.

Re-running this skill must never create duplicates.

## Build order

Stay in the event's **Registration** area for the whole batch. Each step depends
on the ones before it.

R1 reg types → R2 paths → R3 admission items → R4 pricing → R5 optional items →
R6 advanced rules → R7 discounts → R8 vouchers

## R1 Registration types

Source: `registration.reg_types`.

- **Name and code:** use `name` and `code` exactly, including the `|` separators
  in names. Codes are case-sensitive in reports.
- **Visibility:** when `web_visible` is false (RR method "Staff Only"), the type
  is available to planners/staff only and never appears on the website. Use
  whatever control the form offers, such as a website-visibility option or
  restricting it to a planner-only path. Record which one in the learnings.
- **Badge text:** goes to the Badges lane, which owns it. Don't set it here unless
  the reg-type form has a badge field.
- **Approval flags:** belong to the Questions lane (approvals). Leave them for that
  lane, but if the type form has an approval toggle, mention it in your report.

Verify: read the list back and compare the count and every code/name pair with
the plan.

## R2 Registration paths

Source: `registration.paths`.

- Create one path per entry, using the exact name. If an existing path with a
  different name already holds the same reg types, ask before renaming it.
- Associate exactly the listed reg types.
- Enable group registration only where `group_registration` is true.
- A path whose `web_visible` is false is a planner-only path: it gets no public
  link and no Register button (the website skill relies on this).
- Every reg type must belong to exactly one path. A type the plan leaves without a
  path is blocked; never assign one by guess.

Verify: open each path and read back its reg types.

## R3 Admission items

Source: `registration.admission_items`.

- **Name and code** exactly as in the plan.
- **Description:** the RR "additional text" (for example a date or time line)
  first, then the RR description, keeping its bullets as plain lines.
- **Associated reg types:** exactly `reg_types`. This is also how most
  `admission_item_availability` rules get enforced.
- **Capacity:** leave unlimited unless the RR gives a number.
- A reg type with more than one admission item means the registrant chooses one.
  Leave Cvent's default choose-one behaviour in place.

Verify: read back each item's code, name and associated types.

## R4 Pricing

Source: `registration.price_tiers`, plus each reg type's
`admission_items[code].prices[tier]`.

1. Create one fee tier (also called a price window or fee schedule) per plan tier,
   with the same name. It starts at 12:00 AM on `start` and ends at 11:59 PM on
   `end`, in the event time zone. Tiers must be contiguous and must not overlap.
   If Cvent rejects a date, copy the validation text and mark R4 blocked.
2. For every admission item × reg type × tier, set the amount from the plan.
   Treat `0` as an explicit $0 fee, not a missing one. Non-numeric values (for
   example a "no reprint" note) are not admission fees: skip them and list them
   for the Badges lane.
3. Reprint fees and GL codes are not admission fees. Hand them to the Badges lane
   (reprint) and record GL codes in the report unless a GL field exists on the
   fee form.
4. Batch the amount fields from one snapshot (up to 24 per `browser_act`), then
   save.

Verify (spreadsheet-style, in shell): dump the fees you read back into
`fees_readback.json`, then diff it against the plan:

```bash
python3 - <<'EOF'
import json
plan=json.load(open("cvent-builds/<FP>/plan.json"))["registration"]
seen=json.load(open("cvent-builds/<FP>/fees_readback.json"))  # {"RT|ITEM|TIER": "amount"}
bad=[(k,v,seen.get(k)) for rt in plan["reg_types"] for item,d in rt["admission_items"].items()
     for tier,v in d["prices"].items() if v.replace('.','',1).isdigit()
     for k in [f"{rt['code']}|{item}|{tier}"] if str(seen.get(k)) not in (v, f"{float(v):.2f}")]
print("fee mismatches:", bad or "none")
EOF
```

## R5 Optional items, sessions and add-ons

Source: `items`, a list of groups, one per RR tab. Each group has a `kind`
(`session`, `add-on`, `optional` or `membership`), its own `price_tiers` and its
`items`.

- If `items` is empty, skip R5 with the reason "RR has no optional items", unless
  `decisions.md` lists items to add.
- An item tier whose name or dates match a registration tier uses that tier;
  otherwise create the item's own fee window from the group's `price_tiers`.
- `{member, non-member}` prices are charged by reg type. Use the item's
  `member_fee_types` and `nonmember_fee_types` lists; if those are empty, ask.
- Items with `sessionboard_sync` = Yes are synced from Sessionboard, so don't
  create them by hand. List them as "synced". Never create placeholder or test items unless
  `decisions.md` asks for them by name. When it does, prefix each name with
  `TEST - `.
- Map these fields per row: item code, title, description, capacity (blank means
  unlimited), start/end date and time, price per tier, which admission items may
  purchase it, which admission items include it at no charge, maximum quantity,
  whether a ticket prints, and whether it shows on the itinerary.
- In Flex events, optional items can live under Sessions (optional type) or an
  Optional Items screen. Use whichever the event shows, and record it.

## R6 Advanced rules

Source: `registration.advanced_rules`.

- **`admission_item_availability`:** first check whether R3's associated types
  already enforce the rule. If so, it's done; record "enforced by item
  association". Otherwise, add a rule under the event's advanced registration
  rules that limits that reg type to `allowed_admission_items`.
- **`question_display`:** owned by the Questions lane. List these rules in your
  report for that lane; don't build them here.
- Session or optional-item limits from the RR (maximum per registrant, conflicts,
  "included for") get a rule here only if the RR states them.
- Never add rules the RR doesn't state.

Verify: read every rule back, quoting its condition and outcome.

## R7 Discount codes

Source: `discounts.codes`, with the admission-item code map from `decisions.md`.

Channel, in order of preference:

1. **The server-side Cvent API tools** (`cvent_discounts_check` and
   `cvent_discounts_apply`). They appear only once a `cvent_api` credential is
   saved. The client secret and OAuth token stay on the server, so the model never
   sees them, and `secret_request` refuses that credential. See "R7 via the API"
   below.
2. **The planner's discount import.** Build the import file below, then upload it
   through the UI. The native file picker needs `request_takeover` (computer
   provider) or the user (Ego provider).
3. **Manual UI entry,** one code at a time, from a single snapshot per form. Use
   this only for a handful of codes.

### R7 via the API

**One-time setup.** If `list_secrets` shows no `cvent_api`, ask the user for the
Cvent client ID and call `request_secret` with:
- `{"name": "cvent_api", "origin": "https://api-platform.cvent.com", "auth": {"type": "basic", "username": "<client ID>"}}`
- `purpose: "api_key"`

The user types the client secret into the protected card. Use the regional origin
(for example `https://api-platform-eur.cvent.com`) if the account is hosted
outside North America. The tools appear on the next message.

**Event identity.** You need the event's Cvent UUID and its exact title. The UUID
is in the planner URL of the verified target event (`evtstub=` or `eventId=`).
Never guess it.

**Build the work file** (shell, `cwd: "shared"`):

```bash
python3 - <<'EOF'
import json, os, re
plan=json.load(open("cvent-builds/<FP>/plan.json"))
known={i["code"] for i in plan["registration"]["admission_items"]}
path="cvent-builds/<FP>/code_map.json"
cmap={k:v for k,v in (json.load(open(path)) if os.path.exists(path) else {}).items() if v}
METHOD={"Subtract an amount":"BY_AMOUNT","Subtract a percentage":"BY_PERCENTAGE","Charge a fixed price":"FLAT_PRICE"}
AUD={"invitees and guests":"ALL","invitees":"PRIMARY","guests":"GUEST","":"ALL"}
iso=lambda v: v[:10] if re.fullmatch(r"\d{4}-\d{2}-\d{2}( .*)?", v or "") else None
out, held = [], []
for c in plan["discounts"]["codes"]:
    items, types, unmapped, plain = [], [], [], []
    for code in c["admission_items"]:
        if code in cmap: items.append(cmap[code]["admission_item"]); types += cmap[code]["reg_types"]
        elif code in known: items.append(code); plain.append(code)
        else: unmapped.append(code)
    if unmapped or (types and plain) or c["method"] not in METHOD:
        held.append({"code": c["code"], "unmapped": unmapped, "mixed_with": plain if types else [], "method": c["method"], "source": c["source"]}); continue
    spec={"code": c["code"], "name": (c["name"] or c["code"])[:50], "method": METHOD[c["method"]], "value": float(c["amount"]),
          "active": c["active"] and not types,  # a reg-type limit can't be set by API: create inactive, list it
          "stackable": c["stackable"], "capacity": int(c["capacity"]) if str(c["capacity"]).isdigit() else -1,
          "audience": AUD.get(c["usable_by"].lower(), "ALL"),
          "includeGuestsTowardsCapacity": not c["count_guests"].lower().startswith("no"),
          "admissionItems": list(dict.fromkeys(items)), "source": c["source"]}
    for k, v in (("effectiveFrom", iso(c["effective_from"])), ("effectiveTo", iso(c["effective_to"]))):
        if v: spec[k] = v
    note = (c["internal_note"] + (f" | limit to reg types: {','.join(dict.fromkeys(types))}" if types else "")).strip(" |")
    if note: spec["note"] = note[:300]
    out.append(spec)
json.dump({"discounts": out}, open("cvent-builds/<FP>/discounts_api.json", "w"), indent=1)
json.dump(held, open("cvent-builds/<FP>/discount_blocked.json", "w"), indent=1)
print(len(out), "in work file ·", sum(1 for d in out if not d["active"] and "limit to reg types" in d.get("note","")), "inactive pending reg-type limit ·", len(held), "held")
EOF
```

**Run it:**
1. `cvent_discounts_check` with `{eventId, eventTitle, file: "shared/cvent-builds/<FP>/discounts_api.json"}`.
   This is read-only and examines every code. It reports `would_create`,
   `unchanged`, `preserved_difference` and `blocked`, plus the file's
   `fileSha256`. Show the user the counts and the `attention` list.
2. After the user's OK, call `cvent_discounts_apply` with the same arguments plus
   the `fileSha256` from that check. Apply refuses a changed file, so the approval
   always covers what the user saw.

   Each call needs one approval and handles up to `limit` new codes (default 25).
   Call it again until `notInThisCall` is 0. Codes created earlier come back as
   `unchanged`, so re-running is safe.

   Each apply writes a timestamped `*.applied-<time>.json` with every outcome,
   updated as it goes. Its `attention` list includes created codes with their
   IDs. Stopping the run stops the batch between requests.
3. **Stop rules:**
   - **`stoppedEarly` is true, or any code is `uncertain`:** stop R7. Report the
     code and the `resultsFile`, and ask the user to check that code in Cvent.
     Never retry an uncertain code, and never re-create it in the UI.
   - **`preserved_difference`:** the existing code was left as it is. List it for
     the user; the tool never edits existing codes.
   - **`blocked`:** report the reason. A missing admission item usually means R3
     isn't finished.
4. **Reg-type limits:** codes created inactive with a "limit to reg types" note
   can't be restricted through the API. Hand them to the UI (set the limit, then
   activate), or ask the user to decide.

The import-file route below is the fallback when no API credential is available.

Build the work files. The import file keeps the RR template's own column headers
(`template_headers`), because the RR tab mirrors Cvent's discount template.
Reg-type limits go in a separate file and are applied in the UI after import.

```bash
python3 - <<'EOF'
import csv, json, os
plan=json.load(open("cvent-builds/<FP>/plan.json"))
d=plan["discounts"]
known={i["code"] for i in plan["registration"]["admission_items"]}
path="cvent-builds/<FP>/code_map.json"  # user-accepted only: {"GA-SB": {"admission_item":"GA","reg_types":["STUBUY"]}}
cmap={k:v for k,v in (json.load(open(path)) if os.path.exists(path) else {}).items() if v}
rows, limits, blocked = [], [], []
for c in d["codes"]:
    items, types, unmapped, plain = [], [], [], []
    for code in c["admission_items"]:
        if code in cmap: items.append(cmap[code]["admission_item"]); types += cmap[code]["reg_types"]
        elif code in known: items.append(code); plain.append(code)
        else: unmapped.append(code)
    if unmapped or (types and plain):
        blocked.append({"code":c["code"],"unmapped":unmapped,"mixed_with":plain if types else []}); continue
    row=dict(c["raw"]); item_col=next(h for h in d["template_headers"] if h.lower()=="admission items")
    row[item_col]=",".join(dict.fromkeys(items)); rows.append(row)
    if types: limits.append({"code":c["code"],"reg_types":",".join(dict.fromkeys(types))})
for name, data in (("discount_import.csv", rows), ("discount_reg_type_limits.csv", limits)):
    if data:
        with open(f"cvent-builds/<FP>/{name}","w",newline="") as f:
            w=csv.DictWriter(f,fieldnames=list(data[0])); w.writeheader(); w.writerows(data)
json.dump(blocked,open("cvent-builds/<FP>/discount_blocked.json","w"),indent=1)
print(len(rows),"importable ·",len(limits),"need reg-type limits ·",len(blocked),"blocked")
EOF
```

Before uploading, open Cvent's own import template on the import screen and
compare its headers with `discount_import.csv`. If they differ, rename or reorder
the columns to match the template. Never upload a file whose headers don't match.

`code_map.json` holds only the mappings the user accepted. For every row in
`discount_reg_type_limits.csv` (for example "General Admission, student-buyer
types only"), set the discount's registration-type restriction in the UI.

If Cvent has no such restriction for that discount, set the code to inactive and
ask the user, because without the limit it would be broader than the RR allows.

`discount_blocked.json` lists two kinds of code, and none of them are built:
- codes with an admission-item code nobody mapped;
- codes that mix a type-limited item with an unlimited one, where one Cvent
  discount can't express both.

Ask the user about each one (for example, split it into two codes, or drop the
limit).

Leave codes that are inactive in the RR inactive.

Verify: read back the count, plus 5 spot checks covering a percentage code, an
amount code, a capped code, a stackable code and a multi-item code. Report any
import errors verbatim.

## R8 Vouchers

Source: `discounts.vouchers`.

- Build vouchers only from a voucher sheet in the RR, or from vouchers named in
  `decisions.md`. Never turn discount codes into vouchers.
- If there are none, skip R8 with the reason "RR has no vouchers".
- Map per voucher: name, code, which reg types and admission items it covers,
  quantity/capacity, and dates. Never generate or send voucher emails.

## Report

Append a row each for R1–R8 to `status.md`:
`piece | done/blocked/skipped | built/planned | evidence | notes`.
Add three lists: "pre-existing, not in RR", "handed to other lanes" (approvals,
badge text, reprint fees, question display rules), and "blocked on decision".
Release the lock and message Chief.
