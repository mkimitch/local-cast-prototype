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

## D-024 — Production storage initialization is explicit and identity-bound

Status: **ACCEPTED**
Date: 2026-08-05

Normal app and worker startup only verify existing storage; they never initialize fresh volumes. A profile-gated one-shot `storage-init` role is the sole authority to mark empty SQLite/media mounts, apply migrations, and bind both markers plus database metadata to one operator-supplied installation ID. Normal startup verifies database identity before applying migrations so a wrong mounted database is not mutated first.

Database and media directories must be distinct after normalization and realpath resolution. Missing, partial, mismatched, unexpected non-empty, unwritable, or known-placeholder storage fails closed. This makes a lost volume visible instead of silently creating an empty LocalCast installation.

## D-025 — Test providers are a separate non-production artifact boundary

Status: **ACCEPTED**
Date: 2026-08-05

Deterministic transcript and MP3 providers live only under `server/testing` and have a dedicated test worker entrypoint. Production server entrypoints do not import them, Docker excludes the test tree, and production reconciles `NODE_ENV` with `LOCALCAST_RUNTIME_MODE` so runtime flags cannot switch a production image into test mode.

Production without configured real providers starts honestly at `NOT CONFIGURED` and rejects generation. Contract-test fixtures must be repeatable, injectable, and byte-stable, but are never production behavior.

## D-026 — Generation leases use precise heartbeats and process fencing

Status: **ACCEPTED**
Date: 2026-08-05

The worker renews its owned lease during long phases and aborts local work if renewal loses ownership. Lease expiry uses lexicographic comparison of fixed-format UTC ISO timestamps to retain millisecond precision; SQLite `datetime()` is not used because it truncates sub-second values. Every worker process appends a random UUID to its configured label so a restarted process cannot impersonate an earlier lease owner.

The persisted recovery policy requeues stale work, closes the prior attempt as `recovered`, and starts a new attempt from `syncing`. Graceful interruption requeues immediately as `interrupted`. Transcript/media publication remains idempotent across replay, with temporary media excluded from completed state.

## D-027 — The real OpenAI boundary is fixed, worker-only, and reverified per worker session

Status: **ACCEPTED**
Date: 2026-08-06

Slice 1 uses the fixed official OpenAI API origin with `gpt-5.4-mini`, low reasoning effort, and strict Responses API output for drafting and support classification. Provider-generated segments are all factual, cited, and support-checked; LocalCast alone adds the fixed non-factual AI disclosure and section labels. Tools, search, redirects, arbitrary provider URLs, and production fallback are absent.

Only the worker receives `OPENAI_API_KEY`. It is not inherited by `ffprobe`, copied into the image, returned by APIs, or exposed to browser code. A worker boot downgrades configured capabilities to `CONTRACT TESTED ONLY`; only successful calls in that worker session set `LIVE VERIFIED`. Missing credentials record `NOT CONFIGURED` and disable enqueueing.

OpenAI speech uses `gpt-4o-mini-tts`, voice `marin`, MP3 output, and speed `1.05`. Each reusable media filename is bound to a SHA-256 rendering fingerprint over narration and speech settings, so a recovered attempt cannot pair regenerated text with older audio. Temporary names are unique, stale internal temp files are cleaned, ffprobe requires MP3 format plus positive duration, and completed media is published only with byte length and checksum.

## D-028 — The approved single-host pipeline remains the prototype baseline

Status: **ACCEPTED**
Date: 2026-08-06

The operator approved the 78.912-second `marin` sample at checkpoint `1790e91f1b37d518b18f4834b59cb7d9ba160823` as the functional prototype baseline. It is usable but not the desired final LocalCast audio identity. Multiple-speaker generation stays deferred until the defined prototype is complete; `Sol` is a qualitative benchmark only, not an assumed API voice, imitation target, or blocker.

The first post-prototype audio milestone is a grounded two-host format with a pre-dialogue outline/fact ledger, restrained non-fiction dialogue, two configurable voice profiles, bounded ordered turns, per-turn TTS cache/provenance/retry, deterministic pauses/stitching/loudness normalization, speaker-labelled transcripts/citations, and comparisons against the single-host format. Existing server-side speech configuration and provider interfaces remain authoritative. Natural script/transcript work may introduce a backwards-compatible versioned ordered-segment representation with stable ID, text, citation IDs, and optional speaker/voice fields; current output uses one `host`. A broad migration or risk to the green path defers that seam.

Slice 6 will measure delivered loudness and establish a documented podcast-compatible normalization target. The approved sample’s approximately `-22.7 LUFS` integrated and `-5.2 dBFS` true peak are recorded as the baseline, not as a prerequisite for earlier slices.

## D-029 — Feed writes and cloud authorization use item-level provenance

Status: **ACCEPTED**
Date: 2026-08-06

Feed response bytes are fetched through a pinned, bounded transport. Final item upsert, expected canonical URL, unexpired lease ownership, validators, and source health commit in one immediate transaction so a stale owner or concurrent URL edit cannot publish old data. Each retained item stores the network scope of the response that supplied that item; a later redirect or `304` cannot relabel older private/unknown content as public. OpenAI authorization examines each immutable evidence item and fails closed for private or unknown feed material under the current consent.

Authenticated feed URLs remain out of scope. New URLs reject embedded credentials and credential-like query names; legacy invalid URLs are hidden from APIs and disabled until replaced without printing or migrating their value. Generation evidence is deterministically limited to 50 items and 120,000 aggregate title/body/author/URL characters, with a final 160,000-character provider-boundary check before network use.

## D-030 — Mode length is bounded by unique supplied evidence

Status: **ACCEPTED**
Date: 2026-08-06

Brief mode accepts at least 40 unique evidence words and 200 evidence characters. Adequate material produces 600–1,000 words; sparse but factual material may produce a shorter supported briefing instead of padding. Deep mode requires at least 1,800 unique evidence words and 7,200 evidence characters and produces 1,800–3,000 words. Evidence with the same content digest is counted once so duplicate sources cannot manufacture sufficiency.

Failure to meet the input contract is the non-retryable `INSUFFICIENT_SOURCE_MATERIAL` state and requires a new generation action with changed inputs. Output outside the mode contract fails validation and is never published.

## D-031 — Version 1 scripts are ordered single-host segments

Status: **ACCEPTED**
Date: 2026-08-06

New episodes persist `script_format_version = 1` and ordered sections/segments. Every segment has a stable ID, text, citation records, and the `host` role; the persistence boundary also permits optional speaker label and voice-profile fields. Historical rows are not falsely relabeled when they lack the segment projection.

This is the backwards-compatible natural seam requested for the post-prototype audio milestone. Version 1 remains strictly single-host and does not add dialogue, a second voice, turn synthesis, or speculative migration of the approved walking skeleton.

## D-032 — Long single-host speech uses bounded transport chunks

Status: **ACCEPTED**
Date: 2026-08-06

Narration is partitioned only at ordered script-segment boundaries into at most eight OpenAI speech requests, each no more than 4,096 characters. A single request remains the common path. When multiple chunks are required, the worker renders each with the same server-side model, voice, speed, and style configuration, then invokes pinned ffmpeg to concatenate them into one MP3 before the existing strict ffprobe, checksum, fsync, atomic-publication, and retry checks.

Chunk files and assembled temporary output are run-internal, cancellable, and cleaned after success or failure. This transport assembly is not the deferred multi-host stitching feature: it has one host, one voice profile, no inserted pauses/crossfades, and no independent dialogue turns.

## D-033 — Retry identity and evidence state are explicit

Status: **ACCEPTED**
Date: 2026-08-06

Every manual retry requires an `Idempotency-Key`. The database records the job/key/requested-attempt tuple transactionally, so double submission or replay returns the same attempt while a distinct key may request the next eligible retry. A retryable failure keeps the same logical run and, once evidence has frozen, reuses that immutable evidence. Failures before evidence freeze are described honestly and may perform the captured feed synchronization/selection work again.

Non-retryable failures expose no retry action. Safe stable error code, phase, attempt count, retryability, correlation ID, and evidence-frozen state may reach the browser; provider bodies, source bodies, stack traces, filesystem paths, credentials, and authorization headers may not.

## D-034 — Cached speech cannot establish live provider status

Status: **ACCEPTED**
Date: 2026-08-06

Reusing a previously validated MP3 is successful job recovery, not a live provider request. Speech becomes `LIVE VERIFIED` in a worker session only when that session actually completes an authenticated speech request. Cached reuse may preserve already validated media but leaves provider status at its honest configured/contract state.

## D-035 — Follow-up chat is a durable, worker-owned, fail-closed projection

Status: **ACCEPTED**
Date: 2026-08-07

The chat API is nested under one briefing run and accepts only a bounded `question` plus a required `Idempotency-Key`. All transcript, evidence, snapshot IDs, excerpts, and citation context are loaded from the completed version-1 episode by the server; strict request parsing rejects every client-authored grounding field. A completed episode must still contain immutable evidence and at least one valid supported cited factual transcript claim when chat history is read, enqueued, or claimed.

Migration 008 adds ordered chat turns, claims, citations, attempts, and retry-request identity without changing episode, media, feed, GUID, or enclosure records. A durable unique enqueue order gives retained turns deterministic FIFO ordering without timestamp/UUID ambiguity. The existing single worker process alternates generation and chat work and owns all provider access; the app rejects `OPENAI_API_KEY` by role and only enqueues or projects durable state.

The provider result is exactly a strict supported-answer or `EVIDENCE_INSUFFICIENT` refusal. Supported answers use bounded atomic claims, exact immutable snapshot excerpts, local membership/excerpt validation, and a second structured semantic-support classification in which every result must be `supported`; missing, duplicate, unknown, unrelated, `unsupported`, or `uncertain` evidence fails closed. Provider requests use `store: false` and contain no tool/search/browser/URL-retrieval capability or general-knowledge fallback.

Initial submission and manual retry are transactionally idempotent. Durable history exposes the exact accepted submission key and accepted retry turn/key/attempt identity, so a losing or unrelated client action cannot reconcile as accepted. While an HTTP outcome is ambiguous, the browser stores only a versioned bounded episode/action/key/generation/owner/timing identity and, for retry, turn/attempt baseline in same-origin local storage; it never stores the question or grounding. The first empty or nonmatching authoritative history response and browser-record expiry are not proof of rejection. Exact-identity polling continues for a bounded window, after which the unresolved identity remains blocked for manual checking, including across reload and tabs. Each active effect lifetime receives a fresh component epoch; a shared monotonic history generation and the exact action generation fence every history source and mutation callback before cache, persistent identity, errors, focus, status, controls, or locks can change. Cleanup invalidates the old generations but retains the bounded unresolved identity for the next lifetime. Exact compare-before-replace/remove prevents a known older identity from deliberately replacing or removing a newer record. Browser coordination is advisory defense in depth and does not promise that only one POST leaves the browser.

Migration 008 represents the authoritative episode guard with `episode_lock` and a partial unique index. Queued/running turns retain the lock. An unpublished failed turn also retains it once any provider-call lifecycle row exists, including a `finalized` rejection, invalid response/citation result, support failure, or finalized draft followed by lease loss. Finalization proves only a bounded stage outcome; it is not publication and does not release the episode. The release trigger permits only a terminal failure with no provider rows or the exact database-observable publication shape: the current leased running attempt must own either a finalized validated draft plus finalized validated support with cited supported claims, or exactly one finalized draft refusal with no claims. Attempt two additionally requires its accepted retry request and a terminal failed/interrupted/recovered attempt one; every prior provider row must be finalized, the attempt count must match the complete attempt history, and no future attempt may exist. It rejects outcome mismatches, partial publication fields, unresolved prior attempts, and every other lock-clearing update. Under ordinary DML, provider rows must begin reserved, follow only `reserved -> response_received -> finalized` or `reserved -> ambiguous`, keep their row/turn/attempt/stage/model/worker/reservation identity, and cannot be reparented or deleted while retained parent history exists. Conflict-aware insertion/update triggers reject `REPLACE` displacement across briefing, turn, claim, citation, attempt, retry, and provider identities; turn partial-index conflicts are rejected before an `UPDATE OR REPLACE` can remove another locked or running turn. Claim, citation, retry, turn, attempt, and provider identities are immutable, and published attempt outcome must match its parent turn. Whole-episode foreign-key cascade deletion remains the existing explicit retention boundary. These triggers defend ordinary-DML schema invariants, not an actor authorized to alter or drop the schema. Same-key replay returns the original turn, a concurrent different key loses transactionally without creating attempts/call slots, and an eligible explicit retry remains attached to the same locked turn. Uncertainty is never converted to rejection just to admit another question. A retry of an older failed turn also loses transactionally while a different turn for the episode holds the lock; the UI adopts that authoritative turn without treating the losing retry identity as accepted.

Every provider stage is inserted and committed through a runtime-validated native `better-sqlite3` store before its stage-specific provider-adapter method is entered. Only that successful transaction registers a frozen process-private one-use grant bound to the exact episode, lifecycle row, turn, attempt, stage, model, worker, and lease plus row-scoped lifecycle operations. A structural database lookalike cannot construct a usable store or grant. A stale lease before any reservation becomes an explicit retryable pre-dispatch failure; a reserved, response-received-but-unfinalized, timed-out, cancelled, interrupted, or otherwise unconfirmed stage becomes non-retryable because another call could overlap. The one explicit retry may also follow a safely finalized retryable provider response or stale recovery after every existing stage finalized but before a next stage or publication began, because durable state then proves no provider work is unresolved or in flight. Questions, answers/refusals, resolved citations, timestamps, attempts, safe failures, retry requests, lifecycle rows, and order remain in SQLite across app, worker, and browser restart.

## D-036 — Production migration 008 requires a database backup boundary

Status: **ACCEPTED**
Date: 2026-08-07

Migration `008_episode_grounded_chat` is additive and is verified only against fresh temporary databases and a synthetic migration-007 fixture at the pre-deployment checkpoint. Applying it to the existing LocalCast database requires separate authorization to quiesce the app and worker, create and validate a SQLite-consistent pre-migration backup while preserving media, apply the new image/migration, and prove integrity, persistence, and restart behavior.

Rollback is not an older-image restart: the new schema is intentionally rejected by an older migration plan. A rollback must stop the new processes, preserve the migrated database for diagnosis, restore the validated pre-migration database backup as a unit, and then start the prior image. No migration row may be deleted and no production procedure is implied by the synthetic migration tests.

## D-037 — Follow-up chat has pinned model, request, call, attempt, and audit bounds

Status: **ACCEPTED**
Date: 2026-08-07

Slice 5 follow-up chat is pinned independently of generation to `gpt-5.4-mini-2026-03-17`; any other chat-model value is rejected. Operator-supplied official model facts checked 2026-08-07 record a 400,000-token context window and standard rates of $0.75 per million input tokens and $4.50 per million output tokens ([model documentation](https://developers.openai.com/api/docs/models/gpt-5.4-mini)). Each draft and semantic-support request is serialized completely before its fetch and rejected when the UTF-8 body exceeds 131,072 bytes. The count includes every field actually sent: model/response settings, instructions, roles, delimiters, strict schema, JSON escaping, and outer request structure; the draft also includes the question, complete transcript, and all frozen evidence, while support includes the proposed claims, cited snapshot IDs, and exact excerpts. Treating every counted byte as one input token is a deliberately conservative proxy, not an exact tokenizer result; an additional 8,192-token structural/headroom reserve gives a 139,264-token conservative input bound per independent call. Draft output remains capped at 2,500 tokens and support output at 750 tokens.

A refusal ordinarily uses one external call. A supported answer uses at most one draft and one semantic-support call in a claimed attempt. The support request contains the proposed claims, their cited snapshot IDs, and exact excerpts; it does not resend the complete transcript/evidence context. The provider adapter does not retry automatically, and a turn permits at most the initial attempt plus one explicit user-requested retry. Thus one supported attempt is capped at two call slots and a whole turn at four. Before either provider stage method is entered, one transaction validates the current running attempt and unexpired worker lease, inserts the unique stage row, and only then creates a process-private one-use grant in a module-private weak registry. No issuer is exported or subclassable; copied, serialized, plain-object, mismatched, expired, and reused values fail before request construction or fetch. The grant yields only row-bound monotonic lifecycle operations that repeat current ownership/lease checks; the general lifecycle mutator is an ECMAScript-private store method. Production answer/refusal publication requires the exact compatible finalized lifecycle rows and a current lease; zero-row, partial, unresolved, ambiguous, wrong-attempt, wrong-outcome, or stale-worker publication fails transactionally. Lease fencing prevents stale lifecycle writes or publication, not exactly-once external execution. A crash after reservation can leave an unresolved slot even if no bytes were sent; a crash after provider response but before receipt/finalization persistence can leave only that reservation. Both fail closed and prohibit retry.

At the recorded standard rates, the conservative supported-answer ceiling per attempt is `$0.208896` input (`2 * 139,264 * $0.75 / 1,000,000`) plus `$0.014625` output (`3,250 * $4.50 / 1,000,000`), or `$0.223521`; the single permitted retry makes the turn ceiling `$0.447042`. These are conservative planning estimates, not immutable billing facts. Actual usage may be lower, pricing may change, and LocalCast does not enforce an account/project budget across turns. Operator account/project limits remain authoritative. The existing shared $5 authorization was neither activated nor spent by this repository-only work; the bounded live gate described in O-005 requires separate authorization for one exact episode or fixture, two exact questions, one initial attempt per question, no retries, and no further call after an ambiguous outcome.

Each stage first persists `reserved`; a definitive envelope may advance to `response_received` with only bounded stage/model/identifier/usage metadata, then to a safe finalized outcome. Timeout, cancellation, or transport ambiguity advances the reservation to an ambiguous outcome when the lease still permits it. A process crash may prevent receipt/finalization from being recorded, but the reservation remains and blocks retry. Raw requests, prompts, questions as diagnostics, transcript/evidence bodies, raw responses, rejected content, authorization data, and dollar values are never persisted in this lifecycle table.

Follow-up calls do not write the existing text-generation provider-status row. That row is fingerprinted to the independently configured generation model, so changing it after a call to the pinned chat snapshot would falsely verify or downgrade a model that was not called. Until a dedicated chat-status projection is added, live chat evidence must be recorded separately and must not be presented as generation-model `LIVE VERIFIED` status.

## D-038 — Repository smokes use explicit credential-free process boundaries

Status: **ACCEPTED**
Date: 2026-08-07

`smoke:api` and `smoke:production` construct child environments from a fixed allowlist instead of spreading the parent environment. Real provider keys, podcast credentials, external secret paths, certificate paths, deployment configuration, and unrelated variables are excluded. Both use fresh temporary database/media roots, loopback-only ephemeral listeners, explicit Node executable and entry paths, and no Docker, existing network, volume, container, or deployed port. Production bundles run with a fresh temporary working directory so worker startup cannot discover the repository-root `.env`; API smoke children use the repository working directory only through entrypoints that do not load dotenv. The production app alone receives the configured path of a synthetic temporary podcast-token file inside the smoke root; this is not a mount and the worker does not receive it.

The earlier pre-repair `smoke:production` run was not sufficiently secret-isolated because its worker-negative probe used the repository working directory, where production `dotenv.config()` could discover a root `.env`. No provider request or secret disclosure was observed from that defect, but the earlier broad claim of no real-secret access was unsupported. The repaired smoke results supersede that claim only when the credential-free regression tests and both repaired smokes pass.

## D-039 — Chat text is well-formed Unicode before persistence or provider use

Status: **ACCEPTED**
Date: 2026-08-08

Initial/retry identities, questions, provider claims, and citation excerpts are bounded by Unicode code points only after application validation rejects embedded NUL, U+FFFD, and lone UTF-16 surrogates. Valid surrogate pairs are preserved as their non-BMP code point; values are never normalized, truncated, replaced, or reinterpreted. Invalid API questions receive the bounded validation response before durable mutation, and invalid provider claims/excerpts fail closed before publication.

Migration 008 independently applies the length and representable-byte constraints that SQLite can enforce for persisted identities, including NUL, replacement-character encoding, and raw surrogate encodings. Native SQLite cannot express JavaScript UTF-16 well-formedness directly, so the application boundary remains an explicit layered control rather than being described as an identical database rule. Synthetic tests cover ASCII and non-BMP 7/8/200/201-code-point boundaries, NUL placement, lone surrogates, valid pairs, API/store/database behavior, and close/reopen preservation. Fractional usage metadata remains a documented nonblocking defense-in-depth gap behind application integer normalization.

## Open operator decisions

These are genuine inputs that cannot be inferred safely. They do not block documentation bootstrap. A slice must stop before it needs an unresolved value.

### O-001 — Caddy attachment and canonical origin

Status: **ACCEPTED — RESOLVED 2026-08-06**
Needed by: Slice 4, final Slice 6 gate

The canonical origin is `https://localcast.home.arpa`, privately resolved on the trusted LAN to `192.168.1.167`. The app alone joins the existing external `caddy_default` network with alias `localcast-app`; Caddy proxies only to `localcast-app:8787`. The worker stays off that network and no LocalCast host port is published.

The dedicated origin-root site discards access output and applies unconditional `log_skip`. The sole global runtime logger deletes the complete request object before encoding and writes mode-`0600` `/config/caddy-runtime.json` with 10 MiB rolls, at most five uncompressed retained files, and seven-day retention. A fresh accepted/rejected canary exercised feed, enclosure, range, and Caddy upstream-error paths and produced zero matches in every identified active/rotated sink.

After the operator completed the manual client test, a separate narrow authorization replaced Caddy's fragile single-file bind with the read-only dedicated directory `/opt/stacks/caddy/conf:/etc/caddy` and recreated only Caddy. The canonical host file is `/opt/stacks/caddy/conf/Caddyfile`. Compose changed only at that mount, from SHA-256 `dfe5ad8ec35c0fdd08fa0e4c573b78a125fc758f92608c5063bf55b98560407a` to `e7da033b2d3ad85ced9e9134171b6dc228249ed477edda9b1532869a61dbe0bd`; the Caddyfile stayed `7df64b949d4438f4d8fb62706214960ff96b4b8142e4decc5d264b49e1c20e5a` at both host and container paths. Exact migration backups are `/opt/stacks/caddy/compose.yml.pre-localcast-dir-mount-80ac0cd4` and `/opt/stacks/caddy/Caddyfile.pre-localcast-dir-mount-80ac0cd4`. Existing routes, TLS identity, ports, networks, data/config mounts, and logger behavior remained unchanged. This decision authorizes no public route or unrelated-site modification.

### O-002 — OpenAI model, voice, budget, and credential

Status: **ACCEPTED — RESOLVED 2026-08-06**
Needed by: Slice 1

The operator authorized a project-specific key stored only in ignored root `.env`, explicit cloud processing of deliberately supplied LocalCast station/evidence fields and generated narration, and at most $5.00 for prototype implementation/live verification. Approved configuration is text `gpt-5.4-mini` with low reasoning effort and speech `gpt-4o-mini-tts` with voice `marin` and MP3 output. This consent excludes unrelated host files, credentials, logs, other services, private-network data, and autonomous web research.

Slice 1 used one redacted model-access probe, one draft call, one support call, the representative TTS render, and one TTS-only duration correction. Reliable account-level cost accounting was unavailable, so LocalCast does not claim to enforce or independently prove the $5 ceiling. The operator approved that sample; the consent and total authorization remain unchanged, and Slice 2 made no live provider calls.

### O-003 — Piper executable and voice asset

Status: **OPEN**
Needed by: optional Slice 6 live verification only

To upgrade Piper from `CONTRACT TESTED ONLY`/`NOT CONFIGURED` to `LIVE VERIFIED`, choose the executable/package version, language/voice, model source, checksum, license acceptance, and installation path. Downloading a large model requires explicit authorization. This is not required for deterministic adapter-support evidence.

### O-004 — Real podcast client certification target

Status: **ACCEPTED — RESOLVED 2026-08-06; CLIENT EVIDENCE COMPLETE**
Needed by: Slice 4

The certification target is gPodder 3.11.5 Portable on Windows 11, installed outside OneDrive and all other synchronized storage. The feed is added directly with **Subscribe to new podcast**. gPodder.net, vendor accounts, subscription sync, cloud backup, and OPML sharing remain disabled or unconfigured; subscription storage is treated as local-only. Private-feed use requires `GPODDER_WRITE_LOGS=no`, a session-only combined certifi/Caddy CA bundle, and no verbose command-line client.

The operator attests that subscription add, feed refresh, approved-sample download/play, enclosure seek, restart, refresh, and replay all passed. The downloaded SHA-256 `2a8d83087085974c226691ee285168c9f91a52c60cf74f39406b3240a8fa8071` exactly matched LocalCast persistence, and a recursive search of the gPodder configuration for `*.log` files produced no output. These results are recorded as operator-attested manual evidence rather than independently automated observations. No private subscription URL or client token store was inspected or recorded.

### O-005 — Follow-up cloud-processing consent and live-test budget

Status: **COMPLETE 2026-08-21**
Satisfied by: Slice 5 live acceptance

The Slice 1 consent in O-002 does not authorize sending a follow-up question or its episode context to an external provider. Before any live chat request, the operator must explicitly authorize sending each of two exact chosen questions, the episode's immutable transcript, and all frozen supporting evidence snapshots used to construct grounding to the configured external text provider. A supported answer can require a second external semantic-support request; a refusal ordinarily requires one request, but an intended refusal can return an answer-shaped draft and therefore also reach the support call before failing closed. The operator must identify the exact approved episode or synthetic fixture and approve a bounded amount within the still-shared $5.00 prototype ceiling. Using the standard rates recorded on 2026-08-07, the expected no-retry cost ceiling for one supported answer plus one ordinary one-call refusal is `$0.223521 + $0.115698 = $0.339219`; the hard conservative two-question, no-retry gate ceiling is `2 * $0.223521 = $0.447042`, covering up to two calls for each initial attempt. Reliable account-level usage accounting is unavailable and LocalCast does not enforce a global budget across turns, so operator account/project spend limits remain authoritative. The separately authorized live gate must use only those two exact questions, one initial attempt each, no retries, and stop rather than issue another request if an outcome is ambiguous or the expected supported/refusal pair is not achieved. Required evidence remains one supported grounded answer and one evidence-insufficient refusal with only bounded usage/audit metadata retained and no prompt, source body, or raw provider response artifact.
The live gate completed on 2026-08-21 using synthetic fixture `run-o005-atomic-66552802-ca97-4996-a0a9-4456485dce9e`. The supported attempt answered with `18 hours`, one grounded claim, and its exact atomic citation; the refusal ended `EVIDENCE_INSUFFICIENT` with zero claims. Exactly three provider requests were made, with no retries or duplicate dispatches, and both lifecycle outcomes finalized correctly. Final schema 008, integrity, foreign-key, identity, quiescence, and app/worker health checks passed on the bound immutable image. The earlier `run-o005-aurora-9cd647a5-b61b-47d0-8caf-16a142c5e8e3` diagnostic remains retained as evidence of fail-closed behavior after `CHAT_UNSUPPORTED_CLAIM`; it was not retried.

### O-006 — Slice 5 production backup, migration, and deployment

Status: **COMPLETE 2026-08-21**
Needed by: Slice 5 deployment/restart acceptance

The authorized O-006 operation started at `2026-08-21T15:29:58Z` and completed at `2026-08-21T15:30:23Z`. The validated schema-007 backup is `/opt/stacks/localcast-backups/schema007-pre-migration-20260821T132838Z/localcast.sqlite.007` with SHA-256 `0ee6e8e0c40b401d0dfe61ab88ab7f42c35655a51f92ae5107df46db41454afa`; its checksum chain was verified. Migration 008 completed, and schema, integrity, foreign-key, installation-identity, and quiescence checks passed without disclosing protected data. App and worker deployed healthy on immutable image `sha256:af9a5635deccac039955317be7652f8d757001022e3a265df3af6a4a6a8e1fd8`; loopback health and controlled restart passed. No provider dispatch occurred, rollback was not invoked, and distinct rollback tags remain retained. Temporary operational files were removed and no storage-init container remains.
