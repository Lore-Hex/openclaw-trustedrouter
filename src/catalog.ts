/**
 * TrustedRouter model catalog.
 *
 * The public catalog at GET /v1/models needs no key and is OpenRouter-shaped.
 * It is larger than OpenClaw's generic live-discovery response cap (4 MiB),
 * so this plugin fetches and maps it itself, caches it in memory, and falls
 * back to the static catalog in openclaw.plugin.json on any failure.
 */

export type ModelDefinition = {
  id: string;
  name: string;
  reasoning: boolean;
  input: Array<"text" | "image">;
  contextWindow: number;
  maxTokens: number;
  cost: { input: number; output: number; cacheRead: number; cacheWrite: number };
};

export type ProviderConfig = {
  baseUrl: string;
  api: "openai-completions";
  apiKey?: string;
  models: ModelDefinition[];
};

type CatalogRow = {
  id?: unknown;
  name?: unknown;
  context_length?: unknown;
  architecture?: { input_modalities?: unknown };
  top_provider?: { max_completion_tokens?: unknown };
  pricing?: { prompt?: unknown; completion?: unknown; input_cache_read?: unknown; input_cache_write?: unknown };
  supported_parameters?: unknown;
};

export const DEFAULT_MAX_TOKENS = 8192;
export const CACHE_TTL_MS = 60 * 60 * 1000;

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Converts a per-token USD price string to USD per million tokens. */
function perMillion(value: unknown): number {
  const n = typeof value === "string" || typeof value === "number" ? Number(value) : NaN;
  return Number.isFinite(n) && n > 0 ? Math.round(n * 1e6 * 1e6) / 1e6 : 0;
}

export function mapCatalogRow(row: CatalogRow): ModelDefinition | undefined {
  if (typeof row.id !== "string" || row.id.length === 0) return undefined;
  const modalities = Array.isArray(row.architecture?.input_modalities)
    ? row.architecture.input_modalities
    : ["text"];
  const params = Array.isArray(row.supported_parameters) ? row.supported_parameters : [];
  const contextWindow = positiveInt(row.context_length, 128000);
  return {
    id: row.id,
    name: typeof row.name === "string" && row.name ? row.name : row.id,
    reasoning: params.includes("reasoning"),
    input: modalities.includes("image") ? ["text", "image"] : ["text"],
    contextWindow,
    maxTokens: Math.min(
      positiveInt(row.top_provider?.max_completion_tokens, DEFAULT_MAX_TOKENS),
      contextWindow,
    ),
    cost: {
      input: perMillion(row.pricing?.prompt),
      output: perMillion(row.pricing?.completion),
      cacheRead: perMillion(row.pricing?.input_cache_read),
      cacheWrite: perMillion(row.pricing?.input_cache_write),
    },
  };
}

export function mapCatalog(body: unknown): ModelDefinition[] {
  const data = (body as { data?: unknown } | null)?.data;
  if (!Array.isArray(data)) throw new Error("TrustedRouter /models response has no data array");
  const byId = new Map<string, ModelDefinition>();
  for (const row of data) {
    const model = mapCatalogRow(row as CatalogRow);
    if (model) byId.set(model.id, model);
  }
  return [...byId.values()];
}

let cache: { url: string; at: number; models: ModelDefinition[] } | undefined;

export function clearCatalogCache(): void {
  cache = undefined;
}

export async function fetchTrustedRouterModels(params: {
  baseUrl: string;
  fetchImpl?: typeof fetch;
  now?: () => number;
  signal?: AbortSignal;
}): Promise<ModelDefinition[]> {
  const url = `${params.baseUrl.replace(/\/+$/, "")}/models`;
  const now = (params.now ?? Date.now)();
  if (cache && cache.url === url && now - cache.at < CACHE_TTL_MS) return cache.models;
  const response = await (params.fetchImpl ?? fetch)(url, {
    headers: { accept: "application/json" },
    signal: params.signal,
  });
  if (!response.ok) throw new Error(`TrustedRouter /models returned HTTP ${response.status}`);
  const models = mapCatalog(await response.json());
  if (models.length === 0) throw new Error("TrustedRouter /models returned no models");
  cache = { url, at: now, models };
  return models;
}
