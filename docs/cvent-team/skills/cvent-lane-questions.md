---
name: cvent-lane-questions
description: |-
  Cvent build lane for pieces 8–9: show (registration) questions with answer choices and visibility logic, plus Approvals (Family A) or Approval Site Parameters (Family B), via the planner UI / Site Designer.
---

# cvent-lane-questions — Pieces 8–9

Precondition: reg types and paths exist, the browser lock held, and the correct event/environment verified. UI only. Never use REST for questions. No publish/delete/clone.

## Piece 8 — Show questions + visibility
- Source: Show Questions sheet. The parse step already attached answer continuation rows to their question. Verify it did.
- For each question: text, type (single/multi choice, text, dropdown, etc.), answer choices in order, required flag, and reporting/export label if given.
- Visibility: which reg types / paths see it, plus conditional logic (show if answer X). Build parents before dependents.
- Place questions on the right registration pages in Site Designer, in the RR order.
- Reuse matching Question Library/standard questions (e.g. contact info) rather than duplicating them.

## Piece 9 — Approvals
- Family A: "Approvals" sheet. Family B: "Approval Site Parameters".
- Configure which reg types require approval, approver settings, and pending/approved/denied messaging. Don't enable anything that emails attendees live. Communications are drafted in piece 11, not sent.

## Report
Status rows with question counts (built/planned), visibility rules applied, and any unmapped targets. Release the lock.