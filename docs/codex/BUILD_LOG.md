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

## 2026-08-07 — Slice 5 repository-only pre-live/pre-deployment review

Starting checkpoint was exactly `6e1242e3e16c87c294d6f4ba0ca8bc2d0f187a1c` (`feat(prototype): deliver private podcast feed`) on `codex/localcast-prototype` with a clean worktree and index. Governing instructions and every durable record were reconciled before editing. Slice 4 and the standalone Windows launcher follow-up remained closed; no launcher, podcast, Caddy, certificate, token, deployed container, network, volume, database, or media state was inspected or changed.

### Implementation

Additive migration `008_episode_grounded_chat` introduces ordered chat turns, supported claims, immutable snapshot citations, attempt outcomes, and durable submission/retry-request identities. The route is episode-scoped and strictly accepts only a bounded question plus an idempotency header. The store requires a completed version-1 episode with valid supported cited grounding, loads immutable transcript/evidence itself, and transactionally protects enqueue/retry spend. A stale attempt is retryable only when no provider stage was reserved; every reserved or otherwise unresolved stage is non-retryable and is never automatically replayed.

The existing worker process now serializes generation and chat work. Only the worker can construct the OpenAI chat adapter; the existing role contract rejects `OPENAI_API_KEY` in app/storage-init. Chat uses strict fixed answer/refusal and support schemas, exact citation membership/excerpts, a second all-supported semantic check, `store: false`, a compact bounded provider input, and no tools/search/browse/URL/page/general-knowledge path. Private or unknown feed evidence is rejected before the provider boundary. The obsolete optional-`runId`/caller-context route was removed.

Completed episode pages add the pre-action external-provider disclosure, suggestions, question/count controls, durable pending/history, grounded answers and resolved citations, evidence-insufficient refusal, safe error/retry/attempt detail, and timestamps. Query failure blocks submission; ambiguous submit/retry responses retain their exact action identity until an authoritative history fetch proves that same identity was accepted. Focus, live announcements, keyboard operation, safe provenance links, axe, warning contrast, 320px reflow, and simultaneous 200% text are covered.

### Independent review and repairs

Three independent read-only reviewers covered correctness/persistence/migration/idempotency/test gaps; provider boundary/prompt injection/privacy/logging/citation/failure behavior; and accessibility/UI/keyboard/focus/reflow/test coverage. They edited nothing, used no credentials, made no live request, and touched no runtime.

The primary repaired supported findings: accepted replay now precedes provider-config gating; history and enqueue share completed-grounding checks; post-source-deletion evidence reaches the actual provider payload test; the then-current compact context was admitted under a 384,000-character combined bound; durable enqueue order removes timestamp/UUID ambiguity; browser submit and retry keys survive ambiguous responses without duplicate spend; retry baselines reconcile accepted attempts; unavailable history blocks action; each later active turn is announced once; safe action errors receive focus; fresh-context restart evidence compares exact questions, order, timestamps, attempts, and citations; keyboard refusal/retry/details and combined reflow checks were added; and warning contrast was scoped correctly. Primary final diff review restored the explicit proactive generation-job recovery hook beside chat recovery in the combined worker; claim-time recovery already protected work, and the focused process gate re-proved the earlier crash contract. A later pre-live audit found that the character bound did not cover the complete serialized request and that two other repairs were required; the bounded-repair entry below supersedes those affected conclusions.

### Verification and repair ledger

| Exact command or event | Result |
| --- | --- |
| `env NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-vitest-media ./node_modules/.bin/vitest run tests/unit/migrations.test.ts tests/unit/chat-validation.test.ts tests/unit/openai-provider.test.ts tests/integration/chat-workflow.test.ts --reporter=dot` | PASS — 4 files, 74 tests |
| `npm run test` | PASS — 10 files, 174 tests |
| `npm run test:integration -- --reporter=dot` | PASS — 13 files, 78 tests |
| `env NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-vitest-media ./node_modules/.bin/vitest run tests/integration/worker-process-recovery.test.ts --reporter=dot` | PASS — 1 file, 9 combined-worker crash/restart tests |
| `npm run lint` | PASS — no diagnostics |
| `npm run build` | PASS — Vite transformed 2,153 modules and all three server bundles emitted; existing non-blocking chunk warning only |
| `./node_modules/.bin/playwright test tests/e2e/episode-chat.spec.ts --trace=off --reporter=line` | PASS — 1 focused chat/axe flow |
| First `./node_modules/.bin/playwright test --trace=off --reporter=line` | 8 PASS, 1 FAIL — the new chat fixture had populated the established generation E2E database before its empty-list assertion |
| One harness-only repair | Added a distinct loopback-only chat fixture server on ports 43185/43186; no production port, network, data, or assertion changed |
| Second `./node_modules/.bin/playwright test --trace=off --reporter=line` | PASS — 9/9 in 2.3 minutes |
| `npm run smoke:api` | PASS — cited answer/refusal, request replay, order, and API restart persistence |
| `npm run smoke:production` | PASS functionally — a later audit found this run was not secret-isolated because its negative worker probe could load the repository `.env`; the corrected evidence is recorded below |
| Scoped `rg --count-matches` source/test/script scans for OpenAI-key, literal bearer, standalone 43-character base64url, and complete tokenized-URL shapes | PASS — zero matches; each command exited 1 with no output, without reading `.env` or runtime secret paths |
| Built-frontend `rg --count-matches` scan for `OPENAI_API_KEY`, OpenAI-key shapes, and literal bearer values | PASS — zero matches, exit 1 with no output |
| `git diff --check` and `git diff --cached --quiet` | PASS — no whitespace errors; index clean |

`npm run verify` was not run because its Compose tail can invoke image-build package/index network access. `npm run smoke:compose` and deployment-shaped migration/restart checks were likewise deferred; the safe repository evidence did not require them. No dependency was added or downloaded. Every test used synthetic data, temporary SQLite/media paths, and loopback fixtures; Playwright traces were disabled and generated failure artifacts were removed.

### Deferred gates

This is not a green Slice 5 checkpoint. O-005 requires new explicit consent for sending a follow-up question, immutable transcript, and supporting evidence to an external provider plus a bounded allocation within the shared $5 authorization; O-002 alone is not consent. O-006 requires an approved protected production-backup destination/window, app/worker quiescence, migration 008, LocalCast-only deployment/recreation, integrity and restart proof, and restore-based rollback. Minimal redacted live supported/refusal evidence, the deferred safe full/Compose gate, final diff review, and explicit checkpoint authorization remain. No live provider call, production migration, deployment, staging, commit, push, or Slice 6 work occurred. The later audit determined that the pre-repair production smoke could read the repository `.env`; no provider call or secret disclosure was observed, but the prior blanket no-real-secret-access claim is withdrawn and superseded by the credential-free evidence below.

## 2026-08-07 — Slice 5 bounded pre-live audit repairs

The primary retained the same branch and Slice 4 checkpoint with a clean index and only the recognized Slice 5 worktree. No Slice 4 behavior was reopened. The bounded repair addressed exactly three audit blockers and their related evidence: durable mutation-error reconciliation; smoke child-environment and dotenv isolation; and defensible model, context, call, retry, usage, cost, disclosure, and documentation bounds.

### Repair outcome

- The browser now associates an initial error with the submitted idempotency key exposed by that durable turn and associates a retry error with the exact turn, retry key, and pre-retry attempt count. A lost response clears only when history proves that action was accepted or progressed; direct supported/refusal completion and accepted retry progress no longer leave the stale action alert. An actually rejected submission remains visible and focused. Reloaded history remains durable.
- Both smokes construct exact allowlisted child environments rather than spreading their parent. API smoke uses absolute source entry paths with fake processors that do not load dotenv. Production storage/app/negative-worker bundles all run from a fresh temporary working directory using absolute paths, so the dotenv-capable worker cannot discover the repository `.env`. Data/media and the sole synthetic app podcast-token file live under that temporary root; all listeners are ephemeral loopback sockets. Neither smoke invokes Docker, deployed ports, existing networks/volumes/containers, existing data/media, or non-loopback services.
- Follow-up chat is independently pinned to `gpt-5.4-mini-2026-03-17`. Before each fetch the complete JSON body is serialized once and rejected above 131,072 UTF-8 bytes, including settings, instructions, roles, question, transcript/evidence, delimiters, strict schema, escaping, and outer structure. The conservative proxy adds 8,192 tokens to the one-byte/one-token request bound for 139,264 input tokens per call; this is not an exact token count. Draft/support output ceilings are 2,500/750 tokens.
- A refusal ordinarily uses one call; a supported answer uses no more than draft plus support in an attempt. No provider retry is automatic. SQLite and store logic permit only the initial attempt plus one explicit retry, making two calls/attempt and four calls/turn the hard supported-path maxima. Any reserved or otherwise unconfirmed result is explicit and non-retryable. Retry eligibility requires durable proof of no unresolved/in-flight provider work: a pre-dispatch/no-reservation failure, a safely finalized retryable result, or stale recovery after all existing stages finalized and before any next stage/publication.
- Migration 008 persists each stage before dispatch as a unique bounded provider lifecycle row. A definitive envelope can add only exact pinned model, valid returned input/cached-input/output/reasoning counts, an optional bounded safe provider identifier, and bounded lifecycle/outcome metadata before finalization. Timeout, interruption, lease expiry, transport ambiguity, or a crash before finalization leaves the stage unresolved and blocks retry. No raw request/response, prompt, diagnostic question, transcript/evidence body, authorization material, rejected output, or immutable dollar value is stored.
- Chat success/failure deliberately does not mutate the existing text-generation provider-status row because that row is fingerprinted to the independently configured generation model. Synthetic integration evidence preserves the generation-model row byte-for-byte across a successful two-call chat. Dedicated chat live status remains a later explicit design seam rather than falsely labeling an uncalled model.
- The disclosure now states that every frozen supporting evidence snapshot used for grounding is sent externally, not merely cited evidence; it also names the possible second semantic-support request, ordinary one-call refusal, `store: false`, and the absent tools/search/browsing/URL/file/general-knowledge capabilities. Settings copy records the pin, bounds, retry cap, bounded usage metadata, and operator budget responsibility.

The operator-supplied official model facts checked 2026-08-07 record a 400,000-token context and standard rates of $0.75/million input and $4.50/million output. The conservative supported-answer estimate is `$0.208896` input plus `$0.014625` output, or `$0.223521` per attempt and `$0.447042` with the sole retry. A one-call refusal is conservatively `$0.115698`, so one supported answer plus an ordinary refusal is expected to be bounded by `$0.339219` with no retry. Because an intended refusal can return an answer-shaped draft and reach the support call, the hard conservative two-question live-gate ceiling is `$0.447042` for up to two initial calls per question. Actual usage may be lower. LocalCast does not enforce account/project spending across turns; these figures are planning evidence, not a billing guarantee. No part of the shared $5 authorization was activated or spent.

### Safe verification evidence

All executable test, build, browser, and smoke verification ran from an environment scrubbed of inherited credentials and pointed Vite at a pre-created empty mode-`700` directory. Tests used fakes, synthetic fixtures, temporary databases/media, and loopback-only listeners. Scoped privacy and Git checks were separate read-only repository commands. The superseding latest-repair evidence appears below; these earlier commands are retained as historical evidence.

```bash
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/tmp TMPDIR=/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-final-targeted-media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-empty-vite-env-20260807 ./node_modules/.bin/vitest run tests/unit/migrations.test.ts tests/unit/openai-provider.test.ts tests/unit/smoke-environment.test.ts tests/integration/chat-workflow.test.ts --reporter=dot
```

Result: PASS, exit `0` — 4 files and 77 tests.

```bash
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/tmp TMPDIR=/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-final-unit-media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-empty-vite-env-20260807 ./node_modules/.bin/vitest run tests/unit --reporter=dot
```

Result: PASS, exit `0` — 11 files and 183 tests.

```bash
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/tmp TMPDIR=/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-final-integration-media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-empty-vite-env-20260807 ./node_modules/.bin/vitest run tests/integration --reporter=dot
```

Result: PASS, exit `0` — 13 files and 79 tests.

```bash
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/tmp TMPDIR=/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-empty-vite-env-20260807 npm run lint
```

Result: PASS, exit `0` — TypeScript `--noEmit`.

```bash
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/tmp TMPDIR=/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-empty-vite-env-20260807 npm run build
```

Result: PASS, exit `0` — Vite transformed 2,153 modules and all three server bundles were emitted; only the existing non-blocking chunk-size warning remained.

```bash
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/tmp TMPDIR=/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-final-e2e-media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-empty-vite-env-20260807 PLAYWRIGHT_BROWSERS_PATH=/home/mkimitch/.cache/ms-playwright ./node_modules/.bin/playwright test --trace=off --reporter=line
```

Result: PASS, exit `0` — all 9 Playwright/axe flows in 2.3 minutes.

```bash
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/tmp TMPDIR=/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC OPENAI_API_KEY=synthetic-parent-provider-sentinel LOCALCAST_PODCAST_TOKEN_FILE=/tmp/localcast-synthetic-must-not-read.token DOTENV_CONFIG_PATH=/tmp/localcast-synthetic-must-not-read.env SSL_CERT_FILE=/tmp/localcast-synthetic-must-not-read.pem LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-empty-vite-env-20260807 node scripts/smoke-api.mjs
```

Result: PASS, exit `0` — API and worker smoke checks passed; sentinel values were not emitted by the smoke.

```bash
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/tmp TMPDIR=/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC OPENAI_API_KEY=synthetic-parent-provider-sentinel LOCALCAST_PODCAST_TOKEN_FILE=/tmp/localcast-synthetic-must-not-read.token DOTENV_CONFIG_PATH=/tmp/localcast-synthetic-must-not-read.env SSL_CERT_FILE=/tmp/localcast-synthetic-must-not-read.pem LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-empty-vite-env-20260807 node scripts/smoke-production.mjs
```

Result: PASS, exit `0` — production same-origin checks passed; sentinel values were not emitted by the smoke.

The exact scoped privacy commands were:

```bash
rg --count-matches --no-messages -g '!node_modules/**' -g '!dist/**' -g '!dist-server/**' -g '!docs/codex/**' 'sk-[A-Za-z0-9_-]{20,}' server src tests scripts package.json playwright.config.ts vite.config.ts
rg --count-matches --no-messages -g '!node_modules/**' -g '!dist/**' -g '!dist-server/**' -g '!docs/codex/**' 'Bearer [A-Za-z0-9_-]{20,}' server src tests scripts package.json playwright.config.ts vite.config.ts
rg --count-matches --no-messages -g '!node_modules/**' -g '!dist/**' -g '!dist-server/**' -g '!docs/codex/**' '(^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{43}([^A-Za-z0-9_-]|$)' server src tests scripts package.json playwright.config.ts vite.config.ts
rg --count-matches --no-messages -g '!node_modules/**' -g '!dist/**' -g '!dist-server/**' -g '!docs/codex/**' "https?://[^[:space:]\"'<>]*/[A-Za-z0-9_-]{43}([/?#\"'[:space:]<>]|$)" server src tests scripts package.json playwright.config.ts vite.config.ts
rg --count-matches --no-messages 'OPENAI_API_KEY|sk-[A-Za-z0-9_-]{20,}|Bearer [A-Za-z0-9_-]{20,}' dist
```

Each returned exit `1` with zero output, meaning no matches. `git diff --check` returned exit `0`.

The repaired smoke evidence supersedes the earlier non-isolated production-smoke claim. The repository `.env` was not read during these repairs or checks. No real secret, provider endpoint, external request, deployed service, production port, existing database/media, Docker container, network, volume, Caddy configuration, podcast token, certificate, gPodder state, or launcher was accessed or changed. Compose/live/deployment gates remain deferred, and the work remains unstaged and uncommitted pending a new read-only pre-live audit.

### Post-repair independent review

Three bounded read-only reviewers inspected the final diff without edits, tests, credentials, network access, or runtime access. The UI reviewer found the initial cross-action mutation window; the primary added one shared action-in-flight block, and the re-review confirmed matching submission/retry reconciliation, intentional retention of a genuinely rejected action, keyboard/focus/live-region behavior, axe coverage, and narrow/200%-text reflow with no blocker. Its remaining test-depth notes are nonblocking: no separate rejected-retry persistence case, the pending-lock browser assertion is not isolated from active-turn blocking, and reflow assertions are container/document-level.

The provider reviewer found that chat could update status for the separately configured generation model, a successful HTTP `null` envelope was misclassified as a network ambiguity, audit-observer failure lacked direct evidence, and the expected-versus-hard two-question live cost gate needed clearer wording. Chat no longer mutates generation status; malformed envelopes and audit persistence fail closed without another call; direct tests cover both paths and the 131,072 + 8,192 = 139,264 bound; O-005 now requires one exact episode/fixture, two exact questions, one initial attempt each, no retries, and no post-ambiguity call. Re-review found no blocker.

The smoke/migration/documentation reviewer found that exact scrubbed commands were not durably reproducible, a successful supported answer did not directly assert both audit rows, migration constraint tests were sparse, and retained FIFO order was described too broadly. The exact environment/commands/results above, successful draft+support persistence assertion, direct migration constraint cases, and retained-turn wording close those findings. Re-review confirmed fixed child allowlists, temporary data/media/home/cwd, loopback-only services, no Slice 4 regression, and no remaining blocker.

## 2026-08-07 — Slice 5 latest-audit bounded repair

Preflight reconfirmed branch `codex/localcast-prototype`, base HEAD `6e1242e3e16c87c294d6f4ba0ca8bc2d0f187a1c`, subject `feat(prototype): deliver private podcast feed`, clean index, and the exact authorized starting inventory: 28 tracked paths with 1,424 insertions/122 deletions plus 15 untracked paths totaling exactly 2,470 lines. No dependency or lockfile changed. The repository `.env`, secrets, provider, deployed runtime, existing database/media, Docker, Caddy, podcast, certificate, gPodder, and launcher state were not accessed.

The repair remained within the same 43 paths. It added the accepted retry key and attempt to durable history; authoritative post-error history reconciliation keyed by the complete initial/retry action identity; response-order fencing against older callbacks; a unique provider-stage reservation before each fetch; bounded `reserved`, `response_received`, `ambiguous`, and `finalized` lifecycle metadata; fail-closed retry eligibility for every unresolved reservation; and a fresh worker/lease check immediately before both draft and support reservation. A stale worker cannot reserve support, update lifecycle, fail another owner's turn, or publish. The design does not claim exactly-once external execution: a crash can leave a reservation even before bytes are sent, or after a response but before receipt/finalization is persisted. Either reservation prevents LocalCast from retrying that unresolved turn/stage; it does not claim control over upstream execution after interruption.

The first focused browser result after these edits was invalid because the E2E server serves `dist` and that bundle predated the current `EpisodeChat.tsx`. Rebuilding current source removed the apparent competing-retry failure. A subsequent current-bundle run revealed one genuine rejected-action focus timing race; focus was moved to a render-coupled effect. The rebuilt focused flow then passed in 52.5 seconds, and the complete current-bundle browser gate passed 9/9 in 2.4 minutes. Stale-bundle reruns were not current-source repair failures and did not reach the three-repair stop condition.

### Evidence at that repair point (superseded by the later 2026-08-08 record)

All executable test, typecheck, build, browser, and smoke commands used a credential-free `env -i` parent, synthetic fixtures, temporary storage under `/tmp/localcast-slice5-verify.mM0nvm`, an empty temporary Vite environment directory, and loopback-only services. No command used Docker or a non-loopback service.

| Command | Result |
| --- | --- |
| `env -i … ./node_modules/.bin/vitest run tests/unit/migrations.test.ts tests/unit/openai-provider.test.ts tests/unit/smoke-environment.test.ts tests/integration/chat-workflow.test.ts --reporter=dot` | PASS, exit 0 — 4 files, 82 tests |
| `env -i … ./node_modules/.bin/vitest run tests/unit --reporter=dot` | PASS, exit 0 — 11 files, 183 tests |
| `env -i … ./node_modules/.bin/vitest run tests/integration --reporter=dot` | PASS, exit 0 — 13 files, 84 tests |
| `env -i … npm run lint` | PASS, exit 0 — TypeScript `--noEmit` |
| `env -i … npm run build` | PASS, exit 0 — 2,153 Vite modules and three server bundles; existing chunk warning only |
| `env -i … ./node_modules/.bin/playwright test tests/e2e/episode-chat.spec.ts --trace=off --reporter=line` after the current build | PASS, exit 0 — 1 flow in 52.5 seconds |
| `env -i … ./node_modules/.bin/playwright test --trace=off --reporter=line` after the current build | PASS, exit 0 — 9/9 flows in 2.4 minutes |
| `env -i … node scripts/smoke-api.mjs` with synthetic parent credential/path sentinels | PASS, exit 0 — `API and worker smoke checks passed` |
| `env -i … node scripts/smoke-production.mjs` with the same synthetic sentinels | PASS, exit 0 — `Production same-origin smoke checks passed` |
| Five scoped credential/token-pattern scans using an absolute `rg` executable | PASS — every scan exited 1 with zero matches |

Recorded execution window: 2026-08-07 19:05–19:35 CDT. The exact latest executable commands were:

```bash
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/tmp/localcast-slice5-verify.mM0nvm/home TMPDIR=/tmp/localcast-slice5-verify.mM0nvm/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-verify.mM0nvm/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-verify.mM0nvm/vite ./node_modules/.bin/vitest run tests/unit/migrations.test.ts tests/unit/openai-provider.test.ts tests/unit/smoke-environment.test.ts tests/integration/chat-workflow.test.ts --reporter=dot
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/tmp/localcast-slice5-verify.mM0nvm/home TMPDIR=/tmp/localcast-slice5-verify.mM0nvm/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-verify.mM0nvm/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-verify.mM0nvm/vite ./node_modules/.bin/vitest run tests/unit --reporter=dot
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/tmp/localcast-slice5-verify.mM0nvm/home TMPDIR=/tmp/localcast-slice5-verify.mM0nvm/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-verify.mM0nvm/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-verify.mM0nvm/vite ./node_modules/.bin/vitest run tests/integration --reporter=dot
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/tmp/localcast-slice5-verify.mM0nvm/home TMPDIR=/tmp/localcast-slice5-verify.mM0nvm/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-verify.mM0nvm/vite npm run lint
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/tmp/localcast-slice5-verify.mM0nvm/home TMPDIR=/tmp/localcast-slice5-verify.mM0nvm/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-verify.mM0nvm/vite npm run build
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/tmp/localcast-slice5-verify.mM0nvm/home TMPDIR=/tmp/localcast-slice5-verify.mM0nvm/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-verify.mM0nvm/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-verify.mM0nvm/vite PLAYWRIGHT_BROWSERS_PATH=/home/mkimitch/.cache/ms-playwright ./node_modules/.bin/playwright test tests/e2e/episode-chat.spec.ts --trace=off --reporter=line
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/tmp/localcast-slice5-verify.mM0nvm/home TMPDIR=/tmp/localcast-slice5-verify.mM0nvm/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-verify.mM0nvm/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-verify.mM0nvm/vite PLAYWRIGHT_BROWSERS_PATH=/home/mkimitch/.cache/ms-playwright ./node_modules/.bin/playwright test --trace=off --reporter=line
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/tmp/localcast-slice5-verify.mM0nvm/home TMPDIR=/tmp/localcast-slice5-verify.mM0nvm/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC OPENAI_API_KEY=synthetic-parent-provider-sentinel LOCALCAST_PODCAST_TOKEN_FILE=/tmp/localcast-synthetic-must-not-read.token DOTENV_CONFIG_PATH=/tmp/localcast-synthetic-must-not-read.env SSL_CERT_FILE=/tmp/localcast-synthetic-must-not-read.pem LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-verify.mM0nvm/vite node scripts/smoke-api.mjs
env -i PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin HOME=/tmp/localcast-slice5-verify.mM0nvm/home TMPDIR=/tmp/localcast-slice5-verify.mM0nvm/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC OPENAI_API_KEY=synthetic-parent-provider-sentinel LOCALCAST_PODCAST_TOKEN_FILE=/tmp/localcast-synthetic-must-not-read.token DOTENV_CONFIG_PATH=/tmp/localcast-synthetic-must-not-read.env SSL_CERT_FILE=/tmp/localcast-synthetic-must-not-read.pem LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-verify.mM0nvm/vite node scripts/smoke-production.mjs
```

The first scrubbed privacy-scan attempt could not resolve `rg` and exited 127 without scanning. These exact absolute-executable reruns supersede it:

```bash
/home/mkimitch/.codex/packages/standalone/releases/0.146.1-x86_64-unknown-linux-musl/codex-path/rg --count-matches --no-messages -g '!node_modules/**' -g '!dist/**' -g '!dist-server/**' -g '!docs/codex/**' 'sk-[A-Za-z0-9_-]{20,}' server src tests scripts package.json playwright.config.ts vite.config.ts
/home/mkimitch/.codex/packages/standalone/releases/0.146.1-x86_64-unknown-linux-musl/codex-path/rg --count-matches --no-messages -g '!node_modules/**' -g '!dist/**' -g '!dist-server/**' -g '!docs/codex/**' 'Bearer [A-Za-z0-9_-]{20,}' server src tests scripts package.json playwright.config.ts vite.config.ts
/home/mkimitch/.codex/packages/standalone/releases/0.146.1-x86_64-unknown-linux-musl/codex-path/rg --count-matches --no-messages -g '!node_modules/**' -g '!dist/**' -g '!dist-server/**' -g '!docs/codex/**' '(^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{43}([^A-Za-z0-9_-]|$)' server src tests scripts package.json playwright.config.ts vite.config.ts
/home/mkimitch/.codex/packages/standalone/releases/0.146.1-x86_64-unknown-linux-musl/codex-path/rg --count-matches --no-messages -g '!node_modules/**' -g '!dist/**' -g '!dist-server/**' -g '!docs/codex/**' "https?://[^[:space:]\"'<>]*/[A-Za-z0-9_-]{43}([/?#\"'[:space:]<>]|$)" server src tests scripts package.json playwright.config.ts vite.config.ts
/home/mkimitch/.codex/packages/standalone/releases/0.146.1-x86_64-unknown-linux-musl/codex-path/rg --count-matches --no-messages 'OPENAI_API_KEY|sk-[A-Za-z0-9_-]{20,}|Bearer [A-Za-z0-9_-]{20,}' dist
```

Each rerun exited 1 with no output, meaning zero matches.

The smoke scripts construct fixed child environments. API children use the repository working directory only for source entrypoints that do not load dotenv; production storage/app/negative-worker children use absolute bundle paths and fresh temporary working directories so `dotenv.config()` cannot discover the repository-root `.env`. The synthetic podcast-token input is a configured temporary file path supplied only to the temporary app child, not a mount. Executable test/build/browser/smoke evidence is scrubbed; the scoped privacy scans and Git inspections are separate read-only repository commands.

The support request is measured and documented as the proposed claims, cited snapshot IDs, and exact excerpts; it does not resend the complete transcript and evidence. The immutable-evidence deletion test removes the original note, not the station. Migration 008 is still unapplied outside synthetic temporary databases. The migration and tests retain the exact model, 131,072-byte body limit, 139,264-token conservative input proxy/reserve, 2,500/750 output ceilings, two-call attempt ceiling, two-attempt/four-call turn ceiling, `$0.223521` conservative supported-attempt estimate, `$0.447042` sole-retry estimate, bounded numeric usage metadata, `store: false`, and no tools/search/browsing/retrieval/general-knowledge path. Pricing remains a recorded planning estimate; LocalCast does not enforce an account-global budget.

### Final changed-path inventory

The ending inventory remains exactly these 43 recognized Slice 5 paths; no dependency or lockfile path is present:

```text
docs/codex/BUILD_LOG.md
docs/codex/DECISIONS.md
docs/codex/PLAN.md
docs/codex/SPEC.md
docs/codex/STATE.md
docs/codex/TEST_MATRIX.md
package.json
playwright.config.ts
scripts/smoke-api.mjs
scripts/smoke-environment.mjs
scripts/smoke-production.mjs
server/app.ts
server/chat/types.ts
server/chat/validation.ts
server/database/migrations.ts
server/jobs/applicationWorker.ts
server/jobs/chatProcessor.ts
server/jobs/chatWorker.ts
server/providers/openai.ts
server/routes/chat.ts
server/routes/followUp.ts (deleted)
server/services/chatStore.ts
server/testing/fakeChatProcessor.ts
server/testing/worker.ts
server/validation.ts
server/worker.ts
server/workerProcess.ts
src/features/briefings/BriefingDetail.tsx
src/features/briefings/EpisodeChat.tsx
src/features/settings/Settings.tsx
src/services/api/ApiBriefingService.ts
src/services/api/index.ts
src/styles/components.css
src/types.ts
tests/e2e/episode-chat.spec.ts
tests/e2e/foundation.spec.ts
tests/helpers/chat.ts
tests/integration/chat-workflow.test.ts
tests/unit/chat-validation.test.ts
tests/unit/migrations.test.ts
tests/unit/openai-provider.test.ts
tests/unit/smoke-environment.test.ts
vite.config.ts
```

### Final independent re-reviews

Three final bounded read-only re-reviews made no edits, ran no tests, read no secrets, and used no network, Docker, or deployed runtime:

- UI/identity/accessibility found no blocker. It confirmed end-to-end initial/retry identity, full-identity-only clearing, stale-callback fencing, retained competing-client errors, focus/live/keyboard behavior, and valid browser coverage. Remaining depth is nonblocking: no focus reassertion after the competing winner completes, no separate non-competing rejected-retry browser case, direct citation activation and every queued/running announcement are not exhaustive, and Playwright must be preceded by a fresh build because the E2E server serves `dist` without a freshness check.
- Provider lifecycle/lease/retry/privacy initially reported no source blocker and retained two gaps as nonblocking. The later independent audit correctly elevated the zero-lifecycle publication path and provider-stage-entry timing to blockers and required a permanent stale-`response_received` recovery case. That earlier disposition is withdrawn and superseded by the 2026-08-08 repair below. The provider response `id` remains stored under the bounded legacy-compatible name `provider_request_id`; a real process-SIGKILL during a chat provider stage remains nonblocking test depth and no exactly-once claim is made.
- Migration/smoke/docs/regression found no implementation blocker. The primary corrected the latest integration count, retained full current command lines/results/window, and qualified older review evidence; re-review confirmed additive/repeat-safe migration behavior, concurrent retry winner evidence, app/worker/browser restart evidence, fixed smoke allowlists/cwds, unchanged lockfile/dependencies, exact 43-path scope, clean diff, and clean index.

After these dispositions, the tracked diff is 28 paths with 1,721 insertions and 125 deletions; the same 15 untracked paths total 3,148 lines. No file was staged or committed. Slice 5 is repaired only to the repository pre-live/pre-deployment review point; Slice 4 remains green, and every live-consent/budget, protected backup, production migration/deployment/restart, new read-only audit, checkpoint, and Slice 6 gate remains open.

## 2026-08-08 — Slice 5 first-empty/lifecycle blocker repair

Preflight reconfirmed branch `codex/localcast-prototype`, base HEAD `6e1242e3e16c87c294d6f4ba0ca8bc2d0f187a1c`, subject `feat(prototype): deliver private podcast feed`, clean index, and exactly the prior 43-path worktree: 28 tracked paths with 1,721 insertions/125 deletions and 15 untracked paths totaling exactly 3,148 lines. The BUILD_LOG inventory, `git status`, and HEAD-to-worktree inventory agreed. No dependency or lockfile path changed. The repository `.env`, any real secret/provider, deployed runtime, existing database/media, Docker/network/volume, Caddy/certificate/podcast token, gPodder, and Windows launchers were not accessed.

The bounded repair closes only the five independent-audit blockers:

- Ambiguous initial/retry HTTP outcomes retain an exact action identity through the first empty or nonmatching authoritative history fetch. The final implementation persists only action kind, bounded key, bounded reconciliation deadline, generation/owner identity, and retry turn/attempt baseline in same-origin local storage; it never stores question or grounding content. Polling uses fresh API reads until ten seconds after dispatch, exact later acceptance clears the stale transport error, and unresolved identity remains blocked for manual history checking after the window and across reload/tabs. Unrelated history, another client's winning retry key, and provable rejection cannot establish acceptance. The shared lock prevents a replacement UUID or competing retry while the exact action remains uncertain, while SQLite remains authoritative if browser coordination races.
- The worker transactionally reserves draft and support separately before entering either provider-adapter stage. A process-private opaque capability binds the exact turn, attempt, stage, model, worker, durable row, current-lease assertion, lifecycle writer, and one-use state. Missing, structurally forged, mismatched, stale, expired, wrong-stage, wrong-attempt, wrong-worker, or reused capability fails before request construction/fetch. Lifecycle persistence can no longer be replaced with a caller-supplied no-op observer.
- Production answer publication requires exactly finalized `draft_answer_validated` plus `support_validated` rows for the current attempt/worker and current lease. Refusal requires exactly one finalized `draft_refusal` and no support row. Zero-row, partial, `reserved`, `response_received`, `ambiguous`, wrong-stage/attempt/outcome, stale-worker, or expired-lease publication fails transactionally. The deterministic test processor creates matching synthetic lifecycle rows and is excluded from production bundles; there is no production bypass flag or zero-row shortcut.
- A permanent file-backed regression advances a real lifecycle row to `response_received`, closes/reopens SQLite, uses production stale recovery, and proves the row remains consumed, the turn becomes `CHAT_PROVIDER_OUTCOME_UNCONFIRMED` and non-retryable, retry/reservation/publication are rejected, no processor stage runs, and the state survives another reopen. The existing reserved-stage recovery case remains green. These tests model durable crash state; they do not claim exactly-once external execution or replace the acknowledged missing provider-stage process-SIGKILL depth case.
- Still-unapplied migration 008 now enforces the same 8–200-character bound for initial submission identities that the API/store enforce. A synthetic migration-007 file upgrades, accepts exact 8/200 bounds, rejects 7/201, reapplies as a no-op, and preserves rows after reopen. Existing accepted-retry and provider lifecycle bounds remain aligned. No production database was read or migrated.

Request, provider, and cost boundaries are unchanged: chat remains pinned to `gpt-5.4-mini-2026-03-17`, `store: false`, low reasoning, strict structured output, no tools/search/browsing/retrieval/general-knowledge fallback, and worker-only provider access. Each exact serialized body is capped at 131,072 UTF-8 bytes before fetch; the conservative planning proxy plus reserve is 139,264 input tokens/call; draft/support output ceilings are 2,500/750; calls are capped at two slots/attempt, two attempts/four slots/turn; recorded supported-answer estimates remain `$0.223521` per attempt and `$0.447042` with the sole retry. These are recorded planning estimates, not immutable pricing or an enforced global budget. No live authorization was activated or spent.

### Safe verification record

All executable commands below used the same credential-free parent, the pre-created private root `/tmp/localcast-slice5-repair.UYq471`, synthetic configuration, temporary SQLite/media/cache/Vite paths, existing dependencies, and loopback-only listeners. No command used Docker or a non-loopback service. The first typecheck exposed one test-only literal-widening error and was repaired once. The first full chat-browser rerun encountered only a still-closing loopback fixture listener and was not counted; the final current-source browser run started after the listeners exited and passed 10/10. A partial-output focused browser handoff was likewise not used as final evidence; the complete run includes both chat flows.

| Command | Result |
| --- | --- |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.UYq471/home TMPDIR=/tmp/localcast-slice5-repair.UYq471/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.UYq471/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=worker DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair.UYq471/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.UYq471/vite npm_config_offline=true npm run lint` (first repair pass) | FAIL, exit 2 — one test-only literal-widening type error; fixed without weakening a test |
| Same `npm run lint` command after that correction | PASS, exit 0 |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.UYq471/home TMPDIR=/tmp/localcast-slice5-repair.UYq471/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.UYq471/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=worker DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair.UYq471/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.UYq471/vite npm_config_offline=true ./node_modules/.bin/vitest run tests/unit/openai-provider.test.ts tests/unit/migrations.test.ts tests/integration/chat-workflow.test.ts` (before capability binding) | PASS, exit 0 — 3 files, 85 tests |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.UYq471/home TMPDIR=/tmp/localcast-slice5-repair.UYq471/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.UYq471/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=production LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=worker DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair.UYq471/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.UYq471/vite npm_config_offline=true npm run build` (before capability binding) | PASS, exit 0 — 2,153 Vite modules and three server bundles; existing chunk-size warning only |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.UYq471/home TMPDIR=/tmp/localcast-slice5-repair.UYq471/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.UYq471/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=worker DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair.UYq471/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.UYq471/vite PLAYWRIGHT_BROWSERS_PATH=/home/mkimitch/.cache/ms-playwright npm_config_offline=true ./node_modules/.bin/playwright test tests/e2e/episode-chat.spec.ts --grep "ambiguous chat mutations" --trace=off --reporter=line` | PASS, exit 0 — 1/1 focused late-visibility flow in 27.5 seconds |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.UYq471/home TMPDIR=/tmp/localcast-slice5-repair.UYq471/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.UYq471/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=worker DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair.UYq471/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.UYq471/vite PLAYWRIGHT_BROWSERS_PATH=/home/mkimitch/.cache/ms-playwright npm_config_offline=true ./node_modules/.bin/playwright test tests/e2e/episode-chat.spec.ts --trace=off --reporter=line` immediately after that focused run | NOT COUNTED, exit 1 — the prior fixture listener was still closing and Playwright refused to start at port 43179; no test executed |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.UYq471/home TMPDIR=/tmp/localcast-slice5-repair.UYq471/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.UYq471/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=worker DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair.UYq471/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.UYq471/vite npm_config_offline=true ./node_modules/.bin/vitest run tests/unit/openai-provider.test.ts tests/unit/migrations.test.ts tests/integration/chat-workflow.test.ts` (final capability implementation) | PASS, exit 0 — 3 files, 86 tests |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.UYq471/home TMPDIR=/tmp/localcast-slice5-repair.UYq471/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.UYq471/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=worker DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair.UYq471/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.UYq471/vite npm_config_offline=true ./node_modules/.bin/vitest run tests/unit --reporter=dot` | PASS, exit 0 — 11 files, 186 tests |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.UYq471/home TMPDIR=/tmp/localcast-slice5-repair.UYq471/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.UYq471/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=worker DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair.UYq471/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.UYq471/vite npm_config_offline=true ./node_modules/.bin/vitest run tests/integration --reporter=dot` | PASS, exit 0 — 13 files, 84 tests |
| Final `npm run lint` under the same scrubbed test environment | PASS, exit 0 — TypeScript `--noEmit` |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.UYq471/home TMPDIR=/tmp/localcast-slice5-repair.UYq471/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.UYq471/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=production LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=worker DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair.UYq471/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.UYq471/vite npm_config_offline=true npm run build` | PASS, exit 0 — 2,153 Vite modules and three server bundles; existing chunk-size warning only |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.UYq471/home TMPDIR=/tmp/localcast-slice5-repair.UYq471/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.UYq471/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=worker DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair.UYq471/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.UYq471/vite PLAYWRIGHT_BROWSERS_PATH=/home/mkimitch/.cache/ms-playwright npm_config_offline=true ./node_modules/.bin/playwright test --trace=off --reporter=line` immediately after the fresh build | PASS, exit 0 — 10/10 flows in 2.9 minutes |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.UYq471/home TMPDIR=/tmp/localcast-slice5-repair.UYq471/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.UYq471/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC OPENAI_API_KEY=synthetic-parent-provider-sentinel LOCALCAST_PODCAST_TOKEN_FILE=/tmp/localcast-slice5-repair.UYq471/synthetic-must-not-read.token DOTENV_CONFIG_PATH=/tmp/localcast-slice5-repair.UYq471/synthetic-must-not-read.env SSL_CERT_FILE=/tmp/localcast-slice5-repair.UYq471/synthetic-must-not-read.pem LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.UYq471/vite npm_config_offline=true node scripts/smoke-api.mjs` | PASS, exit 0 — `API and worker smoke checks passed` |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.UYq471/home TMPDIR=/tmp/localcast-slice5-repair.UYq471/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.UYq471/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC OPENAI_API_KEY=synthetic-parent-provider-sentinel LOCALCAST_PODCAST_TOKEN_FILE=/tmp/localcast-slice5-repair.UYq471/synthetic-must-not-read.token DOTENV_CONFIG_PATH=/tmp/localcast-slice5-repair.UYq471/synthetic-must-not-read.env SSL_CERT_FILE=/tmp/localcast-slice5-repair.UYq471/synthetic-must-not-read.pem LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.UYq471/vite npm_config_offline=true node scripts/smoke-production.mjs` | PASS, exit 0 — `Production same-origin smoke checks passed` |

The smoke child allowlists and working-directory isolation are unchanged and were reinspected before execution. API source children use the repository cwd only through entrypoints that do not load dotenv. Production bundle children use a new temporary cwd, including the dotenv-capable negative worker. Parent provider/podcast/dotenv/certificate sentinel names do not enter child environments; the app alone receives a newly generated temporary podcast-token file path. Both smokes use ephemeral loopback ports and newly created temporary data/media; neither invokes Docker, deployed services, production ports, networks, volumes, or existing data.

### Final changed-path inventory for this repair

The ending inventory remains exactly the following 43 paths; no dependency or lockfile path is present:

```text
docs/codex/BUILD_LOG.md
docs/codex/DECISIONS.md
docs/codex/PLAN.md
docs/codex/SPEC.md
docs/codex/STATE.md
docs/codex/TEST_MATRIX.md
package.json
playwright.config.ts
scripts/smoke-api.mjs
scripts/smoke-environment.mjs
scripts/smoke-production.mjs
server/app.ts
server/chat/types.ts
server/chat/validation.ts
server/database/migrations.ts
server/jobs/applicationWorker.ts
server/jobs/chatProcessor.ts
server/jobs/chatWorker.ts
server/providers/openai.ts
server/routes/chat.ts
server/routes/followUp.ts (deleted)
server/services/chatStore.ts
server/testing/fakeChatProcessor.ts
server/testing/worker.ts
server/validation.ts
server/worker.ts
server/workerProcess.ts
src/features/briefings/BriefingDetail.tsx
src/features/briefings/EpisodeChat.tsx
src/features/settings/Settings.tsx
src/services/api/ApiBriefingService.ts
src/services/api/index.ts
src/styles/components.css
src/types.ts
tests/e2e/episode-chat.spec.ts
tests/e2e/foundation.spec.ts
tests/helpers/chat.ts
tests/integration/chat-workflow.test.ts
tests/unit/chat-validation.test.ts
tests/unit/migrations.test.ts
tests/unit/openai-provider.test.ts
tests/unit/smoke-environment.test.ts
vite.config.ts
```

Slice 5 remains incomplete and uncommitted. A new independent read-only pre-live audit, separately authorized exact-fixture/question cloud consent and budget, protected backup, production migration/deployment/restart/rollback evidence, final diff review, explicit checkpoint authorization, and Slice 6 all remain open.

### Post-review response-order correction and current evidence

The UI reviewer found one additional bounded race: a manual authoritative history request could capture stale history, then resolve or reject after polling had already accepted the exact action. The manual fetch previously wrote query data before checking which action was still current and could therefore hide the accepted turn or reinstall a stale uncertainty alert over a newer action. The repair makes history fetching side-effect-free, snapshots the complete submission/retry identity plus local action generation, and fences cache/error/focus/reconciliation writes on both that exact still-current identity and the latest manual-check generation. Mutation mismatch fetches are similarly fenced before publishing history. The permanent browser regression captures and holds an empty manual response, lets polling render exact acceptance, installs and focuses a newer terminal rejection, releases the stale response, explicitly waits for its completion, and proves the accepted article, newer alert/focus, and cleared browser identity remain unchanged. Independent UI re-review found no remaining blocker.

The provider reviewer found no lifecycle, ambiguity, lease, publication, privacy, request, usage, or call-ceiling blocker. The migration/smoke reviewer found no implementation blocker and identified stale ledger counts plus imprecise migration-fixture wording; the current scrubbed reruns and durable-record corrections below supersede those discrepancies. These scoped reviews made no edits and used no secret, provider, network, Docker, runtime, database, or media.

The following additional commands ran from the same private temporary root with a scrubbed parent, a temporary Vitest config whose `envDir` was `/tmp/localcast-slice5-repair.UYq471/vite`, synthetic settings, existing dependencies, and only temporary storage/loopback listeners:

| Exact command | Result |
| --- | --- |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.UYq471/home TMPDIR=/tmp/localcast-slice5-repair.UYq471/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.UYq471/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=worker DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair.UYq471/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.UYq471/vite npm_config_offline=true npm run lint` | PASS, exit 0 — TypeScript emitted no diagnostics |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.UYq471/home TMPDIR=/tmp/localcast-slice5-repair.UYq471/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.UYq471/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=worker DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair.UYq471/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.UYq471/vite npm_config_offline=true ./node_modules/.bin/vitest run --config /tmp/localcast-slice5-repair.UYq471/vitest.config.mjs tests/unit/chat-validation.test.ts tests/unit/migrations.test.ts tests/unit/openai-provider.test.ts tests/integration/chat-workflow.test.ts` | PASS, exit 0 — 4 files, 99 tests |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.UYq471/home TMPDIR=/tmp/localcast-slice5-repair.UYq471/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.UYq471/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=worker DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair.UYq471/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.UYq471/vite npm_config_offline=true ./node_modules/.bin/vitest run --config /tmp/localcast-slice5-repair.UYq471/vitest.config.mjs tests/unit` | PASS, exit 0 — 11 files, 192 tests |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.UYq471/home TMPDIR=/tmp/localcast-slice5-repair.UYq471/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.UYq471/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=worker DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair.UYq471/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.UYq471/vite npm_config_offline=true ./node_modules/.bin/vitest run --config /tmp/localcast-slice5-repair.UYq471/vitest.config.mjs tests/integration` | PASS, exit 0 — 13 files, 87 tests; expected synthetic `GENERATION_FAILED` lines exercised recovery fixtures only |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.UYq471/home TMPDIR=/tmp/localcast-slice5-repair.UYq471/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.UYq471/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=production LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.UYq471/vite npm_config_offline=true npm run build` | PASS twice, exit 0 — each run transformed 2,153 Vite modules and emitted all three server bundles; only the existing chunk-size warning remained |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.UYq471/home TMPDIR=/tmp/localcast-slice5-repair.UYq471/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.UYq471/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.UYq471/vite PLAYWRIGHT_BROWSERS_PATH=/home/mkimitch/.cache/ms-playwright npm_config_offline=true ./node_modules/.bin/playwright test tests/e2e/episode-chat.spec.ts --grep "ambiguous chat mutations survive" --workers=1` | PASS, exit 0 — 1/1 focused first-empty/late-visibility flow in 45.0 seconds |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.UYq471/home TMPDIR=/tmp/localcast-slice5-repair.UYq471/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.UYq471/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.UYq471/vite PLAYWRIGHT_BROWSERS_PATH=/home/mkimitch/.cache/ms-playwright npm_config_offline=true ./node_modules/.bin/playwright test --workers=1` immediately after the final fresh build | PASS, exit 0 — 10/10 flows in 3.1 minutes |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.UYq471/home TMPDIR=/tmp/localcast-slice5-repair.UYq471/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.UYq471/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.UYq471/vite npm_config_offline=true OPENAI_API_KEY=synthetic-parent-sentinel-not-a-credential OPENAI_CHAT_MODEL=synthetic-unapproved-parent-model LOCALCAST_PODCAST_TOKEN_FILE=/tmp/localcast-slice5-repair.UYq471/synthetic-parent-path-must-not-be-read npm run smoke:api` | PASS, exit 0 — `API and worker smoke checks passed` |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.UYq471/home TMPDIR=/tmp/localcast-slice5-repair.UYq471/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.UYq471/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=production LOCALCAST_RUNTIME_MODE=production LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.UYq471/vite npm_config_offline=true OPENAI_API_KEY=synthetic-parent-sentinel-not-a-credential OPENAI_CHAT_MODEL=synthetic-unapproved-parent-model LOCALCAST_PODCAST_TOKEN_FILE=/tmp/localcast-slice5-repair.UYq471/synthetic-parent-path-must-not-be-read npm run smoke:production` | PASS, exit 0 — `Production same-origin smoke checks passed` |
| The four exact scoped source/test/script privacy `rg --count-matches` commands and one built-frontend command already printed above | PASS — all five exited 1 with no output, meaning zero matches; ignored `.env` and runtime/secret stores were outside every search target |
| `git diff --check` | PASS, exit 0 — no whitespace errors |
| `git diff --cached --quiet` | PASS, exit 0 — index clean |

The ending worktree still contains exactly the 43 paths in the inventory above: 28 tracked paths with 2,135 insertions and 127 deletions, plus 15 untracked paths totaling 4,106 lines. No dependency or lockfile changed; the index remains clean and no commit or checkpoint was created. The private verification root and Playwright `test-results` directory were removed after the final checks. Slice 5 remains incomplete pending a new independent read-only audit and every previously recorded live/backup/migration/deployment/restart/rollback/checkpoint gate.

## 2026-08-08 — Slice 5 authority, remount-fencing, and cross-tab repair

Preflight reconfirmed branch `codex/localcast-prototype`, base HEAD `6e1242e3e16c87c294d6f4ba0ca8bc2d0f187a1c`, subject `feat(prototype): deliver private podcast feed`, clean index, and exactly the authorized 43-path Slice 5 worktree: 28 tracked paths with 2,135 insertions/127 deletions and 15 untracked paths totaling 4,106 lines. `git status`, the HEAD-to-worktree inventory, the preceding final inventory, and the user-supplied inventory agreed. No dependency or lockfile path changed. Slice 4 remained green and Slice 5 remained incomplete/uncommitted. The repository `.env`, real keys/tokens/certificates/feeds/databases/media, gPodder state, deployed runtime, Docker, networks, volumes, and non-loopback services were not read or touched.

This bounded repair closes the three latest independent-audit blockers:

- The exported/subclassable reservation issuer and public lifecycle-mutation seam are gone. Only `ChatStore.reserveProviderCall()` can insert a durable stage and register its frozen one-use grant in a module-private `WeakMap`. The provider's runtime-private draft/support methods enter only through the exact grant, identity, stage, model, worker, current lease, and durable row. Lifecycle updates close over that row and use ECMAScript-private store methods. Plain, copied, serialized, subclass-created, mismatched, expired, and reused values fail before request construction/fetch; deterministic fakes use the same production reservation/lifecycle invariant and remain absent from production bundles.
- `EpisodeChat` now fences every mutation, direct history read, automatic/manual reconciliation, timer, cache write, local-storage change, alert/status/focus update, and lock change by a mounted instance epoch plus the exact action generation. Unmount invalidates both generations and aborts tracked requests. Persisted state is never removed except by an exact complete-record comparison. Held mutation and history responses released after unmount/remount cannot overwrite the remounted instance's newer cache, shared identity, error, focus, or controls, while genuine late acceptance remains reconcilable.
- Pending identity moved from tab-scoped storage to a version-2 same-origin local-storage record containing only version, episode ID, action kind, bounded submission/retry identity, retry turn/attempt baseline where applicable, generation/owner IDs, and bounded timestamps. No question or grounding/provider content is stored. Storage events coordinate ordinary tabs, but this coordination is explicitly advisory. Migration 008's partial unique index plus immediate enqueue/retry transactions authoritatively permit only one queued/running turn per episode. Two distinct initial keys have one winner and no loser turn/attempt/call slot; same-key replay returns the original; retrying an older failure while a different question is active loses with a bounded conflict; and a new sequential question is permitted after terminal state.

The UI/provider/settings/privacy/request/usage/cost contracts otherwise remain unchanged. Settings now says OpenAI provider-side response storage is disabled through `store: false` while LocalCast retains ordered chat history in SQLite. Chat stays pinned to `gpt-5.4-mini-2026-03-17`, low reasoning, strict schemas, 131,072 UTF-8 serialized bytes/call, 2,500/750 output ceilings, no tools/search/browsing/retrieval/general-knowledge fallback, worker-only credentials, two stages/attempt, two attempts/four slots/turn, bounded audit metadata, and conservative planning estimates of `$0.223521` per supported attempt and `$0.447042` with the sole explicit retry. No exactly-once external-execution claim is made.

The implementation review found one adjacent contention edge: retrying an older failed turn while a newly submitted question was active could surface the SQLite unique violation as a generic error and retain the losing retry identity. The same immediate retry transaction now detects the different active turn, rejects without writing a retry row, and the browser adopts the authoritative active submission while retaining a bounded losing-retry error. Store and browser regressions cover that exact ordering.

### Verification ledger for this repair

The private verification root was `/tmp/localcast-slice5-repair.qyDhNZ` with private `home`, `tmp`, `cache`, `vite-env`, `media`, and `browser-output` children. Its exact initial `mktemp`/directory-creation command was not retained in the durable tool transcript and is not reconstructed. Every executable verification command below is reproduced exactly. Each used a scrubbed `env -i` parent, existing dependencies, synthetic settings, temporary storage, and loopback-only listeners. None invoked Docker or a non-loopback service.

| Exact command | Chronological result |
| --- | --- |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.qyDhNZ/home TMPDIR=/tmp/localcast-slice5-repair.qyDhNZ/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.qyDhNZ/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=worker DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair.qyDhNZ/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.qyDhNZ/vite-env npm_config_offline=true npm run lint` | Initial runs exposed test-only API/signature and then literal-inference diagnostics; both were repaired without weakening coverage. Every subsequent invocation passed, including the final post-contention typecheck, exit 0 |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.qyDhNZ/home TMPDIR=/tmp/localcast-slice5-repair.qyDhNZ/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.qyDhNZ/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=worker DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair.qyDhNZ/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.qyDhNZ/vite-env npm_config_offline=true ./node_modules/.bin/vitest run tests/unit/openai-provider.test.ts tests/unit/migrations.test.ts tests/unit/chat-validation.test.ts tests/integration/chat-workflow.test.ts --reporter=dot` | PASS, exit 0 — 4 files, 100 tests at the pre-contention repair point |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.qyDhNZ/home TMPDIR=/tmp/localcast-slice5-repair.qyDhNZ/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.qyDhNZ/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=worker DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair.qyDhNZ/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.qyDhNZ/vite-env npm_config_offline=true ./node_modules/.bin/vitest run tests/integration/chat-workflow.test.ts --reporter=dot` | PASS, exit 0 — 18 tests after adding retry-versus-question contention |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.qyDhNZ/home TMPDIR=/tmp/localcast-slice5-repair.qyDhNZ/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.qyDhNZ/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=worker DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair.qyDhNZ/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.qyDhNZ/vite-env npm_config_offline=true ./node_modules/.bin/vitest run tests/unit --reporter=dot` | PASS, exit 0 — 11 files, 192 tests |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.qyDhNZ/home TMPDIR=/tmp/localcast-slice5-repair.qyDhNZ/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.qyDhNZ/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NO_COLOR=1 FORCE_COLOR=0 NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=worker DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair.qyDhNZ/media LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.qyDhNZ/vite-env npm_config_offline=true ./node_modules/.bin/vitest run tests/integration --reporter=dot` | PASS, exit 0 — 13 files, 89 tests; expected synthetic `GENERATION_FAILED` stderr only |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.qyDhNZ/home TMPDIR=/tmp/localcast-slice5-repair.qyDhNZ/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.qyDhNZ/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=production LOCALCAST_RUNTIME_MODE=production LOCALCAST_PROCESS_ROLE=app LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.qyDhNZ/vite-env npm_config_offline=true npm run build` | PASS on every current-source invocation, exit 0 — 2,153 Vite modules and three server bundles; existing chunk warning only. The final invocation immediately preceded targeted and full Playwright evidence |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.qyDhNZ/home TMPDIR=/tmp/localcast-slice5-repair.qyDhNZ/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.qyDhNZ/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.qyDhNZ/vite-env PLAYWRIGHT_BROWSERS_PATH=/home/mkimitch/.cache/ms-playwright npm_config_offline=true ./node_modules/.bin/playwright test tests/e2e/episode-chat.spec.ts --grep "losing retry identity" --workers=1 --trace=off --reporter=line --output=/tmp/localcast-slice5-repair.qyDhNZ/browser-output` | PASS, exit 0 — 1/1 in 28.3 seconds |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.qyDhNZ/home TMPDIR=/tmp/localcast-slice5-repair.qyDhNZ/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.qyDhNZ/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NO_COLOR=1 FORCE_COLOR=0 NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.qyDhNZ/vite-env PLAYWRIGHT_BROWSERS_PATH=/home/mkimitch/.cache/ms-playwright npm_config_offline=true ./node_modules/.bin/playwright test tests/e2e/episode-chat.spec.ts --grep "independent browser contexts" --workers=1 --trace=off --reporter=dot --output=/tmp/localcast-slice5-repair.qyDhNZ/browser-output` | PASS, exit 0 — 1/1 in 25.6 seconds |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.qyDhNZ/home TMPDIR=/tmp/localcast-slice5-repair.qyDhNZ/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.qyDhNZ/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NO_COLOR=1 FORCE_COLOR=0 NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.qyDhNZ/vite-env PLAYWRIGHT_BROWSERS_PATH=/home/mkimitch/.cache/ms-playwright npm_config_offline=true ./node_modules/.bin/playwright test --workers=1 --trace=off --reporter=dot --output=/tmp/localcast-slice5-repair.qyDhNZ/browser-output` | First 14-flow run: NOT COUNTED, exit 1 — 13 passed and the same-origin test incorrectly required exactly one browser POST although the database invariant permits two. No product assertion failed. After narrowing that assertion to one committed authoritative turn, the final rerun passed 14/14 in 4.1 minutes |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.qyDhNZ/home TMPDIR=/tmp/localcast-slice5-repair.qyDhNZ/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.qyDhNZ/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NO_COLOR=1 FORCE_COLOR=0 NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.qyDhNZ/vite-env PLAYWRIGHT_BROWSERS_PATH=/home/mkimitch/.cache/ms-playwright npm_config_offline=true ./node_modules/.bin/playwright test tests/e2e/episode-chat.spec.ts --grep "same-origin tabs\|independent browser contexts" --workers=1 --trace=off --reporter=dot --output=/tmp/localcast-slice5-repair.qyDhNZ/browser-output` | PASS, exit 0 — 2/2 in 41.5 seconds before the final 14-flow rerun |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.qyDhNZ/home TMPDIR=/tmp/localcast-slice5-repair.qyDhNZ/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.qyDhNZ/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.qyDhNZ/vite-env npm_config_offline=true OPENAI_API_KEY=synthetic-parent-sentinel-not-a-credential OPENAI_CHAT_MODEL=synthetic-unapproved-parent-model LOCALCAST_PODCAST_TOKEN_FILE=/tmp/localcast-slice5-repair.qyDhNZ/synthetic-parent-path-must-not-be-read DOTENV_CONFIG_PATH=/tmp/localcast-slice5-repair.qyDhNZ/synthetic-dotenv-path-must-not-be-read SSL_CERT_FILE=/tmp/localcast-slice5-repair.qyDhNZ/synthetic-cert-path-must-not-be-read NODE_ENV=test LOCALCAST_RUNTIME_MODE=test npm run smoke:api` | PASS, exit 0 — `API and worker smoke checks passed` |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair.qyDhNZ/home TMPDIR=/tmp/localcast-slice5-repair.qyDhNZ/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair.qyDhNZ/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair.qyDhNZ/vite-env npm_config_offline=true OPENAI_API_KEY=synthetic-parent-sentinel-not-a-credential OPENAI_CHAT_MODEL=synthetic-unapproved-parent-model LOCALCAST_PODCAST_TOKEN_FILE=/tmp/localcast-slice5-repair.qyDhNZ/synthetic-parent-path-must-not-be-read DOTENV_CONFIG_PATH=/tmp/localcast-slice5-repair.qyDhNZ/synthetic-dotenv-path-must-not-be-read SSL_CERT_FILE=/tmp/localcast-slice5-repair.qyDhNZ/synthetic-cert-path-must-not-be-read NODE_ENV=production LOCALCAST_RUNTIME_MODE=production npm run smoke:production` | PASS, exit 0 — `Production same-origin smoke checks passed` |

An earlier full Playwright invocation remained active after its tool wrapper returned only partial output; the immediate retry correctly failed before tests with port 43179 already in use. That abandoned result is not counted. Its loopback-only synthetic server exited naturally before the final build/test sequence. Earlier focused browser iterations also exposed three test-only ordering assertions, then one locator ambiguity, and later a blank-question disabled-button expectation; all were corrected without weakening a production invariant. Missing historical wrapper text is not fabricated; the exact final commands above supersede those incomplete iterations.

Three independent read-only reviewers covered the requested axes. Provider/lifecycle review found no remaining authority, lifecycle, publication, lease, ambiguity, privacy, or call-ceiling blocker. UI review found the retry-versus-new-question contention edge described above; its post-fix re-review found no remaining blocker. Migration/smoke/docs review found no implementation blocker and identified stale counts plus imprecise schema-evidence wording, both superseded here. Reviewers made no edits and used no secret, provider, network, Docker, runtime, database, or media.

Remaining nonblocking depth is unchanged: no real provider-stage SIGKILL test; no post-competing-winner focus reassertion; citation activation, every pending announcement, and per-control reflow are not exhaustive; Playwright has no automatic `dist` freshness guard; generation and chat share one serial worker; local-storage compare/write is advisory rather than transactional; and SQLite's fractional-usage CHECK remains defense in depth behind integer normalization. None is represented as complete evidence.

The final worktree remains the same 43-path inventory printed above: 28 tracked paths with 2,264 insertions/127 deletions and 15 untracked paths totaling 4,764 lines. `git diff --check` and `git diff --cached --quiet` passed; no dependency/lockfile path changed. Three scoped source privacy scans, the built-frontend secret scan, and the production fake/issuer scan each returned zero matches. The app bundle contains no chat provider entrypoint or OpenAI endpoint; its four `OPENAI_API_KEY` name references are the existing non-worker-role rejection/configuration guard, never a value. Slice 5 remains incomplete and uncommitted; consent, exact fixture/questions, budget, protected backup, production migration/deployment/restart/rollback, a new independent audit, final diff review, checkpoint authorization, and Slice 6 remain open.

## 2026-08-08 — Slice 5 four-blocker repository repair (superseded in part)

Preflight matched the authorized base exactly: branch `codex/localcast-prototype`, HEAD `6e1242e3e16c87c294d6f4ba0ca8bc2d0f187a1c`, subject `feat(prototype): deliver private podcast feed`, clean index, the same 43 recognized paths, 28 tracked paths at 2,264 insertions/127 deletions, and 15 untracked paths totaling 4,764 lines. No dependency or lockfile changed. Slice 4 remained green; Slice 5 remained incomplete, unstaged, and uncommitted. The repository `.env`, real secrets/provider, existing data/media, deployed runtime, Docker, networks, volumes, Caddy, feeds, certificates, gPodder, and non-loopback services were not read or touched.

The four audit blockers were reproduced against production source and repaired:

- At this repair point, `episode_lock` plus a partial unique index protected queued/running turns and failed turns containing `reserved`, `response_received`, or `ambiguous` provider rows. A later focused audit found that finalized-but-unpublished provider outcomes could still release that lock; the 2026-08-09 repair below supersedes this incomplete claim.
- `ChatStore` accepts only a runtime-authenticated native `better-sqlite3` database. The exact stage row commits before a frozen one-use row-bound grant is registered and before the stage-specific adapter method is entered. Draft and support reserve separately; support repeats current attempt/worker/lease/order/uniqueness/ceiling validation. Structural database lookalikes and the invalid-grant matrix fail before adapter entry/fake fetch. Narrow row-bound lifecycle transitions and strict finalized-outcome publication remain mandatory.
- `EpisodeChat` now gives every effect lifetime a fresh epoch, rebinds restored actions, and invalidates instance/action/history/manual-check generations on cleanup. One monotonic history generation orders hydration, polling, mutation-error, automatic/manual, timer, and storage-event results. Raw history is published only after all applicable fences pass. Exact local-storage comparison prevents stale replacement/removal. Real development StrictMode, unmount/remount held responses, stale mutation/automatic/manual history, malformed-record recovery, and cross-tab convergence are permanent browser tests.
- Shared well-formed-text validation rejects NUL, U+FFFD, and lone UTF-16 surrogates before persistence, provider construction, or publication, then applies Unicode-code-point bounds. Valid pairs/non-BMP text round-trip. Migration 008 independently enforces the SQLite-representable identity constraints. Invalid questions receive bounded API validation; invalid claims/excerpts finalize fail closed.

### Retained verification ledger for that repair

All executable checks retained below used installed dependencies, synthetic settings, temporary storage, loopback only, and a scrubbed `env -i` parent where environment mattered. No command invoked Docker, dependency installation, a live provider, a non-loopback service, deployed LocalCast, or existing data/media. This is retained evidence, not a complete historical command transcript: wrappers or outputs that were not retained are not reconstructed. The exact retained private-directory preparation command was:

`mkdir -p /tmp/localcast-slice5-repair/home /tmp/localcast-slice5-repair/tmp /tmp/localcast-slice5-repair/media /tmp/localcast-slice5-repair/cache /tmp/localcast-slice5-repair/vite-env /tmp/localcast-slice5-repair/playwright`

It passed with exit 0. Repeated identical commands are printed once below with their chronological results; incomplete wrapper output is explicitly not counted.

| Exact command | Chronological result |
| --- | --- |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair-home TMPDIR=/tmp NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair-media npm_config_offline=true npm run lint` | Early runs exposed missing `runId`/provider-interface/Zod typing, then a readonly test literal, then a missing `PendingStorageRead.raw`; each was repaired. Every later invocation, including the final source run, passed with exit 0 |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair-home TMPDIR=/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair-media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured npm_config_offline=true ./node_modules/.bin/vitest run tests/unit/chat-validation.test.ts tests/unit/migrations.test.ts tests/unit/openai-provider.test.ts tests/integration/chat-workflow.test.ts` | Initial repair point: 101 passed. Expanded run: 115 passed/4 failed, exposing two malformed-output expectations and two SQLite-surrogate expectations. After repairs, 117/117 passed, exit 0; the final post-trigger rerun also passed 117/117 |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair-home TMPDIR=/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair-media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured npm_config_offline=true ./node_modules/.bin/vitest run tests/unit/migrations.test.ts tests/unit/openai-provider.test.ts` | PASS, exit 0 — 76/76 after the malformed-text and SQLite constraint repair |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair-home TMPDIR=/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair-media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured npm_config_offline=true ./node_modules/.bin/vitest run tests/unit/migrations.test.ts` | PASS, exit 0 — 12/12 after adding the provider-row update trigger |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair/home TMPDIR=/tmp/localcast-slice5-repair/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured npm_config_offline=true ./node_modules/.bin/vitest run tests/unit` | PASS, exit 0 — 11 files, 207 tests |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair/home TMPDIR=/tmp/localcast-slice5-repair/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured npm_config_offline=true ./node_modules/.bin/vitest run tests/integration` | PASS, exit 0 — 13 files, 90 tests; expected synthetic `GENERATION_FAILED` stderr only. An earlier parallel wrapper hid its output; this explicit rerun is the counted evidence |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair/home TMPDIR=/tmp/localcast-slice5-repair/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured npm_config_offline=true node scripts/smoke-api.mjs` | PASS, exit 0 — `API and worker smoke checks passed` |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair/home TMPDIR=/tmp/localcast-slice5-repair/tmp LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=production LOCALCAST_RUNTIME_MODE=production LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured npm_config_offline=true node scripts/smoke-production.mjs` | PASS, exit 0 — `Production same-origin smoke checks passed` |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair/home TMPDIR=/tmp/localcast-slice5-repair/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair/cache NODE_ENV=production LOCALCAST_RUNTIME_MODE=production LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair/vite-env LOCALCAST_VITE_API_TARGET=http://127.0.0.1:43185 npm_config_offline=true npm run build` | PASS on the final fresh run, exit 0 — 2,154 Vite modules, browser asset `index-Dim6l2bm.js`, and three production server bundles; existing chunk warning only |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair/home TMPDIR=/tmp/localcast-slice5-repair/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair/vite-env PLAYWRIGHT_BROWSERS_PATH=/home/mkimitch/.cache/ms-playwright npm_config_offline=true ./node_modules/.bin/playwright test tests/e2e/episode-chat.spec.ts --grep "ambiguous chat mutations|malformed-record|development StrictMode" --workers=1 --trace=off --reporter=line --output=/tmp/localcast-slice5-repair/playwright` | Initial iterations exposed test-only ordering/locator expectations (2 failed/2 passed, then 1 timeout/3 passed); after correcting the tests without weakening product assertions, the focused late-visibility flow passed 1/1 and the malformed-record/StrictMode subset passed 3/3 |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair/home TMPDIR=/tmp/localcast-slice5-repair/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair/vite-env PLAYWRIGHT_BROWSERS_PATH=/home/mkimitch/.cache/ms-playwright npm_config_offline=true ./node_modules/.bin/playwright test tests/e2e/episode-chat.spec.ts --grep "same-origin tabs" --workers=1 --trace=off --reporter=line --output=/tmp/localcast-slice5-repair/playwright` | PASS, exit 0 — 1/1 in 27.9 seconds |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair/home TMPDIR=/tmp/localcast-slice5-repair/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair/vite-env PLAYWRIGHT_BROWSERS_PATH=/home/mkimitch/.cache/ms-playwright npm_config_offline=true ./node_modules/.bin/playwright test --workers=1 --trace=off --reporter=line --output=/tmp/localcast-slice5-repair/playwright` | PASS, exit 0 — 17/17 in 4.9 minutes. The first browser attempt without `PLAYWRIGHT_BROWSERS_PATH` failed to launch Chromium and created ignored `test-results`; it is not counted |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-repair/home TMPDIR=/tmp/localcast-slice5-repair/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-repair/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-repair/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-repair/vite-env PLAYWRIGHT_BROWSERS_PATH=/home/mkimitch/.cache/ms-playwright npm_config_offline=true ./node_modules/.bin/playwright test tests/e2e/episode-chat.spec.ts --grep "episode-grounded chat is disclosed" --workers=1 --trace=off --reporter=line --output=/tmp/localcast-slice5-repair/playwright` | PASS, exit 0 — 1/1 in 56.6 seconds after strengthening the synthetic answer/refusal/retry render assertions |
| `find /opt/stacks/local-cast-prototype/test-results -depth -delete` | PASS, exit 0 — removed only the ignored Playwright launch-failure artifacts whose exact identity was inspected first |

Three independent read-only reviews covered transaction/migration/Unicode, provider authority/lifecycle/bundles, and UI StrictMode/history/cross-tab/accessibility. They found no remaining blocker after the provider-row update trigger, malformed-shared-record recovery, stale automatic-poll error suppression, and manual-check generation fixes were applied and rerun. Reviewers made no edits and accessed no secret, provider, network, Docker, runtime, database, or media.

Verification counts at that repair point were 117 focused tests, 207 unit tests, 90 integration tests, 17 browser/axe flows, one targeted disclosure/render flow, both isolated smokes, typecheck, and then-current production bundles. Historical non-scrubbed smoke evidence remains superseded, not rewritten. Earlier command wrappers whose exact text/output was not retained are not reconstructed; only the explicit retained reruns above count as proof.

Remaining nonblocking depth: no real provider-stage SIGKILL test; no post-competing-winner focus reassertion; citation activation, every pending announcement, and per-control reflow are not exhaustive; Playwright has no automatic `dist` freshness guard; generation and chat share one serial worker; local-storage compare/write is advisory; U+FFFD is conservatively excluded; and SQLite's fractional-usage CHECK remains defense in depth behind integer normalization. Slice 5 remains incomplete; consent, exact fixture/questions, budget allocation, protected backup, production migration/deployment/restart/rollback, a new independent read-only audit, final diff review, checkpoint authorization, and Slice 6 remain open.

### Changed-path inventory at that repair point

- `docs/codex/BUILD_LOG.md`
- `docs/codex/DECISIONS.md`
- `docs/codex/PLAN.md`
- `docs/codex/SPEC.md`
- `docs/codex/STATE.md`
- `docs/codex/TEST_MATRIX.md`
- `package.json`
- `playwright.config.ts`
- `scripts/smoke-api.mjs`
- `scripts/smoke-environment.mjs`
- `scripts/smoke-production.mjs`
- `server/app.ts`
- `server/chat/types.ts`
- `server/chat/validation.ts`
- `server/database/migrations.ts`
- `server/jobs/applicationWorker.ts`
- `server/jobs/chatProcessor.ts`
- `server/jobs/chatWorker.ts`
- `server/providers/openai.ts`
- `server/routes/chat.ts`
- `server/routes/followUp.ts` (deleted)
- `server/services/chatStore.ts`
- `server/testing/fakeChatProcessor.ts`
- `server/testing/worker.ts`
- `server/validation.ts`
- `server/worker.ts`
- `server/workerProcess.ts`
- `src/features/briefings/BriefingDetail.tsx`
- `src/features/briefings/EpisodeChat.tsx`
- `src/features/settings/Settings.tsx`
- `src/services/api/ApiBriefingService.ts`
- `src/services/api/index.ts`
- `src/styles/components.css`
- `src/types.ts`
- `tests/e2e/episode-chat.spec.ts`
- `tests/e2e/foundation.spec.ts`
- `tests/helpers/chat.ts`
- `tests/integration/chat-workflow.test.ts`
- `tests/unit/chat-validation.test.ts`
- `tests/unit/migrations.test.ts`
- `tests/unit/openai-provider.test.ts`
- `tests/unit/smoke-environment.test.ts`
- `vite.config.ts`

Repository accounting at that repair point was 28 tracked paths with 2,660 insertions and 130 deletions; 15 untracked paths totaling 5,274 lines; the same 43-path inventory; clean index; no dependency/lockfile change; no commit or checkpoint. The then-current `git diff --check` and `git diff --cached --quiet` each exited 0. The corrected scoped source credential-pattern scan and production fake/obsolete-issuer scan each exited 1 with no matches. The OpenAI endpoint scan exited 1 for browser/app/storage-init bundles and found the expected single worker endpoint. An initial credential scan had an unmatched shell quote and exited 2; an initial bundle scan named obsolete `.cjs` output paths and exited 2; neither result is counted. One read-only documentation grep contained shell-active Markdown backticks, emitted `better-sqlite3: command not found`, and was not used as evidence. All three diagnostics changed no file or runtime state and were superseded by the corrected commands and the independent frozen-record reread.

## 2026-08-09 — Slice 5 finalized-outcome episode-lock repair

Supersession note: the focused read-only audit that followed this entry confirmed the production `ChatStore` lock rule but found that migration 008 still treated every direct `answered`/`refused` update as a publication exception and did not structurally prevent lifecycle rewrite, reparenting, or deletion. The trigger claims below therefore describe the evidence available at that repair point, not the final migration integrity result. The later migration-only repair entry records the corrected schema and verification without rewriting this historical command record.

Preflight matched the authorized base: branch `codex/localcast-prototype`, HEAD `6e1242e3e16c87c294d6f4ba0ca8bc2d0f187a1c`, subject `feat(prototype): deliver private podcast feed`, clean index, the same 43 recognized paths, 28 tracked paths at 2,660 insertions/130 deletions, and 15 untracked paths totaling 5,274 lines. No dependency or lockfile path changed. Slice 4 remained green; Slice 5 remained incomplete, unstaged, and uncommitted.

The focused audit found one remaining defect: store failure, interruption, and stale-recovery paths based `episode_lock` on whether the current attempt had a non-finalized provider row. A provider row finalized as rejection, invalid output/citations, or support failure therefore allowed an unpublished turn to unlock; lease loss after a finalized draft had the same outcome. The bounded repair now uses turn-wide existence of any provider lifecycle row for every unpublished failure/recovery transition. Any provider-using unpublished turn keeps `episode_lock = 1`, including `reserved`, `response_received`, `ambiguous`, and `finalized` rows across any attempt. A safely published answer/refusal sets the lock to zero, as does a provable terminal failure whose turn has no provider row. The existing explicit retry remains attached to the locked turn; same-key initial replay returns that turn; and a distinct key loses before creating a turn, attempt, lifecycle row, retry request, or provider work. Safe publication or a proven zero-provider terminal failure permits a later sequential question, so the guard is not lifetime-scoped.

Migration 008 remains unapplied outside synthetic temporary databases. Its partial unique index still permits only one `episode_lock = 1` row per episode. The turn `state`/`episode_lock` release trigger now rejects any unpublished unlock whenever any provider row exists, regardless of lifecycle status. Provider-row insertion and every provider-row update require the `NEW.turn_id` parent to hold the lock. Direct synthetic trigger tests cover rejected insertion into an unlocked parent, rejected update after a safely published parent released its lock, and rejected turn unlock for all four lifecycle statuses. Migration-007 upgrade, repeat no-op, file-backed close/reopen, exact retained outcomes, and safe published release remain covered. Migration 007 has no chat tables, so there is no conflicting active-chat fixture to add; the test matrix states that limitation rather than claiming one.

Permanent production-path integration tests cover finalized provider rejection, invalid response, invalid citations, support rejection, interruption, unavailable/exhausted queued recovery, and lease loss after a finalized draft. Each asserts the retained lock and bounded distinct-key conflict without losing side effects. The same tests retain same-key replay, same-turn eligible retry, exactly-one retry contention, answer/refusal release, zero-provider stale recovery release, and later sequential submission. No provider request, EpisodeChat, model, dependency, lockfile, privacy boundary, or deployment path changed.

Three scoped read-only reviews followed the implementation. Store review found no blocking production path and confirmed turn-wide lifecycle detection in failure, interrupt, unavailable/exhausted, and stale-recovery writers; its suggested attempt-depth cases remain nonblocking because the helper is turn-wide and the exercised attempt-1/attempt-2 paths share it. Migration review found no invariant defect but requested direct provider-row insert/update trigger negatives and reopened outcome assertions; those were added and the focused gate rerun green. Documentation/scope review found stale historical-finality wording, `channel` terminology despite actual `localStorage`/`storage`-event coordination, imprecise update-trigger scope, and the missing current ledger; all were corrected. Reviewers made no edits and used no secret, provider, network, Docker, deployed runtime, database, or media.

### Exact retained command ledger for this focused repair

Every command in this repair that executed application, test, typecheck, or build code used installed dependencies, obvious synthetic settings, temporary storage, loopback-only configuration where applicable, and a scrubbed `env -i` parent. Read-only Git/`rg` accounting and explicitly scoped temporary-directory lifecycle commands did not need or claim that parent. The real repository `.env`, secrets, provider, existing data/media, Docker, deployed services, and non-loopback network were not accessed. Source edits were made only with the structured patch tool; no shell write command was used. The initial read-only preflight result is retained above, but its earlier orchestration wrapper is not reconstructed and this section is not represented as a complete historical shell transcript.

| Exact command | Result |
| --- | --- |
| `mktemp -d /tmp/localcast-slice5-episode-lock.XXXXXXXX` | PASS, exit 0 — created `/tmp/localcast-slice5-episode-lock.TRlGrSw6` |
| `mkdir -p /tmp/localcast-slice5-episode-lock.TRlGrSw6/home /tmp/localcast-slice5-episode-lock.TRlGrSw6/tmp /tmp/localcast-slice5-episode-lock.TRlGrSw6/media /tmp/localcast-slice5-episode-lock.TRlGrSw6/cache /tmp/localcast-slice5-episode-lock.TRlGrSw6/vite-env /tmp/localcast-slice5-episode-lock.TRlGrSw6/build` | PASS, exit 0 |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-episode-lock.TRlGrSw6/home TMPDIR=/tmp/localcast-slice5-episode-lock.TRlGrSw6/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-episode-lock.TRlGrSw6/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-episode-lock.TRlGrSw6/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-episode-lock.TRlGrSw6/vite-env npm_config_offline=true ./node_modules/.bin/vitest run tests/integration/chat-workflow.test.ts --reporter=dot` | Expected regression-first FAIL, exit 1 — 16 passed/3 failed; finalized provider rejection, finalized-draft lease loss, and support rejection each produced lock `0` instead of required `1` |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-episode-lock.TRlGrSw6/home TMPDIR=/tmp/localcast-slice5-episode-lock.TRlGrSw6/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-episode-lock.TRlGrSw6/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-episode-lock.TRlGrSw6/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-episode-lock.TRlGrSw6/vite-env npm_config_offline=true ./node_modules/.bin/vitest run tests/unit/migrations.test.ts tests/integration/chat-workflow.test.ts --reporter=dot` | PASS twice, exit 0 — 2 files/33 tests after implementation and again after direct trigger/reopen review assertions |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-episode-lock.TRlGrSw6/home TMPDIR=/tmp/localcast-slice5-episode-lock.TRlGrSw6/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-episode-lock.TRlGrSw6/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-episode-lock.TRlGrSw6/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-episode-lock.TRlGrSw6/vite-env npm_config_offline=true npm run lint` | PASS twice, exit 0 — TypeScript emitted no diagnostics before or after the review assertions |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-episode-lock.TRlGrSw6/home TMPDIR=/tmp/localcast-slice5-episode-lock.TRlGrSw6/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-episode-lock.TRlGrSw6/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=production LOCALCAST_RUNTIME_MODE=production LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-episode-lock.TRlGrSw6/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-episode-lock.TRlGrSw6/vite-env LOCALCAST_VITE_API_TARGET=http://127.0.0.1:43185 npm_config_offline=true npm run build` | PASS twice, exit 0 — 2,154 Vite modules plus `index.js`, `worker.js`, and `storageInit.js`; existing chunk-size warning only |
| `rg -n "BroadcastChannel\|reserved.*,.*response_received.*,.*ambiguous\|unresolved provider\|one \`episode_lock\`\|one episode\|later question\|sequential question\|lifecycle trigger\|complete final repair\|Complete final repair\|command history\|historical.*complete\|conflicting pre-migration" docs/codex/{SPEC,PLAN,STATE,DECISIONS,TEST_MATRIX,BUILD_LOG}.md` | Read-only diagnostic, exit 0 after the shell first emitted `episode_lock: command not found`; shell-active Markdown backticks made this output unsuitable as evidence and it changed nothing |
| `rg -n 'BroadcastChannel\|Complete final repair\|conflicting pre-migration\|failed turns containing.*reserved\|failed turns with.*reserved\|failed turns.*unresolved provider\|no unresolved provider lifecycle\|unresolved provider row' docs/codex/SPEC.md docs/codex/PLAN.md docs/codex/STATE.md docs/codex/DECISIONS.md docs/codex/TEST_MATRIX.md docs/codex/BUILD_LOG.md` | PASS as corrected read-only inspection; only the explicitly superseded historical BUILD_LOG statement remained |
| `git diff --check` | PASS before the current ledger, exit 0 |
| `git diff --cached --quiet` | PASS before the current ledger, exit 0 — index clean |
| `git status --short` | PASS, exit 0 — same recognized path set |
| `git diff --stat` | PASS, exit 0 — interim accounting before this ledger was 28 tracked paths, 2,812 insertions/130 deletions |
| `git ls-files --others --exclude-standard -z \| xargs -0 wc -l` | PASS, exit 0 — 15 untracked files, 5,430 total lines |
| `git diff --name-only -- package-lock.json yarn.lock pnpm-lock.yaml` | PASS, exit 0 with no output — no dependency lockfile changed |

The earlier broader Slice 5 evidence remains retained above and was intentionally not rerun. This repair did not change `EpisodeChat`, so the already-passing browser suite was not rerun. Neither smoke was rerun because this scoped store/migration repair did not change smoke or child-environment behavior. `npm run verify`, Compose/image checks, Docker, live-provider checks, production migration, deployment, and non-loopback tests remained prohibited or deferred.

### Current changed-path inventory

The worktree remains exactly these 43 recognized Slice 5 paths; no new path, dependency, or lockfile is present:

```text
docs/codex/BUILD_LOG.md
docs/codex/DECISIONS.md
docs/codex/PLAN.md
docs/codex/SPEC.md
docs/codex/STATE.md
docs/codex/TEST_MATRIX.md
package.json
playwright.config.ts
scripts/smoke-api.mjs
scripts/smoke-environment.mjs
scripts/smoke-production.mjs
server/app.ts
server/chat/types.ts
server/chat/validation.ts
server/database/migrations.ts
server/jobs/applicationWorker.ts
server/jobs/chatProcessor.ts
server/jobs/chatWorker.ts
server/providers/openai.ts
server/routes/chat.ts
server/routes/followUp.ts (deleted)
server/services/chatStore.ts
server/testing/fakeChatProcessor.ts
server/testing/worker.ts
server/validation.ts
server/worker.ts
server/workerProcess.ts
src/features/briefings/BriefingDetail.tsx
src/features/briefings/EpisodeChat.tsx
src/features/settings/Settings.tsx
src/services/api/ApiBriefingService.ts
src/services/api/index.ts
src/styles/components.css
src/types.ts
tests/e2e/episode-chat.spec.ts
tests/e2e/foundation.spec.ts
tests/helpers/chat.ts
tests/integration/chat-workflow.test.ts
tests/unit/chat-validation.test.ts
tests/unit/migrations.test.ts
tests/unit/openai-provider.test.ts
tests/unit/smoke-environment.test.ts
vite.config.ts
```

Final accounting and final Git checks for this repair are recorded below after the ledger itself is included. Slice 5 remains incomplete and uncommitted. The final focused read-only audit; consent, exact fixture/question, live-provider and budget allocation; protected backup; production migration/deployment/restart/rollback; final diff review; checkpoint authorization; and Slice 6 all remain open.

### Final cleanup and repository accounting

| Exact command | Result |
| --- | --- |
| `rg -n 'BroadcastChannel\|channel responses\|channel results\|final four-blocker\|The four final blockers\|Final changed-path inventory\|Final repository accounting' docs/codex/STATE.md docs/codex/BUILD_LOG.md` | Read-only review, exit 0 — matches were limited to historical headings and the literal diagnostic-command records; no current behavioral claim references a broadcast channel |
| `git diff --check` | PASS on both the pre-ledger and final documentation states, exit 0 |
| `git diff --cached --quiet` | PASS on both states, exit 0 — index remained clean |
| `git status --porcelain=v1 -uall` | PASS, exit 0 — the exact 43-path inventory above remained unchanged |
| `git diff --stat` | PASS, exit 0 — final accounting is stated below |
| `git ls-files --others --exclude-standard -z \| xargs -0 wc -l` | PASS, exit 0 — 15 untracked files totaling 5,430 lines |
| `find /tmp/localcast-slice5-episode-lock.TRlGrSw6 -depth -delete` | PASS, exit 0 — removed only this repair's isolated synthetic temporary tree |
| `test ! -e /tmp/localcast-slice5-episode-lock.TRlGrSw6` | PASS, exit 0 — cleanup confirmed |

Final repository accounting: 28 tracked paths with 2,914 insertions and 130 deletions; 15 untracked paths totaling 5,430 lines; exact same 43-path inventory; clean index; no dependency/lockfile change; no staged file, commit, or checkpoint. The current production build was produced after the final source/test changes; later edits were documentation only. No real `.env`, secret, provider, budget, existing database/media, deployed runtime, Docker/container/network/volume, Caddy, certificate, feed, gPodder/launcher, or non-loopback service was accessed or changed.

## 2026-08-09 — Slice 5 migration-008 ordinary-DML integrity repair

This final bounded repository repair started from branch `codex/localcast-prototype` at unchanged HEAD `6e1242e3e16c87c294d6f4ba0ca8bc2d0f187a1c`, subject `feat(prototype): deliver private podcast feed`, with a clean index, the same 43 recognized Slice 5 paths, 28 tracked paths at 2,914 insertions/130 deletions, and 15 untracked paths totaling 5,430 lines. No dependency or lockfile changed. Slice 4 remained green; Slice 5 remained incomplete, unstaged, and uncommitted.

The focused audit identified two schema-level causes inside still-unapplied migration 008. First, the publication trigger verified only the current attempt, so ordinary DML could construct an otherwise valid attempt-two refusal while an earlier provider row remained `reserved`, `response_received`, or `ambiguous`. Second, evidence-retention DELETE triggers were insufficient against SQLite conflict replacement: with the production connection's default non-recursive trigger setting, `INSERT OR REPLACE` or a partial-index `UPDATE OR REPLACE` could implicitly displace a parent, turn, attempt, provider row, or published claim without invoking the intended explicit-delete guard.

Migration 008 now rejects conflicting insert replacement before SQLite can displace a retained briefing, turn, claim, citation, attempt, retry, or provider identity. Turn updates also reject running-slot and per-episode-lock partial-index displacement. Direct identity updates are immutable for turn, claim, citation, attempt, retry, and provider rows; provider reservation identity remains frozen. Provider rows still begin only as `reserved`, move only `reserved -> response_received -> finalized` or `reserved -> ambiguous`, and cannot be deleted while their turn remains. Explicit whole-episode deletion remains the tested retention boundary.

The exact publication exception is now narrower. A zero-provider terminal failure may unlock. A provider-backed answer/refusal must still be written from the current leased running attempt with exact compatible finalized current-attempt outcomes and exact claims/citations. In addition, the number of attempt rows must equal `attempt_count`; the current attempt must have no error metadata; attempt two requires the accepted retry row plus a finished error-bearing attempt one in `failed`, `interrupted`, or `recovered`; and every earlier provider row must be `finalized`. The later attempt outcome can be finalized only after the parent turn has already published the same answer/refusal kind. This preserves the existing `ChatStore` order: validate lifecycle, write answer artifacts, publish the turn, then finalize the attempt.

Permanent migration regressions use only synthetic databases and ordinary SQL. They separately cover missing support, missing claims, missing citations, outcome mismatch, missing publication fields, all three unresolved earlier lifecycle states, attempt two without a retry record, all four failed-turn lifecycle statuses, row and composite identity mutation, cross-target transfer, parent replacement, global-running and episode-lock partial-index displacement, published-claim/citation replacement, retry replacement, lifecycle regression/outcome rewrite, provider deletion, exact state preservation after rejection, exact answer/refusal publication, zero-provider release, sequential questions, whole-episode deletion, migration-007 upgrade, repeat no-op, and file-backed reopen. The production-path chat workflow retains answer/refusal publication, definitive retry, stale recovery, contention, same-key replay, and sequential-question compatibility.

Three final read-only reviews covered SQL/ChatStore compatibility, direct-DML test validity/evidence-erasure equivalents, and documentation/accounting. The first review identified the `REPLACE` bypass and earlier-attempt publication gap; both were reproduced in permanent tests before the schema repair. Final re-reviews found no remaining blocker. Their nonblocking requests for separately isolated missing-support/claim/citation and missing-retry cases were added and rerun. Documentation now describes ordinary-DML structural integrity rather than schema-authority protection, and does not claim broader state preservation than the tested briefing/chat/provider snapshot.

### Retained command ledger for this repair

Every application, test, typecheck, and build command below used installed dependencies, explicit synthetic configuration, temporary storage, and a scrubbed `env -i` parent. The one API integration listener was an authorized synthetic loopback listener. Read-only Git/source inspection and exact temporary-directory lifecycle commands did not use or claim a scrubbed application environment. Some preflight and source-read orchestration wrappers occurred before context compaction and their exact text was not retained; they are not reconstructed here. The retained commands and outcomes below are exact, while repeated identical commands are grouped with their observed chronological outcomes.

| Exact command | Result |
| --- | --- |
| `mktemp -d /tmp/localcast-slice5-migration-integrity.XXXXXXXX` | PASS, exit 0 — created `/tmp/localcast-slice5-migration-integrity.O1Q9ynKW` |
| `mkdir -p /tmp/localcast-slice5-migration-integrity.O1Q9ynKW/home /tmp/localcast-slice5-migration-integrity.O1Q9ynKW/tmp /tmp/localcast-slice5-migration-integrity.O1Q9ynKW/media /tmp/localcast-slice5-migration-integrity.O1Q9ynKW/cache /tmp/localcast-slice5-migration-integrity.O1Q9ynKW/vite-env /tmp/localcast-slice5-migration-integrity.O1Q9ynKW/build` | PASS, exit 0 |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/home TMPDIR=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/vite-env npm_config_offline=true ./node_modules/.bin/vitest run tests/unit/migrations.test.ts -t "rejects an incompatible direct publication" --reporter=dot` | Expected regression-first FAIL, exit 1 — incompatible answer publication did not throw. The same exact command failed again after the first trigger patch because the older fixture manufactured a finalized row instead of following the new reserved-first graph; that fixture was corrected rather than weakening the trigger |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/home TMPDIR=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/vite-env npm_config_offline=true ./node_modules/.bin/vitest run tests/unit/migrations.test.ts --reporter=dot` | Intermediate chronology: exit 1 with two fixture/message failures; then PASS 14/14; then exit 1 with a null-refusal bypass plus an error-message assertion; then exit 1 with the remaining message assertion; then PASS 17/17 after the original integrity repair. Later final-repair runs passed 21/21 twice and the final strengthened suite passed 22/22, all exit 0 |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/home TMPDIR=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/vite-env npm_config_offline=true ./node_modules/.bin/vitest run tests/integration/chat-workflow.test.ts --reporter=dot` | First sandboxed run: exit 1 with 19 production-path tests passing and only the API case blocked by `listen EPERM 127.0.0.1`. Authorized isolated-loopback reruns passed 20/20, exit 0, including the final post-trigger compatibility run |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/home TMPDIR=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=production LOCALCAST_RUNTIME_MODE=production LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/tmp/typecheck.sqlite MEDIA_PATH=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/vite-env npm_config_offline=true npm run lint` | PASS, exit 0 — TypeScript emitted no diagnostics before the final focused findings |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/home TMPDIR=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=production LOCALCAST_RUNTIME_MODE=production LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/tmp/build.sqlite MEDIA_PATH=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/vite-env LOCALCAST_VITE_API_TARGET=http://127.0.0.1:43185 npm_config_offline=true npm run build` | PASS, exit 0 — 2,154 Vite modules and all three server bundles; existing chunk warning only, before the final focused findings |
| `git diff --check && git diff --cached --quiet` | PASS, exit 0 — no whitespace errors and clean index at that intermediate point |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/home TMPDIR=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/vite-env npm_config_offline=true ./node_modules/.bin/vitest run tests/unit/migrations.test.ts -t "rejects replacement statements" --reporter=dot` | Expected FAIL, exit 1 — same-ID provider draft-to-support `INSERT OR REPLACE` succeeded and proved the implicit-delete bypass |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/home TMPDIR=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=test LOCALCAST_RUNTIME_MODE=test LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/vite-env npm_config_offline=true ./node_modules/.bin/vitest run tests/unit/migrations.test.ts -t "rejects attempt-two publication|rejects replacement statements" --reporter=dot` | Expected FAIL before the final SQL patch, exit 1 — four failures: attempt-two publication succeeded over each of `reserved`, `response_received`, and `ambiguous` attempt-one state, and provider `REPLACE` succeeded. Exact rerun after the patch passed 4/4, exit 0 |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/home TMPDIR=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=production LOCALCAST_RUNTIME_MODE=production LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/tmp/typecheck-final.sqlite MEDIA_PATH=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/vite-env npm_config_offline=true npm run lint` | PASS, exit 0 — final TypeScript `--noEmit` check |
| `env -i PATH=/usr/local/bin:/usr/bin:/bin HOME=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/home TMPDIR=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/tmp XDG_CACHE_HOME=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/cache LANG=C.UTF-8 LC_ALL=C.UTF-8 TZ=UTC NODE_ENV=production LOCALCAST_RUNTIME_MODE=production LOCALCAST_PROCESS_ROLE=app DATABASE_PATH=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/tmp/build-final.sqlite MEDIA_PATH=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/media TEXT_PROVIDER=not_configured SPEECH_PROVIDER=not_configured LOCALCAST_VITE_ENV_DIR=/tmp/localcast-slice5-migration-integrity.O1Q9ynKW/vite-env LOCALCAST_VITE_API_TARGET=http://127.0.0.1:43185 npm_config_offline=true npm run build` | PASS, exit 0 — Vite 6.4.3 transformed 2,154 modules; `dist-server/index.js`, `worker.js`, and `storageInit.js` emitted; existing chunk-size warning only |
| `git diff --shortstat` | PASS, exit 0 — interim pre-ledger accounting: 28 tracked paths, 4,469 insertions/130 deletions |
| `git status --porcelain=v1 --untracked-files=all` | PASS, exit 0 — clean index and the same recognized 43-path worktree |
| `git diff --cached --quiet` | PASS, exit 0 — index clean |
| `git diff --name-only -- package-lock.json yarn.lock pnpm-lock.yaml` | PASS, exit 0 with no output — no lockfile changed |
| `git ls-files --others --exclude-standard -z \| xargs -0 wc -l` | PASS, exit 0 — 15 untracked files totaling 5,430 lines |

### Repair scope and deferred gates

This repair changed exactly eight already-recognized paths: `server/database/migrations.ts`, `tests/unit/migrations.test.ts`, and `docs/codex/{SPEC,DECISIONS,PLAN,STATE,TEST_MATRIX,BUILD_LOG}.md`. It added no path or dependency and changed no ChatStore, EpisodeChat, provider, model, request, privacy, feed, audio, Caddy, Docker, deployment, or launcher behavior. Browser and smoke tests were intentionally not rerun because neither their source nor a dependency changed; `npm run verify`, Compose/image checks, Docker, provider calls, production migration, deployment, and non-loopback verification remained prohibited. Consent, exact fixture/question, budget allocation, backup, production migration/deployment/restart/rollback, final diff review, checkpoint authorization, and Slice 6 remain open. Slice 5 is not complete or green.

Final cleanup and repository accounting follow after the last documentation and Git checks. No real `.env`, secret, provider, budget, existing database/media, deployed runtime, container/network/volume, Caddy, certificate, feed, gPodder/launcher, or external non-loopback service was accessed or changed.

### Final cleanup and accounting

| Exact command | Result |
| --- | --- |
| `rg -n "21 migration\|41 migration\|final focused read-only audit\|complete durable state unchanged\|complete historical shell transcript" docs/codex/STATE.md docs/codex/TEST_MATRIX.md docs/codex/BUILD_LOG.md` | Read-only precision check, exit 0 — matches were limited to explicitly historical prior-repair wording and the literal command record; current records use the migration-only gate and narrowed state-preservation claim |
| `git diff --check` | PASS before final accounting, exit 0 — no whitespace errors |
| `git diff --cached --quiet` | PASS before final accounting, exit 0 — index clean |
| `git diff --shortstat` | PASS, exit 0 — pre-final-accounting ledger state was 28 tracked paths at 4,513 insertions/130 deletions |
| `git status --porcelain=v1 --untracked-files=all` | PASS, exit 0 — same recognized 43 paths, no staged path |
| `git diff --numstat -- server/database/migrations.ts tests/unit/migrations.test.ts docs/codex/BUILD_LOG.md docs/codex/DECISIONS.md docs/codex/PLAN.md docs/codex/SPEC.md docs/codex/STATE.md docs/codex/TEST_MATRIX.md` | PASS, exit 0 — confirmed the eight-path repair subset within the retained Slice 5 diff |
| `git ls-files --others --exclude-standard -z \| xargs -0 wc -l` | PASS, exit 0 — 15 untracked files totaling 5,430 lines |
| `find /tmp/localcast-slice5-migration-integrity.O1Q9ynKW -depth -delete` | PASS, exit 0 — removed only this repair's isolated synthetic temporary tree |
| `test ! -e /tmp/localcast-slice5-migration-integrity.O1Q9ynKW` | PASS, exit 0 — cleanup confirmed |
| `git diff --check` | PASS, exit 0 — no whitespace errors after the final ledger |
| `git diff --cached --quiet` | PASS, exit 0 — index clean after the final ledger |
| `git status --porcelain=v1 --untracked-files=all` | PASS, exit 0 — exact same recognized 43-path worktree; no staged path |
| `git diff --shortstat` | PASS, exit 0 — 28 tracked paths at 4,535 insertions/130 deletions |
| `git ls-files --others --exclude-standard -z \| xargs -0 wc -l` | PASS, exit 0 — 15 untracked files totaling 5,430 lines |
| `git diff --name-only -- package-lock.json yarn.lock pnpm-lock.yaml` | PASS, exit 0 with no output — no dependency lockfile changed |

Final repository accounting: 28 tracked paths with 4,535 insertions and 130 deletions; 15 untracked paths totaling 5,430 lines; exact same 43-path inventory; clean index; no dependency/lockfile change; no staged path, commit, or checkpoint. The repair changed exactly the eight paths named above. Slice 5 remains incomplete and not checkpoint-green, and no prohibited resource or service was accessed or changed.

## 2026-08-21 — Slice 5 O-006 completion and local checkpoint validation

The frozen Slice 5 worktree was reconciled before documentation edits: branch `codex/localcast-prototype`, HEAD `6e1242e3e16c87c294d6f4ba0ca8bc2d0f187a1c` (`feat(prototype): deliver private podcast feed`), clean index, 43 recognized Slice 5 paths, 28 tracked paths with 4,535 insertions and 130 deletions, and 15 untracked paths totaling 5,430 lines. No dependency or lockfile changed. The scope comprises migration/database, app/API/chat, worker/provider lifecycle, episode UI, local smoke tooling, deterministic fixtures/tests, and the planning ledger; no credential, `.env`, backup/evidence database, runtime artifact, or generated file is part of the checkpoint.

O-006 started at `2026-08-21T15:29:58Z` and completed at `2026-08-21T15:30:23Z`. Its validated pre-migration backup is `/opt/stacks/localcast-backups/schema007-pre-migration-20260821T132838Z/localcast.sqlite.007`, SHA-256 `0ee6e8e0c40b401d0dfe61ab88ab7f42c35655a51f92ae5107df46db41454afa`, with its checksum chain verified. Migration 008 completed; schema, integrity, foreign-key, undisclosed installation-identity, and quiescence checks passed. App and worker are healthy on `sha256:af9a5635deccac039955317be7652f8d757001022e3a265df3af6a4a6a8e1fd8`; loopback health and controlled restart passed. No provider dispatch occurred. Rollback was not invoked, distinct rollback tags remain retained, temporary operational files were removed, and no storage-init container remains.

### Local checkpoint verification

| Command | Result |
| --- | --- |
| `npm run lint` | PASS — TypeScript no-emit check |
| `npm run test` | PASS — 217 unit tests in 11 files |
| `vitest run tests/unit/migrations.test.ts` | PASS — 22 migration tests |
| `npm run test:integration` | PASS when run in three loopback-safe groups — 91 integration tests in 13 files |
| `npm run build` | PASS — production web and all three server bundles; existing chunk-size warning only |
| `npm run test:e2e` | PASS — 17 Playwright/axe flows in 5.1 minutes, using only temporary loopback servers |
| `npm run smoke:api` | PASS — API and worker smoke checks |
| `npm run smoke:production` | PASS — production same-origin smoke checks |

The Compose smoke was not rerun because this authorization prohibits Docker changes. O-005 remains open: no live follow-up provider request was made, no protected value was recorded, and this checkpoint does not claim live supported/refusal acceptance or begin Slice 6.

## 2026-08-21 — O-005 live supported/refusal acceptance completion

This entry supersedes the deferred O-005 status in the preceding checkpoint entry. The separately authorized live gate completed on synthetic fixture `run-o005-atomic-66552802-ca97-4996-a0a9-4456485dce9e`. The supported attempt answered with the grounded fact `18 hours`, one factual claim, and the exact atomic citation; draft and semantic-support lifecycle stages finalized successfully. The refusal attempt returned `EVIDENCE_INSUFFICIENT` with zero claims. Exactly three provider requests occurred (two supported-path calls and one refusal call), with zero retries and zero duplicate dispatches. Final generation, chat, provider, and synchronization work was quiescent; schema 008, integrity, foreign-key, and undisclosed identity checks passed; and app and worker remained healthy on immutable image `sha256:af9a5635deccac039955317be7652f8d757001022e3a265df3af6a4a6a8e1fd8`. The earlier synthetic fixture's two-call `CHAT_UNSUPPORTED_CLAIM` result remains retained as a fail-closed diagnostic with no published answer or claims and no retry. This closes Slice 5; at that checkpoint, Slice 6 had not started. The documentation-only checkpoint was authorized separately.

## 2026-08-21 — Slice 6A deterministic provider-parity checkpoint

The bounded Slice 6A change adds named Ollama and LM Studio OpenAI-compatible text adapters plus Piper speech execution through the existing ffmpeg/media normalization path. All three are deterministic-contract evidence only: no Ollama, LM Studio, Piper, OpenAI, or other provider request, download, database action, Docker/Compose action, or deployment action occurred. Provider summaries now distinguish `NOT CONFIGURED`, `CONFIGURED UNVERIFIED`, `CONTRACT TESTED ONLY`, and `LIVE VERIFIED`; only a successful current provider operation can produce the last state. Summaries and errors omit credentials, endpoints, and executable paths.

Unsupported Gemini and legacy provider implementation were removed with `@google/genai` and its provably unused transitive dependency graph. No retained synthetic fixture, provider lifecycle record, backup, image, or rollback tag was changed.

| Command | Result |
| --- | --- |
| `npm run lint` | PASS — TypeScript no-emit check |
| focused provider/configuration tests | PASS — 52 tests, including deterministic OpenAI-compatible success/failure/abort paths and fake Piper executable/model/normalization/cleanup paths |
| `npm run test` | PASS — 227 unit tests in 13 files |
| isolated loopback integration groups | PASS — 21 + 44 + 26 = 91 tests in 13 files |
| `npm run build` | PASS — web and server bundles; existing chunk-size warning only |

## 2026-08-21 — Slice 6B versioned backup and safe-restore checkpoint

This bounded checkpoint adds manual version-1 backup creation and verified restore to absent or explicitly empty targets. Backup uses the SQLite backup API, captures committed WAL state, validates schema/integrity/foreign keys/undisclosed identity/quiescence/FTS/relationships, copies only referenced published MP3s under an explicit operator aggregate limit, and atomically publishes private canonical manifest/validation/checksum artifacts. Restore validates compatibility and every artifact before output, revalidates database/media parity, recreates private storage markers, never overwrites a non-empty target, and removes only exact incomplete outputs after failure. Credentials, tokens, provider payloads, logs, source/build output, unrelated media, retention/pruning, upload, and encryption are excluded.

The implementation and drill used only synthetic data under `/tmp/localcast-slice6b-test-*`. No production database/media/service, Docker/Compose/Caddy state, provider/network endpoint, retained O-005 fixture, backup evidence, image, or rollback tag was read or changed. No schema migration, package dependency, or lockfile change occurred.

| Command or gate | Result |
| --- | --- |
| `npm run lint` | PASS — TypeScript no-emit check |
| focused `vitest run tests/unit/backup-restore.test.ts` | PASS — 13 deterministic backup/restore and failure-injection cases |
| `npm run test` | PASS — 240 tests in 14 unit files |
| first sandboxed `npm run test:integration` | ENVIRONMENT-BLOCKED — 17 listener-dependent tests received only `listen EPERM 127.0.0.1`; no product assertion failed |
| authorized loopback `npm run test:integration` | PASS — 91 tests in 13 files |
| isolated rich restore drill | PASS — feed/FTS/jobs/evidence/citations/chat/provider lifecycle/media counts and bytes match; provider status defaults to `NOT CONFIGURED` |
| built `dist-server/backup.js` and `dist-server/restore.js` database-only drill | PASS — categorical success tokens, schema 008, `quick_check=ok`, empty foreign-key result, synthetic-row presence, mode `0700`/`0600`, and byte-identical backup/restored database SHA-256; exact temporary tree removed |
| `npm run build` | PASS — Vite production bundle plus app, worker, storage-init, backup, and restore server bundles; existing chunk-size warning only |
| dependency/reference, sensitive-artifact, scope, and `git diff --check` scans | PASS — package-lock and dependency sets unchanged; no sensitive/runtime artifact in the checkpoint |

Operator commands after a successful build are `npm run backup:create -- --database <absolute-db> --media <absolute-media> --destination <absolute-new-backup> --max-media-bytes <positive-integer>` and `npm run backup:restore -- --backup <absolute-backup> --data-target <absolute-new-or-empty-data> --media-target <absolute-new-or-empty-media>`. Failures emit only categorical codes; successes emit format and non-sensitive media totals.

## 2026-08-22 — Slice 6C accessibility expansion checkpoint

This checkpoint is limited to browser accessibility hardening: semantic destructive confirmations, keyboard route-heading focus, contrast and responsive wrapping corrections, and deterministic browser coverage. It uses no provider call, external network endpoint, Docker/Compose action, database/media access, deployment/image change, backup/rollback change, or dependency/lockfile change. The only remaining accessibility evidence is the explicitly operator-attested real screen-reader spot check; no automated result is presented as that check.

| Command | Result |
| --- | --- |
| `npm run lint` | PASS — TypeScript no-emit check |
| `npm run test` | PASS — 240 unit tests in 14 files |
| `npm run test:integration` | PASS — 91 integration tests in 13 files with isolated loopback fixtures; expected failure-injection records only |
| `npm run build` | PASS — web and server bundles; existing Vite chunk-size warning only |
| `npm run test:e2e` | PASS — 20 Playwright/axe tests in 5.4 minutes; all five core routes are axe-clean in light/dark/high-contrast, with route focus, dialog focus, 320px/200%-text, reduced-motion, and media-keyboard coverage |
| `npm run smoke:api` | PASS — credential-free API and worker smoke |
| `npm run smoke:production` | PASS — credential-free production same-origin smoke |
| dependency/reference, sensitive-output/artifact, scope, and `git diff --check` scans | PASS — no package or lockfile drift, credential/runtime artifact, unrelated path, or whitespace error |

## 2026-08-23 — Slice 6D deterministic security, privacy, and failure-injection checkpoint

The immutable Slice 6C baseline was reviewed across HTTP/provider, storage/job/backup, and whole-product security surfaces. Deterministic repairs authorize private evidence whenever either selected provider is external; add CSP, clickjacking, permissions, referrer, isolation, nosniff, and correlated JSON-boundary controls; bound complete serialized provider requests; validate Piper assets before contract status and enforce per-chunk timeout/live-output cleanup; cache media integrity by stable descriptor identity; fence every generation mutation after lease expiry; deny the AWS IPv6 metadata address; reject storage symlinks/hard links; share one canonical episode-publication predicate; strengthen evidence/citation/lifecycle/FTS backup validation; and bind incomplete cleanup to the originally created inode. README and Settings now disclose trusted-LAN authority, local SQLite/media retention, plaintext backup sensitivity, and backup credential/token exclusion. A deterministic import/dependency guard covers the explicit non-goals.

No provider, external network endpoint, Docker/Compose/Caddy resource, production database, retained evidence, image, backup, rollback tag, or external system was accessed or changed. Package and lockfile remained byte-identical. The review retains four explicit residuals: durable generation dispatch ambiguity, durable expected-byte identity for pre-existing generated media, crash-atomic publication across two restore targets, and operational proxy/runtime/capacity/image checks. `A11Y-01` remains partial.

| Command or gate | Result |
| --- | --- |
| `npm run lint` | PASS — TypeScript no-emit check |
| `npm run test` | PASS — 248 tests in 15 unit files |
| `npm run test:integration` | PASS — 94 tests in 13 integration files with loopback-only listeners |
| `npm run build` | PASS — Vite web and five server entry bundles; existing chunk-size warning only |
| first `npm run test:e2e` | REPAIRED — 20/21 passed; Settings replaced its focused loading heading after async completion |
| focused `npx playwright test tests/e2e/accessibility-expansion.spec.ts` | PASS — 4/4 after preserving the same Settings heading node |
| final `npm run test:e2e` | PASS — 21/21 in 5.4 minutes |
| `npm run smoke:api` | PASS — API and worker smoke checks |
| `npm run smoke:production` | PASS — production same-origin smoke checks |
| immutable baseline security review | COMPLETE — 14 confirmed findings reconciled; repaired controls and four explicit residual designs/operations retained |
| `npm prune --offline --ignore-scripts --no-save` then `npm ls --depth=0` | PASS — removed 35 stale untracked Gemini/transitive install residues; declared dependency tree is clean and package/lock hashes are unchanged |
| dependency, lockfile, sensitive-output/artifact, non-goal, scope, and `git diff --check` scans | PASS — no drift, protected value, runtime artifact, backup, or whitespace error |

## 2026-09-23 — Daily Driver 1A OpenAI credential-management checkpoint

This bounded product change adds trusted-operator OpenAI key replacement and explicit connection testing under Settings. It uses an atomic mode-`0600` file in a mode-`0700` `.credentials` directory beside SQLite on the existing data volume. Managed credentials take precedence over the unchanged worker-only environment fallback and are resolved for each new generation job and claimed chat turn, so no restart is required. The browser receives only configured state and an optional final-four hint; complete values are absent from responses, logs, provider-status rows, browser persistence, build canaries, and backups.

The connection test makes only bounded authenticated fixed-origin model-metadata retrievals for configured OpenAI capabilities and writes through the existing provider-status lifecycle. It does not generate content or run automatically. All test requests were synthetic; no live OpenAI call, production credential/data access, Compose/Docker/Caddy action, fixture-retirement work, dependency change, migration, or deployment occurred.

| Command or gate | Result |
| --- | --- |
| `npm run lint` | PASS — TypeScript no-emit check |
| focused credential/provider/runtime unit suites | PASS — 59 tests |
| focused credential route integration suite | PASS — 2 tests |
| `npm run test` | PASS — 263 tests in 18 files |
| `npm run test:integration` | PASS — 96 tests in 14 files |
| `npm run build` | PASS — web and five server entry bundles; existing Vite chunk-size warning only |
| focused Settings Playwright flow | PASS — accessible modal/focus/autocomplete/replacement/redaction workflow |
| `npm run test:e2e` | PASS — 21 Playwright/axe tests; final artifact contains no failed test |
| temporary visual inspection | PASS — focused credential modal rendered correctly with no browser console message |
| `npm run smoke:api` | PASS — credential-free API and worker smoke |
| first `npm run smoke:production` | REPAIRED — legacy field-name ban conflicted with the intentional transient secret form; the replacement guard continues to reject secret/deployment canaries |
| final `npm run smoke:production` | PASS — production same-origin smoke |

The canonical backup deliberately excludes `.credentials/openai-api-key`; restore requires credential re-entry. Deployment needs only the new LocalCast image through the existing workflow. No one-time volume, environment, Compose, or Caddy change is required.

## 2026-09-29 — Daily Driver 1A exact-tree validation and checkpoint

The September 23 implementation was recovered as an intentional dirty feature tree. A fresh review found no unrelated source, deployment, migration, dependency, Caddy, fixture-retirement, or secret material. The previous validation artifacts were treated as historical only. This entry supersedes their completion claims with results from the exact final tree.

The first fresh browser gate exposed a keyboard regression: disabling the empty required submit button removed it from the dialog's focus order. The button now remains focusable while native `required`/`minLength` validation blocks invalid submission, and the credential live-status assertion is scoped to its labelled region. Independent read-only review then found and repaired capability-global status deletion for mixed local/OpenAI configurations, acceptance of owner-executable credential files, and missing generic `.credentials` Git/build-context exclusions. Additional regressions directly cover typed cancellation, exact API bounds, strict-body rejection, and network/malformed/oversized verification responses. All three reviewers passed the repaired tree.

| Command or gate | Result |
| --- | --- |
| `npm run lint` | PASS — TypeScript no-emit check |
| focused credential/provider/runtime unit suites | PASS — 87 tests in 6 files |
| focused credential route integration suite | PASS — 7 tests |
| `npm run test` | PASS — 273 tests in 18 files |
| `npm run test:integration -- --reporter=dot` | PASS — 101 tests in 14 files; expected injected generation-failure records only |
| `npm run build` | PASS — Vite transformed 2,156 modules and built five server entry bundles; existing chunk-size warning only |
| focused Settings Playwright flow | PASS — 1/1 after keyboard, cancellation, focus, redaction, and scoped-status repairs |
| final `npm run test:e2e` | PASS — 21 Playwright/axe tests in 5.5 minutes |
| fresh visual inspection | PASS — desktop plus 320px/200%-text captures; dialog remained bounded and scrollable with an empty secret input |
| `npm run smoke:api` | PASS — API and worker smoke checks |
| `npm run smoke:production` | PASS — production same-origin and built-bundle checks |
| `git diff --check`, conflict-marker, scope, ignore, and secret scans | PASS — no whitespace/conflict issue, unrelated path, real credential, or unprotected nested credential directory |

All provider interactions were deterministic fixtures on loopback. No live OpenAI request, production credential/data access, Docker/Compose/Caddy action, running-container change, deployment, fixture-retirement work, schema migration, dependency/lockfile change, or production-data mutation occurred. The canonical backup remains credential-free and the known unrelated `PUBLISHED_EPISODE_INVALID` fixture condition remains untouched.

## 2026-09-30 — Station evidence-selection control repair

The live `Morning Signal` form reproduced the reported appearance: station checkboxes inherited the Settings theme-card rule that clipped inputs to `1px × 1px`, while station labels omitted the `data-selected` attribute used to style theme cards. Label click and Space changed controlled state, proving the state handler was active, but the native control was not practically pointer-operable and selected/unselected rows appeared identical. No form-state overwrite, disabled fieldset, pointer-event suppression, overlay, identifier collision, parser, or persistence failure was found.

The repair gives station selections a dedicated native-checkbox/explicit-label presentation with visible checked, focus, selected-card, and disabled states. Inactive or invalid-URL feeds explain their unavailable state; selected unavailable feeds remain enabled for removal. Browser and integration regressions cover control and label click, Space, multiple notes/feeds, mixed category persistence, reload/edit restoration, exact deselection, accessible labels, and legitimate disabled reasons.

| Command or gate | Result |
| --- | --- |
| `npm run lint -- --pretty false` | PASS |
| focused station-generation integration suite | PASS — 7/7 |
| `npm run test` | PASS — 273/273 |
| sandboxed full integration attempt | ENVIRONMENT-BLOCKED — only loopback `EPERM` startup failures |
| authorized `npm run test:integration -- --reporter=dot` | PASS — 102/102 |
| `npm run build` | PASS — production web and five server bundles; existing chunk-size warning only |
| focused station-selection Playwright | PASS — 1/1 |
| first full Playwright/axe run | REPAIRED — 21/22; restored existing inactive-source accessible-name cue |
| affected Playwright rerun | PASS — 3/3 |
| final `npm run test:e2e` | PASS — 22/22 in 5.5 minutes |
| desktop visual/DOM/console inspection | PASS — three visible checked inputs, explained disabled feed, `18px × 18px` control, one label, selected state, no console errors |
| sandboxed smoke attempts | ENVIRONMENT-BLOCKED — loopback `EPERM` before assertions |
| authorized `npm run smoke:api` | PASS |
| authorized `npm run smoke:production` | PASS |

`INVALID_CITATIONS` remains fail-closed and unchanged. Its validation path checks generated snapshot IDs and supporting excerpts against frozen episode evidence; it does not share the CSS/form presentation root cause. No schema migration, dependency/lockfile change, provider request, production station mutation, Docker/Compose/Caddy action, deployment, or citation/support-validation change occurred.

## 2026-10-05 — Provider-status restart preservation repair

The stopped station-fix deployment exposed a pre-existing Daily Driver 1A lifecycle defect: `createGenerationProcessor` performs worker-startup provider reconciliation, and `recordContract` previously used an unconditional capability upsert. Even when the credential and complete descriptor fingerprint matched, this later deterministic check overwrote `LIVE VERIFIED`, its reason, and `verified_at` with `CONTRACT TESTED ONLY`. App startup only read the summary; commit `992db30` did not cause the defect.

Contract reconciliation now uses one conditional SQLite upsert. Same-descriptor live or contract evidence is left byte-for-byte unchanged, including safe reason and timestamps. Credential/provider/model/reasoning/voice/format/local-configuration mismatches still replace stale evidence with contract-only state, missing or unsafe worker credentials still remove affected rows, explicit authenticated success still promotes, and explicit live failure still downgrades. Ollama, LM Studio, Piper, and mixed pairs remain capability-scoped. The configured-unverified reason now accurately refers to provider configuration rather than a worker session.

| Command or gate | Result |
| --- | --- |
| focused provider/config/credential/runtime unit suites | PASS — 72/72 |
| `npm run lint` | PASS — TypeScript no-emit check |
| `npm run test` before the final missing/unsafe cases | PASS — 278/278 |
| final `npm run test` | PASS — 280/280 in 18 files |
| sandboxed `npm run test:integration -- --reporter=dot` | ENVIRONMENT-BLOCKED — 77 assertions passed; all 25 failures were loopback `listen EPERM 127.0.0.1` |
| authorized `npm run test:integration -- --reporter=dot` | PASS — 102/102 |
| `npm run build` | PASS — Vite transformed 2,156 modules and built five server bundles; existing chunk-size warning only |
| `npm run test:e2e` | PASS — 22/22 Playwright/axe tests in 5.6 minutes |
| `npm run smoke:api` | PASS — isolated API/worker smoke |
| `npm run smoke:production` | PASS — isolated production same-origin smoke |
| three independent read-only reviews | PASS after one wording repair — no remaining correctness, test, security, privacy, schema, topology, dependency, or scope finding |
| final scope, conflict-marker, source/bundle secret, dependency/schema, and `git diff --check` scans | PASS — exactly ten expected source/test/ledger paths; no secret, conflict marker, lockfile, migration, deployment, station, health, citation, fixture, or whitespace drift |

All automated provider evidence used synthetic credentials, temporary storage, and deterministic/loopback fixtures. Startup regressions assert zero provider fetches. No live OpenAI/local/Piper request, real credential access/replacement/test, production data/runtime/image access, station mutation, Docker/Compose/Caddy/volume action, deployment, migration, storage-init, deferred-fixture change, health-route change, or citation-validation change occurred. The operator-reported production DD1A runtime and its already-downgraded `CONTRACT TESTED ONLY` state remain untouched; fresh `LIVE VERIFIED` must come later from an explicit authorized Test connection.

## 2026-10-08 — Generation citation-contract and provider-failure-classification repair

The October 7 production artifact showed a valid, unique evidence snapshot and a successful OpenAI draft response containing a repeated `snapshotId` within one factual segment. The validator correctly failed closed, but the generation prompt/schema did not state the uniqueness rule explicitly, its safe message incorrectly implied only duplicate-only arrays were rejected, and the processor's generic catch treated every typed downstream LocalCast failure as a live provider failure.

OpenAI and OpenAI-compatible generation prompts now specify per-segment unique snapshot IDs, one strongest verbatim excerpt per source, distinct IDs for independent sources, atomic segment splitting for separate facts/excerpts from the same source, and permitted cross-segment reuse. The strict OpenAI schema contains equivalent descriptions. The validator continues to reject `[A,A]`, `[A,A,B]`, and same-ID/different-excerpt arrays without output rewriting. Generation errors now explicitly distinguish provider-capability failure from status-preserving downstream failure. Authentication, permission, provider/model rejection, HTTP/network/timeout, malformed/unusable provider output, and invalid fresh provider audio remain failure-classified; citation/excerpt/support validation and local persistence/media/publication errors preserve applicable live evidence.

| Command or gate | Result |
| --- | --- |
| initial focused test command without explicit runtime mode | REPAIRED — TypeScript passed, but five suites stopped at config import because the calling shell supplied an invalid `LOCALCAST_RUNTIME_MODE`; rerun used the repository's explicit test mode |
| final focused citation/provider/status/credential/Piper suites | PASS — 109/109 in 6 files |
| `npm run lint` | PASS — TypeScript no-emit check |
| `npm run test` | PASS — 294/294 in 18 files |
| first sandboxed `npm run test:integration -- --reporter=dot` | ENVIRONMENT-BLOCKED — 77 assertions passed; all 25 failures were loopback `listen EPERM 127.0.0.1` |
| authorized `npm run test:integration -- --reporter=dot` | PASS — 102/102 in 14 files |
| `npm run build` | PASS — Vite transformed 2,156 modules and built five server entry bundles; existing chunk-size warning only |
| Playwright/axe | NOT AFFECTED — no browser component, markup, styling, routing, or accessibility behavior changed |
| first sandboxed API and production smoke attempts | ENVIRONMENT-BLOCKED — loopback `listen EPERM 127.0.0.1` before assertions |
| authorized `npm run smoke:api` | PASS — isolated API and worker smoke |
| authorized `npm run smoke:production` | PASS — isolated production same-origin smoke |

The two logical checkpoints are separated into citation-contract and provider-status commits. No schema migration, dependency/lockfile, evidence construction, station selection, credential storage, restart-preservation, health route, TTS/media-publication semantics, fixture, Compose/Caddy/volume, production data, failed job, provider status, credential, live request, build image, deployment, or push was involved.

## 2026-10-08 — Recurring readiness investigation and diagnostic checkpoint

Production stayed on `e8a1154` / image `sha256:4e4b8776d22780c3e485465a677b924ffd67bae648e3ceae4dc41b68c14db8d4`. App health returned 503, worker health passed, ordinary app read APIs returned 200, and a separate read-only/query-only SQLite audit passed schema 008, FTS5, quick-check and foreign keys. Media access, open descriptors, mounted inode identities and resource checks found no direct cause. The original long-lived connection cannot be inspected through a separate `docker exec` process, and the deployed catch emits no exception. Root cause remains unresolved. Final production check around `2026-10-09T03:04Z` still showed 503 and 51,936 failures, with original image/start times and zero restarts.

Code-only checkpoint `8c3467c9a348608d39289eaa462f3d0af3608f6e` adds stage-aware sanitized diagnostics, exact recognized error codes, minute suppression and recovery logs. It changes no readiness assertion. The complete staged four-file patch passed `git apply --cached --check` against `e8a1154` using an alternate index under `/tmp`; the feature branch and existing commits were preserved. The investigation report and ledgers are committed separately so the code commit can be cherry-picked alone onto the deployed baseline.

| Command/check | Result |
| --- | --- |
| initial `npm run lint` | REPAIRED — test provider summary omitted required adapter/reason fields; one fixture correction |
| final `npm run lint` | PASS, exit 0 |
| final `npm run test -- --reporter=dot` | PASS, exit 0 — 310/310, 19 files; includes 16 diagnostic cases |
| `npm run test:integration -- --reporter=dot` and final run with health test path | PASS, exit 0 — 108/108, 15 files each; directory argument still selects full suite; includes six health HTTP cases |
| `npm run build:server` | PASS, exit 0 — five local server bundles, no container image |
| final `npm run smoke:api` | PASS, exit 0 — temporary API/worker services only |
| final `npm run smoke:production` | PASS, exit 0 — isolated production-mode same-origin services only |
| independent read-only review | PASS after completing recognized extended SQLite-code allowlist and five regression cases |
| schema/dependency/topology/prior-feature diff and whitespace checks | PASS — only diagnostic code/tests and this documentation follow-up |

Validation finished approximately `2026-10-09T03:07Z` (October 8 local). No browser change required Playwright/axe. No live provider request, production SQL write, credential read/replacement, source-selection/fixture change, process restart, production image build, deployment, or push occurred. See `HEALTH_DIAGNOSTICS.md` for the exact stage/connection analysis and separately authorized diagnostic-rollout recommendation.

## 2026-10-09 — Exact citation-pair normalization and truthful failure presentation

Preflight: clean `codex/localcast-prototype` at `28f0fd8af28be424713cfedb14ebaf95807bf010`. Read-only Docker metadata/bundle inspection and explicit `better-sqlite3` read-only plus `query_only` queries established the October 9 attempt facts recorded in STATE. No rejected draft was persisted; exact versus ambiguous excerpt duplication remains unknown. The configured worker is OpenAI / `gpt-5.4-mini`, with the uniqueness prompt installed before the attempt. Both applicable live provider rows predate and survived the failure. The app was already unhealthy again; that separate incident was not investigated or changed.

The patch introduces a shared small parsed-draft normalizer used by both generation adapters. Only exact decoded `(snapshotId, excerpt)` pairs are removed, per factual segment, first occurrence retained. Parser limits remain one to four raw entries; no oversized response is salvaged. The direct strict validator, ID/excerpt membership, semantic support, provider-status handling, and immutable evidence remain unchanged. A best-effort count-only diagnostic is emitted once per affected draft. The episode header now reads canonical status instead of interpreting a terminal timestamp as success; nonretryable citation/support output failures no longer assert that evidence needs changing. No automatic or extra corrective provider request is added.

Two independent read-only reviews found no blocking issue. Their optional positive Completed and raw citation-bound regression requests were added. The first full browser run found a pre-existing axe/theme-transition race on unchanged sidebar styles: measured white -> intermediate gray -> settled dark. A test-only wait for existing CSS transitions preserves the complete axe assertion; no style or rule was weakened. A mobile failure-card capture/overflow assertion was added because the app uses an internal scroll container and a document screenshot alone did not show the failure panel.

### Validation ledger

Commands ran with credential-free `env -i PATH=/usr/local/bin:/usr/bin:/bin` parents. Full tests/build used `LOCALCAST_VITE_ENV_DIR=/tmp/localcast-citation-validation.8E1EdN/vite-env` (empty); direct focused Vitest also set `NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-citation-test`. Browser used the installed `PLAYWRIGHT_BROWSERS_PATH=/home/mkimitch/.cache/ms-playwright`, traces off, and output under the same temporary root. Integration/browser/smokes used only disposable synthetic storage and loopback listeners. No Docker image was built.

| Command/check | Result |
| --- | --- |
| `npm run lint` | PASS — TypeScript no-emit; one final repeat was terminated with exit 143 and not counted, followed by a fresh exit-0 rerun |
| `vitest run tests/unit/citation-normalization.test.ts tests/unit/openai-provider.test.ts tests/unit/openai-compatible-provider.test.ts tests/unit/episode-grounding.test.ts` | PASS — 105 focused cases before two additional raw-bound cases |
| `vitest run tests/integration/citation-normalization.test.ts` | PASS — 5 configured-processor regressions; exact pairs reach speech only after support, failures never reach speech/publication and preserve live evidence |
| `npm run test -- --reporter=dot` | PASS — final 327 cases / 20 files; earlier 325-case run also passed |
| `npm run test:integration -- --reporter=dot` | PASS — 113 cases / 16 files; expected synthetic failure logs only |
| `npm run build` | PASS — web and five server bundles; existing chunk-size warning only |
| focused `playwright test tests/e2e/citation-failure.spec.ts --trace=off --reporter=line` | PASS — initial focused case; strengthened case also passed after scoped text wrapping |
| `playwright test --trace=off --reporter=line --output=/tmp/localcast-citation-validation.8E1EdN/browser-complete` | PASS — final 23/23 in 5.4 minutes, run without competing unit/integration workloads |
| `npm run smoke:api` | PASS — isolated API/worker smoke |
| `npm run smoke:production` | PASS — isolated production-mode same-origin smoke |
| Added-line/new-file and built-client secret-shape scans; scope/whitespace | PASS — zero matches, no schema/dependency/strict-validator/provider-lifecycle/health/topology drift. Initial Node subprocess scan hit sandbox `spawnSync git EPERM`; replaced with read-only Git-to-stdin scan |

Browser repair ledger: first full run passed 22/23 with the settled-theme race described above. After the test-only transition wait, the stronger mobile assertion found long diagnostic words overflowing the failure panel at 320px/200% text. That run was deliberately stopped (8 passed, one known failure, one interrupted, 13 not run) rather than counted as final evidence. A `.generation-failure`-only `overflow-wrap: anywhere` rule corrected the panel without hiding text or changing global layout. A focused five-test run then passed the corrected failure case and three other cases but reached the existing 30-second overall deadline near the end of the broad route matrix while unit/integration suites were executing in parallel. No timeout or assertion was relaxed; the final standalone full run passed all 23. Screenshots inspect the internally scrollable panel at its heading and keyboard-focused action, rather than claiming a whole-document capture shows off-screen content. Re-review found no blocker or weakened assertion.

After the final source change, TypeScript, 327 unit, 113 integration, production build and both smokes were rerun successfully. `npm ls --depth=0 --offline` also passed without dependency changes. Final evidence was reconciled October 10 (client date); executable validation timestamps were October 9 UTC. The frontend-testing skill was used because failure presentation changed; no Browser plugin was available, so the existing Playwright/axe workflow supplied browser evidence. No production data, source selection, fixture, credential, provider evidence, runtime, or failed job was changed; no live provider call, retry, deployment, push, migration, or storage-init occurred. This is a local checkpoint only. A future deployment still requires fresh independent runtime/health gates, especially given the separately observed recurring unhealthy app.

## 2026-10-11 — Deterministic episode citation-reference catalog

The maintenance patch replaces model-copied opaque snapshot IDs and verbatim excerpts with an attempt-scoped catalog built from frozen evidence. Entries use deterministic compact tokens and retain canonical snapshot ID, original identity, exact body substring, and source offsets internally. Valid short bodies remain whole; longer bodies split at Unicode-safe bounded exact-substring boundaries. The model receives only grouped catalog excerpts plus navigation metadata. OpenAI's strict schema enumerates the exact token set; OpenAI-compatible prompts provide the same finite list and both adapters enforce membership locally.

After parsing, LocalCast resolves ordered tokens to canonical `(snapshotId, excerpt)` citations. Unknown/repeated tokens and multiple units from one snapshot in one factual segment fail closed. Cross-segment reuse remains valid. The provider-independent exact membership validator and semantic-support pass remain mandatory; title-only and unsupported claims still reject. The prior raw exact-pair normalizer is removed, with no inferred citations, automatic repair, retry, or provider call added.

Generation errors may now carry a bounded structural diagnostic. The worker serializes only code, stage, typed category, section/segment/citation indices, and counts into the existing attempt-correlated job event. Integration coverage proves private titles, bodies, excerpts, snapshot IDs, and provider output do not enter the event; resolution failure does not reach support, TTS, or publication; applicable provider status remains unchanged.

| Command/check | Result |
| --- | --- |
| `npm run lint -- --pretty false` | PASS — TypeScript no-emit |
| focused catalog/OpenAI/OpenAI-compatible/grounding unit suites | PASS — 106 tests before the final title-only regression; the complete unit result below supersedes the count |
| `npm run test -- --reporter=dot` | PASS — 327/327 in 20 files |
| first sandboxed `npm run test:integration -- --reporter=dot` | ENVIRONMENT-BLOCKED — 82 assertions passed; all 31 failures were loopback `listen EPERM 127.0.0.1` |
| authorized `npm run test:integration -- --reporter=dot` | PASS — 113/113 in 16 files |
| `npm run build` | PASS — Vite transformed 2,156 modules and built five server bundles; existing chunk-size warning only |
| Playwright/axe | NOT AFFECTED — no browser source, markup, style, route, or behavior changed |
| `npm run smoke:api` | PASS — isolated API/worker smoke |
| `npm run smoke:production` | PASS — isolated production same-origin smoke |

One post-documentation direct `npx vitest` spot check bypassed the repository test wrapper and failed during import because an inherited `LOCALCAST_RUNTIME_MODE` was outside the configured enum; 16 tests completed before the three config-dependent suites stopped. No assertion failed. The prescribed `npm run test -- ...` wrapper supplied `LOCALCAST_RUNTIME_MODE=test` and reran the complete unit suite successfully at 327/327. TypeScript/no-emit also passed again on the final tree.

All provider responses were deterministic fixtures. No live provider request, production database/media/runtime access, failed-job retry, station/source/credential/provider-state mutation, schema/migration, dependency/lockfile, browser feature, health-route, fixture, Compose/Caddy/volume, image build, deployment, or push occurred.

## 2026-10-11 — Bounded quick-check result diagnostics

The production app was observed continuously unhealthy on the expected `bf08e913` image with `database_audit` / `quick_check_failed`; the worker remained healthy. Six app-local probes returned the unchanged public `503 NOT_READY` response. Instrumented events began at `2026-10-10T11:50:49Z` in the current container and continued with minute-rate logs and 28 suppressed probes per event. A separate `readonly: true`, `query_only=ON` WAL connection returned canonical `quick_check=ok`, `integrity_check=ok`, zero foreign-key rows, and schema 008. This evidence does not establish that the app's long-lived connection is healthy.

The diagnostic refinement replaces the generic noncanonical-result assertion with a typed failure that retains no SQLite result text. Categories are `non_ok_result`, `empty_result`, `multiple_results`, `unexpected_result_shape`, and `exception`. Logged metadata is restricted to bounded row count, expected-column presence, `inTransaction`, bounded duration, connection read-only state, and recognized SQLite/system code. Existing check order, exact canonical-OK requirement, foreign-key/migration/FTS/media/provider assertions, `200`/`503` behavior, minute suppression, and recovery logging are unchanged.

| Command/check | Result |
| --- | --- |
| `npm run lint -- --pretty false` | PASS — TypeScript no-emit |
| first full unit run after implementation | REPAIRED TEST-ONLY — product assertions passed; one privacy regex incorrectly matched the safe `SQLITE_` code prefix |
| `npm run test -- --reporter=dot` | PASS — 333/333 in 21 files after narrowing that test canary |
| first sandboxed integration run | ENVIRONMENT-BLOCKED — 82 assertions passed; all 31 failures were loopback `listen EPERM 127.0.0.1` |
| authorized `npm run test:integration -- --reporter=dot` | PASS — 113/113 in 16 files |
| `npm run build` | PASS — web and five server bundles; existing chunk-size warning only |
| `npm run smoke:api` | PASS — disposable API/worker storage and loopback only |
| `npm run smoke:production` | PASS — disposable production same-origin storage and loopback only |

No browser behavior changed, so Playwright/axe is unaffected. No live provider call, generation/retry, production write, process restart, schema/migration, dependency/lockfile, Compose/Caddy/volume, fixture, station/source, credential, provider-status, or support-validation change occurred during implementation validation.

## 2026-10-12 — Compact Brief length preset

Starting from clean `codex/localcast-prototype` at `36b23aafac1e80efca3c5d172dd4e6d56d3052f8`, this code-only maintenance adds a typed Brief length preset and an additive persistence boundary. Standard remains the compatibility default and retains 600–1,000 published words, target 700, its existing sparse-evidence fallback, and its prior token budget. Compact publishes 200–350 words with target 275. Provider guidance subtracts the existing seven-word disclosure, yielding 593–993 factual words for Standard and 193–343 for Compact. Deep mode is unchanged.

Migration 009 adds constrained non-null `brief_length_preset` columns to stations and immutable generation requests with a Standard default. Enqueue snapshots the value into the request hash and row. The station UI uses an associated native select; API omission defaults to Standard and invalid values fail parsing. OpenAI, OpenAI-compatible, deterministic generation, sufficiency, and final validation use one policy. Length failures retain only bounded counts and direction. Citation/reference/support validation and publication fencing are unchanged.

| Command/check | Result |
| --- | --- |
| focused lint and mode/provider/migration/station/processor tests | PASS — 145 cases |
| `npm run test -- --reporter=dot` | PASS — 338/338 in 21 files |
| first sandboxed `npm run test:integration -- --reporter=dot` | ENVIRONMENT-BLOCKED — 83 assertions passed; all 31 failures were loopback `listen EPERM 127.0.0.1` |
| authorized `npm run test:integration -- --reporter=dot` | PASS — 114/114 in 16 files |
| `npm run build` | PASS — Vite transformed 2,156 modules and built five server bundles; existing chunk-size warning only |
| focused station/axe Playwright | PASS — 5/5 |
| first complete Playwright/axe run | 22/23 — one unchanged theme-transition contrast sample measured 4.49 against 4.5 |
| focused accessibility rerun | PASS — 4/4 |
| final complete Playwright/axe rerun | PASS — 23/23 in 5.4 minutes, without product or assertion changes |
| `npm run smoke:api` | PASS — disposable API/worker storage and loopback only |
| `npm run smoke:production` | PASS — disposable production same-origin storage and loopback only |

The frontend-testing skill was used because a station control changed. The optional Browser plugin was unavailable, so the repository's Playwright/axe suite supplied rendered and accessibility evidence. A later ad-hoc disposable-server launch failed to bind before inspection; it did not touch production and is not counted as validation. No live provider request, generation/retry, production read or write, process restart, deployment, credential/provider-state/station/source/fixture mutation, Caddy/Compose/volume change, dependency/lockfile change, or push occurred.

Implementation checkpoint: `27ca1a7` (`fix(generation): add compact brief preset`). This documentation-only ledger follow-up records that completed checkpoint; it changes no executable artifact.

## 2026-10-13 — Compact Brief generation guard band

Starting from clean `codex/localcast-prototype` at `5a3b9116bb578503966ad111c7adf9af7684dc7b`, a network-disabled disposable container mounted the production data volume read-only and opened SQLite with both `readonly: true` and `query_only=ON`. The later October 13 attempt used immutable `brief` / `compact`, station revision 7, and 50 feed evidence snapshots. Its bounded diagnostic was `length_validation` / `length_out_of_range`, 188 actual published words, 200 minimum, 350 maximum, direction `below`. The earlier attempt was already established at 191 words with 49 feed snapshots and one note. No rejected narration, evidence text, provider response, credential, or unrelated private data was read or retained. Production containers and persistent state were not changed or restarted; the app's separate unhealthy SQLite diagnostic process remained untouched.

The typed policy now separates Compact's unchanged 275-word product target from a 300-word interior provider target. OpenAI and OpenAI-compatible prompts therefore aim for 293 factual words after the seven-word disclosure while retaining the exact 193–343 factual / 200–350 published acceptance contract. They request additional distinct, evidence-supported detail only when available and explicitly prohibit padding, repetition, speculation, and unsupported context. Standard and Deep targets remain identical to their prior behavior. Deterministic fake generation uses the provider target so fixtures exercise the same guidance; final length, reference, citation, support, provider-status, diagnostic, and publication behavior is unchanged.

| Command/check | Result |
| --- | --- |
| focused mode-policy/OpenAI/OpenAI-compatible suites | PASS — 97/97 in 3 files, including exact 300-word deterministic Compact output and unchanged 200/350 acceptance boundaries |
| `npm run lint -- --pretty false` | PASS — TypeScript no-emit |
| `npm run test -- --reporter=dot` | PASS — 339/339 in 21 files |
| first sandboxed `npm run test:integration -- --reporter=dot` | ENVIRONMENT-BLOCKED — 83 assertions passed; all 31 failures were loopback `listen EPERM 127.0.0.1` |
| authorized `npm run test:integration -- --reporter=dot` | PASS — 114/114 in 16 files |
| `npm run build` | PASS — Vite transformed 2,156 modules and built five server bundles; existing chunk-size warning only |
| `npm run smoke:api` | PASS — disposable API/worker storage and loopback only |
| `npm run smoke:production` | PASS — disposable production same-origin storage and loopback only |
| Playwright/axe | NOT AFFECTED — no browser source, markup, style, route, or behavior changed |

All provider responses were deterministic fixtures. No live provider request, production generation/retry, production write, restart, deployment, schema/migration, dependency/lockfile, credential/provider-state, station/source, health-route, deferred-fixture, Caddy/Compose/volume, or push occurred.

## 2026-10-14 — Temporary Compact Brief acceptance range

Starting from clean `codex/localcast-prototype` at `f559e451fa9e49cd84cdbe8eec86dc84abb8f4dd`, this code-only maintenance separates Compact's preferred editorial range from its temporary hard acceptance range. Compact still prefers 200–350 published words, has product target 275, and asks providers for approximately 193–343 factual words with a 293-factual/300-published target. Its hard range is temporarily 50–350 published words. Accepted 50–199-word output records a bounded `COMPACT_EDITORIAL_LENGTH_BELOW_PREFERRED` warning only after reference, citation, and semantic-support validation has succeeded. Below 50 and above 350 retain `EPISODE_LENGTH_OUT_OF_RANGE`; the fixed seven-word disclosure alone cannot produce a structurally valid episode or meet the hard minimum.

The warning is stored idempotently in the existing current-attempt validating event stream and projected only on completed runs. It contains only actual and preferred boundary counts; no rejected narration, excerpt, title, snapshot ID, or provider response is retained. No migration is needed. The episode warning presentation reuses existing UI and warning design tokens. Standard, Standard sparse behavior, Deep, Architecture B, citation/excerpt validation, semantic support, evidence sufficiency, provider lifecycle, and TTS/publication fencing are unchanged.

| Command/check | Result |
| --- | --- |
| `npm run lint` | PASS — TypeScript no-emit |
| focused mode-policy/OpenAI/OpenAI-compatible/processor suites | PASS — 104/104 in 4 files |
| `npm run test -- --reporter=dot` | PASS — 339/339 in 21 files |
| first sandboxed `npm run test:integration -- --reporter=dot` | ENVIRONMENT-BLOCKED — 84 assertions passed; all 31 failures were loopback `listen EPERM 127.0.0.1` |
| authorized `npm run test:integration -- --reporter=dot` | PASS — 115/115 in 16 files |
| `npm run build` | PASS — Vite transformed 2,156 modules and built five server bundles; existing chunk-size warning only |
| initial focused Playwright against stale prior build | SUPERSEDED — server warning path passed, but the old built UI retained the old heading |
| rebuilt focused warning Playwright/axe | PASS — 2/2 after correcting warning-metadata contrast with the existing warning text token |
| `npm run test:e2e` | PASS — 24/24 in 5.8 minutes |
| first sandboxed `npm run smoke:api` | ENVIRONMENT-BLOCKED — loopback `listen EPERM 127.0.0.1` |
| authorized `npm run smoke:api` | PASS — disposable API/worker storage and loopback only |
| authorized `npm run smoke:production` | PASS — disposable production same-origin storage and loopback only |
| `npm ls --depth=0 --offline` | PASS — declared dependency tree clean |
| final dependency/lockfile, migration/topology, secret-shape, scope, and `git diff --check` scans | PASS — no drift, protected value, unrelated path, or whitespace error |

All provider behavior used deterministic fixtures. No live provider request, production generation/retry, production data/runtime access, process restart, deployment, schema/migration, dependency/lockfile, credential/provider-state, station/source, SQLite-health/RSS change, deferred-fixture, Caddy/Compose/volume, or push occurred.


## 2026-10-15 — Slice 6E generation observability and offline replay

The user authorized a read-only October 15 incident inventory plus implementation/validation/commit, expressly excluding production restart, deployment, push, or live generation. Hard preflight passed at `/opt/stacks/local-cast-prototype` on clean `codex/localcast-prototype`. D-053 records the narrow opt-in raw-retention exception; the guide `GENERATION_TRACE.md` retains the immutable job/request/attempt identities, exact safe diagnostic values/timeline, data lifecycle and retroactive recovery boundary, SQLite audit method, proposed disposable two-connection reproduction, exact CLI commands, and retention caveats. No private production source/narration/credential was committed.

The audit used `docker ps`, selected `docker inspect` fields, timestamped health logs filtered to diagnostic events, non-secret provider/model settings, and a network-disabled/read-only disposable container of image `sha256:d9b7e4a846c26a14e44e0decf6f4a568b62df113fe682c3fe6eab2c5fcf739c9`. The data volume was mounted read-only at `/audit`; SQLite opened with `readonly:true,fileMustExist:true` and `query_only=ON`. Quick/integrity checks returned canonical OK, FK count zero, migrations 001–009. Initial metadata counting incorrectly assumed `episode_citations.run_id`; the corrected query joined `transcript_claims` and confirmed zero. App-local health returned unchanged 503 NOT_READY. Worker `/tmp` was empty and the failure-minute log had no lines. No checkpoint/write/restart or speculative repair occurred.

The implementation shares production schema/extraction/section transformation with a network/database-free replay bundle. It captures only when a local arm is present for the station, consumes that arm once, and writes bounded private artifacts with origin/form/time metadata. Failure traces contain the actual draft/support bodies and original verdicts, never a reconstructed explanation. It adds no HTTP route or provider request. Independent read-only reviews found and verified fixes for orphan report cleanup, invalid expiry fallback, interrupted stage labeling, optional read/I/O containment, and the late speech-character-bound diagnostic classification. Only the primary agent edited/staged/committed.

Validation parents were `env -i PATH=/usr/local/bin:/usr/bin:/bin NO_COLOR=1`; Vite-aware commands additionally used the empty `LOCALCAST_VITE_ENV_DIR=/tmp/localcast-trace-validation/vite-env`. Package scripts supplied test runtime, in-memory/default temporary storage; integration and smokes used disposable synthetic databases/media and loopback fixture servers. No production Docker image was built.

| Exact command/check | Result, October 15 |
| --- | --- |
| `npm run lint -- --pretty false` | PASS exit 0, including final review correction |
| `npm run test -- --reporter=dot` | PASS exit 0, final 351/351 across 22 files (18:22:40Z start) |
| `npm run test:integration -- --reporter=dot` | Initial sandbox run: 87 passed / 31 listener EPERM; approved run PASS 118/118; final PASS 119/119 across 17 files (18:21:11Z start) |
| `npm run build` | PASS exit 0; existing >500kB web chunk warning; six server bundles |
| `npm run build:server` | PASS final rebuild after diagnostic-only edge-case fix |
| `npm run smoke:api` | PASS exit 0, API/worker smoke |
| `npm run smoke:production` | PASS exit 0, production same-origin smoke |
| `npm ls --depth=0 --offline` | PASS exit 0 |
| `node dist-server/generationTrace.js example --root /tmp/localcast-trace-validation/final/.generation-traces` | PASS; explicit synthetic fixture, no provider/DB |
| `node dist-server/generationTrace.js inspect /tmp/localcast-trace-validation/final/.generation-traces/trace-3878de35-57ae-4f17-b350-74fb93cab0c5.json` | PASS, private sibling HTML; only synthetic report copied into docs |
| `node dist-server/generationTrace.js replay /tmp/localcast-trace-validation/final/.generation-traces/trace-3878de35-57ae-4f17-b350-74fb93cab0c5.json` | PASS deterministic checks, original uncertain fixture retained, zero provider requests/publication |
| Headless installed Chromium via `@playwright/test`, local `file:` example | PASS at 1000px/320px; no overflow, nine sections, no HTTP requests |
| Scope, credential-shape, CLI import, and `git diff --check` / staged checks | PASS; no credentials, database/media artifact, dependency, migration, client, health, or topology changes |

An initial Node `execFileSync` replay wrapper reported sandbox `spawnSync EPERM`; a direct CLI invocation passed. No assertion was changed to address sandbox restrictions. The final standalone report was regenerated after review fixes. Full application Playwright/axe is unaffected because no application browser source/route/behavior changed; report rendering and injection are tested independently. No live service fallback or new offline semantic decision is claimed. The recurring production connection-local readiness issue remains unresolved, and all remaining operational gates remain open. No live provider request, retry/generation, production write, restart, deployment, or push occurred.

## 2026-10-17 — captured generation repair and SQLite reproduction

Final evidence timestamp: `2026-10-18T03:53:33Z` (October 17 local). Base `a83a020d8f263e2d926283b0ef1f2058bf8dee1d`; required clean branch/path passed. Primary was sole writer; independent generation and SQLite read-only reviews found no blocking issue. STATE records original trace findings, sanitized production diagnostics, exact-image reproduction and attribution limits. No private trace/HTML was copied into the repository.

All validation parents: `env -i PATH=/usr/local/bin:/usr/bin:/bin NO_COLOR=1`; build additionally `LOCALCAST_VITE_ENV_DIR=/tmp/localcast-oct17-empty-vite-env` (empty directory). Package tests select test mode/in-memory defaults; reproductions use disposable temporary storage and synthetic configuration. No provider network request occurs.

| Exact command | Final result |
| --- | --- |
| `npm run lint -- --pretty false` | PASS exit 0 |
| `npm run test -- --reporter=dot` | PASS exit 0, 358/358, 23 files |
| `npm run test:integration -- --reporter=dot` | PASS exit 0, 122/122, 18 files; start 2026-10-18T03:51:11Z |
| `npm run build` | PASS exit 0; existing >500kB chunk warning only |
| `npm run smoke:api` | PASS exit 0, disposable API/worker |
| `npm run smoke:production` | PASS exit 0, disposable same-origin production mode |

Focused repeatable reproduction (no production paths or credentials):

```sh
env -i PATH=/usr/local/bin:/usr/bin:/bin NO_COLOR=1 NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-vitest-media ./node_modules/.bin/vitest run tests/integration/sqlite-generation-health.test.ts --reporter=dot
```

Authoring evidence: initial mock Responses envelope lacked the completed/message fields and an upgrade fixture named the wrong request columns; each was corrected to the actual contract. The first lifecycle reproduction exposed the FTS defect and motivated the cursor/snapshot fix. Deliberate corruption initially hit SQLite defensive mode; unsafeMode is enabled only around that mutation in the disposable regression. The first full integration run passed 91 assertions but had 31 loopback `listen EPERM` failures; approved loopback rerun passed all 122 without assertion changes. No repeated speculative product repair occurred.

No frontend change required a browser rerun. Production remained untouched: no live generation/provider/TTS, deploy/restart/recreate, configuration/credential change, schema migration, dependency change, Caddy change or push. The production database was only independently inspected through a read-only mount/connection; the exact-image failure reproduction used separate disposable storage with networking disabled.
