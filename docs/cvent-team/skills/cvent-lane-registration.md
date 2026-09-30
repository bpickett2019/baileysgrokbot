---
name: cvent-lane-registration
description: |-
  Cvent build lane for pieces 4–6: admission items and registration types (NEW Reg Types sheets, ACTIVATE/REQUIRED), fees/price windows, sessions and optional items/add-ons, all from Registration Overview in the planner UI.
---

# cvent-lane-registration — Pieces 4–6

Precondition: approved plan, the browser lock held, and the correct event/environment verified. UI only. Never use REST for types. No publish/delete/clone.

**Stay on Registration Overview for the whole batch** (types → fees → sessions). Don't bounce to Site Designer.

## Piece 4 — Admission items & registration types
- Source: NEW Reg Types sheet if present; otherwise the standard sheet.
- Build only rows marked ACTIVATE. Carry REQUIRED flags.
- Create admission items first, then reg types. Link each type to its admission item and registration path (paths come from Shell piece 3; if a path is missing, mark blocked, don't invent it).
- Match names exactly as in the RR (codes too, if given). If the event already has a type with the same name, edit it; don't create a duplicate.

## Piece 5 — Fees / price windows
- For each type/admission item: amount per price window (e.g. Early / Advance / Onsite) with effective start/end dates and the event time zone.
- Verify windows are contiguous, don't overlap, and fall within the registration window. Flag gaps.

## Piece 6 — Sessions & optional items / add-ons
- Family A: "Sessions / Optional" sheets. Family B: "Sessions_Add-Ons".
- Skip empty session shells (no name/date/time) unless the user overrides.
- Set name, code, date/time, capacity, fee, type (included / optional / add-on), and visibility by reg type.

## Report
One status row per piece with built/planned counts and any rows skipped (with reason). Release the lock.