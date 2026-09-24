# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## What this is

Inspector is Edelvives' internal tool for editorial review of digital content. It drives a headless
Playwright browser against the **publisher** backoffice (Edelvives Digital Plus or ByME Digital), using
the logged-in user's own credentials, to collect activity codes (→ Excel) and extract their HTML
statements (→ Word). Comments, identifiers, and commit messages in this repo are in Spanish; match that
convention when editing existing files.

## Commands

```bash
npm install
npx playwright install chromium   # one-time, needed for scraping to work at all
npm run dev                       # dev server, http://localhost:3000
npm run build                     # production build (output: 'standalone')
npm run lint                      # ESLint
npm test                          # tests/**/*.test.ts via `node --test`
node --test tests/sello.test.ts   # run a single test file
```

Requires Node ≥ 20.9 to run the app; tests require Node ≥ 22 because they run TypeScript directly via
`node --test` with no transpiler step (see `tsconfig.json`'s `allowImportingTsExtensions`; test imports
use explicit `.ts` extensions). `tests/package.json` sets `"type": "module"` for that directory.

`xlsx` is installed from `cdn.sheetjs.com`, not npm — the npm-published 0.18.5 has unfixed
vulnerabilities. `npm install` needs network access to that host.

A required `.env.local` (copy from `.env.example`) needs `SESSION_SECRET` (≥32 chars, e.g. `openssl rand
-base64 48`) or the app throws rather than silently degrading.

## Architecture

**Request flow:** `app/page.tsx` is a Server Component that calls `leerSesion()` and renders either
`LoginForm` or `Dashboard` — the panel never reaches the browser without a valid session cookie. API
routes are thin: they validate input, read the session, and delegate to an engine in `lib/publisher/`.
`proxy.ts` (Next 16 renamed `middleware` → `proxy`) only does a cheap check for cookie *presence* to
redirect early — it is explicitly **not** the security boundary; real verification happens in each route
via `leerSesion()`, which returns `null` on a tampered cookie.

**Session, not password.** Login (`app/api/auth/login`) validates credentials for real against the
publisher, once, then discards the password. What's persisted is the platform's Playwright
`storageState`, sealed into an `httpOnly` cookie (AES-256-GCM in `lib/sello.ts`, deliberately
Next-independent and unit-tested; `lib/session.ts` layers the Next `cookies()` API and cookie-chunking on
top). Every subsequent scrape opens a browser context already authenticated from that `storageState`
instead of logging in again.

**Why the session is trimmed (`lib/publisher/estadoSesion.ts`).** The raw `storageState` from the
publisher can be too large for cookies — Node rejects request headers over ~16 KB (431), and browsers
resend all cookies on every request; `lib/session.ts` splits the sealed session across up to 3 chunked
cookies (~3500 B each) and throws `SesionDemasiadoGrandeError` if it still doesn't fit. `estadoSesion.ts`
strips the `storageState` down to cookies plus `localStorage` keys that look session-related, then
**validates the trimmed state actually works** by opening a fresh browser context with it before
accepting it — if the trim doesn't authenticate, the *full* state is returned instead (and session
storage will then reject it with a clear error), rather than silently saving a session that would break
mid-extraction. If the publisher ever renames its session key, this is the file to fix, and
`PATRON_CLAVE_SESION` is the pattern to widen.

**Publisher selectors are centralized.** `lib/publisher/selectores.ts` holds every CSS/DOM selector used
to drive the backoffice. When scraping starts failing after a publisher UI change, this should be the
only file that needs touching.

**Streaming progress (NDJSON).** Long scrapes stream progress to the client as newline-delimited JSON.
`lib/ndjson.ts`'s `respuestaNdjson()` wraps a route handler's work in a `CanalNdjson` (log/exito/error/
cancelado) and centralizes stream lifecycle (closing on `finally`, swallowing post-abort enqueues,
turning thrown exceptions into an `error` message). `hooks/useNdjsonStream.ts` is the single client-side
reader — it exists because there used to be two independent copies of this parsing loop and only one
correctly buffered a JSON line split across network chunks; use it for any new streaming view rather than
writing another reader.

**Cancellation** is just `AbortController.abort()` client-side; the server detects the aborted
`request.signal` and closes its Chromium instance (`lib/publisher/navegador.ts`'s `conNavegador()`
guarantees the browser closes in a `finally`, even on unhandled exceptions — an earlier bug left orphaned
Chromium processes eating ~200-300 MB each until the container OOM'd).

**Client-side persistence.** `hooks/useEstadoPersistido.ts` mirrors state into `sessionStorage` via
`useSyncExternalStore` (not an effect, to avoid hydration mismatches) so results survive an accidental
tab reload. Results/extraction state that should survive a reload belongs here.

**Extraction pipeline:** `lib/html/sanear.ts` (whitelist-sanitize platform HTML before display) →
`lib/html/parseEnunciado.ts` (pure HTML → block AST, unit-tested) → `lib/html/aDocx.ts` (blocks → Word
paragraphs via `docx`). Images in statements can't be reproduced and become `[IMAGEN]`; inaccessible or
missing statements are marked inline (`[SIN ENUNCIADO EN EL EDITOR]`, `[ERROR DE NAVEGACIÓN]`) rather than
silently dropped, so a partial extraction is still auditable.

**Platform catalog** (`lib/plataformas.ts`): the client only ever sends a `PlataformaId` (`'EPD' |
'BYME'`); the server resolves the base URL. Never let the client supply a base URL directly — that
previously turned the container into an arbitrary navigation proxy.

**Data contracts** live in `lib/types.ts` (`ActividadRef`, `EnunciadoExtraido`, `MensajeStream`), shared
between client and server so a shape change is a type error, not a runtime surprise. `esActividadRef` is
the runtime guard used both client-side (reading the uploaded Excel) and server-side (the extractor route
does not trust what it's sent) — extra columns from a Tangerine export (`Position`, `Type`, `Page`, etc.)
are filtered out here.

## Deployment

Runs on Cloud Run behind Firebase Hosting; see `DEPLOY.md` for the full rationale, but two things matter
most for local changes:

- `lib/publisher/navegador.ts` launches Chromium `headless: true` — do not change this to `false` in code
  meant to run in Cloud Run (no display there); it's only useful toggled locally for debugging.
- Firebase Hosting buffers/times out long-polling responses around 60s, which breaks NDJSON streaming.
  Any change to how progress is streamed should be checked against the Hosting path, not just a direct
  Cloud Run URL.
  