---
name: cvent-lane-registration
description: |-
  Cvent build lane: registration types, paths, admission items, pricing tiers, optional items and advanced rules (R1–R6) via /cvent-registration-build.
---

# cvent-lane-registration — R1 to R6

Precondition: an approved `plan.json` (with `decisions.md`), the browser lock,
and the target event verified as described in `/cvent-rr-event-build`.
UI only. No publish, delete or clone.

Follow `/cvent-registration-build` steps R1–R6, in order:
types → paths → admission items → pricing → optional items → advanced rules.

Stay in the event's Registration area for the whole batch. Match existing records
before creating new ones, so a re-run never duplicates anything.

## Report

One `status.md` row per step, with built/planned counts and skipped rows (with
reasons). Hand approvals, badge text, reprint fees and question display rules to
their lanes. Release the lock.
