# Browser bridge specification

Status: **planned — not yet implemented.** This document is a specification and task
plan, not a description of shipped behavior. Update it as tasks land, and flip this
banner when the core (milestones 1–2) ships.

## Goal

Let human and agent share one browser that renders inside the viewer pane's Browser
tab. The agent keeps using its standard browser automation tooling, attached to the
shared Chrome instance over CDP; this may be Chrome DevTools MCP, Playwright,
Puppeteer, or another CDP-compatible integration. No particular agent tool is a
requirement. The human watches and interacts with the same pages in the pane. No
browser tools are implemented in pi-livecraft — we only own the browser process, the
display stream, input forwarding, and the CDP endpoint used for attachment.

## Non-goals (decided)

- No custom browser tools, no MCP protocol implementation, and no dependency on a
  particular agent browser tool. Integration-specific configuration is documentation,
  not part of the bridge contract.
- No puppeteer-in-iframe bridge (cross-origin iframes cannot be scripted;
  reimplementing CDP in-page is reinventing the wheel).
- No reverse proxy for third-party sites (maintenance tar pit; MITM liability).
- No custom browser extension for now. The daily-browser-with-logins case is served
  by existing modes (Playwright MCP `--extension`, chrome-devtools `--autoConnect`)
  outside this pane; a thin mirroring extension is a possible later addition.
- The plain iframe stays as the zero-infra human fallback when no live browser runs.
- The earlier "phase 1" navigate-only extension idea is superseded: with a live
  browser, navigations from attached agent tooling appear in the pane automatically.

## Architecture

```
Pi agent ──(CDP-capable browser tooling, attached to http://127.0.0.1:<port>)──┐
                                                                               ▼
          Chrome (headless, --remote-debugging-port, temp user-data-dir, 127.0.0.1)
                                                                                 ▲
pane input ──POST /api/browser/input──► server/browser-session.ts ──CDP Input.*──┘
pane view  ◄──SSE /api/browser/frames── server/browser-session.ts ◄──Page.startScreencast
```

- `server/browser-session.ts` (new) owns the Chrome process and one CDP connection.
  It is a backend capability like Git/quotas, not a manager concern (`server/manager.ts`
  stays the sole owner of `pi --mode rpc` processes).
- Chrome's CDP endpoint is the tool-neutral agent integration boundary. Agent tooling
  runs outside pi-livecraft and must support attaching to an existing Chrome instance;
  Chrome DevTools MCP is one supported example, not an architectural requirement.
- CDP speaks over Node's built-in `WebSocket` — **zero new dependencies**. Raw JSON
  protocol only: command/response with ids, event subscriptions, flat session for the
  page target.
- Transport shape: SSE downstream (frames + url/status events), plain HTTP POST
  upstream (input). Same pattern as the existing event stream in `server/backend.ts`.
- Frontend: `src/features/browser/` owns the livecast surface behind the existing
  tab/address bar/URL state. `src/api.ts` remains the only browser-to-backend path.

### Security posture

- Chrome debug port binds 127.0.0.1 only; any local process can reach it — accepted
  threat model (same as the app itself), documented in the browser README.
- Fresh temp `--user-data-dir` per session: no logins by design (isolation for agent
  driving); the profile is deleted when the session stops.
- Input endpoint performs the same origin checks as other POST APIs.

## Contracts to define (milestone 1, task 1)

`shared/types.ts`:

- `BrowserSessionState`: `'off' | 'starting' | 'live' | 'stopped' | 'crashed'`.
- `BrowserFrameEvent`: `{ frame: string /* base64 */; meta: BrowserFrameMeta }` with
  viewport size, device pixel ratio, and the pane scale factor the backend assumes.
- `BrowserInputEvent`: discriminated union — `mouse` (type/x/y/button), `wheel`
  (x/y/deltaX/deltaY), `key` (type/key/code/modifiers), `text` (composed string for
  `Input.insertText`).

## Milestone 1 — backend browser session

Tasks are ordered; each lists acceptance criteria and its validation.

1. **Type contracts + module skeleton.** `server/browser-session.ts` with lifecycle
   state machine and the shared types above. Accept: types compile, module exports
   start/stop/status/event-emitter surface used by backend routes. Validate:
   typecheck, lint.
2. **Chrome launcher.** Resolve the binary (env override
   `PI_LIVECRAFT_BROWSER_BIN`, then platform defaults), spawn
   `--headless=new --remote-debugging-port=0 --user-data-dir=<tmp>`, parse the
   `DevTools listening on ws://…` line from stderr, clean up on stop and on backend
   exit. Accept: `start()` resolves with the ws endpoint; kill removes the temp dir;
   double start/stop are safe. Validate: unit test for the stderr parser; opt-in
   integration smoke (skipped unless a browser binary is found, like the manager
   integration test gates on `pi`).
3. **CDP client.** Minimal JSON-RPC: `send(method, params)` with id correlation and
   timeouts, event subscription, page-target attach. Accept: `navigate`,
   `startScreencast`, `Input.*` round-trip. Validate: unit test for id correlation
   and event fan-out using an injected fake socket.
4. **Screencast stream.** `Page.startScreencast` (maxFrameRate ~15, everyNthFrame 1),
   base64 frames coalesced to at most one in-flight frame per subscriber; SSE route
   `/api/browser/frames` emitting `frame`, `url`, `status` events. Accept: a headless
   smoke renders `about:blank` then a data URL and receives both frames. Validate:
   opt-in integration smoke; route wiring reviewed against the existing SSE route.
5. **Input forwarding.** `POST /api/browser/input` mapping `BrowserInputEvent` to
   `Input.dispatchMouseEvent/dispatchKeyEvent/insertText`, with a pure
   `mapPaneToPageCoordinates` helper (scale + clamping). Accept: click on a data-URL
   button toggles page state in the next frame. Validate: unit tests for the mapping
   helper; smoke for the dispatch path.
6. **Navigation and state sync.** Address-bar commits call `Page.navigate`;
   `Page.frameNavigated`/`loadEventFired` emit `url`/`status` SSE events. Accept:
   navigating between two data URLs updates the emitted URL. Validate: smoke; unit
   test for the url event reducer if extracted.

## Milestone 2 — livecast pane

7. **API client.** Functions in `src/api.ts`: start/stop/status, input POST, and an
   SSE subscription helper mirroring the existing event-stream client. Accept:
   typed, no `any`. Validate: typecheck, lint.
8. **Livecast surface.** `BrowserView` renders frames (img swap; canvas only if img
   proves too slow), captures pointer/wheel/key events, scales coordinates via the
   frame meta, renders a local cursor, and hosts a hidden input committing composed
   text via `insertText` (IME mitigation). States: starting/live/stopped/crashed with
   a start/stop toggle. Accept: a human can load a localhost dev server in the pane
   and click/type/scroll; agent browser tooling attached to the same Chrome is visible
   live. Validate: typecheck, lint, visual checklist in both themes at pane min/max
   width; manual IME check if available.
9. **Mode switch.** Livecast when a session is live; iframe fallback otherwise.
   Address bar and reload drive CDP while live, the iframe when not. Accept: closing
   the live session returns to iframe without losing the tab. Validate: visual
   checklist; no console errors across switches.

## Milestone 3 — agent attachment and documentation

10. **Attach UX.** While live, the pane shows the CDP endpoint and generic guidance
    for attaching browser automation tooling to the existing Chrome instance.
    Integration-specific examples may be provided for Chrome DevTools MCP,
    Playwright, Puppeteer, or other supported tools, but remain documentation rather
    than bridge dependencies. Accept: the endpoint is copyable and at least one
    documented integration can attach to it. Validate: visual checklist and a manual
    attachment smoke test.
11. **Documentation.** Rewrite `src/features/browser/README.md` for the live contract;
    add the browser session to `docs/ARCHITECTURE.md` (new module + SSE channel) and
    `server/features/README.md` (backend capability); flip this spec's status banner.
    Validate: docs reread; routing from `docs/README.md` still accurate.

## Deferred backlog (do not schedule)

Click markers on frames, human input lock while the agent works, multi-tab pages,
snapshot overlay from `take_snapshot`, WebRTC transport, mirroring the user's daily
browser via a custom extension.

## Risks

- Headless Chrome availability differs per OS; the launcher must fail with a clear,
  actionable error and the pane must stay in iframe fallback.
- Screencast backpressure on heavy pages; coalescing (task 4) is the mitigation,
  WebRTC the escalation.
- CDP surface drift is minimal — we use stable domains (`Page`, `Input`, `Target`).
- Temp profile means no user logins in the live browser; intentional (agent
  isolation), documented, with extension modes as the future answer.
