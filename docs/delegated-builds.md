# Scoped delegated builds (experimental)

This is an **approved-manifest executor**, not a finished workbook-to-Cvent autopilot.
It adds shared accounting, deterministic progression, specialist execution and independent
verification. It has been exercised with local fixtures, not a complete customer event.

## Operator workflow

1. Stop old workers, apply database migrations, and start the updated API/workers before
   creating any build. Mixed-version worker fleets are unsupported. No provider changes
   or automatic subscription-to-API billing fallback are made.
2. Finish/stop existing runs for participating bots. They must belong to the same user
   and workspace and use one Team Docker computer. The fake provider supports offline tests.
3. Sign in in the browser-owning bot's existing computer. Check the approved target's
   name, product/code and dates. Do not copy cookies between profiles.
4. Open **Settings → Builds**. Paste a reviewed manifest, then create a draft. Creating
   a draft reserves those agents for the build and makes the coordinator delegation-only.
5. Review the entire stored scope, exact values/source cells, authorized API requests,
   click labels and limits. Explicitly start the draft.
6. Coordinator chat is model-free status reporting, not an RR planner. Exact commands
   such as `/pause`, `stop`, or `stop the build` pause future dispatch; already in-flight
   requests can finish. Use the panel for reviewed resumes and scope inspection.
   The backend assigns a dependency-ready package to its specialist, then assigns a
   read-only verification run to a different bot. Multi-package builds then perform a
   final read-only sweep after all writes, so earlier receipts are not mistaken for proof
   that later packages preserved those values. It continues without another chat instruction
   until all packages verify, the user takes control, or a blocker/limit stops it.
7. Use the panel's active-agent link to open the shared computer or request takeover.
   Other participants may view the shared browser but cannot take control in place of
   its active specialist. Terminals are unavailable through a shared build session.
8. For an uncertain save, inspect actual state. The panel's **Verify saved values only**
   action starts independent read-back without replaying writes. A review note is recorded.
   In-flight calls may finish after Pause. Stop a waiting/running agent before reviewing
   its package if necessary. Limits, counters and reservations do not reset on review.
9. Release agent assignments when finished. The ledger and review history remain.
   Bot/run removal does not erase accounting. Explicit account or workspace erasure
   follows the application's data-deletion lifecycle and removes its private manifests
   and associated ledgers; it is not a build retry mechanism.
   The coordinator stays delegation-only; releasing a build does not restore browser
   editing to that role.

The shared RPC contract also exposes `builds.list/get/create/start/review`. The web panel
uses these same authenticated, owner/workspace-scoped procedures. There is not yet a
native mobile build editor; backend enforcement applies regardless of client surface.

## Example browser manifest

Replace the illustrative IDs, URL and source references with reviewed values belonging
to your own workspace. Do not commit customer manifests or put credentials in them.

```json
{
  "title": "Fixture registration build",
  "coordinatorId": "coordinator-bot-id",
  "browserOwnerId": "signed-in-browser-bot-id",
  "targetUrl": "https://fixture.example/event?evtstub=approved",
  "targetIdentity": "Fixture Event",
  "targetQueryKeys": ["evtstub"],
  "instructions": "Preserve the event name and external synchronization settings. No deletion or publication.",
  "maxMicrousd": 80000000,
  "maxInputTokens": 10000000,
  "maxOutputTokens": 500000,
  "maxPromptChars": 60000,
  "maxOutputPerCall": 4096,
  "packages": [
    {
      "key": "registration-fee",
      "title": "Approved registration fee",
      "agentId": "registration-specialist-id",
      "verifierId": "independent-verifier-id",
      "kind": "browser",
      "dependsOn": [],
      "instructions": "Set only the approved Fee field, save, and reopen the saved settings.",
      "readbackUrl": "https://fixture.example/event?evtstub=approved",
      "allowedClicks": ["Save"],
      "checks": [
        {"id": "fee", "source": "Registration!B2", "label": "Fee", "role": "textbox", "expected": "25"}
      ],
      "maxMicrousd": 10000000,
      "maxModelCalls": 30,
      "maxToolCalls": 60
    }
  ]
}
```

`maxMicrousd` is integer micro-USD: 80,000,000 means $80 API-equivalent. The default
build ceiling is $80; the contract permits at most $100. Package limits include execution,
independent verification and the final sweep, not just the first specialist run.

Browser packages expose only observations, scoped navigation/actions, read-back, status
and user handoff/questions. Shell, arbitrary HTTP, nested delegation, connector discovery,
secret operations and desktop-coordinate edits are not available. Field replacements
must match declared checks. Click labels must be explicitly listed; delete/remove,
publish/go-live/activate, send/schedule and clone controls are blocked even if listed.
Navigation/save clicks must end a batch. A fresh snapshot checks target identity and
rebinds previously observed controls only when their name/role is unambiguous. Event
identity query parameters (`evtstub` and `eventId`, case insensitive, plus explicit
`targetQueryKeys`) are pinned to the approved URL. Never treat a title alone as sufficient
operator target validation.

The browser session is the existing owner profile, not a new logged-in specialist profile.
Each executing bot keeps its own file/credential attribution. A second database execution
lease fences the shared browser owner; ordinary per-bot leases still fence file work.
Supervisor commands use the browser's screen ID while tool/run audit events identify the
actual specialist. Stale finalizers cannot translate themselves into a newer screen lease.
All participant viewers receive invalidation events on specialist handoffs. Read-only
view refreshes may follow the current browser lease; stale cleanup/control calls may not.

## API packages

Set `kind` to `api` and supply ordered, literal `apiSteps`, each with a unique `id` and
`request` matching `SecretHttpRequest`: a saved credential `name`, HTTPS URL, GET/POST/PUT
method and optional body. No secret value belongs in the manifest. Credentials stay
scoped to the executing bot; a verifier needs its own authorized read credential.

Each check specifies a `responseStep` identifying a GET step and a JSON pointer, for
example `"jsonPointer": "/fee"`. Execute writes before their GET read-backs. Verification
runs execute only GET steps. Review the exact resource scope and payload semantics;
HTTP verbs alone cannot establish that an arbitrary vendor endpoint is non-destructive.
Obvious destructive/publication URL operations and DELETE are rejected. Avoid bulk
replacement payloads that would implicitly drop existing data.

API requests run deterministically, without model calls. Each write is durably recorded
before dispatch. A completed write is not resent after a crash; an uncertain write blocks
execution instead of being replayed. Operator-approved read-only verification can check
whether the desired values were saved. Responses are checked after the existing credential
transport's SSRF, origin-pinning, response-size and secret-redaction protections.

An expired browser worker is not automatically restarted against possibly saved edits:
its package is paused and unreported model usage stays reserved. The operator can inspect
saved state and explicitly request read-only verification.

Only checks with an exact successful read-back generate a completion receipt. A normal
assistant "done" message is not enough. A failed/missing receipt pauses the build; it
is not silently treated as completed or converted into a new preparation task for Chief.

## Accounting and context limits

- Every Pi model dispatch first commits a row-locked reservation against both the package
  and build. In-flight calls, retries, run restarts and verification share these totals.
- Reservation uses the **entire catalog model context window** at the largest applicable
  input/cache rate, plus the requested output ceiling. This deliberately conservative
  bound can stop a package with money still available rather than gamble on a prompt estimate.
- Only known positive catalog pricing is accepted. Catalog prices express API-equivalent
  usage, not a subscription invoice, subscription quota or provider rate-limit reset.
- Normal completion settles actual input/output/cache usage exactly once. Input counts
  already include cache reads/writes; they are not billed twice by this estimator.
- Missing/uncertain usage retains its reservation and pauses the build. An unexpected
  provider usage/pricing overrun is recorded and pauses further dispatch; software cannot
  retroactively undo a provider charge. Do not interpret this as a billing guarantee.
- Automatic transport retries are disabled for these calls. Nested dispatches also have
  the guard, although nested delegation tools are not exposed to build executors.
- Calls and tools have persistent package caps. Repeated unchanged observations stop work.
  A bounded observation window also detects alternating-page cycles. A build package
  starts with no unrelated thread history and receives only its own scope.
- The request prefix stays append-only rather than rewriting older page results on every
  turn. A character ceiling and a three-image ceiling stop oversized packages before
  another model request. The character ceiling is not a token estimator. No measured
  caching or speed improvement is claimed yet.
- Semantic recall, background history summarization and model-based action auto-review
  are excluded from build execution so they cannot introduce unmetered model calls.
  Existing explicit human approval rules still apply.
- Chief status/delegation and literal API execution do not call a model. An unscheduled
  chat/routine run belonging to a build participant cannot bypass the package ledger.

## Current limits / next work

- **Automatic Excel/RR parsing into an inventory/diff/approved manifest is unfinished.**
  Existing Excel attachment support and parsing runbooks do not constitute that pipeline.
- QA does not autonomously invent repair scope. A failed or ambiguous check pauses for
  review. The owner-only `review` RPC can retry an explicitly reviewed package; counters
  do not reset and uncertain API writes are still not replayed.
- Browser checks currently require exact, uniquely labelled textbox/combobox/spinbutton/
  searchbox values. Checkbox/radio checked-state verification is not implemented. Complex
  iframes, native controls, ambiguous labels, generated API identifiers and application-
  specific read-back views may require additional adapters or a human handoff.
- This serial scheduler avoids parallel preparatory agents consuming the build's worker
  slots, but does not preempt unrelated jobs or add a dedicated handback-priority queue.
- Existing idle computer shutdown and server-side authentication expiration still apply.
- No full Cvent reconciliation, authentication fix, subscription-limit prediction or
  under-$100 completion result has been demonstrated. A representative, separately
  authorized pilot must count against the same build ledger before a full live rollout.

For the Cvent team specifically: preserve the approved event name; verify name, FP code
and dates before starting; include the required Show Code change; defer logo/header
images; preserve A2Z synchronization and external identifiers until separately resolved;
use reviewed discounts API requests; keep communications drafts. No deleted records,
cloning, publication, activation, sending or scheduling is authorized by this feature.

## Tests

```sh
pnpm exec vitest run packages/contracts/src/builds.test.ts \
  packages/adapters/src/build-safety.test.ts \
  packages/adapters/src/guarded-model-stream.test.ts
pnpm test:integration --spec=agent-builds.postgres.test.ts
pnpm test:e2e --spec=delegated-builds.spec.ts
pnpm check
pnpm lint
```

Integration/E2E harnesses create disposable PostgreSQL databases and use fake computers,
scripted runtimes and local transport fixtures. They do not access a customer Cvent
account, the operator's browser session or paid model endpoints.

Local validation snapshot for this feature:
- 405 focused unit tests passed; all 22 type-check tasks passed; lint completed with warnings.
- Full disposable integration run: 20 suites / 158 tests passed, including 17 build cases.
- Build-panel Playwright case passed; Docker parking lifecycle checks also passed (2 cases).
- Full unit run: 5,629 passed, 205 skipped, with the same three baseline failures already
  reproduced without this feature: Compose smoke `--print`, Node's missing `localStorage`,
  and the platform-dependent desktop slot-removal test. The full suite is not green.

These fixture results do not establish live Cvent compatibility, stable authentication,
measured token savings, or completion within the configured allowance.
