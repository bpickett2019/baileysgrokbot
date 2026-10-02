# Cvent build team checkpoint

Reusable configuration for a supervised RR-workbook-to-Cvent workflow. This is an
initial playbook, not a validated unattended event builder.

- `bots.json`: Chief and six specialist definitions, with no account or database IDs.
- `skills/`: build runbooks, the active Team Computer browser workflow, and an optional host-Ego adapter guide.
  - `cvent-rr-parse` embeds `rr.py` (extract → plan → validate), which handles any RR layout: current reg sheets are parsed automatically, legacy ones are mapped by the agent with cited source cells, and a validator blocks sections with real RR errors.
  - `cvent-website-build` covers theme, header, footer and the six body widget types.
  - `cvent-registration-build` covers types, paths, admission items, pricing, optional items, advanced rules, discounts and vouchers.
- `../vendor/ego-browser/`: the complete unmodified Ego skill, references, installer, example learnings, and MIT license (reference only; not auto-loaded).
- Chief coordinates with `cvent-rr-event-build`; specialists reference their lane skills.
- Use a Team Computer and a user-configured model connection. Model credentials are not included.

On a fresh instance, import the skills and create bots using these definitions. To
import them, either paste each file into Knowledge → Skills, or send Chief this
message (it uses only the built-in shell, file and skill tools):

> Run `git clone --depth 1 https://github.com/bpickett2019/baileysgrokbot cvent-team-src`
> with shell `cwd: "shared"` (or `git -C cvent-team-src pull` if it already exists).
> For each file in `shared/cvent-team-src/docs/cvent-team/skills/`, `read_file` it. Call `skill_update` with the full content if a skill with that
> name exists, otherwise `skill_create`. Then list the skill names you installed.

Re-run the same message after updates; the running instance keeps older copies in
its database until then. Give Chief the orchestration runbook as standing guidance.
With `BROWSER_PROVIDER=computer`, use `/cvent-team-browser` for Ego-inspired semantic
observation, batched actions, and verification on the existing Team screen. The
skill does not install Ego Lite or expose its JavaScript SDK. Each bot can have a
different screen; keep the signed-in bot driving if specialists lack that session.

## Included code changes

- Excel `.xlsx` and `.xls` attachments, preserving binary bytes and workbook extensions.
- CSV MIME inference when a document picker reports Excel's MIME type.
- Non-root Docker desktop startup for host user IDs absent from the image's passwd database.
- Attachment and Docker startup regression tests.

The parser runbook targets `.xlsx`; `.xls` upload support alone does not add a legacy
Excel parser. Convert legacy workbooks before parsing.

## Deliberately excluded

Environment files, model credentials, local database contents, uploaded workbooks,
generated event plans, browser sessions, transcripts, and production event details.
This repository is not a backup of the running instance's private state.

## Cvent API (discounts)

Discount codes load through server-side tools (`cvent_discounts_check` and
`cvent_discounts_apply`) that use a saved `cvent_api` credential:
- **Credential:** basic auth, with the Cvent client ID as the username and the
  client secret entered in the protected card.
- **Secrecy:** the secret and the OAuth token never reach the model, and
  `secret_request` refuses this credential.
- **Write rules:** existing codes are never modified, every write is read back,
  and the first unverified write stops the batch without replay.

The tools appear only for bots that have the credential.

## Runtime files

Each build writes to `shared/cvent-builds/<FP>/`: `plan.json`, `plan.md`,
`decisions.md` (the user's answers, which override the plan), `code_map.json`,
`status.md` and `qa.md`.

Bots also read and append `shared/cvent-learnings/*.md`: the exact navigation
paths, labels and gotchas from verified runs. These notes turn successful runs
into repeatable procedures. Never put event data or credentials in them.

## Execution rules

Require a reviewed plan, a named target event (build mode, or test-target mode for
loading an RR into an existing test event without changing its identity), explicit
environment selection, and planner access via a fresh sign-in each run. Default to sandbox. Do not publish, activate, send communications,
delete, or clone without the authorization specified in the runbooks. Browser work
must be serialized and verified. These are agent instructions, not a substitute for
application-level permissions or exhaustive QA.

The `pre-ego-navigation` tag retains the original sandbox-browser checkpoint.
The optional Ego adapter and its limitations are documented in
[../ego-navigation.md](../ego-navigation.md).
