---
name: cvent-rr-event-build
description: |-
  Orchestrator runbook for building a Cvent event from an RR workbook: safety policy, intake, login, plan approval, lane order, single-browser queue, and per-piece reporting.
---

# cvent-rr-event-build — Orchestrator runbook

## Hard rules (never violate)

1. **Never Publish, Go Live, Launch or Activate** the event, the site or any
   communication. If a save dialog offers "save and publish", choose save-only or
   stop.
2. **Sandbox by default.** Use production only if the user explicitly names
   production for this run.
3. **Edit only the exact event the user named** (URL, event ID or title), and
   verify it before every lane. See "Target modes" below.
4. **No delete** of events, types, fees, questions, codes, attendees or anything
   else, and nothing outside the target event. Fix mistakes by editing in place,
   or report them.
5. **No clone** unless the user explicitly asks for one.
6. **Never invent REST writes.** Types, questions, paths, Site Designer and
   attendees are UI only. Discounts may go through the planner's import, or
   through an installed Cvent API connector found in `task_catalog`, but only
   after confirming that the connector targets the same environment, the verified
   event ID, and event-level (not account-level) discounts.
7. **One browser driver at a time.** UI work is queued and serialized. Specialists
   may parse and prepare in parallel.
8. If something is ambiguous or high-impact, pause and ask.

## Target modes

- **Build mode** (the default): the target event *is* the RR's event. Its identity
  key (FP code, event name, primary dates) must match the plan. On a mismatch,
  stop.
- **Test-target mode:** the user names an existing test event (for example a
  cloned sandbox event) to receive the RR's configuration. Verify the target by
  the exact title or ID the user gave; the RR identity key is only the data
  source. Don't rename the event or change its dates or code unless the user says
  so. Everything else is built inside that event. Record the mode in
  `status.md`.

## Intake (collect all of it before parsing or executing)

a. The RR Excel upload.
b. The exact Cvent event URL, ID or title, and the target mode.
c. Sandbox or production.
d. **Login.** Every run starts with a fresh Cvent sign-in; don't rely on a session
   left over from an earlier run.
   - If the browser is already signed in at the start of a run, use Cvent's own
     Log Out first. This overrides the "reuse the existing login" default in the
     browser skills for this team.
   - **Computer provider:** if `list_secrets` has no saved Cvent login, call
     `request_secret` for one at the Cvent sign-in origin. On the sign-in page,
     `fill` the Account Name field (not a secret; ask for it once), then use
     `fill_secret` for the username and password, then click Log In.
   - **Ego provider:** `fill_secret` isn't available. Ask the user to sign in
     directly in the Ego window.
   - MFA, CAPTCHA or SSO: `request_takeover` (computer provider) or the user
     (Ego provider).
   - Never take passwords in chat.

## Flow

1. **Parse** with `/cvent-rr-parse`: run extract, then plan. Map any section whose
   coverage is `needs_mapping` into `agent_plan.json`, citing source cells, then
   run validate. This works for any RR layout. Anything the tool can't settle
   becomes a question, never a guess.
2. **Present the plan**, then the validation errors, then the open questions.
   **Wait for the user's OK**. Record the answers in `decisions.md`, apply them as
   `agent_plan.json` patches and `code_map.json`, and re-run plan and validate.
   Sections that still have errors stay blocked; tell the user which ones.
3. **Sign in and open the target event** (sandbox). Read back the title, code,
   dates and environment, check them against the target mode, and capture a
   snapshot as evidence.
4. **Run the lanes in this order,** one UI owner at a time:

| Order | Lane | Skill | Pieces |
|---|---|---|---|
| 1 | Shell | `/cvent-lane-shell` | 1: event shell fields |
| 2 | Registration | `/cvent-registration-build` | R1 types · R2 paths · R3 admission items · R4 pricing · R5 optional items · R6 advanced rules |
| 3 | Discounts | `/cvent-lane-discounts` (R7–R8 via `/cvent-registration-build`) | R7 discount codes · R8 vouchers · group/volume discounts |
| 4 | Questions | `/cvent-lane-questions` | 8: show questions and display rules · 9: approvals |
| 5 | Website | `/cvent-website-build` | W1 theme · W2 header · W3 footer · W4 body widgets |
| 6 | Site & Comms | `/cvent-lane-site-comms` | 10: policies · 11: communications · 12: integrations |
| 7 | Badges & Onsite | `/cvent-lane-badges-onsite` | 14–16, then 17: QA |

   The website lane runs after registration because the Register buttons link to
   paths that must already exist.

5. **Surface discipline:** finish each surface before moving to the next.
   Registration screens cover R1–R8; Site Designer covers the website lane. Don't
   bounce between surfaces in the middle of a batch.
6. After each piece, the lane appends a row to `status.md`:
   `piece | done/blocked/skipped | built/planned | evidence | notes`.
7. **Final report** to the user:
   - a per-piece status table;
   - each blocker with the exact UI message;
   - pre-existing items that aren't in the RR (left untouched);
   - everything left for a human, including publishing, which always stays with
     the user.

## Files and shell

File tools resolve `shared/...` to the Team root, but `shell` starts in the bot's
own folder. Run shell commands with `cwd: "shared"` and paths relative to it
(`cvent-builds/<FP>/...`).

Every lane reads the same files:
- `plan.json`, the source of truth. Data for the approvals, communications,
  policies, integrations, badge and onsite lanes is under `communications` and
  `other_tabs`;
- `decisions.md`, which overrides the plan;
- `code_map.json`.

## Browser lock

- The lock file is `shared/cvent-builds/LOCK`, containing
  `{holder, event, piece, started_utc}`.
- Only the holder drives the UI. It releases the lock on handoff, and Chief assigns
  the next holder.
- Before any coordinate action, observe the screen; another actor may have changed
  it.

## Delegation message template (to a lane bot)

"Lane: <X>. Skill: /<skill>, pieces <ids>. Event: <URL/ID/title> (<env>, <build|test-target> mode). Identity: <FP, name, dates>. Plan: shared/cvent-builds/<FP>/plan.json + decisions.md (keys for your lane: <keys>). You hold the browser lock now. Rules: no publish/delete/clone; UI only except discounts via installed connector or import. Read and update shared/cvent-learnings/. Report each piece as done/blocked/skipped in status.md, then release the lock and reply with the result."

## Stop conditions

- Wrong event or environment.
- A login, MFA or SSO wall.
- A publish or activate prompt.
- A missing required reference (for example a fee's reg type).
- An unanswered open question that a step needs.
- A Cvent validation error you can't resolve without guessing.
