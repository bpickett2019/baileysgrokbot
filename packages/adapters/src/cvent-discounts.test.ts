import { describe, expect, it } from "vitest";
import { CventApi, loadCventDiscounts, runCventDiscountTool } from "./cvent-discounts.js";

const EVENT = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const uuid = (n: number) => `33333333-3333-4333-8333-${String(n).padStart(12, "0")}`;

type Discount = Record<string, unknown> & { id: string };

/** Minimal in-memory Cvent API: token, event, discounts, admission items, links. */
function fakeCvent(options: { title?: string; discounts?: Discount[]; staleReads?: boolean } = {}) {
  const state = {
    discounts: [...(options.discounts ?? [])],
    links: [] as { id: string; discount: { id: string } }[],
    writes: [] as string[],
    tokenRequests: [] as { authorization: string | null; body: string }[],
  };
  let next = 1;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const fetch = async (raw: string, init: RequestInit = {}) => {
    const url = new URL(raw);
    const method = init.method ?? "GET";
    const path = url.pathname.replace(/^\/ea/, "");
    if (path === "/oauth2/token") {
      state.tokenRequests.push({
        authorization: new Headers(init.headers).get("authorization"),
        body: String(init.body),
      });
      return json({ access_token: "tok-123", expires_in: 3600 });
    }
    if (new Headers(init.headers).get("authorization") !== "Bearer tok-123") return json({}, 401);
    if (method !== "GET") state.writes.push(`${method} ${path}`);
    if (path === `/events/${EVENT}` && method === "GET") {
      return json({ id: EVENT, title: options.title ?? "Sample Event" });
    }
    if (path === "/admission-items")
      return json({ data: [{ id: ITEM, code: "EXONLY", name: "Expo Only" }] });
    if (path === `/events/${EVENT}/discounts/agenda-items`) return json({ data: state.links });
    if (path === `/events/${EVENT}/discounts` && method === "GET") {
      const filter = url.searchParams.get("filter");
      const rows = filter ? state.discounts.filter((d) => filter.includes(d.id)) : state.discounts;
      return json({ data: options.staleReads ? [] : rows });
    }
    if (path === `/events/${EVENT}/discounts` && method === "POST") {
      const body = JSON.parse(String(init.body));
      const row = { ...body, id: uuid(next++), level: "EVENT" };
      state.discounts.push(row);
      return json(row, 201);
    }
    const link = path.match(/\/discounts\/([^/]+)\/agenda-items\/([^/]+)$/);
    if (link && method === "PUT") {
      state.links.push({ id: link[2]!, discount: { id: link[1]! } });
      return new Response(null, { status: 204 });
    }
    const put = path.match(/\/discounts\/([^/]+)$/);
    if (put && method === "PUT") {
      const row = state.discounts.find((d) => d.id === put[1]);
      Object.assign(row!, JSON.parse(String(init.body)));
      return json(row);
    }
    return json({}, 404);
  };
  return { state, fetch };
}

const api = (
  fetch: (url: string, init?: RequestInit) => Promise<Response>,
  tokens: string[] = [],
) =>
  new CventApi({
    baseUrl: "https://api-platform.cvent.com/ea",
    clientId: "client-id",
    clientSecret: "client-secret",
    fetch,
    sleep: async () => undefined,
    intervalMs: 0,
    onToken: (t) => tokens.push(t),
  });

const spec = (code: string, extra: Record<string, unknown> = {}) => ({
  code,
  name: `${code} name`,
  method: "BY_PERCENTAGE",
  value: 100,
  active: true,
  stackable: false,
  capacity: -1,
  audience: "ALL",
  includeGuestsTowardsCapacity: true,
  admissionItems: [],
  ...extra,
});

const run = (
  fetch: (url: string, init?: RequestInit) => Promise<Response>,
  specs: unknown[],
  extra: Partial<Parameters<typeof loadCventDiscounts>[0]> = {},
) =>
  loadCventDiscounts({
    api: api(fetch),
    eventId: EVENT,
    eventTitle: "Sample Event",
    specs,
    apply: true,
    limit: 25,
    sleep: async () => undefined,
    pollDelaysMs: [0, 0],
    ...extra,
  });

describe("Cvent discount loader", () => {
  it("authenticates with client credentials and reports the token for redaction", async () => {
    const cvent = fakeCvent();
    const tokens: string[] = [];
    await loadCventDiscounts({
      api: api(cvent.fetch, tokens),
      eventId: EVENT,
      eventTitle: "Sample Event",
      specs: [],
      apply: false,
      limit: 25,
    });
    expect(cvent.state.tokenRequests[0]?.authorization).toBe(
      `Basic ${Buffer.from("client-id:client-secret").toString("base64")}`,
    );
    expect(cvent.state.tokenRequests[0]?.body).toContain("grant_type=client_credentials");
    expect(tokens).toEqual(["tok-123"]);
  });

  it("refuses an event whose title differs and writes nothing", async () => {
    const cvent = fakeCvent({ title: "Another Event" });
    await expect(run(cvent.fetch, [spec("FREE")])).rejects.toThrow(/does not match/);
    expect(cvent.state.writes).toEqual([]);
  });

  it("creates a final-total code with one POST and verifies it", async () => {
    const cvent = fakeCvent();
    const result = await run(cvent.fetch, [spec("FREE")]);
    expect(result.outcomes).toMatchObject([{ code: "FREE", status: "created" }]);
    expect(cvent.state.writes).toEqual([`POST /events/${EVENT}/discounts`]);
  });

  it("creates item-scoped codes inactive, links items, then finalizes", async () => {
    const cvent = fakeCvent();
    const result = await run(cvent.fetch, [spec("EXPO", { admissionItems: ["exonly"] })]);
    expect(result.outcomes[0]?.status).toBe("created");
    const id = result.outcomes[0]!.discountId!;
    expect(cvent.state.writes).toEqual([
      `POST /events/${EVENT}/discounts`,
      `PUT /events/${EVENT}/discounts/${id}/agenda-items/${ITEM}`,
      `PUT /events/${EVENT}/discounts/${id}`,
    ]);
    expect(cvent.state.discounts[0]).toMatchObject({ active: true, applyToAllAgendaItems: true });
  });

  it("never modifies existing codes", async () => {
    const existing = {
      id: uuid(900),
      type: "DISCOUNT_CODE",
      level: "EVENT",
      code: "SAME",
      name: "SAME name",
      active: true,
      stackable: false,
      autoApply: false,
      audienceType: "ALL",
      includeGuestsTowardsCapacity: true,
      method: { type: "BY_PERCENTAGE", value: 100 },
      capacity: { total: -1, used: 3 },
    };
    const cvent = fakeCvent({
      discounts: [
        existing,
        { ...existing, id: uuid(901), code: "DIFF", method: { type: "BY_AMOUNT", value: 5 } },
      ],
    });
    const result = await run(cvent.fetch, [
      spec("SAME", { name: "SAME name" }),
      spec("DIFF", { name: "SAME name" }),
    ]);
    expect(result.outcomes.map((o) => o.status)).toEqual(["unchanged", "preserved_difference"]);
    expect(cvent.state.writes).toEqual([]);
  });

  it("blocks codes for admission items the event lacks and continues", async () => {
    const cvent = fakeCvent();
    const result = await run(cvent.fetch, [
      spec("BAD", { admissionItems: ["NOPE"] }),
      spec("GOOD"),
    ]);
    expect(result.outcomes.map((o) => o.status)).toEqual(["blocked", "created"]);
  });

  it("stops the batch at an unverified write without replaying it", async () => {
    const cvent = fakeCvent({ staleReads: true });
    const result = await run(cvent.fetch, [spec("ONE"), spec("TWO")]);
    expect(result.stoppedEarly).toBe(true);
    expect(result.outcomes).toMatchObject([{ code: "ONE", status: "uncertain" }]);
    expect(cvent.state.writes).toEqual([`POST /events/${EVENT}/discounts`]);
  });

  it("dry run and limit write nothing beyond their scope", async () => {
    const cvent = fakeCvent();
    const dry = await run(cvent.fetch, [spec("A"), spec("B")], { apply: false, limit: 1 });
    expect(dry.outcomes.map((o) => o.status)).toEqual(["would_create", "would_create"]);
    expect(cvent.state.writes).toEqual([]);
    const limited = await run(cvent.fetch, [spec("A"), spec("B")], { limit: 1 });
    expect(limited.outcomes.map((o) => o.code)).toEqual(["A"]);
  });

  it("tool entry refuses without a credential and writes a results file", async () => {
    const files = new Map<string, string>([
      ["shared/cvent-builds/X/discounts_api.json", JSON.stringify({ discounts: [spec("FREE")] })],
    ]);
    const base = {
      args: {
        eventId: EVENT,
        eventTitle: "Sample Event",
        file: "shared/cvent-builds/X/discounts_api.json",
      },
      apply: false,
      readFile: async (p: string) => new TextEncoder().encode(files.get(p) ?? ""),
      writeFile: async (p: string, c: string) => void files.set(p, c),
      fetch: fakeCvent().fetch,
      registerRedactions: () => undefined,
    };
    expect(await runCventDiscountTool({ ...base, loadCredential: async () => null })).toMatchObject(
      {
        error: expect.stringContaining("cvent_api"),
      },
    );
    const redacted: string[] = [];
    const ok = await runCventDiscountTool({
      ...base,
      registerRedactions: (v) => redacted.push(...v),
      loadCredential: async () => ({
        origin: "https://api-platform.cvent.com",
        username: "client-id",
        secret: "client-secret",
      }),
    });
    expect(ok).toMatchObject({ counts: { would_create: 1 } });
    const hash = (ok as { fileSha256: string }).fileSha256;
    const cred = async () => ({
      origin: "https://api-platform.cvent.com",
      username: "client-id",
      secret: "client-secret",
    });
    expect(
      await runCventDiscountTool({ ...base, apply: true, loadCredential: cred }),
    ).toMatchObject({
      error: expect.stringContaining("fileSha256"),
    });
    const applied = await runCventDiscountTool({
      ...base,
      apply: true,
      args: { ...base.args, fileSha256: hash },
      loadCredential: cred,
      now: () => new Date("2026-01-01T00:00:00Z"),
    });
    expect(applied).toMatchObject({ counts: { created: 1 } });
    expect([...files.keys()].some((f) => f.includes(".applied-2026-01-01"))).toBe(true);
    expect(redacted).toEqual(expect.arrayContaining(["client-secret", "tok-123"]));
    expect(files.has("shared/cvent-builds/X/discounts_api.checked.json")).toBe(true);
  });

  it("rejects a credential saved for a non-Cvent origin", async () => {
    const result = await runCventDiscountTool({
      args: { eventId: EVENT, eventTitle: "t", file: "f.json" },
      apply: false,
      loadCredential: async () => ({ origin: "https://evil.example", username: "u", secret: "s" }),
      readFile: async () => new TextEncoder().encode(JSON.stringify({ discounts: [] })),
      writeFile: async () => undefined,
      fetch: fakeCvent().fetch,
      registerRedactions: () => undefined,
    }).catch((error: Error) => ({ error: error.message }));
    expect(result).toMatchObject({ error: expect.stringContaining("Cvent API platform origin") });
  });

  it("de-duplicates admission items and flags codes repeated in the file", async () => {
    const cvent = fakeCvent();
    const result = await run(cvent.fetch, [
      spec("EXPO", { admissionItems: ["EXONLY", "exonly"] }),
      spec("expo"),
    ]);
    expect(result.outcomes.map((o) => o.status)).toEqual(["created", "blocked"]);
    expect(cvent.state.writes.filter((w) => w.includes("agenda-items"))).toHaveLength(1);
  });

  it("reports an existing code whose linked items differ", async () => {
    const existing = {
      id: uuid(902),
      type: "DISCOUNT_CODE",
      level: "EVENT",
      code: "LINKED",
      name: "LINKED name",
      active: true,
      method: { type: "BY_PERCENTAGE", value: 100 },
      capacity: { total: -1, used: 0 },
    };
    const cvent = fakeCvent({ discounts: [existing] });
    cvent.state.links.push({ id: ITEM, discount: { id: existing.id } });
    const result = await run(cvent.fetch, [spec("LINKED")]);
    expect(result.outcomes[0]?.status).toBe("preserved_difference");
    expect(cvent.state.writes).toEqual([]);
  });

  it("stops between codes when the run is cancelled", async () => {
    const cvent = fakeCvent();
    const controller = new AbortController();
    const result = await loadCventDiscounts({
      api: new CventApi({
        baseUrl: "https://api-platform.cvent.com/ea",
        clientId: "client-id",
        clientSecret: "client-secret",
        fetch: cvent.fetch,
        signal: controller.signal,
        intervalMs: 0,
      }),
      eventId: EVENT,
      eventTitle: "Sample Event",
      specs: [spec("ONE"), spec("TWO")],
      apply: true,
      limit: 25,
      sleep: async () => undefined,
      pollDelaysMs: [0],
      onProgress: async () => controller.abort(),
    });
    expect(result.stoppedEarly).toBe(true);
    expect(cvent.state.writes).toEqual([`POST /events/${EVENT}/discounts`]);
  });
});
