import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import entry, {
  buildStaticProvider,
  runTrustedRouterCatalog,
  TRUSTEDROUTER_BASE_URL,
  TRUSTEDROUTER_DEFAULT_MODEL,
} from "../src/index.js";
import { CACHE_TTL_MS, clearCatalogCache, fetchTrustedRouterModels, mapCatalog } from "../src/catalog.js";

const CATALOG = {
  data: [
    {
      id: "trustedrouter/auto",
      name: "TrustedRouter Auto",
      context_length: 200000,
      architecture: { input_modalities: ["text"] },
      top_provider: { max_completion_tokens: null },
      pricing: { prompt: "0.000000047475", completion: "0.00000009495" },
      supported_parameters: ["max_tokens"],
    },
    {
      id: "openai/gpt-4o-mini",
      name: "GPT-4o mini",
      context_length: 128000,
      architecture: { input_modalities: ["text", "image"] },
      top_provider: { max_completion_tokens: 16384 },
      pricing: { prompt: "0.00000015", completion: "0.0000006" },
      supported_parameters: ["tools", "reasoning"],
    },
    { name: "row without id is skipped" },
  ],
};

function jsonFetch(body: unknown, status = 200) {
  return vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }),
  );
}

function captureRegistrations() {
  const calls: Record<string, unknown[][]> = {};
  const base = { id: "trustedrouter", config: {}, pluginConfig: {}, logger: console, registrationMode: "full" };
  const api = new Proxy(base, {
    get(target, key: string) {
      if (key in target) return (target as Record<string, unknown>)[key];
      return (...args: unknown[]) => {
        (calls[key] ??= []).push(args);
      };
    },
  });
  entry.register(api);
  return calls;
}

beforeEach(() => clearCatalogCache());

describe("manifest and package", () => {
  const manifest = JSON.parse(readFileSync(new URL("../openclaw.plugin.json", import.meta.url), "utf8"));
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

  it("declares the provider, env var and auth choice", () => {
    expect(manifest.id).toBe("trustedrouter");
    expect(manifest.providers).toEqual(["trustedrouter"]);
    expect(manifest.setup.providers[0]).toEqual({ id: "trustedrouter", envVars: ["TRUSTEDROUTER_API_KEY"] });
    expect(manifest.providerAuthChoices[0]).toMatchObject({ provider: "trustedrouter", method: "api-key" });
  });

  it("has the ClawHub-required package metadata", () => {
    expect(pkg.openclaw.extensions).toEqual(["./dist/index.js"]);
    expect(pkg.openclaw.compat.pluginApi).toBeTruthy();
    expect(pkg.openclaw.build.openclawVersion).toBeTruthy();
    expect(pkg.files).toContain("openclaw.plugin.json");
  });

  it("uses fully prefixed TrustedRouter model ids", () => {
    expect(TRUSTEDROUTER_BASE_URL).toBe("https://api.trustedrouter.com/v1");
    expect(TRUSTEDROUTER_DEFAULT_MODEL).toBe("trustedrouter/auto");
    for (const model of buildStaticProvider().models) expect(model.id).toMatch(/^trustedrouter\//);
  });
});

describe("plugin registration", () => {
  it("registers one text provider with API-key auth", () => {
    const calls = captureRegistrations();
    expect(calls.registerProvider).toHaveLength(1);
    const provider = calls.registerProvider[0][0] as {
      id: string;
      label: string;
      envVars: string[];
      auth: Array<{ id: string; kind: string }>;
      staticCatalog: { run: () => Promise<{ provider: { baseUrl: string; models: unknown[] } }> };
    };
    expect(provider.id).toBe("trustedrouter");
    expect(provider.label).toBe("TrustedRouter");
    expect(provider.envVars).toEqual(["TRUSTEDROUTER_API_KEY"]);
    expect(provider.auth.map((a) => [a.id, a.kind])).toEqual([["api-key", "api_key"]]);
    expect(calls.registerModelCatalogProvider[0][0]).toMatchObject({ provider: "trustedrouter", kinds: ["text"] });
  });

  it("serves the static catalog without a key or network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const calls = captureRegistrations();
    const provider = calls.registerProvider[0][0] as {
      staticCatalog: { run: (ctx: unknown) => Promise<{ provider: { baseUrl: string; models: Array<{ id: string }> } }> };
    };
    const result = await provider.staticCatalog.run({});
    expect(result.provider.baseUrl).toBe("https://api.trustedrouter.com/v1");
    expect(result.provider.models.map((m) => m.id)).toContain("trustedrouter/auto");
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe("live catalog", () => {
  const ctx = (apiKey?: string, providerIds?: string[]) => ({
    providerIds,
    resolveProviderApiKey: (id: string) => {
      expect(id).toBe("trustedrouter");
      return { apiKey };
    },
  });

  it("maps /v1/models rows to OpenClaw model definitions", () => {
    const models = mapCatalog(CATALOG);
    expect(models.map((m) => m.id)).toEqual(["trustedrouter/auto", "openai/gpt-4o-mini"]);
    expect(models[0]).toMatchObject({ input: ["text"], reasoning: false, contextWindow: 200000, maxTokens: 8192 });
    expect(models[0].cost.input).toBeCloseTo(0.047475);
    expect(models[1]).toMatchObject({ input: ["text", "image"], reasoning: true, maxTokens: 16384 });
    expect(models[1].cost).toEqual({ input: 0.15, output: 0.6, cacheRead: 0, cacheWrite: 0 });
  });

  it("returns nothing without a key and does not fetch", async () => {
    const fetchImpl = jsonFetch(CATALOG);
    expect(await runTrustedRouterCatalog(ctx(undefined), fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("skips when another provider is selected", async () => {
    const fetchImpl = jsonFetch(CATALOG);
    expect(await runTrustedRouterCatalog(ctx("k", ["openai"]), fetchImpl)).toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fetches the public catalog once, without sending the key", async () => {
    const fetchImpl = jsonFetch(CATALOG);
    const result = await runTrustedRouterCatalog(ctx("test-key"), fetchImpl);
    expect(result?.provider).toMatchObject({
      baseUrl: "https://api.trustedrouter.com/v1",
      api: "openai-completions",
      apiKey: "test-key",
    });
    expect(result?.provider.models.map((m) => m.id)).toEqual(["trustedrouter/auto", "openai/gpt-4o-mini"]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://api.trustedrouter.com/v1/models");
    expect(JSON.stringify(init?.headers)).not.toContain("test-key");
    await runTrustedRouterCatalog(ctx("test-key"), fetchImpl);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("refetches after the cache TTL", async () => {
    const fetchImpl = jsonFetch(CATALOG);
    let t = 1_000;
    await fetchTrustedRouterModels({ baseUrl: TRUSTEDROUTER_BASE_URL, fetchImpl, now: () => t });
    t += CACHE_TTL_MS + 1;
    await fetchTrustedRouterModels({ baseUrl: TRUSTEDROUTER_BASE_URL, fetchImpl, now: () => t });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("falls back to the static catalog when the fetch fails", async () => {
    const result = await runTrustedRouterCatalog(ctx("test-key"), jsonFetch({ error: "x" }, 503));
    expect(result?.provider.models.map((m) => m.id)).toEqual(buildStaticProvider().models.map((m) => m.id));
    expect(result?.provider.apiKey).toBe("test-key");
  });

  it("falls back on a malformed body", async () => {
    const result = await runTrustedRouterCatalog(ctx("test-key"), jsonFetch({ nope: [] }));
    expect(result?.provider.models.length).toBe(buildStaticProvider().models.length);
  });
});
