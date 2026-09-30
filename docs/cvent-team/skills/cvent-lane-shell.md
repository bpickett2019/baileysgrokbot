---
name: cvent-lane-shell
description: |-
  Cvent build lane for pieces 1–3: event shell fields, branding/theme, registration paths and website shell/footer links, driven from an approved RR build plan via the planner UI.
---

# cvent-lane-shell — Pieces 1–3

Precondition: approved `plan.json`, the browser lock held, and the named event open in the correct environment (verified against the identity key). Rules from /cvent-rr-event-build apply: no publish/delete/clone, UI only.

## Piece 1 — Event shell fields
Planner → Event → General/Event Information. Set or verify: title, event code (FP code if the RR maps it), start/end dates and times, time zone, venue/location, currency, languages, planner/contact, capacity, and the registration open/close deadline. Change only fields the RR specifies. Record before → after values.

## Piece 2 — Branding / theme
Site Designer → Theme. Apply colors, fonts, logo/header images, and favicon from the RR. If the RR references asset files that weren't provided, mark blocked and list the missing assets. Save only; do not publish the site.

## Piece 3 — Registration paths & website shell
- Registration Paths: create or rename paths per the RR and assign reg types later (Registration lane links types to paths; note the dependency).
- Website shell: pages/navigation skeleton and footer links (privacy, terms, contact, and so on) with exact URLs from the RR.
- Leave Site Designer page content that isn't shell-related to Site & Comms (piece 12).

## Report
Append a row per piece to `status.md` (done/blocked/skipped, counts, notes, screenshot path). Release the lock.