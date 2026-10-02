---
name: cvent-lane-discounts
description: |-
  Cvent build lane: discount codes and vouchers (R7–R8 via /cvent-registration-build) plus group/volume discounts in the planner UI.
---

# cvent-lane-discounts — R7, R8 and group discounts

Precondition: R1–R6 are done (types, items and pricing exist), the browser lock
is held, and the target event is verified. No publish, delete or clone.

## R7 / R8 — Discount codes and vouchers

Follow `/cvent-registration-build` R7 and R8.

- Test codes (`PPCTEST*`) and `[Free Text]` placeholder rows are already dropped
  by the parser unless the user kept them.
- Admission-item codes that aren't on the reg-type tab come from `code_map.json`,
  which holds only user-confirmed mappings.

## Group / volume discounts

Source: `discounts.group_discounts`.

Configure, in the UI:
- the tiers (threshold → amount or percent);
- the method and what each tier applies to (registrants at/before the threshold,
  registrants after it, at an interval, or everyone);
- eligible admission items and sessions;
- the effective dates.

When the list is empty, or the event details say "No group discounts", skip this
with that reason.

## Report

`status.md` rows for R7, R8 and the group discounts, with imported/planned
counts, the dropped code list, codes whose reg-type limit couldn't be enforced,
and import errors verbatim. Release the lock.
