// Pinecone 3072-D Vector Memory Client
// Compatible with Node.js, Deno, and Edge runtimes
//
// Talks to the real Pinecone data plane over fetch — no extra dependency,
// mirroring the fetch-based style of nansenClient.ts. Configuration comes
// from the env vars already documented in .env.example:
//   PINECONE_API_KEY, PINECONE_INDEX_NAME ("edgescout-v2-memory"),
//   PINECONE_ENVIRONMENT ("us-east-1").
//
// When no PINECONE_API_KEY is set, the client runs in simulated demo mode
// (same pattern as the demo-key fallback in nansenClient.ts): calls resolve
// against a small in-memory vector store with cosine-similarity ranking, so
// the Pinecone Explorer UI and server.ts keep working offline. Nothing is
// written to a real index until a key is configured.

import type { PineconeEntry, PineconeState } from "../types/index.ts";

function getEnvVar(name: string): string | undefined {
  if (typeof process !== "undefined" && process.env && process.env[name]) {
    return process.env[name];
  }
  if (typeof (globalThis as any).Deno !== "undefined" && (globalThis as any).Deno.env) {
    return (globalThis as any).Deno.env.get(name);
  }
  return undefined;
}

export const PINECONE_DIMENSION = 3072;
export const PINECONE_INDEX_NAME =
  getEnvVar("PINECONE_INDEX_NAME") || "edgescout-v2-memory";
export const PINECONE_ENVIRONMENT =
  getEnvVar("PINECONE_ENVIRONMENT") || "us-east-1";

export type PineconeNamespace = "identity" | "strategies" | "market_signals";

export const PINECONE_NAMESPACES: PineconeNamespace[] = [
  "identity",
  "strategies",
  "market_signals",
];

const RAW_API_KEY = getEnvVar("PINECONE_API_KEY") || "";

export const isLive: boolean =
  RAW_API_KEY.length > 0 && !RAW_API_KEY.startsWith("demo_");
export const isDemo: boolean = !isLive;

export function maskedApiKey(): string {
  if (!RAW_API_KEY) return "NONE";
  if (RAW_API_KEY.length <= 8) return RAW_API_KEY.slice(0, 3) + "***";
  return RAW_API_KEY.slice(0, 4) + "..." + RAW_API_KEY.slice(-4);
}

export interface PineconeVector {
  id: string;
  values: number[];
  metadata?: Record<string, any>;
}

export interface PineconeMatch {
  id: string;
  score: number;
  values?: number[];
  metadata?: Record<string, any>;
}

export interface PineconeQueryResponse {
  matches: PineconeMatch[];
  namespace: string;
}

export interface PineconeIndexStats {
  dimension: number;
  indexFullness: number;
  totalVectorCount: number;
  namespaces: Record<string, { vectorCount: number }>;
}

export class PineconeError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(`Pinecone API Error: ${status} - ${message}`);
    this.name = "PineconeError";
    this.status = status;
  }
}

function assertDimension(values: number[]): void {
  if (values.length !== PINECONE_DIMENSION) {
    throw new Error(
      `[Pinecone] Expected a ${PINECONE_DIMENSION}-D vector, got ${values.length} dimensions.`
    );
  }
}

// ---------------------------------------------------------------------------
// Demo mode: in-memory vector store (used when no PINECONE_API_KEY is set)
// ---------------------------------------------------------------------------

interface StoredVector extends PineconeVector {
  namespace: PineconeNamespace;
  createdAt: string;
}

const demoStore = new Map<string, StoredVector>();

function demoKey(namespace: string, id: string): string {
  return `${namespace}:${id}`;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

function toEntry(vector: StoredVector): PineconeEntry {
  return {
    id: vector.id,
    vectorPreview: vector.values.slice(0, 5),
    metadata: vector.metadata || {},
    createdAt: vector.createdAt,
  };
}

// ---------------------------------------------------------------------------
// Live mode: Pinecone control plane + data plane over fetch
// ---------------------------------------------------------------------------

let cachedIndexHost: string | null = null;

async function getIndexHost(): Promise<string> {
  if (cachedIndexHost) return cachedIndexHost;
  const url = `https://api.pinecone.io/indexes/${PINECONE_INDEX_NAME}`;
  const res = await fetch(url, { headers: { "Api-Key": RAW_API_KEY } });
  if (!res.ok) {
    throw new PineconeError(res.status, await res.text());
  }
  const data = (await res.json()) as { host?: string };
  if (!data.host) {
    throw new Error(
      `[Pinecone] Index "${PINECONE_INDEX_NAME}" returned no data-plane host.`
    );
  }
  cachedIndexHost = data.host;
  console.log(`[Pinecone] Resolved index host for "${PINECONE_INDEX_NAME}".`);
  return data.host;
}

async function pineconeFetch(
  path: string,
  init: RequestInit = {},
  retries = 3
): Promise<any> {
  const host = await getIndexHost();
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(`https://${host}${path}`, {
        ...init,
        headers: {
          "Api-Key": RAW_API_KEY,
          "Content-Type": "application/json",
          ...init.headers,
        },
      });
      if (res.ok) return await res.json();
      if (res.status === 429 || res.status >= 500) {
        const backoff = 500 * (attempt + 1);
        console.warn(
          `[Pinecone] ${path} returned ${res.status}. Retrying in ${backoff}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, backoff));
        continue;
      }
      throw new PineconeError(res.status, await res.text());
    } catch (err: any) {
      if (err instanceof PineconeError) throw err;
      if (attempt === retries - 1) throw err;
      console.warn(
        `[Pinecone] Attempt ${attempt + 1} for ${path} failed (${err.message}). Retrying...`
      );
    }
  }
  throw new Error("[Pinecone] All retries exhausted.");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export async function describeIndexStats(): Promise<PineconeIndexStats> {
  if (isDemo) {
    const namespaces: Record<string, { vectorCount: number }> = {};
    let total = 0;
    for (const ns of PINECONE_NAMESPACES) {
      const count = [...demoStore.values()].filter((v) => v.namespace === ns).length;
      namespaces[ns] = { vectorCount: count };
      total += count;
    }
    return { dimension: PINECONE_DIMENSION, indexFullness: 0, totalVectorCount: total, namespaces };
  }
  const data = await pineconeFetch("/describe_index_stats", {
    method: "POST",
    body: JSON.stringify({}),
  });
  return {
    dimension: data.dimension ?? PINECONE_DIMENSION,
    indexFullness: data.indexFullness ?? 0,
    totalVectorCount: data.totalVectorCount ?? 0,
    namespaces: data.namespaces ?? {},
  };
}

export async function upsertVectors(
  namespace: PineconeNamespace,
  vectors: PineconeVector[]
): Promise<{ upsertedCount: number }> {
  vectors.forEach((v) => assertDimension(v.values));
  if (isDemo) {
    const now = new Date().toISOString();
    for (const v of vectors) {
      demoStore.set(demoKey(namespace, v.id), {
        ...v,
        namespace,
        createdAt: demoStore.get(demoKey(namespace, v.id))?.createdAt || now,
      });
    }
    console.log(
      `[Pinecone] (demo) Upserted ${vectors.length} vector(s) into /${namespace}.`
    );
    return { upsertedCount: vectors.length };
  }
  await pineconeFetch("/vectors/upsert", {
    method: "POST",
    body: JSON.stringify({ vectors, namespace }),
  });
  return { upsertedCount: vectors.length };
}

export async function queryVectors(
  namespace: PineconeNamespace,
  vector: number[],
  topK = 5,
  filter?: Record<string, any>,
  includeMetadata = true,
  includeValues = false
): Promise<PineconeQueryResponse> {
  assertDimension(vector);
  if (isDemo) {
    const matches = [...demoStore.values()]
      .filter((v) => v.namespace === namespace)
      .map((v) => ({
        id: v.id,
        score: cosineSimilarity(vector, v.values),
        values: includeValues ? v.values : undefined,
        metadata: includeMetadata ? v.metadata : undefined,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    return { matches, namespace };
  }
  const data = await pineconeFetch("/query", {
    method: "POST",
    body: JSON.stringify({
      vector,
      topK,
      namespace,
      includeMetadata,
      includeValues,
      ...(filter ? { filter } : {}),
    }),
  });
  return { matches: data.matches ?? [], namespace: data.namespace ?? namespace };
}

export async function fetchVectors(
  namespace: PineconeNamespace,
  ids: string[]
): Promise<PineconeVector[]> {
  if (ids.length === 0) return [];
  if (isDemo) {
    return ids
      .map((id) => demoStore.get(demoKey(namespace, id)))
      .filter(Boolean)
      .map((v) => ({ id: v!.id, values: v!.values, metadata: v!.metadata }));
  }
  const query = ids.map((id) => `ids=${encodeURIComponent(id)}`).join("&");
  const data = await pineconeFetch(
    `/vectors/fetch?${query}&namespace=${encodeURIComponent(namespace)}`,
    { method: "GET" }
  );
  return Object.values(data.vectors ?? {}).map((v: any) => ({
    id: v.id,
    values: v.values,
    metadata: v.metadata,
  }));
}

export async function deleteVectors(
  namespace: PineconeNamespace,
  ids: string[]
): Promise<{ deletedCount: number }> {
  if (ids.length === 0) return { deletedCount: 0 };
  if (isDemo) {
    let deleted = 0;
    for (const id of ids) {
      if (demoStore.delete(demoKey(namespace, id))) deleted++;
    }
    return { deletedCount: deleted };
  }
  await pineconeFetch("/vectors/delete", {
    method: "POST",
    body: JSON.stringify({ ids, namespace }),
  });
  return { deletedCount: ids.length };
}

async function listVectorIds(
  namespace: PineconeNamespace,
  limit = 100
): Promise<string[]> {
  if (isDemo) {
    return [...demoStore.values()]
      .filter((v) => v.namespace === namespace)
      .map((v) => v.id)
      .slice(0, limit);
  }
  const data = await pineconeFetch(
    `/vectors/list?namespace=${encodeURIComponent(namespace)}&limit=${limit}`,
    { method: "GET" }
  );
  return (data.vectors ?? []).map((v: any) => v.id);
}

// Store one memory (identity rule, learned strategy, or market signal) as a
// 3072-D vector. Returns the record in the PineconeEntry shape the
// Pinecone Explorer UI already renders.
export async function storeMemory(
  namespace: PineconeNamespace,
  id: string,
  values: number[],
  metadata: Record<string, any>
): Promise<PineconeEntry> {
  await upsertVectors(namespace, [{ id, values, metadata }]);
  const entry: PineconeEntry = {
    id,
    vectorPreview: values.slice(0, 5),
    metadata,
    createdAt: new Date().toISOString(),
  };
  console.log(`[Pinecone] Memory stored in /${namespace} (ID: ${id}).`);
  return entry;
}

// Full memory map in the PineconeState shape used by PineconeExplorer and
// server.ts (GET /api/pinecone/state). Falls back to empty namespaces when
// the live list endpoint is unavailable.
export async function getMemoryState(): Promise<PineconeState> {
  const state: PineconeState = {
    dimension: PINECONE_DIMENSION,
    namespaces: { identity: [], strategies: [], market_signals: [] },
  };
  for (const ns of PINECONE_NAMESPACES) {
    try {
      const ids = await listVectorIds(ns);
      const vectors = await fetchVectors(ns, ids);
      state.namespaces[ns] = vectors.map((v) => ({
        id: v.id,
        vectorPreview: v.values.slice(0, 5),
        metadata: v.metadata || {},
        createdAt: new Date().toISOString(),
      }));
    } catch (err: any) {
      console.warn(
        `[Pinecone] Could not list /${ns} (${err.message}). Returning an empty namespace.`
      );
      state.namespaces[ns] = [];
    }
  }
  return state;
}

// Test the connection on boot: true when the index answers, false otherwise.
export async function testConnection(): Promise<boolean> {
  try {
    await describeIndexStats();
    console.log(
      `[Pinecone] Connected to "${PINECONE_INDEX_NAME}" (${isLive ? "live" : "demo"} mode, key ${maskedApiKey()}).`
    );
    return true;
  } catch (err: any) {
    console.warn(`[Pinecone] Connection failed: ${err.message}`);
    return false;
  }
}
