---
name: cvent-lane-site-comms
description: |-
  Cvent build lane for pieces 10–12: policies and rules, communications (RR Yes-rows only, never sent), and integration snippets. Site Designer layout belongs to /cvent-website-build.
---

# cvent-lane-site-comms — Pieces 10–12

Precondition: earlier lanes done, the browser lock held, and the correct event/environment verified. UI only. No publish/delete/clone. **Never send or schedule-send communications.**

## Piece 10 — Policies & rules
Source: the policies tab under `other_tabs` in plan.json.
Cancellation/refund, substitution, and modification policies; registration rules (limits per person, required fields, capacity/waitlist); terms/consent text. Apply exactly as the RR states.

## Piece 11 — Communications
- Only RR rows answered **Yes** (`communications` in plan.json; full rows under `other_tabs`).
- For each: email type (confirmation, modification, cancellation, reminder, invitation, approval pending/approved/denied), subject, sender name/address, content notes, audience/reg types.
- Configure and save as draft or inactive. Do not activate automated sends or schedule invitations. If Cvent auto-enables a trigger, note it and ask.

## Piece 12 — Integrations
- Integration snippets from the integrations tab under `other_tabs` (tracking pixels, GTM/analytics, custom header/footer code) placed where the RR specifies. Paste them verbatim. If a snippet is missing, mark blocked.
- Confirmation page content and FAQ text the RR supplies. The landing page's theme, header, footer and body widgets belong to `/cvent-website-build`; don't rebuild them here.
- Save only; don't publish the site.

## Report
Status rows per piece, including a list of comms configured with their state (draft/inactive). Release the lock.