# openclaw-trustedrouter

[![Test](https://github.com/Lore-Hex/openclaw-trustedrouter/actions/workflows/test.yml/badge.svg)](https://github.com/Lore-Hex/openclaw-trustedrouter/actions/workflows/test.yml)

[OpenClaw](https://github.com/openclaw/openclaw) provider plugin for [TrustedRouter](https://trustedrouter.com), an OpenAI-compatible LLM router.

## Install

```bash
openclaw plugins install clawhub:@lore-hex/openclaw-trustedrouter
# or from npm
openclaw plugins install npm:@lore-hex/openclaw-trustedrouter
```

## Configure

Set `TRUSTEDROUTER_API_KEY`, or run onboarding and pick **TrustedRouter API key**:

```bash
export TRUSTEDROUTER_API_KEY=...
# or
openclaw onboard --trustedrouter-api-key "$TRUSTEDROUTER_API_KEY"
```

- Base URL: `https://api.trustedrouter.com/v1` (`openai-completions` API)
- Default model: `trustedrouter/auto`

## Models

With a key configured, the plugin loads the public catalog from `GET https://api.trustedrouter.com/v1/models` (no key is sent for this request) and caches it in memory for an hour. TrustedRouter model IDs are fully prefixed (`trustedrouter/auto`, `openai/gpt-4o-mini`, ...). If the catalog cannot be fetched, a small static catalog (`trustedrouter/auto`, `cheap`, `fast`, `zdr`) from `openclaw.plugin.json` is used.

The catalog is fetched by the plugin rather than OpenClaw's generic live discovery because the full response is larger than that path's 4 MiB response cap.

## Verifying the gateway

The gateway runs as an attested Google Confidential Space workload. The attestation is at https://api.trustedrouter.com/attestation and the verification procedure at https://trustedrouter.com/trust (source: https://github.com/Lore-Hex/quill-cloud-proxy).

## Development

Requires Node 24.16+ (or 26.1+).

```bash
npm ci --ignore-scripts
npm test        # builds to dist/ and runs vitest; no network access
npm pack --dry-run
```

Built against OpenClaw `2026.9.9` (`openclaw.compat` / `openclaw.build` in `package.json`).
