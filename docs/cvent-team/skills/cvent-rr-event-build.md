---
name: cvent-rr-event-build
description: |-
  Orchestrator runbook for building a Cvent event from an Emerald RR workbook: safety policy, intake, plan approval, lane order, single-browser queue, and per-piece reporting.
---

# cvent-rr-event-build — Orchestrator runbook

## Hard rules (never violate)
1. **Never Publish / Go Live / Launch / Activate** the event, site, or any communication. If a button would do that, don't click it. If a save dialog offers "save and publish," pick save-only or stop.
2. **Sandbox by default.** Production only if the user explicitly names production for this run.
3. **Edit only the exact event the user named** (URL / event ID / title), verified against the RR identity key (FP Code, Event Name, primary dates). Stop if there's a mismatch.
4. **No delete** (events, types, fees, questions, codes, attendees). To fix a mistake, edit in place or report it.
5. **No clone** unless the user explicitly asks to clone.
6. **Never invent REST writes** for reg types, questions, reg paths, Site Designer, or attendees. The only allowed non-UI channel is discount code import / an existing discount API that is already available.
7. **One browser computer at a time.** UI work is queued and serialized. Specialists may parse/prep in parallel.
8. Ambiguous or high-impact → pause and ask.

## Intake (collect all before parsing/executing)
a. RR Excel upload
b. Exact Cvent event URL / ID / title
c. Sandbox vs production
d. Planner access: already signed in on the browser computer, saved login (request_secret auth login at the Cvent sign-in origin), or user takeover for SSO/2FA. Never take passwords in chat.

## Flow
1. **Parse** with /cvent-rr-parse → `shared/cvent-builds/<FPCODE>/plan.json` + `plan.md`.
2. **Present plan** (piece counts, channel tags, skipped/dropped, open questions). **Wait for user OK.**
3. **Open the named event** in the planner (sandbox). Read back event title, code, dates, and environment, and match them to the identity key. Screenshot as evidence.
4. **Execute lanes in order**, one UI owner at a time:
   Shell (1–3) → Registration (4–6) → Discounts (7a/7b) → Questions (8–9) → Site & Comms (10–12) → Badges & Onsite (14–17).
5. **Surface discipline:** stay on Registration Overview for types → fees → sessions; then run discount import; then Site Designer for questions/theme work. Don't bounce between surfaces mid-batch.
6. After each piece, record status in `shared/cvent-builds/<FPCODE>/status.md`: `piece | done / blocked / skipped | count built / planned | evidence | notes`.
7. **Final report** to the user: per-piece status table, blockers with the exact UI message, anything left for a human (including the publish step, which stays with the user).

## Browser lock
- Lock file: `shared/cvent-builds/LOCK` containing `{holder, event, piece, started_utc}`.
- Only the holder drives the UI. Release it on handoff. The orchestrator assigns the next holder.
- Before any coordinate action, observe the screen. Another actor may have changed it.

## Delegation message template (to a lane bot)
"Lane: <X>. Event: <URL/ID> (<env>). Identity: <FP, name, dates>. Plan: shared/cvent-builds/<FP>/plan.json pieces <ids>. You hold the browser lock now. Rules: no publish/delete/clone, UI only (except discount import). Report per piece done/blocked/skipped into status.md, then release the lock and reply with result."

## Stop conditions
Wrong event or environment · login/2FA wall (request_takeover) · a publish/activate prompt appears · a required reference is missing (e.g. a fee's reg type) · Cvent validation errors you can't resolve without guessing.