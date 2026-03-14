import { IDEM_TTL_MS } from "../config/env.js";

type IdempotencyRecord = {
  fingerprint: string;
  status: number;
  responseBody: unknown;
  createdAt: number;
};

export const idempotencyStore = new Map<string, IdempotencyRecord>();

const stableJson = (value: unknown): string => {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => stableJson(v)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableJson(v)}`).join(",")}}`;
};

const v2MutationFingerprint = (routeKey: string, body: unknown): string => {
  return `${routeKey}:${stableJson(body)}`;
};

const pruneIdempotencyStore = (now = Date.now()) => {
  for (const [key, row] of idempotencyStore.entries()) {
    if (now - row.createdAt > IDEM_TTL_MS) idempotencyStore.delete(key);
  }
};

const getIdempotencyKey = (req: any): string | null => {
  const raw =
    req?.header?.("Idempotency-Key") ||
    req?.header?.("idempotency-key") ||
    req?.headers?.["idempotency-key"] ||
    req?.body?.idempotency_key;
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  return key.length ? key : null;
};

export const idempotencyPrecheck = (req: any, routeKey: string, payload: unknown):
  | { type: "none" }
  | { type: "replay"; status: number; body: unknown }
  | { type: "conflict"; message: string }
  | { type: "fresh"; key: string; fingerprint: string } => {
  pruneIdempotencyStore();
  const key = getIdempotencyKey(req);
  if (!key) return { type: "none" };

  const fingerprint = v2MutationFingerprint(routeKey, payload);
  const existing = idempotencyStore.get(key);
  if (!existing) return { type: "fresh", key, fingerprint };

  if (existing.fingerprint !== fingerprint) {
    return {
      type: "conflict",
      message: "Idempotency key reuse with different request parameters"
    };
  }

  return { type: "replay", status: existing.status, body: existing.responseBody };
};

export const idempotencyPersist = (key: string, fingerprint: string, status: number, body: unknown) => {
  idempotencyStore.set(key, {
    fingerprint,
    status,
    responseBody: body,
    createdAt: Date.now()
  });
};
