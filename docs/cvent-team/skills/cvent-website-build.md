---
name: cvent-website-build
description: "Build a Cvent event website from an approved RR plan: theme, header, footer and the six body widget types (event information, text, image, registration actions, countdown timer, social media). Saves drafts only."
---

# cvent-website-build — Theme, header, footer, body widgets

## Before you start

You need:
- an approved `shared/cvent-builds/<FP>/plan.json`;
- `decisions.md`, whose answers override the plan;
- the browser lock;
- the target event verified as described in `/cvent-rr-event-build`.

**Gate:** if `validation.json` has errors under `website`, build only the parts
they don't touch, and list the rest as blocked.

Read `/cvent-team-browser` (`BROWSER_PROVIDER=computer`) or `/cvent-ego-navigation`
(`BROWSER_PROVIDER=ego`) for the tool rules. Both use `browser_snapshot` and
`browser_act`.

Hard rules: save drafts only, and never click Publish, Go Live, Launch or Activate.
No deletes. Change only the target event. Never edit an account-level theme, theme
library entry, template or shared asset. Everything stays inside this event.

## Learnings (read first, write after success)

Cvent's labels and menus drift between accounts and releases, so this skill
describes goals and checks, not pixel positions.

- Before acting, read `shared/cvent-learnings/site-designer.md` if it exists. It
  holds the exact navigation path, labels and gotchas from earlier verified runs.
- After a step is saved and verified, append what worked: the navigation path,
  the exact button and field labels, which controls needed desktop actions, and
  any error text verbatim. Do not record event data, URLs with IDs, or
  credentials.
- When a learning turns out to be wrong, correct the line rather than appending a
  contradiction.

## Get to Site Designer

From the event, open **Website & Registration** and then the site designer
(Flex: "Site Designer" or "Registration Process"). Take a snapshot and confirm the
event title before changing anything. Website pages and registration-path pages
are edited separately. Use the page picker on the canvas, and record which page
you are on in `status.md`.

## W1 Theme

Source: `website.theme`.

1. Open **Theme**, then **Change Theme**, and choose the theme named in the plan
   (for example a library code such as `T1`). If no theme with that exact name
   appears, mark W1 blocked and list the themes you saw. Never pick a "close
   enough" theme.
2. Open **Theme Colors** and apply the brand colors, in order: color 1 → primary
   (buttons and links), color 2 → secondary/accent, color 3 → header or section
   background, and colors 4–5 → highlights. Keep the theme's own text colors
   unless contrast fails. Record the mapping you used.
3. Contrast check (deterministic, run in shell before saving):

   ```bash
   python3 -c "
   import sys
   def L(h):
       c=[int(h[i:i+2],16)/255 for i in (1,3,5)]
       c=[x/12.92 if x<=0.03928 else ((x+0.055)/1.055)**2.4 for x in c]
       return 0.2126*c[0]+0.7152*c[1]+0.0722*c[2]
   a,b=sorted([L(sys.argv[1]),L(sys.argv[2])],reverse=True)
   print(round((a+0.05)/(b+0.05),2))" '#BUTTON' '#TEXT'
   ```

   A button or link color must reach at least 4.5 against its text or background.
   If it doesn't, keep the theme's text color and note it in `status.md`; never
   invent a new brand color.
4. If the theme note asks for a progress bar, set the progress-bar style the
   note names.
5. Save. A dialog that offers to save the theme to the account library is a stop:
   choose save-to-this-event-only, or cancel and ask.

Verify: reopen Theme and read back the theme name and each color value.

## W2 Header

Source: `website.header` plus the event name.

- **Logo or banner image:** only from files the user provided. When
  `assets_provided` is false, mark the image part blocked ("upload logo/banner").
  Uploads go through a native file picker: with the computer provider, use
  `request_takeover`; with Ego, ask the user to upload. Never pull art from the
  style-guide link yourself.
- **Navigation:** keep the theme's default website navigation unless the RR asks
  for changes.
- **Already-registered link:** when the plan says yes, add a link labelled
  "Already Registered?" that targets the event's existing modify/login page. Use
  the link target option the editor offers for that page; never paste a guessed
  URL.
- Apply it as the default header for all pages, and keep the boxes that apply it
  to new pages checked.

Verify: switch to two different pages and confirm the header renders on both.

## W3 Footer

Source: `website.footers.<audience>`. Each audience is one footer.

1. Build the attendee footer (the audience whose name contains "attendee", or the
   first audience listed) as the default footer.
2. Add only links where `visible` is true, in RR order. Use the RR label as the
   link text and the exact URL. External links open in a new tab. The Contact Us
   button is a `mailto:` button using the address in the plan. A `cvent-generated`
   URL (for example Registration Status) links to the matching built-in event
   page, picked with the editor's page-link option.
3. For every other audience (for example exhibitor), give that path's pages their
   own footer with that audience's link list. Links that exist only for one
   audience, such as an exhibitor resource center, never appear in the default
   footer.
4. Save.

Verify: on one page per audience, read every footer link's text and target from
the snapshot and compare them with the plan. A mismatch is a defect: fix it in
place.

## W4 Body widgets

Work on the landing (summary) page first, then repeat the registration actions on
each web-visible path's entry page. Add widgets from **Build** into a section. Use
one section per row, and keep columns to what the widget allows (countdown, map,
navigation and progress bar can't sit in columns).

| # | Widget type | Plan source | Configure | Skip when |
|---|---|---|---|---|
| 1 | Event information: title, date & time, location, and Add to Calendar | `body.event_information` | Bind title, date and venue to event fields, not typed text. Add to Calendar body = RR calendar text as plain text | never (calendar: when disabled) |
| 2 | Text | `body.text.blocks` and `show_hours` | Show hours as a short list, word for word from the RR. No invented marketing copy | no RR text |
| 3 | Image | `body.image` | Hero or banner from provided files, with alt text = event name | no assets (mark blocked) |
| 4 | Registration actions | `registration.paths` where `web_visible`, and `registration_actions` | One Register button per web-visible path, labelled with the path name and linked to that path. Add the already-registered link if enabled. Planner-only paths get no button | never |
| 5 | Countdown timer | `body.countdown_timer` | Counts down to the first day of the event (or to registration close if the RR says so), with the RR label text above it | `enabled` is false |
| 6 | Social media | `body.social_media` | One icon or link per listed network with the exact URL; new tab | the list is empty |

### Adding widgets despite drag-and-drop

The Build palette usually adds widgets by dragging.

1. First, look in the snapshot for a click-to-add control ("+", "Add widget",
   "Add section") and use it if one exists.
2. Computer provider: take `computer_observe`, then `computer_act` with `down` on
   the palette item, `move` in a few steps to the target section, then `up`. Then
   observe. Verify one widget before repeating the move.
3. Ego provider: drag isn't available. Use `ask_user` to have the user drop the
   listed widgets into place ("Done" / "Can't find widget"). When they answer,
   take a fresh snapshot and configure the widgets by ref.

Record whichever method worked in the learnings file.

### Configuring each widget

Click the widget on the canvas and edit the settings panel by ref. Batch
independent fields (up to 24) and stop the batch before Save. Then save.

Verify: snapshot the canvas and confirm that each of the six widget types is
present, or explicitly skipped or blocked with a reason. Read back the countdown
target date, the Register button links and the social URLs.

## Save, never publish

Use Save (draft). If the only button is "Save & Publish", stop and ask. A preview
may open a new tab; treat it as a new page, snapshot it, then return.

## Report

Append one row each for W1, W2, W3 and W4 (with W4 broken out per widget type) to
`shared/cvent-builds/<FP>/status.md`:
`piece | done/blocked/skipped | built/planned | evidence | notes`.
Then release the lock and message Chief with the blockers (missing art, missing
theme, drag hand-offs).
