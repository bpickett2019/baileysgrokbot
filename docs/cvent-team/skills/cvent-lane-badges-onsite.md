---
name: cvent-lane-badges-onsite
description: |-
  Cvent build lane for pieces 14–17: badges/tickets, Access & Reports (Family B only), onsite / Scan & Go setup, and a final QA read-back of the whole build against the plan.
---

# cvent-lane-badges-onsite — Pieces 14–17

Precondition: earlier lanes done, the browser lock held, and the correct event/environment verified. UI only. No publish/delete/clone/activate.

## Piece 14 — Badges / tickets
Badge/ticket templates per reg type: fields shown, barcode/QR, colors/ribbons by type, print size. Missing art → blocked with list.

## Piece 15 — Access & Reports (Family B only)
Family A → skip with reason "Family A". Family B: planner user access/roles and the saved reports named in the RR. Don't invite or email users without asking.

## Piece 16 — Onsite / Scan & Go
Check-in settings, kiosk/Scan & Go options, session scanning, and onsite payment options per the RR. Don't activate devices or launch onsite mode.

## Piece 17 — QA
Read back every piece against plan.json:
- Counts: types, fees/windows, sessions, codes, questions, comms.
- Spot-check 3+ items per piece for exact names, amounts, and dates.
- Confirm the event is still **not published / not live**, and that the environment and event ID match.
- Write `shared/cvent-builds/<FP>/qa.md` with pass/fail per check and screenshots.

## Report
Status rows for 14–17, then release the lock. Tell the orchestrator QA is done, with the fail list.