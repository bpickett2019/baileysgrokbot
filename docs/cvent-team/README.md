# Cvent build skill

One skill and one bot that turn an RR (Registration Requirements) workbook into a
drafted, verified, **unpublished** Cvent event. The skill is supervised: the user
approves the plan before any Cvent write, and a human publishes.

- `skills/cvent-build.md`: the whole runbook in one file. It carries two tools as
  `file=` code blocks. The model reads only a one-line stub for each, and
  `skill_files` writes them byte for byte to `shared/cvent-builds/tools/`:
  - `rr.py` (Appendix A) parses any RR layout (`extract` → `plan` → `validate`) and
    pulls embedded pictures (`images`). Nothing is dropped: `cells.json` keeps every
    cell's stored value, number format, hyperlink and comment. Plan text is verbatim,
    percent cells read as percentages, and dates without a year are flagged. Current
    registration sheets parse automatically. For legacy layouts, the agent maps them
    with cited source cells. Real RR errors block their section.
  - `rr.py expect` / `verify` check every planned value against what Cvent shows,
    not samples. Anything unread counts as a failure.
  - `cvent_pw.py` (Appendix B) is the Playwright fallback. It attaches to the Team
    Computer's signed-in Chrome over CDP for uploads, native dropdowns, drag-and-drop
    and iframes, and it takes over when screenshots go blind or an action loops. It
    only drives a Cvent tab, never fills password or secret fields, never reports a
    field's value as its name, and refuses publish, delete and send controls.
- `bots.json`: the "Cvent Builder" bot, which follows `/cvent-build`.
- `../vendor/ego-browser/`: the unmodified Ego skill, kept for reference only.

## What it builds

- Event shell.
- Registration: types, paths, admission items, pricing tiers, optional items,
  advanced rules, discount codes and vouchers.
- Questions and approvals.
- Website: theme, header, footer and the six body widget types.
- Comms as drafts, and policies.
- Badges and onsite settings.
- QA that checks every planned value against Cvent.

## Install

1. Import `skills/cvent-build.md` in Knowledge → Skills.
2. Create the bot from `bots.json` and give it a Team Computer and a model
   connection.
3. For discount codes through the API, save a `cvent_api` credential on the bot:
   basic auth, with the Cvent client ID as the username and the client secret entered
   in the protected card. The bot asks for it if it is missing.

## Run

Attach the RR workbook and name the target event (URL or exact title), the
environment, and the mode:
- **build:** the event is the RR's show;
- **test-target:** the RR is loaded into an existing test event without changing its
  title, code or dates.

The bot then:
1. signs in fresh;
2. checks the event;
3. sends `plan.md`, the validation errors and its questions;
4. builds only after the user's OK.

RR images are listed with their tab and cell. Template pictures are never used as
event art; a header or logo needs an uploaded file or the user's confirmation.

## Cvent API (discounts)

`cvent_discounts_check` and `cvent_discounts_apply` run on the server with the
`cvent_api` credential:
- **Secrecy:** the secret and the OAuth token never reach the model, and
  `secret_request` refuses this credential.
- **Approval:** apply needs the user's approval and the checked file's hash.
- **Write rules:** existing codes are never modified, and every write is read back.
  The first unverified write stops the batch without replay.
- **Only path:** discount codes are never created, edited, activated or imported in
  the Cvent UI. Codes the tool can't express (for example, limited to certain reg
  types) are held and listed for a human.

The tools appear only for bots that have the credential.

## Runtime files

Each build writes to `shared/cvent-builds/<FP>/`:
- `plan.json` and `plan.md`;
- `validation.md`;
- `decisions.md` (the user's answers, which override the plan);
- `code_map.json`;
- `assets/`;
- `cells.json` (the RR evidence);
- `status.md`, `readback.json` and `qa.md`.

`shared/cvent-learnings/procedures.md` records how each Cvent screen worked, so later
runs are shorter. It never holds event data or credentials.

## Excluded

Environment files, credentials, uploaded workbooks, generated plans, browser
sessions and event details. The optional host Ego adapter is described in
[../ego-navigation.md](../ego-navigation.md).
