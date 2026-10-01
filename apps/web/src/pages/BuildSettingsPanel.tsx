import { Trans, useLingui } from "@lingui/react/macro";
import { BuildManifest } from "@rakazo/contracts";
import { Button } from "@rakazo/ui-web";
import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { rpc } from "../lib/rpc";

type BuildSummary = Awaited<ReturnType<typeof rpc.builds.list>>[number];
type Build = Awaited<ReturnType<typeof rpc.builds.get>>;
const dollars = (value: number) => `$${(value / 1e6).toFixed(2)}`;

export function BuildSettingsPanel({ onOpenAgent }: { onOpenAgent: () => void }) {
  const { t } = useLingui();
  const [builds, setBuilds] = useState<BuildSummary[]>([]);
  const [detail, setDetail] = useState<Build>();
  const [selected, setSelected] = useState("");
  const [manifest, setManifest] = useState("");
  const [approved, setApproved] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => setBuilds(await rpc.builds.list({})), []);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const next = await rpc.builds.list({});
        if (active) setBuilds(next);
      } catch (cause) {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load builds");
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, []);
  const summary = builds.find((item) => item.id === selected) ?? builds[0];
  const selectedId = summary?.id;
  useEffect(() => {
    setApproved(false);
    if (!selectedId) return;
    let active = true;
    void rpc.builds
      .get({ id: selectedId })
      .then((value) => {
        if (active) setDetail(value);
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : "Unable to load build scope");
      });
    return () => {
      active = false;
    };
  }, [selectedId]);
  const build = summary && detail?.id === summary.id ? { ...detail, ...summary } : undefined;
  async function perform(work: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      await work();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Build operation failed");
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="space-y-5" data-testid="build-settings">
      <p className="text-sm text-muted-foreground">
        <Trans>
          Experimental delegated builds. The coordinator does not edit; specialists execute bounded
          packages and another agent verifies them. Only one package runs at a time.
        </Trans>
      </p>
      <p className="text-sm text-muted-foreground">
        <Trans>
          Dollar amounts are catalog API-equivalent estimates, not subscription charges or remaining
          subscription allowance. No automatic switch to API billing. Workbook-to-manifest
          compilation is not yet automatic.
        </Trans>
      </p>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <details className="rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">
          <Trans>Create a scoped build</Trans>
        </summary>
        <p className="my-2 text-sm">
          <Trans>
            Paste a reviewed manifest with agent IDs, exact values and source cells, dependencies,
            saved-value checks, approved click labels and limits. Never include credentials; API
            steps reference saved credential names.
          </Trans>
        </p>
        <textarea
          aria-label={t`Build manifest JSON`}
          className="min-h-48 w-full rounded border bg-background p-2 font-mono text-xs"
          value={manifest}
          onChange={(event) => setManifest(event.target.value)}
        />
        <Button
          disabled={busy || !manifest.trim()}
          onClick={() =>
            void perform(async () => {
              const parsed = BuildManifest.parse(JSON.parse(manifest));
              const created = await rpc.builds.create(parsed);
              setSelected(created.id);
              setApproved(false);
              setManifest("");
            })
          }
        >
          <Trans>Create draft</Trans>
        </Button>
      </details>
      {!build ? (
        <p className="text-sm">
          <Trans>No builds yet.</Trans>
        </p>
      ) : (
        <>
          <select
            aria-label={t`Selected build`}
            className="w-full rounded border bg-background p-2"
            value={build.id}
            onChange={(event) => {
              setSelected(event.target.value);
              setApproved(false);
              setNote("");
            }}
          >
            {builds.map((item) => (
              <option key={item.id} value={item.id}>
                {item.title} — {item.status}
              </option>
            ))}
          </select>
          <section className="space-y-3 rounded-lg border p-3" aria-label={t`Build progress`}>
            <h3 className="font-medium">
              {build.title}: <span data-testid="build-status">{build.status}</span>
            </h3>
            <p className="text-sm">{build.manifest.targetIdentity}</p>
            {build.finalVerification && build.status === "running" ? (
              <p className="text-sm">
                <Trans>Final read-only verification sweep</Trans>
              </p>
            ) : null}
            <p className="text-sm">
              <Trans>Spent</Trans>: {dollars(build.spentMicrousd)} · <Trans>Reserved</Trans>:{" "}
              {dollars(build.reservedMicrousd)} · <Trans>Ceiling</Trans>:{" "}
              {dollars(build.maxMicrousd)}
            </p>
            <p className="text-xs text-muted-foreground">
              <Trans>Model calls</Trans>: {build.modelCalls} · <Trans>Input tokens</Trans>:{" "}
              {build.inputTokens.toLocaleString()} · <Trans>Output tokens</Trans>:{" "}
              {build.outputTokens.toLocaleString()}
            </p>
            {build.reason ? (
              <p role="status" className="text-sm">
                {build.reason}
              </p>
            ) : null}
            <Link
              className="text-sm underline"
              to={`/app/${build.activeAgentId ?? build.browserOwnerId}`}
              onClick={onOpenAgent}
            >
              <Trans>Open the build agent and shared computer</Trans>
            </Link>
            <ol className="space-y-2 text-sm">
              {build.packages.map((packet) => (
                <li key={packet.key} className="rounded border p-2">
                  <span className="font-medium">{packet.title}</span> — {packet.status} (
                  {packet.phase}) · {dollars(packet.spentMicrousd)} · {packet.toolCalls}{" "}
                  <Trans>tool calls</Trans>
                  {packet.reason ? <p>{packet.reason}</p> : null}
                  {build.status === "paused" && packet.status === "blocked" ? (
                    <Button
                      size="sm"
                      className="mt-2"
                      disabled={busy || !note.trim()}
                      onClick={() =>
                        void perform(() =>
                          rpc.builds.review({
                            id: build.id,
                            action: "verify",
                            packageKey: packet.key,
                            note,
                          }),
                        )
                      }
                    >
                      <Trans>Verify saved values only</Trans>
                    </Button>
                  ) : null}
                </li>
              ))}
            </ol>
            <details>
              <summary className="cursor-pointer text-sm">
                <Trans>Review complete approved scope</Trans>
              </summary>
              <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all text-xs">
                {JSON.stringify(build.manifest, null, 2)}
              </pre>
            </details>
            {build.status === "draft" ? (
              <>
                <label className="flex gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={approved}
                    onChange={(event) => setApproved(event.target.checked)}
                  />
                  <Trans>I reviewed the target, values, permissions and shared budget.</Trans>
                </label>
                <Button
                  disabled={busy || !approved}
                  onClick={() => void perform(() => rpc.builds.start({ id: build.id }))}
                >
                  <Trans>Start approved build</Trans>
                </Button>
              </>
            ) : null}
            {build.status === "running" ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void perform(() =>
                    rpc.builds.review({
                      id: build.id,
                      action: "pause",
                      note: "Operator paused from build controls.",
                    }),
                  )
                }
              >
                <Trans>Pause after in-flight actions</Trans>
              </Button>
            ) : null}
            {build.status === "paused" ? (
              <>
                <label className="block text-sm">
                  <Trans>Review note</Trans>
                  <textarea
                    aria-label={t`Build review note`}
                    className="mt-1 w-full rounded border bg-background p-2"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
                <p className="text-xs text-muted-foreground">
                  <Trans>
                    Review uncertain saves before continuing. Verification does not repeat writes.
                    Limits and held usage reservations do not reset.
                  </Trans>
                </p>
                <Button
                  disabled={busy || !note.trim()}
                  onClick={() =>
                    void perform(() => rpc.builds.review({ id: build.id, action: "resume", note }))
                  }
                >
                  <Trans>Resume ready work</Trans>
                </Button>
              </>
            ) : null}
            {build.status === "completed" ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void perform(() =>
                    rpc.builds.review({
                      id: build.id,
                      action: "release",
                      note: "Operator released completed build assignments.",
                    }),
                  )
                }
              >
                <Trans>Release agent assignments</Trans>
              </Button>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
