# LocalCast decision log

Status values: `ACCEPTED`, `PROVISIONAL`, `OPEN`, `SUPERSEDED`.

Only decisions that affect scope, architecture, safety, or acceptance belong here. When changing an accepted decision, append a superseding entry and record the reason; do not silently rewrite history.

## D-001 — Preserve the established npm single-package repository

Status: **ACCEPTED**
Date: 2026-08-05

The repository already has one coherent npm package, a lockfile, npm-based scripts, and no package boundary that benefits from workspaces. Keep npm and `package-lock.json`. Do not migrate to Yarn or a monorepo as incidental work.

This is the explicit exception to the Yarn-workspaces default, which applies only where no package-management solution exists.

## D-002 — Retain Express; adopt Zod at new boundaries

Status: **ACCEPTED**
Date: 2026-08-05

Retain the existing Express server, route/service/store separation, API smoke coverage, and native `fetch`. A Fastify migration would churn working code without delivering a product requirement.

Use Zod for new or substantially changed environment configuration, request/response contracts, provider output, and persisted JSON. Migrate existing handwritten validation only when the associated boundary is touched.

Fastify remains a default for a new server, not a mandate to rewrite this one.

## D-003 — Preserve React/Vite and add routing/query libraries incrementally

Status: **ACCEPTED**
Date: 2026-08-05

Keep React, Vite, TypeScript, the feature-oriented UI, service interfaces, layered CSS, and appearance/accessibility work.

Introduce React Router because episode/station/feed pages need durable, refresh-safe URLs. Introduce TanStack Query because the current hand-written polling and mutation refresh logic will not provide reliable persisted job state. Migrate one flow at a time; do not rewrite presentational components.

## D-004 — SQLite and filesystem media remain the local system of record

Status: **ACCEPTED**
Date: 2026-08-05

Continue `better-sqlite3`, explicit ordered migrations, foreign keys, WAL, and transactions. Add FTS5 using explicit migrations and synchronization triggers or an equivalently tested transaction strategy.

Store MP3 bytes in a persisted media directory and metadata/checksums in SQLite. Publish files atomically. Do not store large audio blobs in SQLite and do not introduce Redis, a vector database, or object storage.

## D-005 — Separate stations, factual material, and immutable episode evidence

Status: **ACCEPTED**
Date: 2026-08-05

A station’s topic/instructions are editorial direction. Feed items and pasted notes are factual material. Enqueue captures the station revision, feed selection, and note state; after selected-feed synchronization, the worker atomically freezes the exact evidence before any provider call. Transcript and chat citations point only to those immutable snapshots.

Each factual narration claim stores its cited snapshot IDs and bounded supporting excerpts. Deterministic validation proves identifier membership and exact excerpt presence. A separate bounded structured support pass must classify each claim as supported by its cited snapshots; `unsupported` or `uncertain` fails validation. Deterministic fact-oracle fixtures include unrelated valid citations and forbidden claims so a cosmetic citation cannot green-light a fixture episode.

Deleting or refreshing an original source must not destroy historical episode evidence.

## D-006 — Generation and feed synchronization are manual only

Status: **ACCEPTED**
Date: 2026-08-05

The single **Sync and generate** action is the primary workflow. Remove/freeze the existing browser timer, schedule settings, RSS sync-on-start, and interval sync behavior. A user may also manually sync a feed for inspection.

There is no cron, automatic scheduling, or background feed refresh in this prototype.

## D-007 — Use a durable single-worker queue

Status: **ACCEPTED**
Date: 2026-08-05

The API transactionally enqueues jobs. One separate worker process from the same build claims jobs from SQLite with a lease, and no more than one generation job may run at a time. Work is FIFO unless a later explicit decision adds priority.

Attempts, phases, lease state, safe errors, and retry classification are persisted. Restart recovery is deterministic and stage writes are idempotent. The API process must not start detached generation promises.

In production Compose, application and worker share only the required persisted SQLite/media volumes. There is still one public application origin.

## D-008 — Production can start unconfigured but can never fall back

Status: **ACCEPTED**
Date: 2026-08-05

The application may start with providers in `NOT CONFIGURED` so the operator can inspect setup guidance and existing episodes. Generation controls must be disabled or return a clear typed failure until required providers are configured.

Unknown values are configuration errors. Production never normalizes them to mock, never selects browser mock services, and refuses an explicitly fake provider.

Deterministic fake providers are allowed only behind an explicit test/development gate that the production build/runtime rejects.

## D-009 — Provider status has three exact states

Status: **ACCEPTED**
Date: 2026-08-05

The only top-level provider states are:

- `LIVE VERIFIED`
- `CONTRACT TESTED ONLY`
- `NOT CONFIGURED`

The status payload may also carry a redacted reason, configured model/voice label, and last-check time. A failed live check does not masquerade as live; a configured adapter with green deterministic contracts but no successful current live probe is `CONTRACT TESTED ONLY` with the failure reason.

Live verification uses minimal synthetic input, never user content, and is explicitly initiated or clearly disclosed because it may incur cost.

## D-010 — OpenAI is the real walking-skeleton provider pair

Status: **ACCEPTED**
Date: 2026-08-05

Slice 1 uses OpenAI text plus OpenAI TTS for the first true end-to-end episode. This minimizes configuration to one credential while proving external text, speech, validated transcript/citations, persisted jobs, real MP3 bytes, and browser playback.

Ollama and LM Studio text parity and Piper speech parity arrive in Slice 6. No adapter is called production-ready without its required contract evidence.

Exact models, voices, credentials, and spend limits are operator configuration and remain open below.

## D-011 — One origin is served by the existing server

Status: **ACCEPTED**
Date: 2026-08-05

The production Express app serves the built frontend, `/api`, browser media, tokenized podcast feed, and tokenized enclosures. Vite remains a development server only. Absolute URLs derive from one validated `PUBLIC_BASE_URL`, never arbitrary request headers.

This avoids production CORS complexity and gives podcast/media routes one canonical origin.

## D-012 — Caddy is an external, operator-owned boundary

Status: **ACCEPTED**
Date: 2026-08-05

This repository may supply Docker/Compose ports, health checks, and a documented reverse-proxy contract. Agents may not edit, reload, or deploy Caddy without explicit authorization.

The supported topology must prevent direct LAN access to the application port. The exact connection pattern—host-loopback proxy versus a shared Docker network—is unresolved until the operator describes the existing Caddy stack.

## D-013 — Private feed uses an opaque URL bearer token

Status: **ACCEPTED**
Date: 2026-08-05

Podcast clients commonly cannot attach custom authorization headers. Protect the single feed and enclosure routes with a CSPRNG-generated opaque token carrying at least 256 bits of entropy in the URL path. Reject missing/default/weak configuration, compare a server-side digest in constant time, and give every invalid/old token the same generic no-store `404`. Never log or return the cleartext token through general APIs.

The cleartext token is deployment configuration and is excluded from application backups. Restores require the operator to re-supply the same token or intentionally rotate it. Token rotation invalidates the old token immediately for the prototype; a grace window is not required.

## D-014 — Public-feed metadata and media are immutable projections

Status: **ACCEPTED**
Date: 2026-08-05

Only completed, validated episodes appear in the feed. Episode GUID, publication time, enclosure byte length, checksum, and media bytes do not change after publication. A retry before completion may replace temporary work; a correction after publication is a new episode, not silent mutation.

## D-015 — Real media is normalized and validated before completion

Status: **ACCEPTED**
Date: 2026-08-05

All speech output is normalized to MP3. OpenAI may return MP3 directly; Piper output may be transcoded with a pinned system tool such as ffmpeg. Completion requires a non-empty decodable file, measured duration, byte length, checksum, and atomic rename.

The exact transcoder/container package versions will be fixed when the production image is added.

## D-016 — No production demo seeding

Status: **ACCEPTED**
Date: 2026-08-05

An empty production database starts empty. Existing sample sources, invented transcript, and `#` audio remain test/development fixtures only and must be removed from production initialization.

A missing or wrong volume must be reported, not disguised by creating plausible demo data.

## D-017 — Browser assets are self-contained

Status: **ACCEPTED**
Date: 2026-08-05

Production UI assets, including fonts, are bundled or use system fonts. The browser must not contact Google Fonts, a CDN, analytics, or provider APIs merely by loading LocalCast.

## D-018 — Backups exclude credentials and require restore proof

Status: **ACCEPTED**
Date: 2026-08-05

Backup uses SQLite’s online backup API or an explicitly quiesced checkpoint and includes published media plus a checksum manifest. It excludes `.env`, provider keys, and cleartext podcast token. Restore defaults to a new/empty target and must pass integrity, FTS, reference, and media checksum validation.

LocalCast does not schedule, prune, upload, or encrypt backup artifacts; destination protection, retention, and encryption are operator responsibilities outside the application, as frozen in D-022.

## D-019 — RSS egress is public-by-default with explicit private-host exceptions

Status: **ACCEPTED**
Date: 2026-08-05

RSS/Atom fetches allow public HTTP(S) destinations by default. An operator may explicitly allow named private/LAN feed hosts in server configuration. The implementation validates DNS results and every redirect, blocks link-local/cloud-metadata destinations even when other private ranges are allowed, caps redirects/body sizes, and does not follow item links.

Authenticated feed URLs are not part of the prototype unless separately authorized and designed; secrets embedded in URLs are rejected or redacted.

## D-020 — Test evidence combines deterministic gates and minimal live checks

Status: **ACCEPTED**
Date: 2026-08-05

Use Vitest for unit/integration/provider/job contracts, Playwright for browser/accessibility behavior, fixture HTTP servers for RSS/Atom and OpenAI-compatible contracts, and Docker smoke checks for production topology. Retain and split the useful existing API smoke coverage as appropriate.

Live checks prove only the current provider/client/deployment combination. They are required only for `LIVE VERIFIED` and for the one mandatory OpenAI walking-skeleton pair. Deterministic adapter contracts are sufficient to establish support for Ollama, LM Studio, and Piper at `CONTRACT TESTED ONLY`; optional authorized local probes upgrade the current deployment status but never replace deterministic failure tests.

## D-021 — Retain user data indefinitely by default

Status: **ACCEPTED**
Date: 2026-08-05

The prototype performs no automatic source, episode, evidence, chat, or media deletion. It may report storage use and document manual deletion semantics, but retention automation is out of scope. This is the safe default until a later operator request introduces a storage policy.

## D-022 — Backup is manual and leaves retention/encryption to the operator

Status: **ACCEPTED**
Date: 2026-08-05

LocalCast provides a manual command that writes a validated backup artifact to an operator-selected new path. It does not schedule backups, prune old artifacts, upload them, or implement key management. The operator is responsible for destination protection, retention, and encryption outside the application.

## D-023 — External-provider disclosure follows the frozen data flow

Status: **ACCEPTED**
Date: 2026-08-05

Agents may draft and test accurate concise UI copy without another product decision. The disclosure must say that an external text provider receives station direction and selected evidence, external TTS receives the final narration, and external follow-up receives the episode transcript/evidence plus the user’s question. It must distinguish these calls from local Ollama, LM Studio, and Piper processing.

## Open operator decisions

These are genuine inputs that cannot be inferred safely. They do not block documentation bootstrap. A slice must stop before it needs an unresolved value.

### O-001 — Caddy attachment and canonical origin

Status: **OPEN**
Needed by: Slice 4, final Slice 6 gate

Provide the canonical HTTPS `PUBLIC_BASE_URL`, whether the existing Caddy instance reaches LocalCast through a host-loopback port or a shared Docker network, and confirmation that tokenized podcast paths are not retained in access logs. No agent may inspect or modify the external Caddy stack beyond granted access.

### O-002 — OpenAI model, voice, budget, and credential

Status: **OPEN**
Needed by: Slice 1

Supply the server-side OpenAI credential and a small live-test spend boundary. Model and voice remain validated server configuration and can use implementation-documented defaults unless the operator overrides them. The key must never be pasted into tracked files or chat.

### O-003 — Piper executable and voice asset

Status: **OPEN**
Needed by: optional Slice 6 live verification only

To upgrade Piper from `CONTRACT TESTED ONLY`/`NOT CONFIGURED` to `LIVE VERIFIED`, choose the executable/package version, language/voice, model source, checksum, license acceptance, and installation path. Downloading a large model requires explicit authorization. This is not required for deterministic adapter-support evidence.

### O-004 — Real podcast client certification target

Status: **OPEN**
Needed by: Slice 4

Choose at least one real client that can reach the trusted-LAN HTTPS origin. The operator must be able to add a URL-token feed and exercise refresh, download/stream, and seek. Prefer a client that stores subscriptions locally. If the chosen client synchronizes subscriptions through a vendor cloud, the operator must explicitly accept disclosure of tokenized URLs and use the documented token-rotation procedure. Client/server-cloud products that cannot reach a LAN-only origin are unsuitable functional evidence.
