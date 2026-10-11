# LocalCast prototype specification

Status: frozen bootstrap contract
Audience: implementation agents and reviewers
Acceptance source: `docs/codex/TEST_MATRIX.md`

## 1. Product definition

LocalCast is a single-user, local-first application that turns user-supplied RSS/Atom material and pasted notes into source-grounded spoken episodes. It runs on a trusted LAN behind an operator-managed Caddy reverse proxy.

LocalCast is its own product. It is not named, branded, or presented as a Huxe clone.

The core promise is narrow:

1. The user saves feed sources, pasted notes, and topic stations.
2. The user explicitly chooses **Sync and generate**.
3. LocalCast synchronizes only the selected feeds, snapshots eligible supplied material, and asks the selected providers to produce a transcript and audio.
4. LocalCast validates the provider output and its citations before publishing an episode.
5. The user can read the transcript, inspect citations, play a real MP3, receive the episode in one private podcast feed, and ask follow-up questions grounded in that episode.

A topic is an editorial direction, not evidence and not a research request. LocalCast must never search the web, follow article pages, or invent a factual episode when the supplied material is inadequate.

## 2. Normative language and completion

`MUST` and `MUST NOT` are release-blocking. `SHOULD` may be deferred only with a recorded decision and explicit residual risk.

A requirement is complete only when its row in `TEST_MATRIX.md` has the named observable evidence. A passing mock screen, a typecheck, or code inspection alone is not proof of required production behavior.

## 3. User and trust model

- There is one operator and no account system.
- Every client allowed to reach the application origin is treated as fully trusted and can read or mutate all application data. CORS is not authentication.
- Caddy and LAN access control form the application boundary. The repository must document the proxy contract but must not modify Caddy without authorization.
- The private podcast feed has its own bearer token because podcast clients may reach feed/media routes independently of the browser UI.
- Feed publishers, redirects, feed content, provider outputs, podcast clients, and all external-provider responses are untrusted inputs.
- Sensitive data includes pasted notes, feed contents and URLs, transcripts, citation snapshots, chat turns, SQLite/media files, provider credentials, and the podcast token.
- “Local-first” means durable state is owned locally. It does not mean all inference is local: when OpenAI is selected, the UI must clearly disclose that selected source text and prompts leave the host.

The application is intentionally not suitable for public exposure. If accounts, untrusted LAN users, or public access become requirements, this contract must be revised before implementation.

## 4. Functional contract

### 4.1 Sources and notes

- **SRC-01 — RSS and Atom:** The user can add, edit, enable/disable, delete, manually sync, and inspect RSS 2.0 and Atom feeds. Only feed XML and fields embedded in it are ingested; LocalCast does not retrieve linked pages.
- **SRC-02 — Pasted notes:** The user can save a title and non-empty pasted body, with optional author and original URL. A note is factual input material, not a topic prompt.
- **SRC-03 — Conditional synchronization:** Feed state records ETag and Last-Modified values, sends conditional requests, handles `304 Not Modified`, and preserves deduplication across restarts.
- **SRC-04 — Bounded safe fetch:** Feed fetches have scheme, DNS/IP, redirect, timeout, response-size, item-count, field-size, and content-type controls. Private/LAN feed hosts require an explicit server-side allowlist; link-local and cloud-metadata destinations remain forbidden.
- **SRC-05 — Search:** User-supplied material is searchable with SQLite FTS5. Search results identify feed/note provenance and remain synchronized with source-item changes.
- **SRC-06 — Historical evidence:** Refreshing or deleting a source must not mutate or erase material already snapshotted into a historical episode.

### 4.2 Topic stations

- **STN-01 — Saved stations:** A station has a stable identifier, name, topic/editorial instruction, default mode, selected feed sources, and selected notes. It can be created, edited, deleted, and reused.
- **STN-02 — Direction is not evidence:** Station text is stored and prompted separately from source material. It must never be cited or copied into the evidence snapshot as a factual source item.
- **STN-03 — No autonomous research:** A station may rank or shape supplied items, but it must not trigger search, page fetches, tool use, or material acquisition beyond its saved RSS/Atom feeds.

### 4.3 Manual generation and modes

- **GEN-01 — Manual action:** Episodes are created only by an explicit **Sync and generate** action. There is no timer, cron, browser scheduler, startup generation, or automatic recurring feed sync.
- **GEN-02 — Immutable request and evidence snapshots:** Enqueueing captures the station revision, requested mode, selected feed IDs, and the selected notes exactly as they existed at the user action. After the worker synchronizes only those feeds, its selecting phase atomically records the final immutable feed-item/note evidence snapshots. No provider call begins until that evidence transaction commits.
- **GEN-03 — Brief mode:** Brief mode targets 600–1,000 spoken words, roughly four to seven minutes at normal speech speed. It prioritizes the highest-value supported points and may be shorter when the material is sparse.
- **GEN-04 — Deep mode:** Deep mode targets 1,800–3,000 spoken words, roughly twelve to twenty minutes, with more context and connections among supplied items. It must fail instead of padding when the material cannot support a deep dive.
- **GEN-05 — Honest insufficiency:** No eligible factual input, trivially short input, or input unable to support the requested mode produces a typed `INSUFFICIENT_SOURCE_MATERIAL` failure. It never produces a placeholder or “best effort” factual episode. A feed-sync error is recorded as an error, never evidence; generation may continue from clearly identified previously stored items only when those items independently provide adequate material.
- **GEN-06 — Deterministic pipeline:** The phases are `queued`, `syncing`, `selecting`, `drafting`, `validating`, `rendering_audio`, and terminal `complete` or `failed`. Phase and safe progress detail are persisted.

Exact duration is provider-dependent; factual density and honest failure take precedence over filling the target.

### 4.4 Transcript and citations

- **GRD-01 — Structured provider output:** The text provider returns schema-validated sections composed of atomic factual claims plus non-factual transitions. For episode generation, each factual claim selects one or more compact references from an attempt-scoped catalog of exact source-body substrings; LocalCast resolves those references deterministically to canonical snapshot IDs and excerpts. Invalid or malformed output is a typed provider-output failure, not silently coerced prose.
- **GRD-02 — Claim support:** Every factual claim resolves to one or more episode-source snapshot IDs and bounded supporting excerpts found exactly in the cited snapshot. Intro/outro/transitions may be uncited only when they introduce no facts. Unknown/repeated catalog references, multiple catalog units from one snapshot in a segment, non-snapshot, missing-excerpt, or unrelated citation artifacts fail validation. Titles and other source metadata remain navigation context, not citable body evidence.
- **GRD-03 — Citation presentation:** The episode UI resolves citations to source title, provenance, excerpt, and safe original URL when present; it does not show raw identifiers as the only evidence.
- **GRD-04 — Immutable history:** A completed episode retains its exact transcript and citation evidence even if the original source or note changes or is deleted.
- **GRD-05 — Semantic grounding:** Prompts treat source content as untrusted evidence, not instructions. After deterministic ID/excerpt validation, a bounded schema-validated support pass classifies every factual claim as `supported`, `unsupported`, or `uncertain` against only its cited snapshots; any non-supported claim fails the episode. Deterministic fact-oracle fixtures and live review must show that injected instructions, unrelated-but-valid citations, and unsupported claims are rejected rather than cited cosmetically.

### 4.5 Episode library and failures

- **LIB-01 — Library:** The user can browse and deep-link to episodes with title, mode, timestamps, status, transcript, citations, duration, provider summary, and failure state.
- **LIB-02 — Progress:** Queued/running phases update accessibly without a full page reload and remain accurate after browser or server restart.
- **LIB-03 — Safe failure:** Failures expose a stable error code, safe user message, failed phase, attempt count, and whether retry is allowed. Raw stack traces/provider bodies are never shown.
- **LIB-04 — Retry:** Retryable provider/network/TTS failures can be retried from the UI. Retry creates a persisted attempt and is idempotent; it cannot publish duplicate episodes or partial media. Evidence-insufficiency requires changed inputs and a new generation action.

### 4.6 Text providers

- **TXT-01 — OpenAI generation:** A server-side OpenAI text adapter supports structured episode generation and claim-support validation using an explicitly configured model. Follow-up use of the same adapter is accepted through `CHAT-*`.
- **TXT-02 — Ollama:** A server-side adapter supports Ollama’s OpenAI-compatible endpoint with explicit base URL and model.
- **TXT-03 — LM Studio:** A server-side adapter supports LM Studio’s OpenAI-compatible endpoint with explicit base URL and model.
- **TXT-04 — Bounds:** All text adapters enforce timeouts, cancellation, response-size limits, schema validation, and safe error classification.

Gemini is not part of the frozen provider contract and is not a supported production provider.

### 4.7 Speech providers and MP3 production

- **TTS-01 — OpenAI TTS:** A server-side OpenAI speech adapter produces speech with an explicitly configured model and voice.
- **TTS-02 — Piper:** A server-side Piper adapter invokes an operator-installed executable and voice model with bounded resources and safe argument handling. Agents may not download a large voice model without authorization.
- **TTS-03 — Real MP3:** Every completed episode references a non-empty, decodable MP3 whose measured duration, byte length, checksum, and storage path are persisted.
- **TTS-04 — Atomic publication:** Audio is written to a temporary file, validated, and atomically renamed. An interrupted render never exposes a partial episode file.

OpenAI text plus OpenAI TTS is the default walking-skeleton pair because one credential can exercise both paths. Exact model and voice remain operator configuration.

### 4.8 Provider configuration and status

- **PROV-01 — Server-side configuration:** Provider endpoints, executable paths, models, and voices come from validated server configuration. Provider credentials remain server-side at rest and during provider use. The trusted-operator Settings UI may transiently accept a complete replacement credential through a dedicated bounded same-origin request, but ordinary settings/status responses expose only configured state and an optional last-four-character hint; the complete value is never returned, prefilled, persisted in browser storage, or embedded in the client bundle. OpenAI resolves an installation-private managed credential before the compatible worker environment fallback.
- **PROV-02 — No production fallback:** Unknown, missing, or fake provider configuration never silently becomes a mock. The app may start in a visible not-configured state, but generation is disabled or fails clearly.
- **PROV-03 — Status vocabulary:** Each adapter displays exactly one status:
  - `CONFIGURED UNVERIFIED`: the current configuration has all required validated fields, but LocalCast has not recorded deterministic contract evidence or a successful current live operation for it.
  - `CONTRACT TESTED ONLY`: deterministic adapter contract evidence is recorded for the current configuration, but LocalCast has no successful current live operation; show a safe reason.
  - `LIVE VERIFIED`: a successful current live provider operation is recorded; show its timestamp.
  - `NOT CONFIGURED`: required credentials, endpoint, executable, model, or voice are absent.
  Configuration and deterministic tests alone never yield `LIVE VERIFIED`. Provider summaries omit credential, endpoint, and executable-path values.
- **PROV-04 — Test fakes:** Deterministic text and speech fakes are available only through an explicit test/development gate that production rejects.
- **PROV-05 — Disclosure:** Before an external provider is verified or used, the UI explains each external data flow: station direction and evidence sent for text generation, final narration sent for TTS, and the question, complete immutable episode transcript, and all frozen supporting evidence snapshots used to construct follow-up grounding. The disclosure states that supported follow-up answers can require a second external semantic-support request, refusals ordinarily require one request, and provider-side storage is disabled. Local provider status does not imply an external call.

### 4.9 Follow-up chat

- **CHAT-01 — Episode required:** A follow-up belongs to one completed episode. The server rejects missing, unknown, incomplete, or failed episode context.
- **CHAT-02 — Server-built grounding:** The server constructs context only from the immutable episode transcript and source snapshots. Client-authored “context” is ignored or rejected.
- **CHAT-03 — Cited answers:** Every factual answer claim cites episode-source snapshot IDs, carries a matching supporting excerpt, passes the same support validation as transcript claims, and displays resolved evidence. The semantic-support request contains only the proposed claims, their cited snapshot IDs, and exact excerpts. Unknown, unrelated, or invalid citations fail validation.
- **CHAT-04 — Honest refusal:** Questions not supported by the episode evidence receive a clear refusal. Follow-up requests use no provider tools, search, browsing, URL/page retrieval, file search, code execution, or general-knowledge fallback and set `store: false`.
- **CHAT-05 — Persistence:** Ordered user questions, answers/refusals, citations, timestamps, attempt/failure/retry/idempotency state, accepted retry identity, and bounded provider-call lifecycle/usage metadata survive restart. The browser retains only a bounded non-content pending action identity in same-origin shared storage while an HTTP outcome is uncertain, including across reload and tabs; an empty first history response or an expired browser timer is not rejection evidence, and only the exact later accepted identity releases the action. Browser coordination is advisory and may still emit competing POSTs. Migration 008 maintains one `episode_lock` per episode: queued/running turns retain it, and every unpublished failed turn containing any provider-call lifecycle row retains it whether that row is `reserved`, `response_received`, `ambiguous`, or `finalized`. The lock releases only for a zero-provider terminal failure or for a running current attempt whose database state has the exact answer shape (finalized validated draft and support, supported claims, and citations) or refusal shape (one finalized draft refusal and no claims). Publication additionally requires the exact current attempt row, no future attempt, an accepted retry plus a terminal prior attempt when publishing attempt two, and only finalized lifecycle rows on every prior attempt. Under ordinary DML, the partial unique index and triggers reject every other release; reject conflicting `INSERT OR REPLACE` and partial-index `UPDATE OR REPLACE` before they can displace retained rows; make turn, attempt, claim, citation, retry, and provider identity fields immutable; permit only the production lifecycle transition graph; and prevent provider evidence from being reparented or erased while its retained parent history exists. Whole-episode deletion remains the explicit tested retention boundary. These controls are structural integrity, not a defense against an actor allowed to alter or drop the schema. Same-key replay returns the existing turn, a concurrent different key loses without creating work, an eligible retry stays attached to the locked turn, and a genuinely new sequential question is allowed only after safe lock release. Every asynchronous reconciliation and mutation callback is fenced by a fresh effect-lifetime epoch, exact action generation, and one shared monotonic history-response generation before it may update cached history, persistent identity, errors, focus, status, or controls; stale successes and failures return no newer state. Each draft/support stage is inserted and committed through a runtime-validated native `better-sqlite3` store before its adapter method is entered. Only after that commit is the frozen process-private one-use grant registered, bound to the exact episode/turn/attempt/stage/worker/lease and row-scoped lifecycle operations. Receipt, bounded usage, safe finalization, or ambiguity is recorded only while ownership permits it. Answer/refusal publication requires the exact finalized lifecycle outcome, and raw provider request/response bodies are not audit data. Initial/retry identities, questions, claims, and excerpts use Unicode-code-point bounds only after application validation rejects NUL, U+FFFD, and malformed UTF-16; migration checks independently reject NUL, replacement encoding, and raw surrogate encodings before SQLite persistence.

Slice 5 OpenAI follow-up chat is pinned to `gpt-5.4-mini-2026-03-17` with low reasoning. Each complete serialized draft/support request body is rejected above 131,072 UTF-8 bytes before its fetch; bounded fields remain defense in depth. The conservative input proxy plus reserve is 139,264 tokens per call; draft/support output ceilings are 2,500/750 tokens. A refusal ordinarily uses one call, a supported answer uses at most two calls per claimed attempt, and a turn permits only its initial attempt plus one explicit user retry. There is no automatic provider retry. Any reserved stage whose external outcome or durable finalization is unconfirmed is non-retryable. The one explicit retry is eligible only after a pre-dispatch failure with no reservation, a safely finalized retryable provider response, or stale recovery after every existing stage was safely finalized and before any next stage or publication began; in every case durable state must prove that no provider work is unresolved or in flight. Recorded standard-rate planning estimates are `$0.223521` per supported attempt and `$0.447042` with the sole retry; they are neither immutable pricing nor an account-global budget guard.

## 5. Persistence and job semantics

SQLite is the system of record; the media directory stores immutable MP3 bytes. Both must live on persisted local volumes.

The target domain model is logical rather than a mandate for exact table names:

| Record | Required purpose |
| --- | --- |
| Feed source | URL, active state, fetch validators, sync health, and safe display metadata |
| Note | Pasted factual content and optional provenance |
| Station and joins | Editorial direction, mode, and selected sources/notes |
| Source item | Normalized feed/note material with stable dedupe identity and FTS linkage |
| Episode | User-facing status, mode, transcript summary, timing, and terminal error metadata |
| Episode source snapshot | Immutable evidence actually supplied to the provider |
| Transcript claim/citation | Ordered spoken claims/transitions, validated snapshot references, supporting excerpts, and support result |
| Job and attempt | Durable payload, phase, lease, attempt count, retry class, and safe error |
| Media asset | Relative path, MIME type, bytes, duration, checksum, and publication state |
| Chat turn/citation | Episode-grounded follow-up history and evidence references |
| Provider check | Redacted adapter identity, status, reason, and verification timestamp |

Requirements:

- **DATA-01 — Explicit migrations:** Every schema change is an ordered, additive migration recorded transactionally. Production never mutates schema ad hoc or silently resets data.
- **DATA-02 — SQLite integrity:** Foreign keys, WAL, busy timeout, schema version, `quick_check`, and `foreign_key_check` are covered. The runtime must verify FTS5 is available.
- **DATA-03 — Production mount:** Production fails clearly if the configured database/media mount is missing, unwritable, or unexpectedly empty after previously being initialized. It never masks a missing volume with demo data.
- **DATA-04 — FTS consistency:** FTS5 indexes remain synchronized through insert, update, delete, migration, backup, and restore.
- **JOB-01 — One worker:** Exactly one worker claims generation work. The app/API process does not also run detached jobs.
- **JOB-02 — One active generation:** At most one episode-generation lease is active. Additional work stays queued in FIFO order.
- **JOB-03 — Recovery:** On restart, stale running work is reconciled deterministically: idempotent phases resume or requeue; unsafe partial output is discarded from publication; attempt history remains.
- **JOB-04 — Idempotency:** Repeated enqueue/retry requests and worker restarts do not duplicate transcript sections, citations, media, or feed entries.
- **JOB-05 — Shutdown:** The worker stops claiming work, records or releases its lease safely, closes provider work within a bound, and closes SQLite cleanly.

## 6. Media and private podcast delivery

- **MEDIA-01 — Browser playback:** The UI uses the native audio element or media APIs against the real MP3. Play/pause, seek, skip, speed, elapsed/duration, keyboard controls, and error state reflect actual media events.
- **MEDIA-02 — HTTP media:** `GET` and `HEAD` provide `audio/mpeg`, exact byte length, validators, and `Accept-Ranges: bytes`.
- **MEDIA-03 — Byte ranges:** Full, bounded, open-ended, and suffix requests return exact `200`/`206` responses; unsatisfiable ranges return `416`. Multi-range requests follow one documented, tested policy.
- **MEDIA-04 — Path safety:** Media identifiers cannot traverse paths, enumerate arbitrary files, or expose temporary assets.
- **POD-01 — One feed:** The installation exposes exactly one private RSS 2.0 podcast feed containing completed episodes only, newest first.
- **POD-02 — Token protection:** A CSPRNG-generated bearer token with at least 256 bits of entropy, encoded as unpadded base64url or an equivalently strong format, protects the feed and its enclosure URLs. Production rejects missing, default, malformed, or weaker token configuration. Missing, malformed, wrong, old, and rotated tokens receive the same generic `404` status/body and no-store cache policy. The value is masked by default and never logged or returned by general APIs; a dedicated explicit copy/reveal action may disclose the complete feed URL transiently to the trusted operator without persisting it in browser storage. The supported Caddy contract must disable or redact request-path logging for these tokenized routes.
- **POD-03 — Feed validity:** The feed uses stable GUIDs, RFC-822 dates, absolute validated-origin enclosure URLs, `audio/mpeg`, exact byte lengths, useful titles/descriptions, and standard podcast namespace metadata.
- **POD-04 — Client interoperability:** At least one operator-approved real podcast client on the trusted LAN can add the feed, list episodes, download/stream an enclosure, seek, and refresh without custom headers. The client must keep subscriptions local, or the operator must explicitly accept that a vendor cloud will receive the tokenized URLs and follow the documented rotation guidance.

The token is deployment configuration, not browser-stored application state. Backup artifacts do not contain provider credentials or the cleartext token.

## 7. Deployment, operations, security, and privacy

### 7.1 Production topology

- **DEP-01 — One origin:** One Express application serves the built frontend, API, browser media, tokenized podcast feed, and tokenized enclosures on one origin. Vite is development-only.
- **DEP-02 — Caddy boundary:** Production runs behind Caddy with an explicit validated `PUBLIC_BASE_URL`. Direct application ports are not exposed to other LAN hosts in the supported topology.
- **DEP-03 — Compose:** Docker Compose defines the application and one worker from the same pinned image, persists SQLite and media, provides health/readiness checks, runs as a non-root user, and supports graceful shutdown.
- **DEP-04 — No Caddy mutation:** Repository automation never edits or reloads Caddy without explicit authorization.

### 7.2 Security and privacy

- **SEC-01 — Feed SSRF controls:** The RSS fetch policy in `SRC-04` is applied to initial DNS resolution and every redirect, including rebinding-safe connection checks and unconditional cloud-metadata denial before any private-host exception.
- **SEC-02 — Safe browser links/content:** Feed/provider content is rendered as text. Original links use an allowed `http`/`https` scheme and safe external-link attributes.
- **SEC-03 — Prompt isolation:** Prompts delimit untrusted material, tell providers to ignore embedded instructions, disable tools/search, and validate structured output.
- **SEC-04 — Secrets:** Provider credentials are used by the server only for dedicated trusted-operator replacement and authorization to the configured provider. The replacement value may appear transiently in that same-origin request body, but is absent from ordinary browser artifacts/network/storage, browser-facing responses, logs, test snapshots, errors, Git, images, and backups. Private/unknown feed evidence may reach an external provider only after the explicit external-evidence authorization, including mixed local-text/external-speech configurations. The podcast token has one narrow exception: the explicit trusted-operator feed-URL copy/reveal response and clipboard. It remains absent from bundles, persistent storage, routine APIs, logs, snapshots, errors, Git, images, and backups.
- **SEC-05 — Same-origin controls:** Production rejects wildcard CORS and unexpected Origin/Host/proxy values. Absolute URLs derive only from validated configuration.
- **SEC-06 — Bounded input and output:** JSON, feed XML, notes, complete serialized provider requests/responses, chat questions, Piper subprocesses, backup artifacts, and media operations have documented size/time/resource bounds.
- **SEC-07 — Safe errors/logs:** Logs use correlation IDs and stable error codes without source bodies, prompts, raw provider responses, tokens, or internal stack traces in client responses.
- **PRIV-01 — No browser third-party egress:** Production browser assets are self-hosted; loading the UI does not contact Google Fonts, analytics, CDNs, or provider endpoints.
- **PRIV-02 — Honest disclosure:** The UI and deployment docs accurately describe the all-LAN-clients-trusted model, local SQLite/media storage, plaintext backup sensitivity and credential exclusion, and external-provider data flow.

### 7.3 Backup and restore

- **OPS-01 — Consistent backup:** A documented command uses SQLite’s online backup mechanism or a quiesced checkpoint, copies published media, and writes a versioned manifest with checksums.
- **OPS-02 — Safe restore:** Restore validates the manifest and targets an empty/new location unless the operator explicitly authorizes replacement. It never silently overwrites user data.
- **OPS-03 — Restore proof:** A restored deployment passes database integrity/FTS checks and preserves episodes, snapshots, citations, chat, jobs, feed identity, and MP3 checksums. Missing/corrupt media is reported, not hidden.
- **OPS-04 — Credential boundary:** Backups exclude deployment and installation-managed provider credentials plus the cleartext podcast token; restore documentation explains how to re-supply or rotate them.

## 8. Accessibility and usability

- **A11Y-01 — Standard:** Core flows meet WCAG 2.2 AA, with zero unadjudicated applicable automated accessibility violations in supported themes and responsive sizes. Any tool false positive is documented with manual evidence.
- **A11Y-02 — Keyboard:** A keyboard-only user can manage sources/notes/stations, sync and generate, inspect progress/failure, retry, read citations, control audio, copy the feed URL, and use chat.
- **A11Y-03 — Semantics and focus:** Interactive rows are real controls/links; controls have programmatic labels; focus is visible, trapped/restored only where appropriate, and not left on hidden player elements.
- **A11Y-04 — Status:** Sync, generation, provider verification, failure, retry, and save states use concise live-region announcements without excessive repetition.
- **A11Y-05 — Visual adaptability:** Existing theme, contrast, color-vision, text-size, density, and reduced-motion support remains functional. Layout reflows at a 320 CSS-pixel viewport and at 200% text resize without two-dimensional scrolling for ordinary content or clipping essential controls.
- **A11Y-06 — Media alternative:** The complete transcript and resolved citations are available whenever audio is available.

Automated browser evidence covers the complete core-route/theme matrix, keyboard/focus behavior, destructive confirmation, live-region structure, ordinary-content reflow, reduced motion, and real media controls. A real assistive-technology spot check remains operator-attested evidence; automated checks must not be represented as a completed screen-reader review.

## 9. Architectural contract

- **ARC-01 — Preserve the application:** Keep the existing React/Vite/TypeScript frontend, Express server, feature-oriented UI, and route/service/store/provider boundaries. Do not rewrite solely to match a preferred stack.
- **ARC-02 — Package management:** Keep the established single npm package and `package-lock.json`. Yarn workspaces are only a default for an unestablished repository and do not justify migration here.
- **ARC-03 — Validation:** Use Zod for new or substantially changed environment, API, provider, and structured-output boundaries. Migrate handwritten validators only when touched.
- **ARC-04 — Client state:** Add React Router for durable URLs and TanStack Query for server-state caching, mutations, polling, and invalidation; preserve focused presentational components.
- **ARC-05 — Persistence:** Continue `better-sqlite3` with explicit migrations and FTS5. Do not introduce an ORM merely for preference.
- **ARC-06 — Tests:** Use Vitest for unit/integration contracts and Playwright for browser/accessibility flows, retaining the useful API smoke coverage.
- **ARC-07 — Production artifact:** Build server and client reproducibly; the production image contains only runtime code/assets and no local secrets, databases, media, caches, or development mock mode.

Fastify remains the default for a new backend, but Express is already coherent, tested work and is retained. This is an explicit exception, not an oversight.

## 10. Explicit non-goals

The prototype MUST NOT add:

- Gmail or Calendar ingestion;
- general web search or autonomous research;
- full-page/article scraping;
- authentication, accounts, roles, or multi-user isolation;
- public internet deployment;
- automatic episode or feed synchronization scheduling;
- embeddings or vector databases;
- Redis, message brokers, distributed workers, or horizontal scaling;
- multiple speakers;
- voice cloning or user-trained voices;
- native mobile apps;
- analytics, telemetry, tracking pixels, or third-party browser metrics;
- provider keys in the browser.

Local files, Gemini, ElevenLabs, the Web Speech API, and the current schedule UI are not supported prototype features. Existing placeholders must not be mistaken for scope.

## 11. Release definition

The prototype is solid and usable when every non-deferred row in `TEST_MATRIX.md` is green, all seven slice checkpoints in `PLAN.md` exist, the production Compose deployment passes the full gate behind the operator’s Caddy boundary, one real text and speech path has live evidence, every required provider adapter has at least contract evidence, and the unresolved decisions in `DECISIONS.md` are either resolved or explicitly accepted by the operator.
