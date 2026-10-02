import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";

/**
 * Server-side Cvent discount loader. The model never sees the client secret or
 * the OAuth token: it supplies a work file and an event identity, and this
 * module runs the whole batch.
 *
 * Lifecycle per code (ported from a live-tested runner):
 * - exact code match first; an existing event-level code is never modified,
 *   only reported as unchanged or as a preserved difference;
 * - a new item-scoped code is created inactive, each admission item is linked
 *   and read back, then the code is finalized with its requested values;
 * - acknowledgment is not verification: every write is read back with bounded
 *   polling, and an unverified or failed write stops the batch without replay.
 */

export const CVENT_CREDENTIAL_NAME = "cvent_api";
/** Cvent API platform origins; credentials for them are usable only by this module. */
export const CVENT_API_ORIGIN = /^https:\/\/api-platform(?:-[a-z0-9]+)?\.cvent\.com$/i;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const MAX_RESPONSE_BYTES = 5_000_000;

const key = (code: string) => code.trim().toUpperCase();

export const CventDiscountSpec = z
  .object({
    code: z.string().trim().min(1).max(30),
    name: z.string().trim().min(1).max(50),
    method: z.enum(["BY_AMOUNT", "BY_PERCENTAGE", "FLAT_PRICE"]),
    value: z.number().finite().min(0),
    active: z.boolean(),
    stackable: z.boolean(),
    capacity: z.number().int().min(-1).max(32767),
    audience: z.enum(["ALL", "PRIMARY", "GUEST"]),
    includeGuestsTowardsCapacity: z.boolean(),
    effectiveFrom: z.iso.date().optional(),
    effectiveTo: z.iso.date().optional(),
    note: z.string().max(300).optional(),
    admissionItems: z
      .array(z.string().trim().min(1))
      .max(100)
      .default([])
      .transform((items) => [...new Map(items.map((item) => [key(item), item])).values()]),
    source: z.string().max(200).optional(),
  })
  .refine((d) => d.method !== "BY_PERCENTAGE" || d.value <= 100, "Percentage above 100")
  .refine(
    (d) => !d.effectiveFrom || !d.effectiveTo || d.effectiveFrom <= d.effectiveTo,
    "Effective dates are reversed",
  );
export type CventDiscountSpec = z.infer<typeof CventDiscountSpec>;

export const CventDiscountFile = z.object({ discounts: z.array(z.unknown()).max(5000) });

export type CventDiscountOutcome = {
  code: string;
  status:
    | "created"
    | "unchanged"
    | "preserved_difference"
    | "would_create"
    | "blocked"
    | "uncertain";
  detail?: string;
  discountId?: string;
  source?: string;
};

export class CventApiError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    /** True once a write may have reached Cvent; the batch must stop without replay. */
    readonly uncertain = false,
  ) {
    super(message);
  }
}

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
type Row = Record<string, unknown> & { id: string };

export function cventBaseUrl(origin: string): string {
  const url = new URL(origin);
  if (!CVENT_API_ORIGIN.test(url.origin)) {
    throw new CventApiError(
      "The cvent_api credential must be saved for a Cvent API platform origin.",
    );
  }
  return `${url.origin}/ea`;
}

function abortableSleep(signal?: AbortSignal) {
  return (ms: number) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(new CventApiError("Stopped.", null, false));
      const timer = setTimeout(resolve, ms);
      signal?.addEventListener(
        "abort",
        () => {
          clearTimeout(timer);
          reject(new CventApiError("Stopped.", null, false));
        },
        { once: true },
      );
    });
}

async function readJson(response: Response): Promise<unknown> {
  const length = Number(response.headers.get("content-length") ?? 0);
  if (length > MAX_RESPONSE_BYTES) return undefined;
  const text = await response.text().catch(() => "");
  if (text.length > MAX_RESPONSE_BYTES) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export class CventApi {
  private token: { value: string; expires: number } | null = null;
  private last = 0;
  private readonly sleep: (ms: number) => Promise<void>;
  constructor(
    private readonly options: {
      baseUrl: string;
      clientId: string;
      clientSecret: string;
      fetch: Fetch;
      signal?: AbortSignal;
      sleep?: (ms: number) => Promise<void>;
      now?: () => number;
      intervalMs?: number;
      onToken?: (token: string) => void;
    },
  ) {
    this.sleep = options.sleep ?? abortableSleep(options.signal);
  }

  private get now() {
    return this.options.now ?? Date.now;
  }

  private signal() {
    const timeout = AbortSignal.timeout(30_000);
    return this.options.signal ? AbortSignal.any([this.options.signal, timeout]) : timeout;
  }

  private async throttle() {
    if (this.options.signal?.aborted) throw new CventApiError("Stopped.", null, false);
    const wait = this.last + (this.options.intervalMs ?? 520) - this.now();
    if (wait > 0) await this.sleep(wait);
    this.last = this.now();
  }

  private async authorization(): Promise<string> {
    if (this.token && this.token.expires > this.now() + 60_000) return `Bearer ${this.token.value}`;
    await this.throttle();
    const basic = Buffer.from(`${this.options.clientId}:${this.options.clientSecret}`).toString(
      "base64",
    );
    let response: Response;
    try {
      response = await this.options.fetch(`${this.options.baseUrl}/oauth2/token`, {
        method: "POST",
        headers: {
          authorization: `Basic ${basic}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: this.options.clientId,
        }),
        signal: this.signal(),
      });
    } catch {
      throw new CventApiError("Cvent authentication did not complete.");
    }
    const body = (await readJson(response)) as { access_token?: unknown; expires_in?: unknown };
    if (!response.ok || typeof body?.access_token !== "string" || !body.access_token) {
      throw new CventApiError("Cvent rejected the API credential.", response.status);
    }
    this.options.onToken?.(body.access_token);
    const seconds = typeof body.expires_in === "number" ? body.expires_in : 3600;
    this.token = { value: body.access_token, expires: this.now() + seconds * 1000 };
    return `Bearer ${body.access_token}`;
  }

  /** One HTTP call. Writes are never retried here. */
  async call(method: "GET" | "POST" | "PUT", path: string, body?: unknown): Promise<unknown> {
    const authorization = await this.authorization();
    await this.throttle();
    const write = method !== "GET";
    let response: Response;
    try {
      response = await this.options.fetch(`${this.options.baseUrl}${path}`, {
        method,
        headers: {
          authorization,
          accept: "application/json",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: this.signal(),
      });
    } catch {
      throw new CventApiError(`Cvent ${method} ${path} did not complete.`, null, write);
    }
    if (response.status === 204) return null;
    const payload = await readJson(response);
    if (!response.ok) {
      // A rejected write (4xx) did not apply; anything else after a write is uncertain.
      throw new CventApiError(
        `Cvent ${method} ${path} returned HTTP ${response.status}.`,
        response.status,
        write && response.status >= 500,
      );
    }
    if (payload === undefined) {
      throw new CventApiError(
        `Cvent ${method} ${path} returned invalid JSON.`,
        response.status,
        write,
      );
    }
    return payload;
  }

  async list(path: string, filter?: string): Promise<Row[]> {
    const rows: Row[] = [];
    let token: string | undefined;
    for (let page = 0; page < 200; page++) {
      const query = new URLSearchParams({ limit: "100" });
      if (filter) query.set("filter", filter);
      if (token) query.set("token", token);
      const body = (await this.call("GET", `${path}?${query}`)) as {
        data?: unknown;
        paging?: { nextToken?: unknown };
      };
      if (!Array.isArray(body?.data)) {
        throw new CventApiError(`Cvent ${path} returned no data list.`);
      }
      for (const row of body.data as Row[]) {
        if (!row || typeof row.id !== "string" || !UUID.test(row.id)) {
          throw new CventApiError(`Cvent ${path} returned a row without a valid id.`);
        }
        rows.push(row);
      }
      token =
        typeof body.paging?.nextToken === "string" && body.paging.nextToken
          ? body.paging.nextToken
          : undefined;
      if (!token) return rows;
    }
    throw new CventApiError(`Cvent ${path} paging did not end.`);
  }
}

function desiredBody(spec: CventDiscountSpec) {
  return {
    type: "DISCOUNT_CODE",
    code: spec.code,
    name: spec.name,
    active: spec.active,
    stackable: spec.stackable,
    autoApply: false,
    audienceType: spec.audience,
    includeGuestsTowardsCapacity: spec.includeGuestsTowardsCapacity,
    method: { type: spec.method, value: spec.value },
    capacity: { total: spec.capacity },
    applyToAllAgendaItems: false,
    ...(spec.effectiveFrom ? { effectiveFrom: spec.effectiveFrom } : {}),
    ...(spec.effectiveTo ? { effectiveTo: spec.effectiveTo } : {}),
    ...(spec.note ? { note: spec.note } : {}),
  };
}

/** Fields Cvent may omit from a read; when omitted they cannot be compared. */
const OPTIONAL_READ_FIELDS = new Set([
  "stackable",
  "autoApply",
  "audienceType",
  "includeGuestsTowardsCapacity",
  "applyToAllAgendaItems",
  "note",
]);

/** Every requested field matches the saved row. */
function matches(saved: Row | undefined, wanted: Record<string, unknown>): boolean {
  if (!saved) return false;
  return Object.entries(wanted).every(([field, value]) => {
    const actual = saved[field];
    if (actual === undefined && OPTIONAL_READ_FIELDS.has(field)) return true;
    if (field === "capacity") {
      return (
        (actual as { total?: unknown } | undefined)?.total === (value as { total: number }).total
      );
    }
    if (field === "effectiveFrom" || field === "effectiveTo") {
      return typeof actual === "string" && actual.slice(0, 10) === value;
    }
    if (field === "method") {
      const m = actual as { type?: unknown; value?: unknown } | undefined;
      const w = value as { type: string; value: number };
      return m?.type === w.type && Number(m?.value) === w.value;
    }
    return isDeepStrictEqual(actual, value);
  });
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export type CventDiscountRun = {
  event: { id: string; title: string };
  outcomes: CventDiscountOutcome[];
  stoppedEarly: boolean;
};

export async function loadCventDiscounts(input: {
  api: CventApi;
  eventId: string;
  eventTitle: string;
  specs: unknown[];
  apply: boolean;
  /** New codes to create in this call; a check (apply = false) examines every code. */
  limit: number;
  sleep?: (ms: number) => Promise<void>;
  pollDelaysMs?: number[];
  /** Called after every outcome so progress survives a later failure. */
  onProgress?: (run: CventDiscountRun) => Promise<void>;
}): Promise<CventDiscountRun> {
  const { api, eventId } = input;
  if (!UUID.test(eventId)) throw new CventApiError("eventId must be the Cvent event UUID.");
  const sleep = input.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const polls = input.pollDelaysMs ?? [500, 1000, 2000, 4000, 8000, 15000];
  const event = (await api.call("GET", `/events/${eventId}`)) as { id?: unknown; title?: unknown };
  if (event?.id !== eventId || event.title !== input.eventTitle) {
    throw new CventApiError(
      "The Cvent event does not match the expected id and exact title; nothing was written.",
    );
  }
  const run: CventDiscountRun = {
    event: { id: eventId, title: input.eventTitle },
    outcomes: [],
    stoppedEarly: false,
  };
  const record = async (outcome: CventDiscountOutcome) => {
    run.outcomes.push(outcome);
    await input.onProgress?.(run);
  };
  const discountsPath = `/events/${eventId}/discounts`;
  const existing = await api.list(discountsPath);
  const items = await api.list("/admission-items", `event.id eq '${eventId}'`);
  const itemByCode = new Map<string, string>();
  for (const row of items) {
    if (typeof row.code === "string" && row.code.trim()) {
      const k = key(row.code);
      if (itemByCode.has(k)) {
        throw new CventApiError(`Admission item code ${row.code} is ambiguous in this event.`);
      }
      itemByCode.set(k, row.id);
    }
  }
  let allLinks: Row[] | null = null;
  const links = async (discountId: string, fresh = true) => {
    if (fresh || !allLinks) allLinks = await api.list(`${discountsPath}/agenda-items`);
    return allLinks
      .filter((r) => (r.discount as { id?: unknown } | undefined)?.id === discountId)
      .map((r) => r.id)
      .sort();
  };
  const poll = async <T>(read: () => Promise<T>, ok: (value: T) => boolean, what: string) => {
    for (const delay of polls) {
      await sleep(delay);
      const value = await read();
      if (ok(value)) return value;
    }
    throw new CventApiError(`${what} did not verify; stopping without replay.`, null, true);
  };
  const byCode = new Map<string, Row[]>();
  for (const row of existing) {
    if (typeof row.code === "string") {
      byCode.set(key(row.code), [...(byCode.get(key(row.code)) ?? []), row]);
    }
  }

  const seenInFile = new Set<string>();
  let processed = 0;
  for (const raw of input.specs) {
    const parsed = CventDiscountSpec.safeParse(raw);
    const rawCode = (raw as { code?: unknown })?.code;
    const code = typeof rawCode === "string" ? rawCode : "?";
    const source = (raw as { source?: unknown })?.source;
    const base = { code, ...(typeof source === "string" ? { source } : {}) };
    if (!parsed.success) {
      await record({
        ...base,
        status: "blocked",
        detail: parsed.error.issues.map((i) => i.message).join("; "),
      });
      continue;
    }
    const spec = parsed.data;
    if (seenInFile.has(key(spec.code))) {
      await record({
        ...base,
        status: "blocked",
        detail: "Code appears more than once in the work file.",
      });
      continue;
    }
    seenInFile.add(key(spec.code));
    const body = desiredBody(spec);
    const found = byCode.get(key(spec.code)) ?? [];
    if (found.length > 1) {
      await record({
        ...base,
        status: "blocked",
        detail: "More than one discount already uses this code.",
      });
      continue;
    }
    const missing = spec.admissionItems.filter((c) => !itemByCode.has(key(c)));
    if (missing.length) {
      await record({
        ...base,
        status: "blocked",
        detail: `Admission items not in this event: ${missing.join(", ")}`,
      });
      continue;
    }
    const itemIds = spec.admissionItems.map((c) => itemByCode.get(key(c))!).sort();
    const current = found[0];
    if (current) {
      if (current.level !== "EVENT" || current.type !== "DISCOUNT_CODE") {
        await record({
          ...base,
          status: "blocked",
          detail: "Code belongs to an account-level or different discount; left untouched.",
        });
        continue;
      }
      const { applyToAllAgendaItems: _scope, ...business } = body;
      const linked = await links(current.id, false);
      const same = matches(current, business) && isDeepStrictEqual(linked, itemIds);
      await record({
        ...base,
        discountId: current.id,
        status: same ? "unchanged" : "preserved_difference",
        ...(same
          ? {}
          : {
              detail:
                "Existing code differs from the RR (values or linked items); it was not modified.",
            }),
      });
      continue;
    }
    if (!input.apply) {
      await record({ ...base, status: "would_create" });
      continue;
    }
    if (processed >= input.limit) break;
    processed++;
    let createdId: string | undefined;
    try {
      const scoped = itemIds.length > 0;
      const first = scoped ? { ...body, active: false } : body;
      const created = (await api.call("POST", discountsPath, first)) as {
        id?: unknown;
        data?: { id?: unknown };
      };
      const id = (created?.data?.id ?? created?.id) as unknown;
      if (typeof id !== "string" || !UUID.test(id)) {
        throw new CventApiError("Create returned no discount id.", null, true);
      }
      createdId = id;
      const readOne = async () =>
        (await api.list(discountsPath, `id in ('${id}')`)).find((row) => row.id === id);
      await poll(readOne, (row) => matches(row, first), `Discount ${spec.code}`);
      if (scoped) {
        const expected: string[] = [];
        for (const itemId of itemIds) {
          await api.call("PUT", `${discountsPath}/${id}/agenda-items/${itemId}`);
          expected.push(itemId);
          const want = [...expected].sort();
          await poll(
            () => links(id),
            (got) => isDeepStrictEqual(got, want),
            `Link for ${spec.code}`,
          );
        }
        const finalBody = { ...body, applyToAllAgendaItems: true };
        await api.call("PUT", `${discountsPath}/${id}`, finalBody);
        await poll(readOne, (row) => matches(row, finalBody), `Final values for ${spec.code}`);
      }
      byCode.set(key(spec.code), [{ id, code: spec.code, level: "EVENT", type: "DISCOUNT_CODE" }]);
      await record({ ...base, status: "created", discountId: id });
    } catch (error) {
      const err =
        error instanceof CventApiError
          ? error
          : new CventApiError("Unexpected failure.", null, true);
      // Once the code exists, any failure leaves a partly configured discount: stop the batch.
      if (!err.uncertain && !createdId && err.message !== "Stopped.") {
        await record({ ...base, status: "blocked", detail: err.message });
        continue;
      }
      run.stoppedEarly = true;
      await record({
        ...base,
        status: createdId || err.uncertain ? "uncertain" : "blocked",
        ...(createdId ? { discountId: createdId } : {}),
        detail: `${err.message}${createdId ? " The code exists but its configuration is incomplete." : ""} Check this code in Cvent before any retry.`,
      });
      return run;
    }
  }
  return run;
}

/** Tool entry point: credential lookup, work-file read, batch run, results file. */
export async function runCventDiscountTool(input: {
  args: Record<string, unknown>;
  apply: boolean;
  loadCredential: () => Promise<{ origin: string; username: string; secret: string } | null>;
  readFile: (path: string) => Promise<Uint8Array>;
  writeFile: (path: string, content: string) => Promise<void>;
  fetch: Fetch;
  registerRedactions: (values: string[]) => void;
  signal?: AbortSignal;
  now?: () => Date;
}): Promise<unknown> {
  const eventId = String(input.args.eventId ?? "");
  const eventTitle = String(input.args.eventTitle ?? "");
  const file = String(input.args.file ?? "");
  const limit = Math.min(Math.max(Number(input.args.limit ?? 25) || 25, 1), 100);
  if (!eventId || !eventTitle || !file)
    return { error: "eventId, eventTitle and file are required." };
  const credential = await input.loadCredential();
  if (!credential) {
    return {
      error: `No ${CVENT_CREDENTIAL_NAME} credential. Save it with request_secret (basic auth: username = Cvent client ID, origin = the Cvent API platform origin).`,
    };
  }
  input.registerRedactions([credential.secret]);
  let specs: unknown[];
  let fileSha256: string;
  try {
    const bytes = await input.readFile(file);
    fileSha256 = sha256Hex(bytes);
    specs = CventDiscountFile.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    ).discounts;
  } catch {
    return { error: `Could not read ${file} as {"discounts": [...]} JSON.` };
  }
  // The approval covers this exact file: the check reports its hash, apply must quote it.
  if (input.apply && input.args.fileSha256 !== fileSha256) {
    return {
      error:
        "fileSha256 does not match the work file. Run cvent_discounts_check again and pass the hash it reports.",
    };
  }
  const stamp = (input.now?.() ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const resultsFile = `${file.replace(/\.json$/i, "")}.${input.apply ? `applied-${stamp}` : "checked"}.json`;
  const save = (run: CventDiscountRun, extra: Record<string, unknown> = {}) =>
    input.writeFile(resultsFile, `${JSON.stringify({ ...run, fileSha256, ...extra }, null, 1)}\n`);
  let run: CventDiscountRun;
  try {
    const api = new CventApi({
      baseUrl: cventBaseUrl(credential.origin),
      clientId: credential.username,
      clientSecret: credential.secret,
      fetch: input.fetch,
      signal: input.signal,
      onToken: (token) => input.registerRedactions([token]),
    });
    run = await loadCventDiscounts({
      api,
      eventId,
      eventTitle,
      specs,
      apply: input.apply,
      limit,
      sleep: abortableSleep(input.signal),
      onProgress: input.apply ? (progress) => save(progress).catch(() => undefined) : undefined,
    });
  } catch (error) {
    return { error: error instanceof CventApiError ? error.message : "Cvent request failed." };
  }
  let saved = true;
  await save(run, { complete: true }).catch(() => {
    saved = false;
  });
  const counts: Record<string, number> = {};
  for (const o of run.outcomes) counts[o.status] = (counts[o.status] ?? 0) + 1;
  const notable = run.outcomes.filter((o) => !["unchanged", "would_create"].includes(o.status));
  const remaining = specs.length - run.outcomes.length;
  return {
    event: run.event,
    fileSha256,
    counts,
    stoppedEarly: run.stoppedEarly,
    notInThisCall: remaining > 0 ? remaining : 0,
    resultsFile: saved ? resultsFile : null,
    attention: notable.slice(0, 60),
  };
}
