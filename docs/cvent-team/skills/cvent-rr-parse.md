---
name: cvent-rr-parse
description: "Parse an RR (Registration Requirements) Excel workbook into a Cvent build plan (plan.json + plan.md) covering website and registration. Read-only; never touches Cvent."
---

# cvent-rr-parse — RR workbook → build plan

Read-only. Produces the plan every other Cvent skill reads. Never touches Cvent.
RRs differ every show, so the parser finds columns by header text and sends
anything it cannot settle to `open_questions` instead of guessing.

## Paths

File tools resolve `shared/...` to the Team root, but `shell` starts in the bot's
own folder. Run every shell command in this skill with `cwd: "shared"`, and use
paths relative to it (`cvent-builds/...`).

On a Private Computer, create the folder first by running `mkdir -p shared` in the
default cwd.

## 1. Install the parser (once per computer)

Write the script at the end of this skill to
`shared/cvent-builds/tools/parse_rr.py` with `write_file`, exactly as shown. If
the file already exists and has the same `PARSER_VERSION`, reuse it; otherwise
overwrite it.

```bash
python3 -c "import openpyxl" 2>/dev/null || pip install --user openpyxl
```

## 2. Run it

First resolve the uploaded workbook to an absolute path: run
`realpath "<attachment path>"` in the default cwd. Then, with `cwd: "shared"`:

```bash
python3 cvent-builds/tools/parse_rr.py "<absolute .xlsx path>" cvent-builds/<FP>/
```

Use the FP code from the workbook for `<FP>`. If you don't know it yet, run once
into `cvent-builds/_new/`, read the code from `plan.md`, then move the output.
Add `--keep-test-codes` only when the user asks to keep `PPCTEST*` codes.
Legacy `.xls` files must be converted to `.xlsx` first.

## 3. Review the output yourself before presenting it

`plan.md` is the summary and `plan.json` is the source of truth. Check:

- **Identity:** FP code, event name and dates are present.
- **Reg types:** the count matches the unique `REG CODE` values marked ACTIVATE or
  REQUIRED. `skipped_rows` lists everything that wasn't built, with the reason.
- **Price tiers:** the date ranges are contiguous and inside the event's
  registration window.
- **Paths:** every reg type has a path. Planner-only paths come from rows whose
  method is "Staff Only".
- **Discounts:** test codes were dropped (`dropped_test_codes`), template rows
  were skipped (`dropped_placeholder_rows`), and codes are unique and 15
  characters or fewer.
- **Admission-item codes:** any code that isn't defined on the reg-type tab
  appears in `open_questions` with a suggested mapping. Never apply the
  suggestion without a yes.
- **Questions:** each question's answers are attached to it, and conditional
  rules appear in `display_when`.

Then send the user `plan.md`, with the open questions listed first, and **wait
for an explicit OK**. Ask the open questions with `ask_user` where 2–4 options
cover them; for example "Use suggested mapping / Map differently / Skip these
codes".

Record the answers in `shared/cvent-builds/<FP>/decisions.md`, one line per
question, quoting the user's answer. Write only the admission-item code mappings the user accepted to
`shared/cvent-builds/<FP>/code_map.json`, as
`{"CODE": {"admission_item": "...", "reg_types": [...]}}`. Leave out declined or
`null` suggestions; codes left unmapped are blocked at build time. Build skills read `decisions.md` as
overrides to `plan.json`.

## plan.json shape (what the build skills read)

| Key | Contents |
|---|---|
| `event` | Identity key, time zone, approval / pre-approval / advanced pre-reg flags |
| `website.theme` | Theme name, brand colors, style-guide source |
| `website.header` | Whether assets were provided, and the already-registered link |
| `website.footers.<audience>` | `[{label, visible, url}]`. The Contact Us button becomes a `mailto:` link |
| `website.body` | `event_information`, `text`, `image`, `registration_actions`, `countdown_timer`, `social_media` |
| `registration.price_tiers` | `[{name, start, end}]`, ISO dates, inclusive |
| `registration.paths` | `[{name, reg_types, web_visible, group_registration}]` |
| `registration.reg_types` | Code, name, path, web visibility, flags, and `admission_items[code].prices[tier]` |
| `registration.admission_items` | Code, name, additional text, description, reg types |
| `registration.advanced_rules` | `admission_item_availability` and `question_display` rules |
| `optional_items`, `sessions` | Rows from those tabs (empty means none) |
| `discounts` | `codes` (each with `raw` RR columns), `template_headers`, `dropped_test_codes`, `dropped_placeholder_rows`, `admission_item_code_map`, `group_discounts`, `vouchers` |
| `questions` | Show questions with answers and `display_when` |
| `communications` | Communications rows answered Yes: `{type, notes}` |
| `other_tabs` | Non-empty rows of the approvals, policies, integrations, communications, badge, onsite, access and evaluation tabs, for the lanes that own them |
| `gaps`, `open_questions` | Everything that needs a human |

## The parser

```python
#!/usr/bin/env python3
"""RR workbook -> Cvent build plan (plan.json + plan.md). Read-only.

Usage: python3 parse_rr.py <rr.xlsx> <out_dir> [--keep-test-codes]

Header-driven: columns are found by header text, never fixed letters, because
every RR drifts. Anything the workbook does not settle goes to open_questions
instead of being guessed.
"""
import datetime
import json
import os
import re
import sys

import openpyxl

PARSER_VERSION = 3
TEST_CODE = re.compile(r"^PPCTEST", re.I)
PLACEHOLDER = re.compile(r"^\[.*\]$")


def norm(v):
    if v is None:
        return ""
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    return re.sub(r"[ \t]+", " ", str(v).replace("\xa0", " ")).strip()


def yes(v):
    return norm(v).lower() in ("y", "yes", "x", "true", "activate", "required", "both")


def sheet(wb, *needles, prefer_new=True, exclude=()):
    hits = [ws for ws in wb.worksheets
            if all(n in ws.title.lower() for n in needles)
            and not any(x in ws.title.lower() for x in exclude)]
    if prefer_new:
        hits.sort(key=lambda ws: ("new" not in ws.title.lower(), ws.sheet_state != "visible"))
    return hits[0] if hits else None


def header_row(ws, predicate, limit=40):
    for row in ws.iter_rows(max_row=limit):
        if any(predicate(norm(c.value).lower()) for c in row):
            return row[0].row
    return None


def header_map(ws, rows):
    out = {}
    for r in rows:
        if r < 1:
            continue
        for c in ws[r]:
            t = norm(c.value)
            if t:
                out[c.column] = (out.get(c.column, "") + " | " + t).strip(" |")
    return out


def col(hm, *needles, exact=None):
    for c, h in hm.items():
        hl = h.lower()
        if exact is not None and hl.split(" | ")[-1] == exact.lower():
            return c
        if exact is None and all(n.lower() in hl for n in needles):
            return c
    return None


def cell(row, c):
    return norm(row[c - 1].value) if c and len(row) >= c else ""


def kv(ws):
    """Label in A, value in B, notes in C. First match wins."""
    out = {}
    for row in ws.iter_rows():
        k = cell(row, 1)
        if k and k.lower() not in out:
            out[k.lower()] = (cell(row, 2), cell(row, 3))
    return out


def lookup(table, prefix):
    p = prefix.lower()
    for k, v in table.items():
        if k.startswith(p):
            return v
    return ("", "")


def initials(text):
    return "".join(w[0] for w in re.findall(r"[A-Za-z]+", text)).upper()


# ---------------------------------------------------------------- event + site

def parse_event(wb, gaps):
    ws = sheet(wb, "event details") or sheet(wb, "event info")
    if not ws:
        gaps.append("No Event Details sheet; identity key unknown.")
        return {}, {}
    t = kv(ws)
    g = lambda p: lookup(t, p)[0]
    n = lambda p: lookup(t, p)[1]
    ev = {
        "name": g("event name"),
        "fp_code": g("event fp code"),
        "location": g("event location"),
        "timezone": g("time zone"),
        "dates_display": g("event dates"),
        "show_hours": [h for h in g("show hours").splitlines() if h.strip()],
        "user_group": g("event user group"),
        "est_registrations": g("total estimated registration"),
        "approval": {"enabled": yes(g("do you use the approval")), "reg_types": n("do you use the approval")},
        "pre_approval": {"enabled": yes(g("do you have pre-approval")), "reg_types": n("do you have pre-approval")},
        "advanced_prereg": {"enabled": yes(g("do you have advanced pre-reg")), "reg_types": n("do you have advanced pre-reg")},
        "group_discounts": yes(g("do you offer group discounts")),
        "invitation_forwarding": yes(g("do you want to include invitation forwarding")),
        "photo_badging": yes(g("will you use photo badging")),
    }
    for k in ("name", "fp_code", "dates_display"):
        if not ev[k]:
            gaps.append(f"Identity key component missing: {k}")
    return ev, t


def parse_website(wb, ev_table, gaps):
    g = lambda p: lookup(ev_table, p)[0]
    n = lambda p: lookup(ev_table, p)[1]
    site = {
        "theme": {
            "name": g("event theme"),
            "progress_bar_note": n("event theme"),
            "brand_colors": re.findall(r"#[0-9A-Fa-f]{6}\b", g("branding colors")),
            "style_guide_source": g("brand style guide"),
        },
        "header": {"assets_provided": False, "already_registered_link": yes(g("already registered link"))},
        "footers": {},
        "body": {},
    }
    if not site["theme"]["brand_colors"] and g("branding colors"):
        gaps.append("Brand colors present but no #RRGGBB hex codes parsed.")
    if site["theme"]["style_guide_source"]:
        gaps.append("Header/logo art lives at the style-guide link; upload the files or the header image stays blocked.")

    ws = sheet(wb, "social media") or sheet(wb, "links")
    countdown, social = {"enabled": False, "label": ""}, []
    if ws:
        section = None
        for row in ws.iter_rows():
            a, b, c = cell(row, 1), cell(row, 2), cell(row, 3)
            al = a.lower()
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
                visible = yes(b)
                mail = re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", c)
                link = {"label": re.sub(r"\s*\(.*?only\)\s*", "", a).strip(), "visible": visible,
                        "url": c if c.startswith("http") else (f"mailto:{mail.group(0)}" if mail else c)}
                if visible and not link["url"]:
                    gaps.append(f"Footer link '{a}' ({section[1]}) is Yes but has no URL.")
                site["footers"][section[1]].append(link)
            elif section and section[0] == "countdown":
                if "appear" in al:
                    countdown["enabled"] = yes(b)
                elif "text" in al:
                    countdown["label"] = b
            elif section and section[0] == "social" and yes(b):
                social.append({"network": a, "url": c})

    first_day = None
    m = re.search(r"([A-Za-z]+)\.?\s+(\d{1,2})\b.*?(\d{4})", g("event dates"))
    for fmt in ("%B %d %Y", "%b %d %Y"):
        try:
            first_day = datetime.datetime.strptime(f"{m.group(1)} {m.group(2)} {m.group(3)}", fmt).strftime("%Y-%m-%d") if m else None
            break
        except ValueError:
            continue
    if countdown["enabled"] and not first_day:
        gaps.append(f"Countdown is on but the first event day could not be read from '{g('event dates')}'.")
    site["body"] = {
        "event_information": {"title": g("event name"), "dates": g("event dates"), "location": g("event location"),
                              "show_hours": [h for h in g("show hours").splitlines() if h.strip()],
                              "add_to_calendar": {"enabled": yes(g("calendar reminder")), "text": n("calendar reminder")}},
        "text": {"blocks": []},
        "image": {"assets_provided": False},
        "registration_actions": {"register_buttons": "one per web-visible path", "already_registered": yes(g("already registered link"))},
        "countdown_timer": {**countdown, "target": "first day of event", "target_date": first_day},
        "social_media": social,
    }
    return site


# ---------------------------------------------------------------- registration

def parse_registration(wb, gaps, questions):
    ws = sheet(wb, "reg type") or sheet(wb, "registration type")
    if not ws:
        gaps.append("No Registration Types sheet found.")
        return {}
    hrow = header_row(ws, lambda v: v == "reg code")
    if not hrow:
        gaps.append(f"'{ws.title}' has no 'REG CODE' header; reg types not parsed.")
        return {}
    hm = header_map(ws, [hrow - 1, hrow])
    c = {
        "code": col(hm, exact="reg code"), "name": col(hm, "reg type name"), "status": col(hm, "activate"),
        "ai_code": col(hm, "admission item code"), "ai": col(hm, exact="admission item"),
        "ai_text": col(hm, "admission item additional text"), "ai_desc": col(hm, "admission item description"),
        "group": col(hm, "group registration"), "path": col(hm, "registration path"),
        "badge": col(hm, "badge description"), "method": col(hm, "registration method"),
        "approval": col(hm, "approval needed"), "pre": col(hm, "pre-approval"),
        "adv": col(hm, "advanced pre-registration"), "reprint": col(hm, "reprint"), "gl": col(hm, "gl code"),
    }
    tiers = []
    for ci, h in sorted(hm.items()):
        if "price tier" in h.lower():
            m = re.search(r"(\d{1,2}/\d{1,2}/\d{4})\s*-\s*(\d{1,2}/\d{1,2}/\d{4})\s*\|?\s*(.*)", h)
            label = re.sub(r"(?i)price tier \d+\s*\|?", "", h).strip(" |")
            tiers.append({"col": ci, "name": (m.group(3).strip() if m and m.group(3) else label) or f"Tier {len(tiers) + 1}",
                          "start": m.group(1) if m else "", "end": m.group(2) if m else ""})
    for i, t in enumerate(tiers):
        if not t["start"]:
            gaps.append(f"Price tier '{t['name']}' has no date range in its header.")
        for d in ("start", "end"):
            if t[d]:
                t[d] = datetime.datetime.strptime(t[d], "%m/%d/%Y").strftime("%Y-%m-%d")
        if i and tiers[i - 1]["end"] and t["start"]:
            gap_days = (datetime.date.fromisoformat(t["start"]) - datetime.date.fromisoformat(tiers[i - 1]["end"])).days
            if gap_days != 1:
                gaps.append(f"Price tiers '{tiers[i - 1]['name']}' and '{t['name']}' are not contiguous.")

    rows, skipped = [], []
    for row in ws.iter_rows(min_row=hrow + 1):
        code, ai = cell(row, c["code"]), cell(row, c["ai"])
        if not code or not ai:
            continue
        status = cell(row, c["status"]).upper()
        if c["status"] and status not in ("ACTIVATE", "REQUIRED"):
            skipped.append({"code": code, "admission_item": ai, "status": status or "(blank)"})
            continue
        rows.append({k: cell(row, v) for k, v in c.items()} | {
            "label": cell(row, 1),
            "prices": {t["name"]: cell(row, t["col"]) for t in tiers},
        })

    reg_types, items, paths = {}, {}, {}
    for r in rows:
        rt = reg_types.setdefault(r["code"], {
            "code": r["code"], "name": r["name"], "labels": [], "path": r["path"],
            "web_visible": "staff only" not in r["method"].lower(), "method": r["method"],
            "status": r["status"].upper(), "group_registration": False, "approval": False,
            "pre_approval": False, "advanced_prereg": False, "badge_text": [], "admission_items": {}})
        if r["label"] and r["label"] not in rt["labels"]:
            rt["labels"].append(r["label"])
        if r["badge"] and r["badge"] not in rt["badge_text"]:
            rt["badge_text"].append(r["badge"])
        for flag, key in (("group_registration", "group"), ("approval", "approval"), ("pre_approval", "pre"), ("advanced_prereg", "adv")):
            if rt["labels"] and len(rt["admission_items"]) and rt[flag] != yes(r[key]):
                gaps.append(f"Reg type {r['code']}: '{flag}' differs between its RR rows (admission item {r['ai_code'] or r['ai']}); per-type flag set to Yes, confirm.")
            rt[flag] = rt[flag] or yes(r[key])
        aic = r["ai_code"] or r["ai"]
        prev = rt["admission_items"].get(aic)
        if prev and prev["prices"] != r["prices"]:
            gaps.append(f"Reg type {r['code']} lists admission item {aic} twice with different prices ({r['label']}); first row kept.")
        rt["admission_items"].setdefault(aic, {"prices": r["prices"], "reprint_fee": r["reprint"], "gl_code": r["gl"]})
        it = items.setdefault(aic, {"code": aic, "name": r["ai"], "additional_text": "", "description": "", "reg_types": []})
        it["additional_text"] = it["additional_text"] or r["ai_text"]
        it["description"] = it["description"] or r["ai_desc"]
        if r["code"] not in it["reg_types"]:
            it["reg_types"].append(r["code"])
        if r["path"]:
            p = paths.setdefault(r["path"], {"name": r["path"], "reg_types": [], "web_visible": False, "group_registration": False})
            if r["code"] not in p["reg_types"]:
                p["reg_types"].append(r["code"])
            p["web_visible"] = p["web_visible"] or rt["web_visible"]
            p["group_registration"] = p["group_registration"] or rt["group_registration"]
        else:
            gaps.append(f"Reg type {r['code']} has no registration path; assign it during review.")
    for rt in reg_types.values():
        if len(rt["labels"]) > 1:
            gaps.append(f"Reg type code {rt['code']} is shared by RR rows {rt['labels']}; Cvent gets one type.")

    rules = []
    all_items = list(items)
    for rt in reg_types.values():
        allowed = list(rt["admission_items"])
        if set(allowed) != set(all_items):
            rules.append({"kind": "admission_item_availability", "reg_type": rt["code"], "allowed_admission_items": allowed})
    for q in questions:
        for when, answers in q.get("display_when", []):
            rules.append({"kind": "question_display", "owner": "questions lane", "question": q["code"], "when_question": when, "answers": answers})

    return {
        "price_tiers": [{k: t[k] for k in ("name", "start", "end")} for t in tiers],
        "paths": list(paths.values()),
        "reg_types": list(reg_types.values()),
        "admission_items": list(items.values()),
        "skipped_rows": skipped,
        "advanced_rules": rules,
    }


def parse_item_sheet(wb, needle, code_header):
    ws = sheet(wb, needle)
    if not ws:
        return [], None
    hrow = header_row(ws, lambda v: v.startswith(code_header))
    if not hrow:
        return [], ws.title
    hm = header_map(ws, [hrow])
    out = []
    for row in ws.iter_rows(min_row=hrow + 1):
        d = {h: cell(row, ci) for ci, h in hm.items()}
        code = next((v for k, v in d.items() if k.lower().startswith(code_header)), "")
        title = next((v for k, v in d.items() if "title" in k.lower()), "")
        if code and title:
            out.append(d)
    return out, ws.title


def resolve_code(code, items, reg_types):
    """Suggest a mapping for an admission-item code the reg-type tab does not define,
    e.g. GA-SB -> "General Admission" for the reg type labelled "Student Buyer"."""
    head, _, tail = code.partition("-")
    item = next((i["code"] for i in items if head.upper() in (i["code"].upper(), initials(i["name"]))), None)
    if not item or not tail:
        return None
    tail = tail.upper()
    rts = [rt["code"] for rt in reg_types
           if rt["code"].upper() == tail
           or any(initials(lbl) == tail for lbl in rt["labels"] + [rt["name"].split("|")[-1]])]
    # Pre-approved twins share the audience (CODE -> CODEPRE).
    rts += [rt["code"] for rt in reg_types if rt["code"] not in rts and any(rt["code"] == f"{c}PRE" for c in rts)]
    return {"admission_item": item, "reg_types": rts} if rts else None


def parse_discounts(wb, reg, keep_test, gaps, open_q):
    ws = sheet(wb, "discount code") or sheet(wb, "discount", exclude=("group", "volume"))
    out, dropped, placeholders, headers = [], [], 0, []
    hrow = header_row(ws, lambda v: v == "discount code") if ws else None
    if ws and not hrow:
        gaps.append(f"'{ws.title}' has no 'Discount Code' header; no codes parsed.")
    if hrow:
        hm = header_map(ws, [hrow])
        headers = [h for _, h in sorted(hm.items())]
        C = lambda *n: col(hm, *n)
        group = ""
        for row in ws.iter_rows(min_row=hrow + 1):
            v = lambda *n: cell(row, C(*n))
            name, code = v("name"), v("discount code")
            if name and not code and not v("amount"):
                group = name
                continue
            if not code:
                continue
            if PLACEHOLDER.match(code) or PLACEHOLDER.match(v("amount")):
                placeholders += 1
                continue
            if TEST_CODE.match(code) and not keep_test:
                dropped.append(code)
                continue
            out.append({
                "group": group, "name": name, "code": code, "type": v("discount type"), "method": v("method"),
                "amount": v("amount"), "effective_from": v("effective from"), "effective_to": v("effective to"),
                "capacity": v("capacity"), "stackable": yes(v("stackable")), "usable_by": v("can be used by"),
                "count_guests": v("counts guests"), "active": v("active").lower() != "no", "internal_note": v("internal note"),
                "admission_items": [x.strip() for x in v("admission items").split(",") if x.strip()],
                "sessions": v("sessions"), "optional_items": v("optional items"),
                "raw": {h: cell(row, ci) for ci, h in hm.items()},
            })
    seen = {}
    for d in out:
        if d["code"].upper() in seen:
            gaps.append(f"Duplicate discount code {d['code']}.")
        seen[d["code"].upper()] = 1
        if len(d["code"]) > 15:
            gaps.append(f"Discount code {d['code']} exceeds 15 characters.")
    known = {i["code"] for i in reg.get("admission_items", [])}
    unknown = sorted({c for d in out for c in d["admission_items"]} - known)
    mapping = {}
    for code in unknown:
        mapping[code] = resolve_code(code, reg.get("admission_items", []), reg.get("reg_types", []))
        open_q.append(f"Discount admission-item code {code} is not on the reg-type tab. Suggested: {mapping[code] or 'no match'}. Confirm before building.")
    groups = []
    gws = sheet(wb, "group")
    if gws:
        hrow = header_row(gws, lambda v: v == "threshold")
        if not hrow:
            gaps.append(f"'{gws.title}' has no 'Threshold' header; group discounts not parsed.")
        else:
            hm = header_map(gws, [hrow])
            for row in gws.iter_rows(min_row=hrow + 1):
                d = {h: cell(row, ci) for ci, h in hm.items()}
                low = {k.lower(): v for k, v in d.items()}
                if low.get("name") and not PLACEHOLDER.match(low["name"]) and not PLACEHOLDER.match(low.get("threshold", "")):
                    groups.append(d)
    vouchers, vtitle = parse_item_sheet(wb, "voucher", "voucher")
    return {"codes": out, "template_headers": headers, "dropped_test_codes": dropped,
            "dropped_placeholder_rows": placeholders, "admission_item_code_map": mapping,
            "group_discounts": groups, "vouchers": vouchers, "voucher_sheet": vtitle}


def parse_questions(wb, gaps):
    ws = sheet(wb, "show questions") or sheet(wb, "questions")
    if not ws:
        return []
    hrow = header_row(ws, lambda v: v.startswith("demo name"))
    if not hrow:
        gaps.append(f"'{ws.title}' has no 'Demo Name' header; questions not parsed.")
        return []
    hm = header_map(ws, [hrow])
    C = lambda *n: col(hm, *n)
    qs, cur = [], None
    for row in ws.iter_rows(min_row=hrow + 1):
        v = lambda *n: cell(row, C(*n))
        code, text = v("demo name"), v("question text")
        if code and text:
            cur = {"code": code.upper(), "page": v("page displayed"), "scope": v("company or individual"), "text": text,
                   "appearance": v("question appearance"), "required": yes(v("required")),
                   "reg_types": v("list reg types"), "trigger": v("trigger question"), "notes": v("notes"),
                   "answers": [], "display_when": []}
            qs.append(cur)
        elif cur and (v("answer code") or v("answer text")):
            cur["answers"].append({"code": v("answer code"), "text": v("answer text"), "reg_types": v("determine reg type")})
    for q in qs:
        for src in (q["trigger"], q["reg_types"]):
            m = re.match(r"(?i)^(?:if\s+)?([A-Z][A-Z0-9]*)\s*=\s*(.+)$", src or "")
            if m:
                answers = [a for a in re.findall(r"\b[A-Z0-9]+\b", m.group(2).upper()) if a not in ("AND", "OR")]
                q["display_when"].append((m.group(1).upper(), answers))
    return qs


OTHER_TABS = ("communication", "polic", "approval", "integration", "badge", "onsite", "access", "evaluation")


def parse_other_tabs(wb):
    """Tabs owned by the questions, site & comms and badges lanes: kept as
    non-empty rows so those lanes read the plan instead of re-opening the workbook."""
    out = {}
    for ws in wb.worksheets:
        t = ws.title.lower()
        if ws.sheet_state != "visible" or not any(k in t for k in OTHER_TABS):
            continue
        rows = [[cell(r, i + 1) for i in range(len(r))] for r in ws.iter_rows()]
        out[ws.title] = [[v for v in r] for r in rows if any(r)]
        while out[ws.title] and out[ws.title][-1] == []:
            out[ws.title].pop()
        out[ws.title] = [r[: max(i for i, v in enumerate(r) if v) + 1] for r in out[ws.title]]
    return out


def communications(other):
    """Rows of the communications tab answered Yes in the 'Using for event?' column."""
    for title, rows in other.items():
        if "communication" not in title.lower():
            continue
        return [{"type": r[0], "notes": r[2] if len(r) > 2 else ""} for r in rows if len(r) > 1 and r[0] and yes(r[1])]
    return []


# ---------------------------------------------------------------- output

def family(wb):
    titles = " ".join(ws.title.lower() for ws in wb.worksheets)
    a = "approvals" in titles and ("sessions" in titles or "optional" in titles)
    b = "approval site parameters" in titles or "sessions_add-ons" in titles or "access & reports" in titles
    return "A" if a and not b else "B" if b and not a else "ambiguous"


def plan_md(p):
    ev, reg, site, disc = p["event"], p["registration"], p["website"], p["discounts"]
    L = [f"# Build plan: {ev.get('name', '?')}", "",
         f"Identity key: FP {ev.get('fp_code')} · {ev.get('name')} · {ev.get('dates_display')} · {ev.get('timezone')}",
         f"Workbook family: {p['family']}", "", "## Website",
         f"- Theme: {site['theme']['name'] or '(none)'} · colors {', '.join(site['theme']['brand_colors']) or '(none)'}",
         f"- Header: logo/banner {'provided' if site['header']['assets_provided'] else 'NOT provided (blocked until uploaded)'}; already-registered link {'yes' if site['header']['already_registered_link'] else 'no'}"]
    for aud, links in site["footers"].items():
        L.append(f"- Footer ({aud}): " + ", ".join(l["label"] for l in links if l["visible"]))
    b = site["body"]
    L += [f"- Body widgets: event info · text · image ({'assets' if b['image']['assets_provided'] else 'blocked: no assets'}) · "
          f"registration actions · countdown ({'on' if b['countdown_timer']['enabled'] else 'off'}) · social ({len(b['social_media'])})",
          "", "## Registration",
          "- Price tiers: " + "; ".join(f"{t['name']} {t['start']}→{t['end']}" for t in reg.get("price_tiers", [])),
          f"- Paths ({len(reg.get('paths', []))}): " + "; ".join(f"{x['name']} [{', '.join(x['reg_types'])}]{'' if x['web_visible'] else ' (planner-only)'}" for x in reg.get("paths", [])),
          f"- Reg types: {len(reg.get('reg_types', []))} · admission items: {len(reg.get('admission_items', []))} ({', '.join(i['code'] for i in reg.get('admission_items', []))})",
          f"- Optional items: {len(p['optional_items'])} · sessions: {len(p['sessions'])}",
          f"- Discount codes: {len(disc['codes'])} (dropped test codes: {', '.join(disc['dropped_test_codes']) or 'none'}) · group discounts: {len(disc['group_discounts'])} · vouchers: {len(disc['vouchers'])}",
          f"- Advanced rules: {len(reg.get('advanced_rules', []))}",
          f"- Communications (Yes rows): {len(p.get('communications', []))} · other lane tabs: {', '.join(p.get('other_tabs', {})) or 'none'}",
          "", "## Reg types", "",
          "| Code | Name | Path | Web | Admission items and prices |", "|---|---|---|---|---|"]
    for rt in reg.get("reg_types", []):
        prices = "; ".join(f"{k}: " + "/".join(v["prices"].values()) for k, v in rt["admission_items"].items())
        L.append(f"| {rt['code']} | {rt['name']} | {rt['path']} | {'yes' if rt['web_visible'] else 'staff'} | {prices} |")
    L += ["", "## Gaps", *([f"- {g}" for g in p["gaps"]] or ["- none"]),
          "", "## Open questions (answer before any Cvent write)",
          *([f"- {q}" for q in p["open_questions"]] or ["- none"])]
    return "\n".join(L) + "\n"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) != 2:
        sys.exit(__doc__)
    path, out_dir = args
    wb = openpyxl.load_workbook(path, data_only=True)
    gaps, open_q = [], []
    ev, ev_table = parse_event(wb, gaps)
    questions = parse_questions(wb, gaps)
    reg = parse_registration(wb, gaps, questions)
    optional, opt_sheet = parse_item_sheet(wb, "optional", "item code")
    sessions, _ = parse_item_sheet(wb, "session", "item code")
    if opt_sheet and not optional:
        open_q.append(f"'{opt_sheet}' has no rows: build no optional items, or confirm items to add.")
    plan = {
        "source_file": os.path.basename(path),
        "family": family(wb),
        "sheets": [{"title": ws.title, "state": ws.sheet_state} for ws in wb.worksheets],
        "event": ev,
        "website": parse_website(wb, ev_table, gaps),
        "registration": reg,
        "optional_items": optional,
        "sessions": sessions,
        "discounts": parse_discounts(wb, reg, "--keep-test-codes" in sys.argv, gaps, open_q),
        "questions": questions,
    }
    plan["other_tabs"] = parse_other_tabs(wb)
    plan["communications"] = communications(plan["other_tabs"])
    if plan["family"] == "ambiguous":
        open_q.append("Workbook family is ambiguous (A vs B); confirm which approval/sessions sheets apply.")
    plan["gaps"], plan["open_questions"] = gaps, open_q
    os.makedirs(out_dir, exist_ok=True)
    with open(os.path.join(out_dir, "plan.json"), "w") as f:
        json.dump(plan, f, indent=2)
    with open(os.path.join(out_dir, "plan.md"), "w") as f:
        f.write(plan_md(plan))
    print(plan_md(plan))


if __name__ == "__main__":
    main()
```
