---
name: cvent-rr-parse
description: "Parse an Emerald \"Registration Requirements NEW\" (RR) Excel workbook with openpyxl into an ordered, piece-by-piece Cvent build plan (JSON + markdown) with counts and UI vs API/import channel tags. Read-only; never writes to Cvent."
---

# cvent-rr-parse — RR Excel → Cvent build plan

Read-only. Produces a plan for user approval. Never touches Cvent.

## Inputs
- RR workbook (.xlsx) uploaded by the user ("Registration Requirements NEW").
- Optional user overrides (e.g. "include PPC test codes", "include Evaluation sheet").

## Setup
```bash
uv pip install --system openpyxl 2>/dev/null || pip install --user openpyxl
```
Load with `openpyxl.load_workbook(path, data_only=True)` (values, not formulas). Also load once with `data_only=False` only if a cell shows a formula result of None and you need to explain it.

## Step 1 — Inventory sheets
List every sheet name, max_row, max_column, and first ~15 non-empty rows. Record hidden sheets (`ws.sheet_state`) but don't silently skip them — note them.

## Step 2 — Detect workbook family (by sheet names, case/whitespace-insensitive, fuzzy)
- **Family A**: has `Approvals` AND `Sessions` / `Optional` (e.g. "Sessions & Optional Items").
- **Family B**: has `Approval Site Parameters` and/or `Sessions_Add-Ons` and/or `Access & Reports`.
- Neither/both → report as ambiguous and ask the user. Access & Reports (piece 15) exists only for Family B.

## Step 3 — Event identity
Build key = **(Event FP Code, Event Name, primary event dates start–end)**. Pull from the event info/shell sheet. Never identify the event by name alone. If any component is missing or conflicting across sheets, flag it.

## Step 4 — Header handling (multi-row headers)
- RR sheets often have 2–3 header rows and merged cells. Resolve merged ranges (`ws.merged_cells.ranges`) by forward-filling the top-left value across the range.
- Compose column keys by joining header rows top→bottom (`"Fees | Early Bird | Amount"`), dropping blanks.
- Detect header end = first row where most key columns hold data values rather than labels.
- Strip whitespace, normalize non-breaking spaces, keep original text for display.

## Step 5 — Sheet rules
- **Prefer NEW reg sheets**: if both "Registration Types" and "NEW Registration Types" (or similar "NEW" variants) exist, use NEW and note the other as superseded.
- Honor **ACTIVATE / REQUIRED** columns: only rows marked active (Y/Yes/X/TRUE/Activate) are built; REQUIRED flags carry into the plan.
- **Show Questions**: answer choices continue on rows under each question (question cell blank, answer cell filled). Attach continuation rows to the preceding question until the next non-blank question cell. Capture type, required flag, visibility (which reg types / paths), and conditional logic.
- **Discounts (Discount Code Template)**: drop rows containing `[Free Text]`, codes matching `PPCTEST*` (case-insensitive), and other obvious PPC test rows — unless the user overrides. Report dropped count and codes.
- **Communications**: only rows answered Yes.
- **Skip by default** (list them as skipped with reason): `Evaluation`, `Sheet1` wireframes, instructional Reference ID naming-tool matrices, empty session shells (session rows with no name/date/time). User can override.

## Step 6 — Map to pieces and lanes
| Piece | Content | Lane | Channel |
|---|---|---|---|
| 1 | Event shell fields (title, code, dates, time zone, venue, planner/currency/languages) | Shell | UI |
| 2 | Branding / theme | Shell | UI (Site Designer) |
| 3 | Registration paths, website shell, footer links | Shell | UI |
| 4 | Admission items & registration types | Registration | UI |
| 5 | Fees / price windows | Registration | UI |
| 6 | Sessions & optional items / add-ons | Registration | UI |
| 7a | Discount codes (Discount Code Template) | Discounts | Import (or existing discount API only if already available) |
| 7b | Group / volume discounts | Discounts | UI |
| 8 | Show questions + visibility | Questions | UI |
| 9 | Approvals / Approval Site Parameters | Questions | UI |
| 10 | Policies & rules | Site & Comms | UI |
| 11 | Communications (Yes rows) | Site & Comms | UI |
| 12 | Integrations snippets; Site Designer leftovers not owned by Shell | Site & Comms | UI |
| 13 | (unassigned — flag if RR has content that maps here; ask the user) | — | — |
| 14 | Badges / tickets | Badges & Onsite | UI |
| 15 | Access & Reports (Family B only) | Badges & Onsite | UI |
| 16 | Onsite / Scan & Go | Badges & Onsite | UI |
| 17 | QA checklist | Badges & Onsite | UI read-back |

Never tag types, questions, paths, Site Designer, or attendees as REST/API.

## Step 7 — Output
Write to `shared/cvent-builds/<FPCODE>/`:
- `plan.json`: `{event_key, family, source_file, sheets:{used,skipped,superseded}, pieces:[{id, lane, channel, count, items:[...], flags:[...]}], dropped:{discounts:[...]}, open_questions:[...]}`
- `plan.md`: human summary — identity key, family, per-piece table (piece, lane, channel, count, notes), skipped/dropped lists, ambiguities.

Present plan.md to the user and **get explicit OK before any Cvent write**.

## Sanity checks
- Every fee references an existing reg type/admission item.
- Every question visibility target exists in reg types/paths.
- Discount codes unique; amounts/percents parse; dates in the event window.
- Counts in plan.md match plan.json.