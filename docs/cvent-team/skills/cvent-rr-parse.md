---
name: cvent-rr-parse
description: "Turn any RR (Registration Requirements) Excel workbook into a validated Cvent build plan: extract every tab, auto-parse known layouts, map legacy layouts with cited sources, validate. Read-only; never touches Cvent."
---

# cvent-rr-parse — any RR workbook → validated build plan

Read-only. Never touches Cvent. RRs differ every show: new and legacy reg-type
layouts, member/non-member pricing, add-on tabs, typos in dates. So this runs in
three stages, and you (the agent) fill in only what the tool can't do safely.

| Stage | Who | Output |
|---|---|---|
| 1. `extract` | tool | `extract.json` (every tab as tables, with cell refs), `inventory.md` |
| 2. `plan` | tool, plus you for legacy layouts | `plan.json`, `plan.md`, with `coverage` per section |
| 3. `validate` | tool | `validation.json` and `validation.md`: errors and warnings per section |

A section with validation errors is never built. Everything else proceeds.

## Paths

File tools resolve `shared/...` to the Team root, but `shell` starts in the bot's
own folder. Run every shell command here with `cwd: "shared"`, using paths
relative to it. On a Private Computer, run `mkdir -p shared` in the default cwd
first.

## 1. Install the tool (once per computer)

Write the script at the end of this skill to `shared/cvent-builds/tools/rr.py`
with `write_file`, exactly as shown. If the file exists with the same
`PARSER_VERSION`, reuse it; otherwise overwrite it.

```bash
python3 -c "import openpyxl" 2>/dev/null || pip install --user openpyxl
```

## 2. Run it

First resolve the attachment path: run `realpath "<attachment path>"` in the
default cwd. Then, with `cwd: "shared"`:

```bash
python3 cvent-builds/tools/rr.py extract "<absolute .xlsx path>" cvent-builds/_new
python3 cvent-builds/tools/rr.py plan cvent-builds/_new
```

Read the FP code from `plan.md` and rename `_new` to `cvent-builds/<FP>`. Use
`--keep-test-codes` on `plan` only if the user wants `PPCTEST*` codes kept. Legacy
`.xls` files must be converted to `.xlsx` first.

## 3. Read coverage, then fill only the gaps

Open `plan.md`. Its `coverage` line says, per section, `parsed`, `needs_mapping`,
`absent`, `agent` or `parsed+agent`.

### Registration `needs_mapping` (legacy layout)

Legacy RRs keep old reg types with codes inside one cell (for example
`ATT Attendee` with admission `EO Expo Only`). They usually include a
`NEW REG MAPPING` tab, and sometimes Member/Non-Member price columns. The plan
holds the extracted material under `registration.rows`, `registration.headers`,
`registration.mapping` and `registration.lookups`; `extract.json` has every
cell.

Write `cvent-builds/<FP>/agent_plan.json`:

```json
{
 "notes": "what you mapped, from which tabs, and what you left out",
 "registration": {
  "price_tiers": [{"name": "Early Bird", "start": "2026-04-15", "end": "2026-04-29"}],
  "admission_items": [{"code": "EXONLY", "name": "Expo Only", "description": "...", "reg_types": ["ATT"],
                       "source": "NEW REG MAPPING!D3", "code_source": "rr | proposed"}],
  "reg_types": [{"code": "ATT", "name": "Attendee", "path": "Attendee", "web_visible": true,
                 "source": "NEW REG MAPPING!C2",
                 "admission_items": {"EXONLY": {"prices": {"Early Bird": "0"}, "source": "Registration Types & Pricing!A6"}}}],
  "paths": [{"name": "Attendee", "reg_types": ["ATT"], "web_visible": true, "group_registration": false,
             "source": "Event Details!A38"}]
 }
}
```

Rules for mapping:
- **Cite the cell for every value** in `source`. A value you can't cite is a
  question for the user, not a guess.
- **Use the RR's own names and codes:** the NEW REG MAPPING tab, then any
  `lookups` lists in the workbook. If a code exists nowhere in the RR, propose one,
  set `"code_source": "proposed"`, and list it for the user.
- **Prices:**
  - Take each price from the old reg-type row that maps to the new type and
    admission item.
  - Member/Non-Member columns become separate reg types (for example `ATTNEW` /
    `ATTNON`) only if the mapping tab names them. Otherwise ask.
  - A cell holding two values (for example `135  139`) is a question.
- **Skip rows** marked as EXAMPLES, dropdown source lists, and rows whose
  Registration Method is empty.
- **Old rows with no row in the mapping tab** are left out and listed in `notes`
  as an open question. Never drop them silently.
- **Staff-only types** (method "Staff Only" or "Reg Ops") go on a planner-only
  path with `web_visible: false`.

### Small fixes on a parsed layout

To fix one thing, patch it in `agent_plan.json` instead of rewriting the whole
section:

```json
{"registration": {
  "path_assignments": {"STAFF": "Internal"},
  "admission_item_codes": {"Full Access": "FULL"},
  "price_tier_dates": {"Tier 2": {"start": "2026-09-01", "end": "2026-10-14"}}
}}
```

Only patch what the RR states or what the user decided (cite `decisions.md`).
Then re-run `plan` and `validate`. `plan` always re-applies `agent_plan.json` on
top of a fresh parse.

## 4. Validate

```bash
python3 cvent-builds/tools/rr.py validate cvent-builds/<FP>
```

`validation.md` lists errors and warnings per section: identity, website,
registration, items, discounts, questions. Typical errors are real RR problems:
- overlapping or undated price tiers;
- a name typed where a code belongs;
- a reg type with no path;
- a price cell holding two numbers.

Don't "fix" them by guessing. Turn each one into a question for the user.

## 5. Approve

Send the user `plan.md`, then the errors from `validation.md`, then the open
questions, in that order. Use `ask_user` where 2–4 options cover a question.

Record each answer in `cvent-builds/<FP>/decisions.md`, quoting the user. Apply
it as an `agent_plan.json` patch, and write any accepted discount-code mappings
to `code_map.json` as `{"CODE": {"admission_item": "...", "reg_types": [...]}}`.
Re-run `plan` and `validate`.

**Get an explicit OK before any Cvent write.** Sections with remaining errors stay
blocked; tell the user which ones.

## plan.json (what the build skills read)

| Key | Contents |
|---|---|
| `coverage` | Per-section status |
| `event` | Identity key, dates, time zone, approval flags, `registration_paths_section` |
| `website` | `theme`, `header`, `footers.<audience>` (`url` can be `mailto:` or `cvent-generated`), `body` widgets |
| `registration` | `price_tiers`, `paths`, `reg_types` (`admission_items[code].prices[tier]`), `admission_items`, `advanced_rules`, `skipped_rows` |
| `items` | Groups of sessions, add-ons, optional items and memberships: each has `kind`, `price_tiers` and `items` (prices may be `{member, non-member}`) |
| `discounts` | `codes` (each with `raw` RR columns and `source`), `template_headers`, `dropped_test_codes`, `admission_item_code_map`, `group_discounts`, `vouchers` |
| `questions` | Questions with answers, `display_when` and `source` |
| `communications`, `other_tabs` | Data for the comms, approvals, policies, badge and onsite lanes |
| `gaps`, `open_questions`, `agent_notes` | For the user |

## The tool

```python
#!/usr/bin/env python3
"""RR workbook -> Cvent build plan. Read-only; never touches Cvent.

  python3 rr.py extract  <rr.xlsx> <dir>   every sheet as tables -> extract.json, inventory.md
  python3 rr.py plan     <dir>             known layouts -> plan.json, plan.md (+ merges agent_plan.json)
  python3 rr.py validate <dir>             checks plan.json -> validation.md; exit 1 on errors

Columns are found by header text, never fixed letters. Layouts the planner does
not recognise are marked needs_mapping in plan.json `coverage`, with the
extracted rows attached, for the agent to map into agent_plan.json.
"""
import datetime
import json
import os
import re
import sys

import openpyxl
from openpyxl.utils import get_column_letter

PARSER_VERSION = 4

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


def blank(v):
    return norm(v).lower() in NA or bool(PLACEHOLDER.match(norm(v)))


def yes(v):
    return norm(v).lower() in ("y", "yes", "x", "true", "activate", "required", "both")


def money(v):
    """'$1,008' -> '1008'; free text -> None (caller keeps raw)."""
    s = norm(v).replace("$", "").replace(",", "").strip()
    return s if re.fullmatch(r"\d+(\.\d+)?", s) else None


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
    if a:
        ya = a[0] or (yb if (a[1], a[2]) <= (b[1], b[2]) else yb - 1)
        start = datetime.date(ya, a[1], a[2])
    else:
        start = None
    end = datetime.date(yb, b[1], b[2])
    if start and start > end:
        return None
    return (start.isoformat() if start else None, end.isoformat())


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
    for key in ("communication", "polic", "approval", "integration", "badge", "onsite", "access", "reference",
                "evaluation"):
        if key in t:
            return key
    return "unclassified"


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
    records, empty_run = [], 0
    for row in ws.iter_rows(min_row=max(hrows) + 1):
        cells = {c.column: norm(c.value) for c in row if norm(c.value) and norm(c.value) != "`"}
        if not cells:
            empty_run += 1
            if empty_run >= 15 and records:  # what follows is dropdown source lists, not data
                break
            continue
        empty_run = 0
        records.append({"row": row[0].row, "cells": {get_column_letter(k): v for k, v in cells.items()}})
    return {"anchor_row": anchor, "header_rows": hrows,
            "headers": {get_column_letter(c): h for c, h in headers.items()}, "records": records}


def raw_rows(ws, limit=400):
    out = []
    for row in ws.iter_rows(max_row=limit):
        cells = {get_column_letter(c.column): norm(c.value) for c in row if norm(c.value)}
        if cells:
            out.append({"row": row[0].row, "cells": cells})
    return out


def lookup_tables(ws):
    """Small reference lists inside a sheet, e.g. 'Admission Items | CODES' or 'REG TYPES | REG CODES'."""
    found = {}
    for row in ws.iter_rows(max_row=ws.max_row):
        for c in row:
            v = norm(c.value).lower()
            if v in ("codes", "reg codes"):
                label_col = c.column - 1
                label = norm(ws.cell(c.row, label_col).value).lower()
                kind = "admission_items" if "admission" in label else "reg_types" if "reg" in label else None
                if not kind:
                    continue
                pairs = {}
                for r in range(c.row + 1, min(ws.max_row, c.row + 80) + 1):
                    name, code = norm(ws.cell(r, label_col).value), norm(ws.cell(r, c.column).value)
                    if name and code:
                        pairs[name.split("\n")[0].strip()] = code
                found[kind] = pairs
    return found


def extract(path, out_dir):
    wb = openpyxl.load_workbook(path, data_only=True)
    sheets = []
    for ws in wb.worksheets:
        role = classify(ws)
        entry = {"title": ws.title, "state": ws.sheet_state, "role": role,
                 "excluded": bool(EXCLUDE_TITLE.search(ws.title)) or ws.sheet_state != "visible"}
        if role in ("event_details", "links"):
            entry["rows"] = raw_rows(ws, 200)
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
    lines = [f"# Inventory: {ext['source_file']}", "", "| Sheet | Role | Used | Header rows | Data rows |", "|---|---|---|---|---|"]
    for s in sheets:
        t = s.get("table")
        lines.append(f"| {s['title']} | {s['role']} | {'no (' + ('hidden' if s['state'] != 'visible' else 'old/DNU') + ')' if s['excluded'] else 'yes'} | "
                     f"{t['header_rows'] if t else '-'} | {len(t['records']) if t else len(s.get('rows', []))} |")
    with open(os.path.join(out_dir, "inventory.md"), "w") as f:
        f.write("\n".join(lines) + "\n")
    print("\n".join(lines))


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
            out.append((c["A"].lower(), c.get("B", ""), c.get("C", ""), r["row"]))
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
                mail = re.search(r"[\w.+-]+@[\w-]+\.[\w.]+", url)
                link = {"label": re.sub(r"\s*\(.*?only\)\s*", "", a.split("\n")[0]).strip(), "visible": yes(b),
                        "url": url if url.startswith("http") else (f"mailto:{mail.group(0)}" if mail else
                                                                   "cvent-generated" if "cvent will provide" in url.lower() else ""),
                        "source": ref(s["title"], r["row"])}
                if link["visible"] and not link["url"]:
                    ctx.gap(f"Footer link '{link['label']}' ({section[1]}) is Yes but has no URL ({link['source']}).")
                site["footers"][section[1]].append(link)
            elif section and section[0] == "countdown":
                if "appear" in al:
                    countdown["enabled"] = yes(b)
                elif "text" in al:
                    countdown["label"] = b
            elif section and section[0] == "social" and url.startswith("http") and norm(b).lower() not in ("no", "n"):
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
                    rng = (None, ctx.event_end)
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
        key = (c["label"], c["window"]) if c["window"] or c["label"] else (c["raw"], None)
        t = next((t for t in tiers if t["_key"] == key), None)
        if not t:
            name = c["label"] or (f"Tier {c['tier_hint']}" if c["tier_hint"] else f"Tier {len(tiers) + 1}")
            if c["window"] and not c["label"]:
                name = f"Tier {c['tier_hint'] or len(tiers) + 1}"
            t = {"_key": key, "name": name, "start": c["window"][0] if c["window"] else None,
                 "end": c["window"][1] if c["window"] else None, "header": c["raw"]}
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
        out.append({k: t[k] for k in ("name", "start", "end")})
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
                "rows": t["records"][:400], "mapping": [m.get("table") for m in ctx.sheets("reg_mapping")]}, "needs_mapping"

    C = {"code": code_c, "status": status_c, "ai": ai_c,
         "name": hcol(H, r"reg type name"), "old": hcol(H, r"old reg type|current cvent reg|current reg type"),
         "ai_code": hcol(H, r"admission item code"), "ai_text": hcol(H, r"admission item additional text"),
         "ai_desc": hcol(H, r"admission item description"), "group": hcol(H, r"register another"),
         "path": hcol(H, r"registration path"), "badge": hcol(H, r"badge description"),
         "method": hcol(H, r"registration method"), "approval": hcol(H, r"approval needed|pended\?"),
         "pre": hcol(H, r"pre-approval"), "adv": hcol(H, r"advanced pre-reg"), "reprint": hcol(H, r"reprint"),
         "gl": hcol(H, r"gl code"), "notes": hcol(H, r"^notes|\| notes")}
    pcols, tiers = price_columns(ctx, H)
    lookup = {k.lower(): v for k, v in s.get("lookups", {}).get("admission_items", {}).items()}
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
        aic = v("ai_code").strip() or lookup.get(ai.lower(), "")
        if not aic:
            near = [f"{n} = {c}" for n, c in s.get("lookups", {}).get("admission_items", {}).items()
                    if ai and (n.lower().startswith(ai.lower()) or ai.lower().startswith(n.lower()))]
            ctx.gap("admission item has no code; confirm one in review",
                    f"'{ai}' ({ref(title, row)}{'; RR list suggests ' + ', '.join(near) if near else ''})")
            aic = ai
        prices = read_prices(ctx, cells, pcols, where)
        used.update(prices)
        rt = reg_types.setdefault(code, {
            "code": code, "name": v("name") or code, "labels": [], "path": v("path"),
            "web_visible": "staff only" not in v("method").lower(), "method": v("method"), "status": status,
            "group_registration": False, "approval": False, "pre_approval": False, "advanced_prereg": False,
            "badge_text": [], "admission_items": {}, "source": ref(title, row)})
        if v("old") and v("old") not in rt["labels"]:
            rt["labels"].append(v("old"))
        if v("badge") and v("badge") not in rt["badge_text"]:
            rt["badge_text"].append(v("badge"))
        for flag, key in (("group_registration", "group"), ("approval", "approval"), ("pre_approval", "pre"),
                          ("advanced_prereg", "adv")):
            if rt["admission_items"] and rt[flag] != yes(v(key)):
                ctx.gap(f"{where}: '{flag}' differs between this reg type's rows; set to Yes, confirm.")
            rt[flag] = rt[flag] or yes(v(key))
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
            p = paths.setdefault(v("path"), {"name": v("path"), "reg_types": [], "web_visible": False,
                                             "group_registration": False})
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
                if amount is None:
                    ctx.gap("discount amount is not a number", f"{code} '{v('amount')}' ({ref(title, row)})")
                codes.append({"sheet": title, "group": group, "name": name, "code": code, "type": v("type"),
                              "method": method, "amount": amount if amount is not None else v("amount"),
                              "effective_from": v("from"), "effective_to": v("to"), "capacity": v("capacity"),
                              "stackable": yes(v("stackable")), "usable_by": v("usable"), "count_guests": v("guests"),
                              "active": v("active").lower() != "no", "internal_note": v("note"),
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
    for key in ("reg_types", "admission_items", "paths", "price_tiers"):
        if key in patch:
            reg[key] = patch[key]
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
    for key, val in agent.items():
        plan[key] = val
        plan["coverage"][key] = "agent"


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
        by_name.setdefault(i["name"].strip().lower(), []).append(i["code"])
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


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if len(args) >= 1 and args[0] == "extract" and len(args) == 3:
        extract(args[1], args[2])
    elif len(args) == 2 and args[0] == "plan":
        build_plan(args[1], "--keep-test-codes" in sys.argv)
    elif len(args) == 2 and args[0] == "validate":
        sys.exit(validate(args[1]))
    else:
        sys.exit(__doc__)


if __name__ == "__main__":
    main()
```
