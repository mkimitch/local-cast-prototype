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

The loopback-only page `http://127.0.0.1:43182/episodes/run-737b6807-a8e1-4cff-95d7-9797138b7671` remains available for the operator. Slice 2 and all longer generation are stopped pending explicit listening approval.
