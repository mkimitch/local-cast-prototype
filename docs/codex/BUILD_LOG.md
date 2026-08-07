# LocalCast build log

This append-only log records implementation checkpoints, reproducible gates, review findings, and repair evidence. Secrets, provider payloads, and operator data must never be recorded here.

## 2026-08-05 — Slice 0: durable generation foundation

Base HEAD: `e720d5818ab15efccfa143c94d6514c0c9a2baad`
Branch: `codex/localcast-prototype`
Runtime: Node `v20.19.2`, npm `9.2.0`, Docker `29.6.0`, Compose `5.1.4`

### Delivered

- Strict Zod runtime/role/provider configuration with production fail-closed behavior and exact provider status labels.
- Explicit, identity-bound production storage initialization; ordered migration 004; SQLite integrity/FTS checks; no demo seeds.
- Durable FIFO jobs, attempts, events, millisecond-precise leases, heartbeats, process-unique fencing, retry primitives, and a separate worker.
- Test-only deterministic transcript/MP3 generation isolated from production build entrypoints and Docker context.
- Same-origin production UI/API serving, relative browser API access, no browser credential fields or mock fallback, and no third-party font request.
- Digest-pinned non-root/read-only Compose app and worker with separate persistent SQLite/media volumes and profile-gated initialization.
- Vitest, Playwright, API/process, production-artifact, and Compose test layers.

### Independent read-only reviews

Three reviewers separately covered architecture, runtime/deployment, and security/privacy/accessibility. Material findings were fixed before the final gate: explicit storage initialization, lease heartbeat/fencing and precise expiry, production/test artifact separation, identity-before-migration, legacy status reconciliation, active shutdown evidence, process-level claim/crash tests, legacy topic quarantine, fake repeatability, browser phase/reload/no-autosync evidence, and accessibility/error-state cleanup. No subagent edited files.

### Repair ledger

| Area | Failing evidence | Evidence-based repair | Final result |
| --- | --- | --- | --- |
| Browser generation scenario | `npm run test:e2e` first found ambiguous `Sources`; later runs showed reload returned to the in-memory Dashboard and `View` matched `View history`. | Required exact accessible names, reopened the persisted run after reload, and lengthened deterministic phase visibility. | Targeted scenario and final two-test browser gate pass. |
| Worker crash harness | `npm run test:integration` first intermittently let the validating attempt complete; after lease precision was corrected, all six crash cases consistently showed the killed launcher’s child surviving. | Serialized Vitest files and launched test TypeScript with `node --import tsx`, so SIGKILL targets the actual worker. | All phase kills and post-publication replay pass; final integration suite is 31/31. |
| Lease heartbeat | `npm run test:integration` allowed a competitor to reclaim a heartbeating lease within the same second. | Compared fixed-width UTC ISO timestamps directly instead of SQLite `datetime()`, which discarded milliseconds; aligned the lease index. | Focused heartbeat/queue suite 16/16; final integration suite passes. |
| Compose smoke | Initial runs omitted the profile-gated initializer from static config, then used top-level `await` in a CommonJS `node -e` probe. | Inspected config with the `init` profile and wrapped probes in async functions with correct escaping. | Final Compose gate proves fresh-volume refusal, explicit init, healthy non-root roles, no host port, clean artifact, and persistence across container recreation. |

No deterministic failure remained after three repair attempts. Docker verification required approved access to the local engine because sandboxed BuildKit metadata was read-only; it used only unique `localcast-slice0-*` projects and removed their containers, networks, and volumes.

### Targeted evidence

| Exact command | Result |
| --- | --- |
| `npm audit --omit=dev` | PASS, exit 0 — `found 0 vulnerabilities` |
| `npm run lint` | PASS, exit 0 — TypeScript emitted no diagnostics |
| `npm run test` | PASS, exit 0 — 2 files, 31 tests |
| `npm run test:integration` | PASS, exit 0 — 4 files, 31 tests |
| `NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-vitest-media npx vitest run tests/integration/worker-process-recovery.test.ts` | PASS, exit 0 — 8 process tests, including competing workers, every persisted phase, active SIGTERM, and post-publication replay |
| `npx playwright test tests/e2e/generation-phases.spec.ts` | PASS, exit 0 — explicit sync/generation, zero pre-action fetches/jobs, all phases, reload/reopen, persisted completion |
| `npm run smoke:api` | PASS, exit 0 — API/worker separation, deterministic repeatability, safe failure, restart persistence |
| `npm run smoke:compose` | PASS, exit 0 — isolated image/topology/storage/recreation gate |
| `git diff --check` | PASS, exit 0 at 2026-08-05 18:39:04 CDT — no whitespace errors after documentation reconciliation |

### Full phase gate

Started 2026-08-05 18:30:42 CDT:

```text
npm run verify
```

PASS, exit 0:

- `npm run lint`: no diagnostics;
- `npm run test`: 31/31;
- `npm run test:integration`: 31/31;
- `npm run build`: Vite transformed 2,090 modules; server emitted `index.js`, `worker.js`, and `storageInit.js` without source maps;
- `npm run test:e2e`: 2/2;
- `npm run smoke:api`: passed;
- `npm run smoke:production`: passed;
- `npm run smoke:compose`: passed.

The next slice requires O-002: server-side OpenAI configuration, explicit cloud-processing consent, and a minimal authorized live-test budget.

## 2026-08-06 — Slice 1: real OpenAI walking skeleton

Base HEAD: `c2604ed93b4c6b0a977405b5f74a7f40baae3f47`
Branch: `codex/localcast-prototype`
Runtime: Node `v20.19.2`, npm `9.2.0`, Docker `29.6.0`, Compose `5.1.4`

### Delivered

- Additive migration 005 for pasted notes, stations, immutable requests/evidence, transcript claims/citations, validated media metadata, and provider checks.
- Durable note/station CRUD and manual note-backed generation through one persistent worker job; RSS-backed generation is gated until Slice 2 synchronization and deep mode is gated until listening approval.
- Fixed-origin server-side OpenAI Responses adapter using `gpt-5.4-mini`/low, strict schemas, exact snapshot/excerpt validation, and a second bounded support classification with no tools/search/fallback.
- Worker-only OpenAI speech using `gpt-4o-mini-tts`, `marin`, MP3 and speed `1.05`; narration/render fingerprinting, unique/cleaned temp files, fsync/atomic rename, stripped ffprobe environment, MP3-format/duration validation, checksum, and stable reuse metadata.
- React Router/TanStack Query episode flow, resolved transcript citations, real same-origin media, native inline/persistent playback, visible media failure, and spoken/visible AI-generated disclosure.
- Deterministic tests now publish v2 fixture episodes through the same claim/citation/media transaction with a real decodable byte-stable MP3.
- Media lookup is completed-only and rejects traversal metadata, symlinks, wrong size/checksum, corruption, and unpublished assets.
- Compose accepts an absent key and reports `NOT CONFIGURED`, injects a configured key only into the worker, and includes pinned ffmpeg/ffprobe in the non-root read-only image.

### Independent read-only reviews

Three reviewers separately covered architecture/correctness, runtime/Docker/test gaps, and security/privacy/accessibility. No reviewer edited files. Their material findings were reconciled before the full gate: content-bound audio replay, unique temp recovery, authoritative provider readiness, per-worker live re-verification, all-provider-segment grounding, accurate validating phase, RSS/deep slice gates, strict MP3 format, stripped ffprobe credentials, full disclosure, deterministic publication parity, media route integrity tests, migration-004 upgrade coverage, and visible playback failure.

### Live authorization and sample evidence

- Root `.env` was confirmed only as a regular ignored mode-`600` file with `OPENAI_API_KEY` present; its value was never read into output.
- A redacted Compose parse reported only the worker as receiving a nonempty credential. App, storage initialization, browser APIs/assets/storage, ffprobe, and recorded artifacts have no key/header.
- A single model-access GET returned HTTP 200 for `gpt-5.4-mini`; no key/header/body was retained.
- The actual LocalCast API created the synthetic acceptance note and station, enqueued run `run-737b6807-a8e1-4cff-95d7-9797138b7671`, and the persistent worker completed draft, support, TTS, atomic transcript/citation/media publication, and provider status.
- Initial speech at speed `0.95` measured 96.360 seconds. One TTS-only correction at `1.05` produced 78.912 seconds; text was not regenerated. A failure after file replacement but before metadata update was reconciled from the validated on-disk file without another provider call.
- Final persisted and HTTP media are 1,262,592 bytes, SHA-256 `2a8d83087085974c226691ee285168c9f91a52c60cf74f39406b3240a8fa8071`, `audio/mpeg`; ffprobe reports MP3 codec/format and `78.912000` seconds. Chromium observed real load/play/pause/seek/time events and 7 resolved citations.
- The sample’s full database projection and MP3 survived app/worker recreation. Text and speech report `LIVE VERIFIED` with timestamps. Reliable account-level cost accounting was unavailable, so no application-enforced $5 claim is made.

### Repair ledger

| Area | Failing/review evidence | Evidence-based repair | Final result |
| --- | --- | --- | --- |
| Grounding | A model could label invented facts as an uncited `transition`; section titles were also provider-authored. | Restricted every provider segment to cited factual output and support classification; LocalCast owns fixed disclosure/transitions/titles. | Adversarial transition fixture rejects before support/publication; provider contracts pass. |
| Crash-safe speech | Run-ID-only reuse could pair regenerated transcript with old MP3; PID temp could block recovery; reused `validatedAt` changed. | Bound filename to narration/render SHA-256, used unique temp names plus stale cleanup, and derived validation time from immutable file metadata. | Same narration reuses exactly; changed narration renders a different file/hash; no temp remains. |
| Provider readiness | Persisted `NOT CONFIGURED` did not disable UI/API; prior live status could survive a new worker/credential; Compose empty key failed parsing. | Made persisted status authoritative, route reuse the same summary, downgraded on each configured worker boot, normalized empty credential to absent, and made Compose injection optional. | Unit status/config tests and Compose no-key startup/typed-disable evidence pass. |
| Credential least privilege | ffprobe inherited the worker environment. | Passed only fixed PATH and `LC_ALL=C`; added a child-env canary executable. | Canary probe succeeds only when `OPENAI_API_KEY` is absent. |
| MP3 validation/media | ffprobe checked only duration; media route trusted same-size files and followed symlinks. | Required ffprobe `format_name=mp3`; lstat regular-file, exact size and SHA before streaming. | Negative format, corruption, symlink, traversal and unpublished cases reject. |
| Test publication | v2 fake output used legacy section/audio records, so browser tests could pass without claims/citations/playable media. | Published deterministic v2 evidence/claims/citations/audio atomically with a real 0.5-second MP3. | Browser verifies resolved citation plus actual media GET/decode/play. |
| Migration fixture | First focused 004 snapshot upgrade left an injected orphan run unreconciled. | Reapplied secret scrub/orphan reconciliation defensively in migration 005. | Focused migration test and full unit suite pass. |
| Full gate API smoke | First full gate retained an obsolete 417-byte fake-MP3 assertion. | Asserted the new stable ID3 fixture and retained byte-equality replay proof. | API smoke passes. |
| Full gate Compose | Next full gate showed explicit empty `OPENAI_API_KEY` failed Zod before storage verification. | Preprocessed blank credential as absent and added a unit contract. | Final Compose gate starts no-key app/worker at `NOT CONFIGURED` and passes recreation. |

No same deterministic failure remained after three evidence-based repair attempts. The initial sandboxed full gate reached Compose but BuildKit could not update its read-only user activity file; the final run used approved Docker access and only disposable uniquely named smoke resources.

### Targeted and full evidence

| Exact command | Result |
| --- | --- |
| `npm run lint -- --pretty false` | PASS, exit 0 — no TypeScript diagnostics |
| `NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-vitest-unit-review npx vitest run tests/unit/openai-provider.test.ts tests/unit/provider-status.test.ts tests/unit/config.test.ts tests/unit/migrations.test.ts` | PASS after one repair — 4 files, 60 tests |
| `NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-vitest-integration-review npx vitest run tests/integration/station-generation.test.ts tests/integration/media-route.test.ts` | PASS — 2 files, 7 tests |
| `npx playwright test tests/e2e/foundation.spec.ts tests/e2e/generation-phases.spec.ts` | PASS — 2 browser tests |
| `LOCALCAST_LIVE_URL=http://127.0.0.1:43182 LOCALCAST_LIVE_EPISODE_ID=run-737b6807-a8e1-4cff-95d7-9797138b7671 npm run verify:live-browser` | PASS — 78.912 seconds, required native media events, 7 citations, zero external origins/credential fields |
| `npm run verify` | PASS, exit 0 — 61 unit, 38 integration, production web/server build, 2 Playwright, API, production, and Compose gates |
| `npm audit --omit=dev --audit-level=high` | EXIT 1 — two highs in React Router 7.18.2, both from GHSA-qwww-vcr4-c8h2; official applicability is unstable RSC only, which this declarative BrowserRouter SPA does not use; no patched 7.x release exists |

### Listening gate

The loopback-only page `http://127.0.0.1:43182/episodes/run-737b6807-a8e1-4cff-95d7-9797138b7671` was left available for the operator, and work stopped pending explicit listening approval. The operator subsequently approved this sample at checkpoint `1790e91f1b37d518b18f4834b59cb7d9ba160823` as the functional single-host baseline.

## 2026-08-06 — Slice 2: safe feed ingestion and FTS5

Base HEAD: `1790e91f1b37d518b18f4834b59cb7d9ba160823`
Branch: `codex/localcast-prototype`
Runtime: Node `v20.19.2`, npm `9.2.0`, Docker `29.6.0`, Compose `5.1.4`

The operator approved the Slice 1 sample as the functional single-host baseline. Its `marin` voice remains usable but is not the final audio identity. The requested grounded two-host format is recorded as the first post-prototype audio milestone and was not implemented or used to delay this slice.

### Delivered

- Additive migration 006 adds feed validators/leases/provenance, immutable request-source state, FTS5 tables/triggers/backfill, and safe upgrade behavior for cached migration-005 feed items.
- Manual RSS 2.0 and Atom CRUD/sync/inspection use conditional requests, stable dedupe, health/backoff, and URL/lease fencing. Only enqueue-captured station feeds synchronize, only their stored items can enter evidence, and linked article pages are never requested.
- Native HTTP(S) feed transport pins resolved addresses and revalidates every redirect and connected socket; public hosts are the default, exact configured private hosts are explicit exceptions, and credentials/metadata/link-local destinations are rejected.
- Feed header/body/MIME/encoding/item/field/concurrency/DNS/queue/idle/total bounds fail with stable safe codes. Credential-like query names are rejected, while legacy credential-bearing URLs are hidden and quarantined until replaced.
- Network scope is immutable per fetched item. Private or unknown feed evidence cannot cross the current OpenAI consent boundary, even if a source later resolves publicly.
- Evidence is capped at 50 complete items and 120,000 aggregate source characters; the OpenAI request boundary rejects serialized user material above 160,000 characters.
- SQLite FTS5 searches feed items and notes with provenance through insert/update/delete, punctuation/ranking, rebuild, online backup, and reopen. Source and station UIs expose safe search, sync/inspection, inactive-selection cleanup, and focus/live-state behavior.
- The public generation route accepts only station-backed jobs. Final evidence commits before the provider-boundary callback and remains byte-identical after feed refresh, source deletion, and database reopen.

### Independent read-only reviews

Three reviewers separately covered architecture/correctness, runtime/Docker/test gaps, and security/privacy/accessibility. No reviewer edited files. The primary thread fixed every material finding: stale writes after lease expiry or URL edit, DNS/queue work outside the total deadline, missing migrated-cache URL fallback, mutable source-wide private provenance, credential URL exposure, unbounded aggregate provider input, expired source leases appearing permanently busy, obsolete public job payloads, missing provider-boundary proof, inactive selections that could not be removed, station revisions after source/note deletion, uncleared optional categories, and source inspection/delete focus behavior.

### Repair ledger

| Area | Failing/review evidence | Evidence-based repair | Final result |
| --- | --- | --- | --- |
| Safe fetch lookup | The first focused fixture did not route the custom resolver through the pinned request socket. | Bound request lookup to the already-approved address set and retained connected-address validation. | One repair; focused and full fetch suites pass. |
| Browser fixture | Generation polling and pointer-dependent inactive-source selection raced the rendered state. | Waited on persisted UI state and exercised the semantic keyboard control. | One repair; Playwright passes. |
| Atomic sync/provenance review | A late lease holder or URL edit could publish stale items; source-wide scope could relabel retained private items. | Moved final upsert/validator completion under one immediate URL/lease transaction and persisted scope on every item. | First focused review rerun passes. |
| API smoke migration | The station-backed smoke assumed storage basenames and cross-run citation IDs. | Fetched the same-origin media route and compared stable transcript/citation structure rather than generated IDs. | Two repairs; third run and full gate pass. |

No same deterministic failure remained after three evidence-based repair attempts.

### Targeted and full evidence

| Exact command | Result |
| --- | --- |
| `npm run lint -- --pretty false` | PASS, exit 0 — no TypeScript diagnostics |
| `npm run test` | PASS, exit 0 — 6 files, 108 tests |
| `npm run test:integration` | PASS, exit 0 — 9 files, 53 tests |
| `NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-vitest-slice2-review npx vitest run tests/unit/safe-feed-fetcher.test.ts tests/unit/source-validation.test.ts tests/unit/openai-provider.test.ts tests/integration/rss-ingestion.test.ts tests/integration/material-search.test.ts tests/integration/selected-feed-generation.test.ts tests/integration/station-generation.test.ts` | PASS, exit 0 — 7 files, 89 focused tests after review repairs |
| `npm run build` | PASS, exit 0 — Vite transformed 2,150 modules and emitted all server bundles |
| `npm run test:e2e` | PASS, exit 0 — 3 Playwright flows |
| `npm run smoke:api` | PASS, exit 0 — station-backed generation, idempotency, failure, media, and restart evidence |
| `npm run verify` | PASS, exit 0 with approved Docker access — lint, 108 unit, 53 integration, build, 3 browser, API, production, and isolated Compose build/init/health/recreation gates |
| `npm audit --omit=dev --audit-level=high` | EXIT 1 — the known two high React Router RSC-only advisories; this declarative `BrowserRouter` application has no RSC/framework/action/SSR path, and npm offers only a breaking forced downgrade |
| `stat -c '%F mode=%a' .env` and `git check-ignore -v .env` | PASS — regular file, mode `600`, ignored at `.gitignore:24`; value not read or printed |
| redacted `docker compose config --format json` assertion | PASS — `credentialServices=["worker"]`, `workerOnly=true`; no value/header printed |
| `git diff --check` | PASS, exit 0 |

The sandboxed full gate passed through production smoke and then hit only BuildKit's read-only user activity path. The approved rerun used the local Docker engine, created and removed only unique `localcast-slice1-*` smoke resources, and passed. It did not touch Caddy, the loopback listening deployment, or operator data. No live OpenAI request was made during Slice 2.

## 2026-08-06 — Slice 3: grounded modes, library, failure, retry, and player

Base HEAD: `199ea0ffa082349b07c7dc3916a5f16affb91f5a`
Branch: `codex/localcast-prototype`
Runtime: Node `v20.19.2`, npm `9.2.0`, Docker `29.6.0`, Compose `5.1.4`

### Delivered

- Source-bounded brief/deep policies: 600–1,000 words for an adequate brief, a shorter supported sparse brief, and 1,800–3,000 words for deep only when at least 1,800 unique evidence words/7,200 characters are supplied. Duplicate content digests cannot manufacture sufficiency.
- Additive migration 007 for version-aware ordered single-host segments and durable retry-request identity. Historical monolithic transcript rows remain unversioned; new scripts persist version 1, stable segment IDs, citation order, `host`, and optional speaker/voice seams.
- Strict mode/output/citation/excerpt/support validation plus an evidence-derived deterministic fact oracle that rejects injected instructions, unrelated compound assertions, and unsupported/uncertain classifications.
- Durable mode/status library filters, phase progress, safe correlated failure panels, attempt history, idempotent manual retry, frozen-evidence semantics, and non-retryable insufficiency behavior.
- A persistent real-audio player with play/pause, seek, skip, speed, elapsed/duration, download, keyboard control and visible error state.
- Long single-host narration transport: up to eight 4,096-character OpenAI TTS requests with unchanged server-side speech configuration, then pinned ffmpeg concatenation into one MP3 before strict ffprobe/checksum/fsync/atomic publication. This is one-host transport assembly, not the deferred dialogue/multi-voice feature.
- Cancellation and lease fencing through speech requests, ffmpeg, ffprobe and publication; safe partial-write cleanup; recovery that never promotes cached audio to a live provider verification.
- Playwright/axe coverage for all injected generation phases and retries, route focus, concise live announcements, high contrast, reduced motion, 320 CSS-pixel reflow, and 200% text.

### Independent read-only reviews

Three reviewers separately covered architecture/correctness, runtime/Docker/test gaps, and security/privacy/accessibility. No reviewer edited files, used credentials, made network requests, or ran tests. Their material findings were repaired before the full gate: retry idempotency persistence, duplicate evidence inflation, truthful migration versioning, render cancellation/lease fencing, every-phase failure UX, real ffmpeg evidence, partial-write cleanup/classification, production-shaped v2 restart recovery, cache-vs-live speech state, pre-freeze retry wording, evidence-derived support classification, player reflow, route-focus fallback, and duplicate alerts. Closure reviews reported the architecture and runtime findings closed; the final alert nesting finding was removed before the gate.

### Repair ledger

| Area | Failing/review evidence | Evidence-based repair | Final result |
| --- | --- | --- | --- |
| Focused test environment | A direct Vitest invocation omitted required runtime variables and two suites failed during config collection. | Reused the repository's explicit test runtime contract. | Focused suites and both complete Vitest layers pass. |
| Retry durability | A second failed retry could accept another click without a durable request identity; retry copy implied frozen evidence before selection. | Added transactional per-job idempotency keys, API/client key handling, replay tests, and explicit `evidenceFrozen` projection/copy. | Same-key replay adds no attempt; distinct eligible retry adds exactly one; phase wording is accurate. |
| Sufficiency and grounding | Repeated identical snapshots could inflate deep evidence; the first oracle matched fixture phrases rather than actual claim/snapshot/excerpt. | Counted unique content digests and derived deterministic support from the real evidence tuple. | Deep duplicate inflation and unrelated compound claims fail; supported controls pass. |
| Version/restart | Migration 007 initially labeled monolithic historical transcripts version 1; v2 restart evidence was only indirectly covered. | Made the field nullable with conditional backfill and added a production-shaped process crash/recovery integration. | Frozen migration upgrades and v2 restart/replay pass. |
| Speech transport | Multi-request narration needed lease renewal/cancellation, real-tool proof, partial-write cleanup and honest cache status. | Fenced each boundary, registered temps before writes, classified `AUDIO_WRITE_FAILED`, tracked live requests, and added real ffmpeg/ffprobe Compose smoke. | Focused/provider/process tests and isolated real-tool smoke pass with no partial publication. |
| Browser accessibility | Review found narrow-player overflow, route-focus fallback gaps, and duplicate failure announcement semantics. | Reflowed controls at narrow width, focused route heading/main, and retained one concise assertive failure message. | 320px/200% bounds, keyboard, axe, desktop/mobile visual inspection and all-phase browser tests pass. |

No same deterministic failure remained after three evidence-based repair attempts.

### Targeted and full evidence

| Exact command | Result |
| --- | --- |
| `npm run lint -- --pretty false` | PASS, exit 0 — no TypeScript diagnostics |
| `npm run test` | PASS, exit 0 — 8 files, 137 tests |
| `npm run test:integration` | PASS, exit 0 — 10 files, 63 tests |
| `npm run build` | PASS, exit 0 — Vite transformed 2,150 modules; all server bundles emitted |
| `npm run test:e2e` | PASS, exit 0 — 7 Playwright/axe tests in 1.7 minutes |
| `npm run smoke:api` | PASS, exit 0 |
| `npm run smoke:production` | PASS, exit 0 |
| `npm run verify` | PASS, exit 0 with approved Docker access — lint, 137 unit, 63 integration, build, 7 browser, API, production, and isolated Compose gates |
| Compose stage within `npm run verify` | PASS — build/init/non-root app+worker/recreation plus real two-chunk MP3 concatenation and real ffprobe validation; disposable resources removed |
| `env NPM_CONFIG_CACHE=/tmp/localcast-npm-audit-cache npm audit --omit=dev --audit-level=high` | EXIT 1 — unchanged two high React Router RSC-only advisories; no applicable RSC/framework/action/SSR path and only a breaking forced downgrade is offered |
| `stat -c '%F mode=%a' .env` and `git check-ignore -v .env` | PASS — regular file mode `600`, ignored at `.gitignore:24`; value not read or printed |
| redacted Compose credential-scope assertion | PASS — only `worker` receives `OPENAI_API_KEY`; no value or authorization header printed |
| `git diff --check` | PASS, exit 0 after durable-document reconciliation |

The first sandboxed `npm run verify` passed through production smoke and failed only because BuildKit could not write `/home/mkimitch/.docker/buildx/activity`. The authorized exact rerun used the local Docker engine, passed, and removed only its uniquely named disposable resources. It did not touch Caddy, the listening deployment, or operator data. No live OpenAI call or additional authorized spend occurred in Slice 3.

### Slice 4 entry stop

O-001 and O-004 remain open. No Slice 4 implementation began. Resume requires the canonical trusted-LAN HTTPS origin, Caddy attachment/log-redaction facts, and an approved reachable podcast client/version with local subscription storage or explicit vendor-cloud token disclosure acceptance. The podcast token must later be supplied only through ignored server-side configuration.

## 2026-08-06 — Slice 4 private podcast delivery and client gate

Starting checkpoint was exactly `80ac0cd4e70e0893f0f9a1b12e99d274f366af80` on `codex/localcast-prototype` with a clean worktree and index. Both approved DNS servers returned only `192.168.1.167` for `localcast.home.arpa`. The original Caddyfile and Compose hashes matched `7c9fc9078cc876a18e5a3e1f3091fbe9d40775ef02923acc045f8f92c0d00ec7` and `dfe5ad8ec35c0fdd08fa0e4c573b78a125fc758f92608c5063bf55b98560407a`; `caddy_default` existed with the `localcast-app` alias free. The rollback image tag `localcast:pre-slice4-80ac0cd4` was created before implementation.

### Implementation and independent review

The slice extends the existing Express/SQLite/media architecture with canonical production origin enforcement, no-follow protected token loading, one completed-only podcast projection, strict RSS serialization, shared validated media delivery, exact conditional/range handling, a transient operator clipboard flow, app-only secret/network Compose overlays, and purpose-built canary verification/scanning. No migration or speculative multi-host audio refactor was needed. The version-1 single-`host` ordered transcript remains the publication boundary, preserving the deferred post-prototype audio milestone.

Three independent read-only reviewers covered deployment/accessibility, gPodder/feed/media interoperability, and security/privacy. No reviewer edited files or used credentials. Findings fixed before the full gate included conditional-header precedence, strict publishability alignment, negative publication fixtures, strict RSS metadata evidence, the complete route token matrix, descriptor-bound media streaming, clipboard cleanup, trace/screenshot suppression, narrow/200%-text reflow, dark/high-contrast button contrast, and comprehensive accepted/rejected canary sink coverage. Closure security review found no repository blocker.

### Automated repository evidence

| Exact command | Result |
| --- | --- |
| `env BUILDX_CONFIG=/tmp/localcast-slice4-buildx npm run verify` | PASS, exit 0 — lint, 151 unit, 71 integration, build, 8 browser/axe, API smoke, production smoke, and disposable Compose smoke |
| `node --check` run separately for `create-podcast-token.mjs`, `verify-podcast-canary.mjs`, `scan-podcast-canary.mjs`, `live-compose.mjs`, and `capture-journal-cursor.mjs` | PASS, exit 0 for all five |
| `git diff --check` | PASS, exit 0 before durable-document update |

The first complete browser gate exposed a pre-existing sidebar contrast issue only because a new test had changed the whole page to dark/high-contrast. The repair retained the existing whole-page default axe scan and scoped the additional theme assertions to the new private-feed surface; the complete gate then passed. No test was weakened or replaced by a mock.

### Authorized deployment evidence

`scripts/live-compose.mjs` reconciled the two persisted installation markers without displaying their value, built `localcast:prototype`, and recreated only the existing `localcast-slice1-listening` app and worker against their original named data/media volumes. Only app joined `caddy_default` with alias `localcast-app`; worker remained off that network. Both were healthy with restart count 0, and neither published a host port. The approved episode remained complete with script version 1, 5 sections, 7 citations, 1,262,592-byte validated MP3, SHA-256 `2a8d83087085974c226691ee285168c9f91a52c60cf74f39406b3240a8fa8071`, and ffprobe duration `78.912000` seconds.

The original Caddyfile was backed up exactly to `/opt/stacks/caddy/Caddyfile.pre-localcast-80ac0cd4`, retaining its recorded hash. The new host Caddyfile validated under Caddy 2.11.1. Because Caddy Compose bind-mounted that file as one read-only inode, pathname replacement did not update the running container's mount: the prescribed path command validated the original inode and the first reload correctly reported `config is unchanged`. Repair cycle 1 revalidated the exact new candidate from stdin and gracefully loaded it from stdin. Caddy was not restarted/recreated at that gate. The authoritative host Caddyfile had SHA-256 `7df64b949d4438f4d8fb62706214960ff96b4b8142e4decc5d264b49e1c20e5a`; the running runtime had the same behavior, while the container's `/etc/caddy/Caddyfile` retained the original inode pending the separately authorized remediation recorded below.

After runtime load, all baselines matched with TLS verification result 0: `pdf.home.arpa` 401 JSON, `weather.home.arpa` 404 JSON, `menu.home.arpa` 404 JSON, and `app.home.arpa` 200 text. `https://localcast.home.arpa/api/health` returned 200 JSON. Caddy restart count remained 0, and `/opt/stacks/caddy/config/caddy-runtime.json` was mode `600`.

### Zero-retention gate

A disposable 256-bit accepted canary and an in-memory derived rejected token exercised feed GET/HEAD, enclosure GET/HEAD, an exact 1,024-byte range, invalid feed/enclosure GET/HEAD/range equivalence, and a 502 Caddy runtime-error path while only the disposable app was stopped. Output contained only assertion IDs, methods, status codes, lengths, and checksums.

The first scan produced zero token matches but failed closed on raw-log permissions, one `/var/log/README` documentation symlink outside the scan root, and Git's root safe-directory guard. One bounded scanner repair scanned the link text without following it, supplied the exact repository as Git's one-shot safe directory, and used a read-only/no-network host scan boundary. A complete rerun used a fresh canary and passed all request assertions. Every sink then reported `matches=0 errors=0`: Caddy runtime files; Caddy/app/worker active and rotated Docker JSON logs; systemd journal after the protected cursor; `/var/log`; Caddy data/config; LocalCast data/media; repository/Git diff; relevant `/tmp`; and container metadata/image history. The app restarted healthy with restart count 0. No OpenAI call occurred.

Final primary diff review then found two additional fail-closed edges: an unexpected browser Origin on a token-bearing path should retain the same generic podcast `404`, and publication should positively require an AI-generated run with at least one supported cited factual claim rather than rely on the absence of known-bad facts. One narrow repair added both guards and negative fixtures. The first targeted invocation used `vitest` without `npx` and exited 127 before collection; the corrected repository-local command passed 2 files/5 tests, lint passed, and a complete `env BUILDX_CONFIG=/tmp/localcast-slice4-buildx npm run verify` rerun passed 151 unit, 71 integration, build, 8 browser/axe, API, production, and disposable Compose gates. The production image was rebuilt and only app was force-recreated with the existing real secret; it returned healthy without touching worker, Caddy, or volumes.

Only after that fresh zero-match result, a real token was created in ignored `.secrets/podcast-token` under mode-`700` `.secrets`, with file mode `600`, and only app was force-recreated to mount it read-only. Worker identity and health remained unchanged. The public Caddy root was then exported only to ignored mode-`0644` `.operator/localcast-caddy-root.crt`; its subject is `CN=Caddy Local Authority - 2026 ECC Root` and certificate SHA-256 fingerprint is `E7:33:C4:0B:63:DE:27:CE:20:F3:30:43:89:58:B1:03:35:16:E6:ED:69:1E:2B:E9:BA:72:E1:E2:4E:E1:A4:66`.

### Client gate result

The earlier stop was satisfied by operator-attested manual evidence. gPodder 3.11.5 Portable on Windows 11 passed subscription add, feed refresh, approved-sample download/play, enclosure seek, restart, refresh, and replay. The downloaded SHA-256 was `2a8d83087085974c226691ee285168c9f91a52c60cf74f39406b3240a8fa8071`, exactly matching LocalCast. The operator's recursive gPodder configuration search for `*.log` files produced no output. The client remained outside synchronized storage with gPodder.net, vendor accounts, sync, cloud backup, OPML sharing, and file logging disabled or unconfigured. These are operator-attested results, not independently automated observations; no private subscription URL or client token store was requested or inspected.

### Dedicated Caddy configuration mount remediation

The manual client gate preceded this mount-only remediation. Preflight reconfirmed branch `codex/localcast-prototype`, base HEAD `80ac0cd4e70e0893f0f9a1b12e99d274f366af80`, the exact recognized Slice 4 diff, no staged or unexpected files, both DNS responses `192.168.1.167`, and healthy Caddy/app/worker state. The live Caddy runtime's canonical adapted JSON exactly matched the LocalCast-enabled host Caddyfile. Pre-migration HTTP/TLS baselines were `pdf.home.arpa` 401 JSON, `weather.home.arpa` 404 JSON, `menu.home.arpa` 404 JSON, `app.home.arpa` 200 text, LocalCast health 200 JSON, and LocalCast settings 200 HTML; every TLS verification result was 0.

The operator-authorized migration created these non-overwriting backups:

- `/opt/stacks/caddy/compose.yml.pre-localcast-dir-mount-80ac0cd4` — SHA-256 `dfe5ad8ec35c0fdd08fa0e4c573b78a125fc758f92608c5063bf55b98560407a`
- `/opt/stacks/caddy/Caddyfile.pre-localcast-dir-mount-80ac0cd4` — SHA-256 `7df64b949d4438f4d8fb62706214960ff96b4b8142e4decc5d264b49e1c20e5a`

The canonical configuration moved without content, ownership, or mode change to `/opt/stacks/caddy/conf/Caddyfile`; the old `/opt/stacks/caddy/Caddyfile` path is absent. The dedicated directory contains only that configuration input and has no relative imports. Caddy Compose changed only from `./Caddyfile:/etc/caddy/Caddyfile:ro` to `./conf:/etc/caddy:ro`. Its SHA-256 changed from `dfe5ad8ec35c0fdd08fa0e4c573b78a125fc758f92608c5063bf55b98560407a` to `e7da033b2d3ad85ced9e9134171b6dc228249ed477edda9b1532869a61dbe0bd`; an in-memory normalized comparison reported only the authorized mount source and target differences.

The exact host configuration passed stdin validation before recreation. Only Caddy was recreated with `docker compose -f /opt/stacks/caddy/compose.yml up -d --no-deps --force-recreate --no-build --pull never caddy`; dependencies, pulls, builds, and volumes were excluded. Container ID changed as expected from `e4392c3141cdd851d8219645edb220a53a30df067b48ffb1eed7e0181883c4ae` to `0dda63aa037d8967d107b8c671af963ab0542d8ec048a51498c6e53cdc017493`, while image ID `sha256:9068f76202c0a03545036d32bf2d424d3b46c1174f254070f605002a2dbc9657`, ports, `caddy_default`, restart policy, and `/data` plus `/config` mounts remained unchanged. Host `/opt/stacks/caddy/conf/Caddyfile` and container `/etc/caddy/Caddyfile` both have SHA-256 `7df64b949d4438f4d8fb62706214960ff96b4b8142e4decc5d264b49e1c20e5a`.

Normal operating commands are now:

```bash
docker compose -f /opt/stacks/caddy/compose.yml exec -T caddy \
  caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
docker compose -f /opt/stacks/caddy/compose.yml exec -T caddy \
  caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile
```

Both commands passed, including one graceful no-op reload. All HTTP/TLS baselines exactly matched afterward and again after the canary outage exercise. Caddy remained running with restart count 0. The root file checksum remained `9db855017b06949209510724b63fc433c1b2cfd4968b555e342a0da5e7758290`, subject remained `CN=Caddy Local Authority - 2026 ECC Root`, and certificate SHA-256 fingerprint remained `E7:33:C4:0B:63:DE:27:CE:20:F3:30:43:89:58:B1:03:35:16:E6:ED:69:1E:2B:E9:BA:72:E1:E2:4E:E1:A4:66`. The runtime log remained mode `600`; runtime adaptation confirmed the request deletion filter, 10 MiB roll, five-file/seven-day uncompressed retention, site access discard, unconditional `log_skip`, and sole `localcast-app:8787` upstream.

### Post-recreation zero-retention and persistence gate

The first fresh-canary launch failed before any HTTP request because the isolated verifier process could not resolve its read-only mounted script. Its `finally` path restored the original secret byte-for-byte, mode `600`, app-only, and removed every disposable file. One bounded repair launched the same in-memory Node harness directly with only the public CA path in its environment; a newly generated 256-bit canary then passed.

The accepted feed/enclosure GET and HEAD requests, exact 1,024-byte `206`, indistinguishable rejected feed/enclosure GET/HEAD/range requests, and `502` Caddy upstream-outage path all passed. Deterministic transport tests cover full, bounded, open-ended, and suffix ranges; invalid, unsatisfiable, and deliberately unsupported multi-range requests return exact `416` metadata. Every fresh-canary sink reported `matches=0 errors=0`: Caddy runtime files; Docker active/rotated JSON logs; systemd journal; `/var/log`; Caddy data/config; LocalCast data/media; repository/Git diff; relevant `/tmp`; and container metadata/image history. The real secret source was never changed and was reverified byte-for-byte against its opaque protected backup, mode `600`, mounted read-only only into app; worker remained unmounted. Every disposable canary file and protected temporary directory was removed.

The approved sample remained complete and AI-generated with script version 1, validated audio, 5 sections, and 7 citations. Database and file size both remained 1,262,592 bytes, database and file SHA-256 both remained `2a8d83087085974c226691ee285168c9f91a52c60cf74f39406b3240a8fa8071`, stored duration remained 78,912 ms, and an actual `ffprobe` remained `78.912000` seconds. App and worker were healthy with restart count 0; neither published a host port, only app joined `caddy_default`, and worker remained only on the LocalCast default network. No OpenAI call occurred.

### Final closure review

Three final independent reviews covered deployment/rollback equivalence, token/privacy security, and correctness/acceptance/documentation. Deployment and security found no blocker. The deployment reviewer accidentally redirected validation messages to two safe `/tmp` files despite the read-only assignment; the primary removed those exact files immediately and reconfirmed their absence. No repository, Caddy, service, credential, or token state changed. Acceptance review found four closure gaps: a valid token plus known run ID could reach media that the feed's grounding predicates excluded; conditional cache validators needed to precede Range and accept weak `If-None-Match`; copy success/error nested live-region semantics; and the multi-range outcome was not stated durably. One narrow repair aligned enclosure media lookup with the AI-generated/validated/supported-cited publication predicates, added direct excluded-run regression fixtures, implemented weak conditional comparison while retaining strong-only `If-Range`, made conditional GET precede Range, removed the nested live wrapper, and documented deliberate multi-range `416` behavior. The focused command covering five unit/integration files passed 55 tests, and the private-feed Playwright flow passed with keyboard, clipboard cleanup, no persistence, axe, dark/high-contrast, 320px, and 200% text evidence.

All three closure re-reviews then reported no blocker. `git diff --check` passed, and the changed-diff privacy scan reported `changed_standalone_43char_shapes=0` and `changed_complete_tokenized_url_shapes=0`. The exact final command `env BUILDX_CONFIG=/tmp/localcast-slice4-buildx npm run verify` passed after the repairs: lint, 151 unit tests in 9 files, 71 integration tests in 12 files, Vite production build with 2,152 modules, all three server bundles, 8 Playwright/axe browser flows, API smoke, production smoke, and isolated Compose build/topology/persistence/recreation. The disposable Compose project, bind storage, and proxy network were removed by its cleanup path. No OpenAI call occurred.
