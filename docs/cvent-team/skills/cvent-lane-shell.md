---
name: cvent-lane-shell
description: |-
  Cvent build lane: piece 1 event shell fields, then the website (theme, header, footer, body widgets) via /cvent-website-build.
---

# cvent-lane-shell — Event shell and website

Precondition: an approved `plan.json` (with `decisions.md`), the browser lock,
and the target event verified as described in `/cvent-rr-event-build`.
No publish, delete or clone.

## Piece 1 — Event shell fields

Planner → Event → General / Event Information. Set or verify the fields the RR
specifies:
- title, event code, start/end dates and times, time zone;
- venue/location, currency, languages;
- planner/contact, capacity, and the registration deadline.

In test-target mode, leave the title, code and dates alone unless the user said
otherwise; set only the remaining fields. Record before → after values.

## Website — W1 to W4

Run `/cvent-website-build` once the registration lane has finished paths (R2),
because the Register buttons link to them.

## Report

Append a row per piece to `status.md` (done/blocked/skipped, counts, notes,
evidence). Release the lock.
