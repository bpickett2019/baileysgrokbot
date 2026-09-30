---
name: cvent-lane-discounts
description: |-
  Cvent build lane for pieces 7a/7b: Discount Code Template import (filtered: no [Free Text], PPCTEST*, PPC test rows) and group/volume discounts via the planner UI.
---

# cvent-lane-discounts — Pieces 7a / 7b

Precondition: Registration lane done (types, fees, sessions exist), the browser lock held, and the correct event/environment verified. No publish/delete/clone.

## Piece 7a — Discount codes (import)
1. From plan.json take the filtered code list. Default drops: `[Free Text]` rows, `PPCTEST*`, and obvious PPC test rows (unless the user overrode).
2. Build the import file in Cvent's Discount Code template format: code, name, type (% / amount), value, applies-to (reg types / sessions / admission items), capacity/usage limit, start/end dates. Save as `shared/cvent-builds/<FP>/discount_import.xlsx|csv`.
3. Validate: codes unique; every applies-to target exists in the event; values parse; dates in range.
4. Import via the planner's discount import (UI upload). Use an API only if an existing discount API integration is already available. Never invent one.
5. Read back the discount list and reconcile counts against the plan.

## Piece 7b — Group / volume discounts (UI)
Configure group/volume tiers (minimum group size → discount), eligible reg types, and date windows per the RR, manually in the UI.

## Report
Status rows for 7a/7b: imported/planned counts, dropped codes list, import errors verbatim. Release the lock.