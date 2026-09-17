# Code and media viewer specification

Status: **proposed** — for review before implementation.

## Goal

Replace the file pane's plain-text fallback with a real, read-only code surface and add
safe previews for common workspace media. The first version should make source files,
images, PDFs, HTML, and SVG useful inside Livecraft without turning the application
into a file editor or introducing language-server processes yet.

The code surface must establish a clean path to later LSP-backed hover, diagnostics,
go-to-definition, and references. The media path must serve only explicitly supported
content, preserve the existing workspace containment checks, and isolate active
formats from the Livecraft origin.

## Decisions

- Use **CodeMirror 6** for source and raw-text views.
- Keep the first version **read-only**. Editing, saving, dirty state, and conflict
  handling are separate work.
- Keep rendered Markdown through the existing shared `Markdown` component. Its raw
  mode moves from a `<textarea>` to `CodeViewer`.
- Render raster images with `<img>` and PDFs in a sandboxed iframe backed by a fetched
  blob URL.
- Render HTML and SVG only from fetched text in a sandboxed `srcDoc` document. Never
  serve either format as a same-origin executable document.
- Do not create a generic "iframe any file" path. Every preview kind and MIME type is
  allow-listed.
- Language-server integration is a future backend capability. This proposal defines
  the frontend seams needed for it but does not install, launch, or transport an LSP.
- Language-server processes will belong to the HTTP backend when implemented, not to
  the Pi manager.

## Non-goals

- Editing or saving workspace files.
- Formatting, rename, completion, diagnostics, hover, definitions, or references in
  this version.
- Embedding code-server, OpenVSCode Server, Monaco, or a VS Code extension host.
- Previewing office documents, archives, executables, arbitrary binary files, or
  remote URLs.
- Executing JavaScript, forms, popups, downloads, navigation, or network requests from
  an HTML/SVG preview.
- Replacing conversation Markdown or tool-call diff rendering.
- Automatic filesystem watching or invalidating the existing text cache.
- Mobile redesign. The viewer pane keeps its current behavior of hiding below 900 px.

## User experience

### Code and text

Opening a code or text file shows a CodeMirror surface with:

- syntax highlighting for supported languages;
- line numbers;
- selection and clipboard support;
- native editor scrolling;
- bracket matching and active-line highlighting;
- in-file search through the platform shortcut (`Cmd/Ctrl+F`);
- readable plain-text fallback when no language package matches;
- no caret or edit affordance suggesting that changes can be saved.

The header continues to identify the file as a read-only preview. Markdown retains its
`Markdown` / `Raw` switch; raw mode uses `CodeViewer`. HTML and SVG gain a `Preview` /
`Source` switch. Source is the default for HTML because rendering project HTML without
its scripts, network resources, and relative assets is intentionally incomplete. SVG
may default to preview because its preview remains sandboxed and offline.

Changing tabs preserves each code file's scroll position and selection for the life of
the pane. Closing a tab releases its editor view state. Selecting another workspace
continues to remount and clear the pane through the existing `key={workspacePath}`
contract.

### Images

Supported raster images are centered on the normal file-pane surface and scaled down
to fit while preserving aspect ratio. They are not upscaled beyond their intrinsic
size. The filename is the accessible alternative text. Loading and decode failures
replace the image with an actionable error state; they do not leave a blank pane.

Initial image types:

- PNG (`image/png`)
- JPEG (`image/jpeg`)
- GIF (`image/gif`)
- WebP (`image/webp`)
- AVIF (`image/avif`)

SVG is deliberately excluded from the raw image route because it is an active XML
format. It uses the sandboxed text-preview path described below.

### PDFs

A PDF opens in a sandboxed iframe using the browser's native PDF viewer. The iframe
fills the content area and has an accessible title containing the filename. If the
browser cannot render the PDF, the pane offers the existing "open externally" action
rather than adding a PDF rendering dependency.

The implementation must verify the sandboxed blob-URL behavior in the Livecraft-owned
Chromium. Removing the sandbox or adding `allow-scripts` / `allow-same-origin` is not an
acceptable fallback without a separate security review.

### HTML and SVG

Preview mode renders a generated `srcDoc` inside:

```html
<iframe sandbox="" referrerpolicy="no-referrer">
```

The generated document prepends a restrictive Content Security Policy before the file
content:

```text
default-src 'none';
img-src data: blob:;
font-src data:;
style-src 'unsafe-inline';
form-action 'none';
base-uri 'none';
```

The empty sandbox blocks scripts even if the source contains them and gives the
content an opaque origin. The CSP additionally blocks external images, styles,
fonts, frames, media, and other network requests. Do not rely on regex-based script
stripping as the security boundary.

Relative project assets therefore do not load in v1. The preview should explain this
constraint in its empty/error help rather than silently relaxing isolation.

### Unsupported files

An unsupported binary or oversized file shows:

- the filename;
- a concise reason such as `Preview is not available for this file type` or
  `File exceeds the preview limit`;
- the existing open-in-default-application action.

Unknown extensions may use the plain-text CodeViewer only when the text API accepts
the file. The backend should reject clearly binary text reads instead of returning
UTF-8 replacement characters.

## Visual contract

The files feature remains the owning surface. New viewers fill the existing
`.file-content` region and do not add nested cards.

The header has three alignment groups:

1. **Identity** — truncated path, taking the remaining width.
2. **View mode** — `Markdown / Raw` or `Preview / Source` when applicable.
3. **Status/actions** — the quiet `Read-only preview` label and existing/reused
   open-externally action when relevant.

Controls in one group share a single height and the existing soft-fill selected state.
Use only theme variables already available to `files.css`. CodeMirror gutters,
selection, cursor suppression, search UI, and syntax colours must remain legible in
light and dark themes. Do not import a hard-coded third-party editor theme; map the
editor theme to Livecraft tokens.

Every new action supports hover, focus-visible, active, and disabled states. Paths and
status text ellipsize rather than pushing mode controls out of the header. Viewer
content owns its overflow; the pane itself must not create a second competing scroll
axis.

## Preview classification

Add one pure shared classifier, for example `shared/file-preview.ts`. It returns a
closed preview kind and, for raw formats, a controlled MIME type:

```ts
type WorkspaceFilePreview =
  | { kind: 'markdown'; language: 'markdown' }
  | { kind: 'code'; language: CodeLanguage | null }
  | { kind: 'html'; language: 'html' }
  | { kind: 'svg'; language: 'xml' }
  | { kind: 'image'; mimeType: SupportedImageMimeType }
  | { kind: 'pdf'; mimeType: 'application/pdf' }
  | { kind: 'unknown' }
```

Classification is based on the lowercase final extension, with explicit handling for
well-known names such as `Dockerfile`, `Makefile`, and `.gitignore`. It must not trust a
client-provided MIME type. The backend repeats/uses the same authoritative allow-list
before returning raw bytes.

Initial syntax packages should cover the repository's common formats without trying to
support every language:

- JavaScript, JSX, TypeScript, and TSX;
- JSON;
- HTML and XML;
- CSS;
- Markdown;
- YAML when a maintained CodeMirror 6 language package is available.

All other accepted text opens in CodeMirror's plain-text mode. Additional languages
are isolated additions to the classifier/language loader.

## Frontend component contract

### `CodeViewer`

Create `src/features/files/CodeViewer.tsx` as the only component that imports
CodeMirror. Its initial public contract should remain editor-library-neutral:

```ts
interface CodeViewerProps {
  content: string
  language: CodeLanguage | null
  path: string
  reveal?: {
    line: number
    column?: number
    endLine?: number
    endColumn?: number
  }
}
```

Requirements:

- Construct one `EditorView` on mount and destroy it on unmount.
- Configure both `EditorState.readOnly.of(true)` and
  `EditorView.editable.of(false)`.
- Reconfigure language and document through CodeMirror compartments rather than
  destroying the editor on every prop update.
- Treat line and column as one-based at the component boundary. Clamp invalid targets.
- Reveal and briefly select a supplied target without mutating the document.
- Preserve selection and scroll state per `path` while its file tab remains open.
- Do not expose CodeMirror `EditorView`, `Extension`, positions, or transactions to
  `FileContentPane` or `App`.
- Load the CodeViewer as a separate Vite chunk so users who never open source files do
  not pay its startup cost. Language support may be loaded on demand if the resulting
  loading state stays stable and testable.

The `reveal` contract is intentionally included before LSP work. Tool-call file links,
search results, definitions, diagnostics, and references can later share the same
path/range navigation without teaching `App` about CodeMirror offsets.

### Viewer dispatcher

Extract content dispatch from `FileContentPane` into a small feature-local component,
for example `FilePreview.tsx`. `FileContentPane` continues to own tabs, resizing,
browser/terminal selection, the header, and per-path loading state. `FilePreview`
selects among:

- existing rendered Markdown;
- `CodeViewer`;
- `ImageViewer`;
- `PdfViewer`;
- sandboxed HTML/SVG preview;
- unsupported/error state.

Do not create a generic cross-feature viewer registry. These variants all belong to
workspace files and share one lifecycle.

Replace the single global `viewRaw` boolean with view mode keyed by path so changing an
HTML or Markdown tab does not alter another open tab's mode.

### Blob lifecycle

`src/api.ts` adds a binary-aware request that returns a `Blob` and still translates the
backend JSON error contract into an `Error`. Media viewers:

1. fetch through that API boundary;
2. create an object URL;
3. revoke the URL on path/workspace change or unmount;
4. abort stale fetches;
5. never persist blobs or object URLs outside the pane lifecycle.

## HTTP contract

Add:

```text
GET /api/files/raw?cwd=<workspace>&path=<relative-path>
```

The route:

1. resolves `cwd` through the existing working-directory resolver;
2. requires a non-empty relative `path`;
3. resolves the file through `resolveWorkspaceFilePath` with
   `allowOutsideWorkspace = false`;
4. classifies the extension using the server-authoritative allow-list;
5. rejects unsupported raw types with 415;
6. rejects files larger than **25 MiB** with 413;
7. streams bytes without first converting them to UTF-8.

Only the five raster image MIME types listed above and `application/pdf` are accepted
by the first raw route. HTML and SVG continue through the bounded text endpoint and are
never returned by `/api/files/raw`.

Successful responses include:

```text
Content-Type: <allow-listed MIME>
Content-Length: <known size>
Content-Disposition: inline; filename*=UTF-8''<encoded filename>
Cache-Control: no-store
X-Content-Type-Options: nosniff
```

The endpoint is GET-only in v1. Range requests, audio, and video are deferred. Adding
large streaming media later requires explicit `HEAD`/`Range` semantics and must not be
silently approximated by loading the complete file into a browser blob.

Errors use the existing JSON error contract. `sendJson` remains unchanged; the raw
route needs a narrow streaming helper analogous to static-file serving but rooted in a
validated workspace file.

### Text-file validation

Keep the existing 2 MiB text limit. Before returning text, reject content that is
clearly binary, at minimum files containing NUL bytes in the inspected prefix. This is
a guard against rendering binary data as replacement-character text, not a complete
encoding detector. UTF-8 text without a recognized extension remains eligible for
plain-text CodeViewer.

## Security requirements

- Preserve realpath-based workspace containment and the existing non-symlink listing
  behavior.
- Raw previews never use `allowOutsideWorkspace`.
- MIME types come from the allow-list, never request parameters or browser sniffing.
- Set `X-Content-Type-Options: nosniff` on raw responses.
- Never return HTML or SVG from the same-origin raw route.
- HTML/SVG preview iframes use an empty sandbox, no permissions, no referrer, and the
  restrictive CSP above.
- Do not add `allow-scripts`, `allow-same-origin`, `allow-forms`, `allow-popups`, or
  top-navigation permissions.
- Do not resolve relative HTML/SVG resources through a privileged workspace-file
  bridge in v1.
- Object URLs are revoked promptly and never logged.
- File errors must not expose arbitrary absolute paths beyond the existing API
  contract.

## LSP-compatible future path

This proposal does not implement LSP, but `CodeViewer` must not close that path.
A later feature can add CodeMirror's maintained LSP client as an internal extension and
introduce this backend flow:

```text
CodeViewer / CodeMirror LSP client
    │ JSON-RPC over a same-origin WebSocket owned by src/api.ts
    ▼
server/features/lsp/ — allow-listed server lifecycle and stdio bridge
    ▼
typescript-language-server, pyright, rust-analyzer, ...
```

Future constraints:

- start with one TypeScript/JavaScript server per canonical workspace;
- launch only configured/allow-listed binaries, never a client-supplied command;
- start lazily and stop on backend shutdown or bounded idle timeout;
- use canonical `file:` document URIs and one-based UI ranges at the Livecraft edge;
- route definitions and references back through the existing file-tab open/reveal
  contract;
- keep the initial LSP editor read-only and send `didOpen`/`didClose` without
  pretending unsaved edits exist;
- keep LSP processes out of `server/manager.ts`, which remains the sole owner of Pi RPC
  processes.

Editing is a separate proposal because it requires atomic writes, dirty tabs,
`didChange`, save state, external/agent modification detection, and conflict recovery.

## Architecture and ownership

- `src/features/files/` owns all viewer components, mode state, and viewer styling.
- `FileContentPane` remains the tab/browser/terminal host.
- `src/api.ts` is the only browser-to-backend file boundary, including blob requests.
- `shared/file-preview.ts` owns pure extension classification shared by browser and
  backend.
- `server/workspace-file.ts` owns validated text/raw file behavior and limits.
- `server/backend.ts` owns the raw route and response headers.
- No change is made to manager runtime files or manager lifecycle.

## Implementation outline

1. Add and test the shared preview classifier and controlled MIME map.
2. Add binary rejection to text reads and a bounded raw-file stream capability in
   `server/workspace-file.ts`.
3. Add `/api/files/raw`, its response headers, and a blob-returning wrapper in
   `src/api.ts`.
4. Add the minimum CodeMirror packages and create the lazy-loaded read-only
   `CodeViewer` with a Livecraft-token theme.
5. Extract `FilePreview` and replace the textarea fallback while preserving the
   existing loading/error cache and tab behavior.
6. Add raster `ImageViewer`, sandboxed `PdfViewer`, and sandboxed HTML/SVG source/
   preview modes with correct blob cleanup.
7. Add unsupported/oversized states and reuse the existing external-open behavior.
8. Update `src/features/files/README.md` after implementation.
9. Validate behavior and visual states in the shared Livecraft browser.

Expected files:

- `package.json` and lockfile
- `shared/file-preview.ts` — new
- `server/workspace-file.ts`
- `server/backend.ts`
- `src/api.ts`
- `src/features/files/CodeViewer.tsx` — new
- `src/features/files/FilePreview.tsx` — new
- `src/features/files/ImageViewer.tsx` — new or kept private in `FilePreview`
- `src/features/files/PdfViewer.tsx` — new or kept private in `FilePreview`
- `src/features/files/SandboxedMarkupViewer.tsx` — new or kept private in `FilePreview`
- `src/features/files/FileContentPane.tsx`
- `src/features/files/files.css`
- `src/features/files/README.md`
- `test/file-viewer-kind.test.ts` — new
- `test/workspace-file.test.ts`

Small private viewers should remain in `FilePreview.tsx` when separate files would add
indirection without independent behavior or tests.

## Validation

Focused automated checks:

- classifier coverage for supported extensions, case differences, dotfiles, unknowns,
  SVG, and HTML;
- language mapping and plain-text fallback;
- traversal, outside-workspace, missing-file, unsupported-MIME, oversized-file, and
  binary-as-text rejection;
- raw response MIME, `nosniff`, no-store, content length, and inline disposition;
- stale media requests are aborted and object URLs revoked where this can be tested
  without adding a broad UI-test dependency;
- existing Markdown rendering/raw behavior and pane-width tests remain valid.

Repository checks:

```bash
npm test -- test/file-viewer-kind.test.ts
npm test -- test/workspace-file.test.ts
npm run lint
npm run typecheck
npm run build
```

Visual inspection with the `livecraft-browser` skill:

- TypeScript/TSX, JSON, CSS, Markdown raw, plain text, long lines, and a large accepted
  text file;
- PNG, JPEG, animated GIF, WebP, AVIF, valid PDF, malformed image, and malformed PDF;
- HTML containing scripts, forms, external images/styles, relative assets, and very
  long content; verify none can execute, navigate, submit, or make network requests;
- SVG containing scripts and external references; verify the same isolation;
- tab switching, closing, workspace switching, loading, errors, and preserved code
  scroll/selection;
- light and dark themes, long paths, narrow allowed pane width, keyboard focus, search
  UI, and the existing 900 px hide breakpoint.

## Acceptance criteria

- Supported code/text files open in a read-only CodeMirror surface with line numbers,
  search, selection, and appropriate syntax highlighting.
- Unknown accepted text remains readable without claiming an incorrect language.
- Markdown keeps rendered/raw modes, and raw mode uses CodeViewer.
- HTML and SVG offer isolated preview/source modes with no script execution, privileged
  origin, forms, navigation, or network access.
- Supported raster images render proportionally and report decode/load errors.
- PDFs render in the Livecraft-owned Chromium under the required sandbox or show a
  clear external-open fallback; security restrictions are not weakened to make them
  render.
- Unsupported, binary, and oversized files fail clearly without mojibake or blank
  panes.
- Raw bytes are available only for the allow-listed media types, only inside the
  canonical workspace, with controlled MIME and anti-sniffing headers.
- Media fetches use `src/api.ts`, abort stale work, and revoke object URLs.
- Existing file tabs, Markdown rendering, pane resizing, browser tab, terminal tab,
  responsive behavior, and workspace reset semantics continue to work.
- CodeViewer accepts a path and one-based reveal range without leaking CodeMirror
  types upward, preserving the navigation seam needed by future LSP work.
- No language server, write endpoint, manager change, generic iframe capability, or
  new UI framework is introduced.

## Sources

External projects were inspected for direction, not as components to copy wholesale:

- [CodeMirror documentation](https://codemirror.net/docs/)
- [CodeMirror LSP client](https://github.com/codemirror/lsp-client)
- [omp-web `FileViewer`](https://github.com/ddallabenetta/omp-web/blob/main/components/FileViewer.tsx)
- [omp-web file-type helpers](https://github.com/ddallabenetta/omp-web/blob/main/lib/file-types.ts)
- [OpenHands highlighted source view](https://github.com/OpenHands/OpenHands/blob/main/src/frontend/components/features/files-tab/highlighted-source-view.tsx)

CodeMirror should be integrated through its public packages. If any MIT-licensed helper
is copied rather than independently implemented, retain its required copyright and
license notice.
