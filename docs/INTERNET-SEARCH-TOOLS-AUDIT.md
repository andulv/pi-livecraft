# Internet-search tooling audit

**Date:** 2026-09-09  
**Scope:** Pi packages/extensions available in this environment, effective configuration, live smoke tests, and upgrade status. This is research only; no configuration or package changes were made.

## Executive summary

Two overlapping web-research packages are installed in the Pi user profile:

1. **`pi-ketch` 0.1.6** — the broad, native Ketch adapter. It exposes five tools: `ketch_search`, `ketch_scrape`, `ketch_crawl`, `ketch_code`, and `ketch_docs`. It uses a local `ketch` CLI rather than an MCP daemon.
2. **`pi-gpt-search` 1.1.0** — the Codex-backed adapter. It exposes `codex-search`, `codex-research`, and the deprecated `web` alias, plus `/gpt-search`. It reuses Codex authentication and calls OpenAI's standalone search service.

Both packages are listed in `/home/anders/.pi/agent/settings.json`, so they are installed/enabled at the package level. `pi-ketch` is the only one represented in the current `tools.json` active list. The Codex tools were callable in this audit session, but this discrepancy should be resolved before implementation: it may reflect separate host-tool registration rather than Pi's package resource selection.

The main duplication is **web search**: `ketch_search` and `codex-search` both provide single-query search. `codex-research` and Ketch's scrape/crawl surfaces are complementary rather than identical: Codex research has an iterative browser-like document workflow (`search`, `open`, `find`, `click`), while Ketch separates search, URL extraction, and bounded same-host crawling.

## Installed packages and ownership

Evidence: `/home/anders/.pi/agent/settings.json`, `pi list`, and the installed package manifests.

| Package | Installed | Enabled resources | Main capability | Requirement/status |
|---|---:|---|---|---|
| `pi-ketch` | 0.1.6 | 1 extension + bundled skill | Search, scrape, crawl, public code search, library docs | Ketch 0.11+; installed Ketch is 0.12.0 |
| `pi-gpt-search` | 1.1.0 | 1 extension | Codex-backed search/research + `/gpt-search` | Requires usable Codex login; live tool call succeeded |
| `pi-mcp-adapter` | 2.32.1 | 1 extension | Generic MCP gateway; can expose search MCP servers if configured | No MCP servers are configured/connected in this session |
| `@ff-labs/pi-fff` | 0.10.6 | 1 extension | Local fuzzy file/content search, not internet search | Out of scope for web-tool consolidation |

The project itself (`server/pi-process.ts`) loads only its own Livecraft extensions and the `livecraft-browser` skill into persistent sessions. The user-level Pi package settings are therefore the relevant source for the internet-search packages.

## What is configured

### Ketch

Read-only `ketch config` reported:

- default backend: **Brave**
- Brave API key: **set** (one key)
- default limit: 5
- cache TTL: 72h
- code backend: **grep.app**
- docs backend: **Context7**, but no Context7 key
- Sourcegraph URL: configured
- GitHub token: absent
- browser: not configured/disabled
- cookies: not configured

`ketch doctor` found:

| Surface/backend | Result |
|---|---|
| Brave search | OK |
| DuckDuckGo search | OK |
| SearXNG | Unreachable (`localhost:8081` refused) |
| Exa search | OK in doctor, but not the selected default |
| Firecrawl search | No key |
| Keenable search | OK in doctor |
| grep.app code search | OK |
| Sourcegraph code search | OK |
| GitHub code search | No token |
| Context7 docs | No key |
| Browser rendering | Skipped; not configured |
| Ketch cache | OK; 526 entries / 16.0 MB |

The configured SearXNG URL is a stale/non-running local endpoint, and Context7/GitHub/Firecrawl are unavailable unless an operator configures them. No keys were copied or exposed.

### Codex search

`codex --version` reported **0.147.0**. The Codex-backed search and research calls succeeded using the current Codex session. The package documentation says the adapter sends only the query/research actions, not conversation history, files, or system prompts, and claims zero GPT inference turns; that claim was not independently network-instrumented in this audit.

The deprecated `web` alias also worked, but returned a deprecation notice and the same research result shape. It should not be retained in any future tool surface unless compatibility is required.

### MCP

The MCP gateway status was **0 servers / 0 tools**. There is no configured MCP search server currently contributing duplicate internet tools.

## Live smoke-test results

All tests used small bounded requests.

| Test | Result | Notes |
|---|---|---|
| `ketch_search("latest stable Node.js release official")` | **Pass** | Returned Node.js official release pages; used configured Brave default |
| `ketch_search(..., allBackends: true)` | **Pass** | Returned fused results and identified usable backends as Brave, DDG, and Keenable for that call |
| `ketch_scrape(https://pi.dev/packages/pi-ketch)` | **Pass** | Returned cleaned Markdown; bounded at 2,500 chars and visibly truncated |
| `ketch_crawl(https://pi.dev/packages/pi-ketch, depth 1, maxPages 3)` | **Pass** | Returned one seed page, with crawl notice: 1 page, 0 errors |
| `ketch_code(..., grepapp default)` | **Pass/empty** | A generic `ketch_search` code query returned no public results; doctor separately confirmed grep.app and Sourcegraph availability |
| `ketch_code(..., backend: github)` | **Expected failure** | Requires GitHub token; error gave `gh auth login` / token remedies |
| `ketch_docs(resolve React)` | **Expected failure** | Context7 key missing; error gave operator setup command |
| `codex-search(Node.js release)` | **Pass** | Returned structured official Node.js URLs/snippets |
| `codex-research(Node.js release)` | **Pass** | Returned iterative-research-formatted result set and citations |
| deprecated `web` | **Pass with warning** | Same research path, prepended deprecation notice |

### Practical differences observed

- **Ketch search:** provider-selectable, cached, bounded, and operator-controlled. Normal calls use one configured backend; `allBackends` is available for deeper/federated research.
- **Codex search:** one OpenAI/Codex retrieval path, no Ketch provider configuration, and convenient for users already authenticated to Codex.
- **Ketch scrape/crawl:** explicit URL extraction and same-host bounded crawling. Browser rendering is optional and currently unavailable.
- **Codex research:** one tool can perform multi-step search/open/find/click work and maintains document references within the research call sequence.
- **Ketch docs:** specialized Context7 library documentation, currently unavailable because no key is configured.
- **Ketch code:** specialized public OSS search through grep.app/Sourcegraph, with GitHub as an optional authenticated backend.

## Upgrade status

Versions were checked against npm's live registry on 2026-09-09:

| Component | Installed | Latest reported | Actionable? |
|---|---:|---:|---|
| `pi-ketch` | 0.1.6 | 0.1.6 | No package upgrade |
| `pi-gpt-search` | 1.1.0 | 1.1.0 | No package upgrade |
| `pi-mcp-adapter` | 2.32.1 | 2.32.1 | No package upgrade |
| `@ff-labs/pi-fff` | 0.10.6 | 0.10.6 | No package upgrade |
| `@earendil-works/pi-coding-agent` | 0.84.4 | 0.85.1 | **Upgrade available** |
| Ketch CLI | 0.12.0 | Not checked via npm (Homebrew binary) | Already newer than `pi-ketch` minimum 0.11 |

The installed project runtime reports Node.js v22.22.2, while the repository's `package.json` declares Node `>=24`; this is a general environment mismatch worth resolving separately, not a search-package upgrade.

## Other available Pi search packages

The Pi package catalog currently lists many alternatives, including `pi-web-search` (catalog version 1.5.0), `pi-web-access`, `pi-search-multi`, `pi-smart-web-search`, and `@bytetrue/pi-web-search`. These are **not installed here**. The catalog descriptions show substantial overlap, especially for packages that combine search and fetch across many providers. Installing one would increase rather than reduce the current context/tool surface unless it replaces an existing package after a deliberate comparison.

## Discussion points before implementation

1. **Likely simplest consolidation:** keep `pi-ketch` as the general-purpose web surface and disable the overlapping `pi-gpt-search` tools, unless Codex-only search quality/cost is materially preferred.
2. **Alternative:** keep only `pi-gpt-search` for minimal web-search surface; accept loss of Ketch's provider choice, caching, crawl, code search, and library-doc surfaces.
3. **Middle ground:** retain both packages installed but disable duplicate `codex-search` and deprecated `web`; keep `codex-research` only if its iterative document workflow is used. This requires checking whether Pi package resource configuration supports per-tool disablement cleanly.
4. **Do not enable missing optional services by default:** Context7, GitHub code search, browser rendering, and SearXNG add capability but also configuration/context and operational cost.
5. **First cleanup target:** remove the deprecated `web` alias from the active tool surface. It adds no capability over `codex-research` and emits a warning on every use.
6. **Before editing settings:** verify the `tools.json` discrepancy in a fresh Pi session and measure actual system-context contribution from package skills/tool schemas. The Ketch skill is useful routing guidance, but its full text is additional persistent context.

## Context-cost follow-up

A clean, non-project Pi process was started with the installed user packages and a temporary read-only introspection extension. It reported 20 registered tools, of which all eight internet tools were active. The measurements below use Pi's own tool metadata and JSON serialization; provider serialization adds some wrapper overhead.

| Persistent contribution | Measured characters |
|---|---:|
| Eight internet tool definitions (`ketch_*`, `codex-*`, `web`) | 10,054 |
| Their active `promptGuidelines` | 4,566 |
| Ketch skill catalogue entry (name + description) | 433 |
| **Search-specific subtotal** | **15,053** |

The assembled system prompt in that clean process was 9,318 characters before tool schemas; internet-tool guidelines alone were 49% of it. Adding the separately transmitted tool definitions gives about 19,372 characters of system prompt plus schemas, of which roughly 15,053 are attributable to internet search. A tokenizer-dependent estimate is approximately 3,500–4,500 tokens paid on every model request even when no search occurs.

The current instructions duplicate routing at several levels:

- tool descriptions and JSON schemas;
- 4,566 characters of active tool-specific guidelines;
- the always-visible Ketch skill description;
- the full Ketch skill after it is loaded;
- overlapping Codex research workflow instructions;
- the deprecated `web` definition, which duplicates `codex-research` almost exactly.

Pi's native dynamic-tool support is directly applicable. An extension may register tools but keep them inactive, leaving one small loader active. When the loader adds tools, GPT-5.4+ receives them through OpenAI's native deferred tool-search representation. Other providers, including GLM unless its endpoint gains equivalent support, receive the newly active definitions normally on the next request. Inactive tools do not contribute their schemas or active-only guidelines.

## Subscription-backed options

### OpenAI/Codex

Official Codex documentation says local Codex chats include first-party hosted web search, cached by default and optionally live. That capability belongs to the Codex runtime. It is not automatically exposed as a callable tool inside Pi merely because Pi uses an `openai-codex` model.

The installed `pi-gpt-search` does expose it to Pi, but the package documents that it was extracted from Codex's standalone search endpoint. This creates a maintenance and policy risk compared with a documented integration surface. Its `web` alias is also already deprecated. I would not make this package the long-term foundation.

### Z.AI/GLM Coding Plan

Z.AI officially includes remote **Web Search MCP** and **Web Reader MCP** services in every Coding Plan. They use the existing Coding Plan API key and are explicitly documented for MCP-compatible clients. A live, credential-safe smoke test confirmed this account's entitlement:

- `web_search_prime` advertised search query, domain, recency, summary-size, and region parameters; a live query returned cited URL/title/summary records.
- `webReader` advertised URL, timeout, cache, Markdown/text, image, and link options. The server initialized and advertised the tool successfully; the minimal `example.com` call returned no text block, so extraction quality still needs a representative-page acceptance test before relying on it exclusively.

This is the simplest supported subscription path because it needs one existing credential and no new search-vendor account. The MCP adapter is already installed and current.

## Recommended target design

### Recommendation: one progressive-disclosure internet capability

Build a very small local Pi package, tentatively `livecraft-internet`, containing:

1. **One skill: `internet-research`.** Its always-visible description should be one or two sentences. The loaded `SKILL.md` owns all routing, citation, trust, bounding, and fallback instructions. Detailed provider notes belong in skill references, not global agent instructions.
2. **One always-active loader tool: `load_internet_tools`.** It accepts a capability such as `search`, `read`, or `deep-research` and additively activates only the required dormant tools with `pi.setActiveTools()`.
3. **Two normal dormant tools:** `web_search` and `web_read`. Keep names and parameters provider-neutral. Most work needs only these two. Domain and recency filters belong on search; URL, format, character bound, and optional link extraction belong on read.
4. **No permanent provider-routing prose.** The skill selects defaults and explains exceptional overrides only after internet work is requested.

The persistent 90%-case cost then becomes only the short skill catalogue entry plus the small loader schema—likely hundreds of characters instead of about 15,000. Once loaded, the model gets only the one or two schemas it needs.

### Backend policy

Use a deliberately short routing policy:

1. **Primary: Z.AI Web Search MCP + Web Reader MCP.** These are official Coding Plan benefits, cover the common search/read pair, and reuse one existing credential.
2. **Fallback: Ketch, narrowly configured.** Keep Ketch available initially for retrieval failures, bounded crawling, public-code search, and provider comparison. Use its already-working Brave default and grep.app/Sourcegraph surfaces; do not add Context7, GitHub, Firecrawl, browser, or more keys unless a measured need appears.
3. **OpenAI/Codex: optional, not default.** Remove `pi-gpt-search` from the normal runtime. Reconsider OpenAI when Pi has a documented first-party way to expose provider-hosted search, or when a maintained extension uses an official supported interface. Codex CLI search can remain a manual/operator fallback, not an always-present Pi tool.

Provider selection should normally be hidden. An advanced `provider: auto | zai | ketch` option can exist for diagnosis and comparisons, but agents should use `auto` unless the user asks for a provider or the primary fails. Do not expose every backend Ketch knows about in the common schema.

### Why not the obvious alternatives?

- **Ketch alone:** operationally solid and broad, but five permanent tools plus extensive instructions caused much of the measured clutter; it also introduces independent provider configuration beyond the subscriptions.
- **`pi-gpt-search` alone:** only one credential and good iterative research, but it lacks a supported general reader/crawler and depends on an extracted endpoint.
- **Generic MCP alone:** the adapter is maintainable and context-efficient relative to direct MCP tools, but its generic `mcp`/`mcpScript` schemas and discovery workflow are unnecessary complexity for every non-search turn. Keep `mcpScript` disabled for this use case.
- **`pi-web-access`:** it offers two friendly tools and Codex-auth reuse, but its very large provider/fallback matrix is the opposite of the desired human simplicity.
- **A single giant `internet` tool with an `action` union:** fewer tool names, but a larger always-on schema and weaker argument clarity. A tiny loader plus two focused dormant tools provides better progressive disclosure.

## Proposed implementation sequence

No settings were changed during this audit. If this direction is accepted:

1. **Immediate no-risk cleanup:** disable the deprecated `web` alias and `mcpScript`; remove unavailable Context7/GitHub/browser guidance from global instructions.
2. **Add the dynamic gate:** register existing internet tools but make all of them inactive at session start; keep only `load_internet_tools` active. This proves the context reduction before changing providers.
3. **Configure the two official Z.AI MCP servers** through `pi-mcp-adapter`, using an environment/credential command reference rather than storing a plaintext key in project files.
4. **Expose provider-neutral `web_search` and `web_read`** behind the loader, backed by Z.AI first and bounded Ketch fallback.
5. **Remove `pi-gpt-search`** after side-by-side acceptance tests confirm search quality, recency, domain filtering, citations, reader output, cancellation, and failure fallback.
6. **Trim global developer instructions** to one rule: load `internet-research` for current/external facts or URL retrieval. Move the present search workflow and provider-specific rules into the skill.
7. **Measure again** with `getAllTools()`, `getActiveTools()`, and `getSystemPrompt()`. Acceptance target: no internet execution tools active before the skill/loader path, and under 1,000 persistent search-related characters.

## Sources

- Pi user settings and package installation: `/home/anders/.pi/agent/settings.json`, `/home/anders/.pi/agent/tools.json`
- Installed package docs/manifests: `/home/anders/.pi/agent/npm/node_modules/pi-ketch/README.md`, `/home/anders/.pi/agent/npm/node_modules/pi-ketch/package.json`, `/home/anders/.pi/agent/npm/node_modules/pi-gpt-search/README.md`, `/home/anders/.pi/agent/npm/node_modules/pi-gpt-search/package.json`
- Live package catalog: https://pi.dev/packages/pi-ketch
- Live package catalog: https://pi.dev/packages/pi-gpt-search
- `pi-gpt-search` repository: https://github.com/mateusdcc/pi-gpt-search
- `pi-ketch` repository: https://github.com/sovorn-c/pi-ketch
- Ketch project: https://github.com/1broseidon/ketch
- OpenAI Codex web search: https://developers.openai.com/codex/web-search
- OpenAI Codex configuration: https://developers.openai.com/codex/config-basic
- Z.AI Coding Plan quick start: https://docs.z.ai/devpack/quick-start
- Z.AI Coding Plan FAQ: https://docs.z.ai/devpack/faq
- Z.AI Web Search MCP: https://docs.z.ai/devpack/mcp/search-mcp-server
- Z.AI Web Reader MCP: https://docs.z.ai/devpack/mcp/reader-mcp-server
- Alternative package catalog search: https://pi.dev/packages
