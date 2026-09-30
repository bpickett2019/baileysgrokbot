# Local Ego navigation (experimental)

Ego is an opt-in host browser adapter. It replaces the existing `browser_navigate`,
`browser_snapshot`, and `browser_act` implementation; it does **not** give agents a
host shell or an arbitrary JavaScript execution tool. Docker remains the file and
Python environment. Installing a skill alone does not connect these environments.

## Requirements and configuration

Run the API/worker on the same trusted desktop as an installed, onboarded Ego Lite
browser with `ego-browser` on PATH. A Compose worker does not automatically have
access to the host CLI. This integration is for a trusted local deployment, not a
multi-tenant hosted service.

1. Use the Ego skill to create **one** task space for the event-building goal and
   record its numeric ID and page label. Never claim an existing user-owned space
   or choose another profile without explicit permission.
2. Create a private JSON binding **outside all bot homes**, for example
   `data/browser-connection.json`, mode `0600`:

   ```json
   {
     "provider": "ego",
     "userId": "local-user-id",
     "spaceId": "local-space-id",
     "computerHomeKey": "team-home-key",
     "botIds": ["chief-bot-id", "specialist-bot-id"],
     "taskSpaceId": 7,
     "page": "p1",
     "allowedOrigins": ["https://app.cvent.com"]
   }
   ```

   These are application identifiers from your local instance, not credentials.
   `computerHomeKey` is the persistent computer home key, not a transient Docker ID.
   Add all authorized specialist IDs explicitly. Origins must be exact HTTP(S)
   origins (no path, embedded credentials, or wildcard). Only approve the origins
   needed for the task; do not broadly allow unrelated logged-in sites.
3. In the ignored `.env`, set:

   ```dotenv
   BROWSER_PROVIDER=ego
   BROWSER_CONNECTION_FILE=/absolute/path/to/private/browser-connection.json
   ```

4. Restart the host API/worker while no run is executing browser actions. Existing
   approval questions remain pending; this is not authorization to continue a build.
5. Add `docs/cvent-team/skills/cvent-ego-navigation.md` to the team's Skills catalog
   and reference it in the bots' instructions.

The app's embedded Computer screen still shows Docker, **not Ego**. Watch and sign
in through the bound task space in Ego Lite. The adapter disables screenshot/desktop
fallback tools and sandbox takeover for its runs so a page-tool failure does not
silently move the work to another browser. Shell/file tools remain in Docker.

## Supported operations

- Navigate to a configured origin.
- Semantic full-page snapshots; Ego `[ref=N]` nodes are exposed as Rakazo `[eN]` refs.
- Click, replace field text (`fill`), or append field text (`type`).
- Up to 24 actions per batch and a final snapshot. Batch independent fields, not
  operations spanning page transitions; the adapter stops if the observed URL changes.
- Follow a single managed popup, then stop the batch before applying remaining actions.

This is not the entire Ego SDK exposed to an agent. No arbitrary scripts, profile
selection, cookie export, host files, raw CDP, or automatic ownership claims are
available. Saved-login `fill_secret` calls are rejected before entering the CLI;
use the user's existing login or have the user sign in directly in Ego.

Uploads/downloads, native select helpers, key chords, graphical drag/drop, and
interactive dialog handling are not yet mapped to Rakazo tools. Ask the user for
assistance rather than using a different browser. Discount import may therefore
still require a manual upload. There is no measured end-to-end speedup claim.

## Isolation and recovery

The host binding limits callers by user, space, computer home, and bot. All commands
use the same numeric task space; none create another task to recover from failure.
A filesystem lock serializes commands across API/worker processes. Element refs are
bound to the last observing bot/run. This serializes individual commands, **not** an
entire specialist lane: Chief must still assign one browser owner at a time.

The CLI receives fixed code plus JSON on stdin, with only basic desktop environment
variables—not model keys, database passwords, or supervisor tokens. No model-provided
code or shell command runs on the host.

The origin check applies to the destination/current top-level page before reading
or acting. It is **not a network firewall**: redirects, subframes, subresources, and
links may load other origins. Stop and review unexpected navigation. Existing
no-publish, no-delete, event-identity, and plan-approval instructions still apply;
this adapter does not replace Cvent permissions or enforce every business rule.

Interrupted/uncertain commands latch the private `.state` file. They are never
replayed automatically. The operator must inspect the bound Ego page, confirm no
operation is still in flight, and only then remove the binding's `.state` file to
require a fresh snapshot. A `.lock` directory left by a killed process likewise
requires checking that no command is running before removing it. Never delete or
reset the user's browser profile or create a new task space to bypass a stop.

If the user takes control, ask for explicit handback. Use the Ego skill's
`takeOverTaskSpace(existingId)` only after that approval; the adapter never invokes
it. Use `task.handOff()` for manual login and close the task with `finish()` only
when the entire authorized browser task is complete. Do not finish the task between
specialist calls or it will no longer be available to the next lane.

## Verification and rollback

Offline tests:

```sh
pnpm exec vitest run packages/adapters/src/ego-browser.test.ts packages/adapters/src/browser-tools.test.ts packages/adapters/src/executor.test.ts
```

Explicit local smoke (temporarily navigates the **bound page** to a local fixture;
run only while no agent is using it):

```sh
pnpm exec tsx scripts/verify-ego-navigation.ts /absolute/path/to/browser-connection.json
```

This verifies real Ego navigation, refs, batched form entry and saved-result read-back.
It does not test Cvent event configuration. It never creates or claims another space.

For rollback, set `BROWSER_PROVIDER=computer` and restart at a safe task boundary.
Reconfirm browser login/target and update the bot guidance before resuming. The
`pre-ego-navigation` Git tag preserves the prior source checkpoint; neither Git
nor that tag contains private database state or uploaded workbooks.
