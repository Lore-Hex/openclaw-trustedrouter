/**
 * TrustedRouter provider plugin for OpenClaw.
 *
 * TrustedRouter is an OpenAI-compatible router. With a key configured, the
 * model list comes from https://api.trustedrouter.com/v1/models; the static
 * catalog in openclaw.plugin.json is used before a key exists and as a
 * fallback when the catalog cannot be fetched.
 */
import { createRequire } from "node:module";
import { defineSingleProviderPluginEntry } from "openclaw/plugin-sdk/provider-entry";
import { fetchTrustedRouterModels, type ProviderConfig } from "./catalog.js";

const requireJson = createRequire(import.meta.url);
// Resolved relative to both src/ (tests) and dist/ (published build).
export const manifest = requireJson("../openclaw.plugin.json");

export const TRUSTEDROUTER_PROVIDER_ID = "trustedrouter";
const STATIC_CATALOG = manifest.modelCatalog.providers.trustedrouter;
export const TRUSTEDROUTER_BASE_URL: string = STATIC_CATALOG.baseUrl;
export const TRUSTEDROUTER_DEFAULT_MODEL: string = STATIC_CATALOG.defaultModel;

export function buildStaticProvider(): ProviderConfig {
  return {
    baseUrl: TRUSTEDROUTER_BASE_URL,
    api: "openai-completions",
    models: STATIC_CATALOG.models.map(
      (m: Omit<ProviderConfig["models"][number], "reasoning"> & { reasoning?: boolean }) => ({
        ...m,
        reasoning: m.reasoning ?? false,
      }),
    ),
  };
}

type CatalogContext = {
  providerIds?: string[];
  signal?: AbortSignal;
  resolveProviderApiKey: (providerId: string) => { apiKey?: string };
};

export async function runTrustedRouterCatalog(
  ctx: CatalogContext,
  fetchImpl?: typeof fetch,
): Promise<{ provider: ProviderConfig } | null> {
  if (ctx.providerIds !== undefined && !ctx.providerIds.includes(TRUSTEDROUTER_PROVIDER_ID)) {
    return null;
  }
  const apiKey = ctx.resolveProviderApiKey(TRUSTEDROUTER_PROVIDER_ID).apiKey;
  if (!apiKey) return null;
  const provider = buildStaticProvider();
  try {
    provider.models = await fetchTrustedRouterModels({
      baseUrl: provider.baseUrl,
      fetchImpl,
      signal: ctx.signal,
    });
  } catch {
    // Keep the static catalog.
  }
  return { provider: { ...provider, apiKey } };
}

export default defineSingleProviderPluginEntry({
  id: TRUSTEDROUTER_PROVIDER_ID,
  name: "TrustedRouter Provider",
  description: "TrustedRouter model provider (OpenAI-compatible)",
  manifest,
  provider: {
    label: "TrustedRouter",
    catalog: {
      order: "simple",
      run: (ctx) => runTrustedRouterCatalog(ctx as CatalogContext),
      staticRun: async () => ({ provider: buildStaticProvider() }),
    },
  },
});
