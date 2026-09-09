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

## Sources

- Pi user settings and package installation: `/home/anders/.pi/agent/settings.json`, `/home/anders/.pi/agent/tools.json`
- Installed package docs/manifests: `/home/anders/.pi/agent/npm/node_modules/pi-ketch/README.md`, `/home/anders/.pi/agent/npm/node_modules/pi-ketch/package.json`, `/home/anders/.pi/agent/npm/node_modules/pi-gpt-search/README.md`, `/home/anders/.pi/agent/npm/node_modules/pi-gpt-search/package.json`
- Live package catalog: https://pi.dev/packages/pi-ketch
- Live package catalog: https://pi.dev/packages/pi-gpt-search
- `pi-gpt-search` repository: https://github.com/mateusdcc/pi-gpt-search
- `pi-ketch` repository: https://github.com/sovorn-c/pi-ketch
- Ketch project: https://github.com/1broseidon/ketch
- Alternative package catalog search: https://pi.dev/packages
