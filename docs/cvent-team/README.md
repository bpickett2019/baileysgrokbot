# Cvent build team checkpoint

Reusable configuration for a supervised RR-workbook-to-Cvent workflow. This is an
initial playbook, not a validated unattended event builder.

- `bots.json`: Chief and six specialist definitions, with no account or database IDs.
- `skills/`: eight build runbooks, the active Team Computer browser workflow, and an optional host-Ego adapter guide.
- `../vendor/ego-browser/`: the complete unmodified Ego skill, references, installer, example learnings, and MIT license (reference only; not auto-loaded).
- Chief coordinates with `cvent-rr-event-build`; specialists reference their lane skills.
- Use a Team Computer and a user-configured model connection. Model credentials are not included.

On a fresh instance, create/import the skills through the Skills interface and create
bots using these definitions. Give Chief the orchestration runbook as standing guidance.
With `BROWSER_PROVIDER=computer`, use `/cvent-team-browser` for Ego-inspired semantic
observation, batched actions, and verification on the existing Team screen. The
skill does not install Ego Lite or expose its JavaScript SDK. Ordinary runs still have
separate bot screens. Do not route editing back to Chief as a workaround: use the
[experimental delegated-build executor](../delegated-builds.md) for an explicitly
approved shared browser session, or pause. The profile may belong to Chief while
specialists execute under their own identities. Importing these skills alone does
not enable shared budgets, backend delegation restrictions, or automatic scheduling.
Automatic workbook-to-manifest compilation remains unfinished; do not resume an
unrestricted free-form Chief run as if it were a budgeted build.
Importing this directory is not automatic; the current running instance already has
these bots and skills stored in its local database.

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

## Execution rules

Require a reviewed plan, a named target event, explicit environment selection, and
planner access. Default to sandbox. Do not publish, activate, send communications,
delete, or clone without the authorization specified in the runbooks. Browser work
must be serialized and verified. These are agent instructions, not a substitute for
application-level permissions or exhaustive QA.

The `pre-ego-navigation` tag retains the original sandbox-browser checkpoint.
The optional Ego adapter and its limitations are documented in
[../ego-navigation.md](../ego-navigation.md).
