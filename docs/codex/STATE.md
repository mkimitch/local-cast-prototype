# LocalCast build state

Last updated: 2026-08-06 23:36 CDT
Branch: `codex/localcast-prototype`
Pre-bootstrap HEAD: `910485b77ead63450660b0b97544889960e45e3f`
Slice 0 base HEAD: `e720d5818ab15efccfa143c94d6514c0c9a2baad`
Current base checkpoint: Slice 3 at `80ac0cd4e70e0893f0f9a1b12e99d274f366af80`
Current checkpoint: **Slice 4 — the green checkpoint is the commit containing this state**
Implementation slice: **4 — COMPLETE**
Next action: **STOP for review after the Slice 4 checkpoint; Slice 5 has not started**
Overall state: **SLICE 4 GREEN; OPERATOR CLIENT AND POST-REMEDIATION EVIDENCE COMPLETE**

## Slice 4 result

O-001 and O-004 are resolved. The canonical origin is `https://localcast.home.arpa`, privately resolved by both approved LAN DNS servers to `192.168.1.167`. Only the app joins external network `caddy_default` as `localcast-app`; the worker remains only on the LocalCast default network. Neither LocalCast service publishes a host port. The existing `localcast-slice1-listening` data/media volumes, stable episode IDs, and approved sample were preserved.

LocalCast now publishes one completed-only RSS 2.0 feed with stable token-independent GUIDs, exact MP3 enclosures, standard podcast metadata, transcript/citation-backed publication filtering, and a clear AI-generated-audio disclosure. Feed and enclosure routes use a server-side 256-bit token, canonical configured URLs, indistinguishable generic no-store `404` failures, `GET`/`HEAD`, validators, and exact single-range behavior; multiple ranges are deliberately rejected with `416`. The explicit settings action copies the masked-by-default subscription URL transiently; the token is not stored in browser state or exposed through routine APIs. The real token is in ignored `.secrets/podcast-token`, directory mode `700`, file mode `600`, mounted read-only only into the app. Its value was never displayed or copied into documentation or artifacts.

The authorized Caddy attachment added one origin-root `localcast.home.arpa` site pointing only to `localcast-app:8787`. LocalCast access output is discarded and skipped unconditionally. The sole global runtime logger deletes the complete request object before JSON encoding, writes `/config/caddy-runtime.json` mode `600`, rolls at 10 MiB, keeps at most five uncompressed rolls, and retains seven days. The canonical host configuration is now `/opt/stacks/caddy/conf/Caddyfile`, mounted read-only as the dedicated directory `/opt/stacks/caddy/conf:/etc/caddy`. This resolves the earlier single-file inode caveat without mounting the Caddy stack directory.

The operator separately authorized the mount-only Compose correction and one Caddy recreation after completing the gPodder test. Caddy Compose changed from SHA-256 `dfe5ad8ec35c0fdd08fa0e4c573b78a125fc758f92608c5063bf55b98560407a` to `e7da033b2d3ad85ced9e9134171b6dc228249ed477edda9b1532869a61dbe0bd`; normalized configuration differed only at the configuration mount source and target. Migration rollback backups are `/opt/stacks/caddy/compose.yml.pre-localcast-dir-mount-80ac0cd4` with the original Compose hash and `/opt/stacks/caddy/Caddyfile.pre-localcast-dir-mount-80ac0cd4` with SHA-256 `7df64b949d4438f4d8fb62706214960ff96b4b8142e4decc5d264b49e1c20e5a`. The older all-Slice-4 rollback file remains `/opt/stacks/caddy/Caddyfile.pre-localcast-80ac0cd4` with SHA-256 `7c9fc9078cc876a18e5a3e1f3091fbe9d40775ef02923acc045f8f92c0d00ec7` and was not used.

### Automated evidence

| Exact command or gate | Result |
| --- | --- |
| `env BUILDX_CONFIG=/tmp/localcast-slice4-buildx npm run verify` | PASS after final closure repairs, exit 0 — lint; 151 unit; 71 integration; production build; 8 Playwright/axe tests; API, production, and disposable Compose smoke |
| `env BUILDX_CONFIG=/tmp/localcast-slice4-buildx LOCALCAST_PODCAST_TOKEN_SOURCE=<protected-canary-file> node scripts/live-compose.mjs build` | PASS — production image rebuilt without displaying the persisted installation ID or a secret |
| `LOCALCAST_PODCAST_TOKEN_SOURCE=<protected-canary-file> node scripts/live-compose.mjs deploy` | PASS — only LocalCast app/worker recreated against the existing named volumes; both healthy |
| `docker compose -f /opt/stacks/caddy/compose.yml exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` | PASS on the mounted original inode; no reload was attempted until the candidate had also passed stdin validation |
| `docker exec -i caddy caddy validate --config - --adapter caddyfile < /tmp/Caddyfile.localcast.80ac0cd4` | PASS — exact new candidate valid under Caddy 2.11.1 |
| `docker exec -i caddy caddy reload --config - --adapter caddyfile < /tmp/Caddyfile.localcast.80ac0cd4` | PASS — graceful runtime load, Caddy restart count remained 0 |
| HTTPS baseline and health checks using Caddy's public root | PASS — `pdf` 401 JSON, `weather` 404 JSON, `menu` 404 JSON, `app` 200 text, LocalCast health 200 JSON; TLS verification result 0 for every origin |
| `node scripts/verify-podcast-canary.mjs --token-file <protected-canary-file> --origin https://localcast.home.arpa` in a credential-free verifier container | PASS — feed GET/HEAD, enclosure GET/HEAD, exact 1,024-byte 206, and indistinguishable rejected feed/enclosure GET/HEAD/range |
| The same canary harness with `--mode outage` while only the app was stopped | PASS — Caddy runtime-error path returned 502; app restarted healthy with restart count 0 |
| `node scripts/scan-podcast-canary.mjs ...` in a read-only, no-network host scan boundary | PASS after one scanner-only repair and a fresh canary — zero matches and zero errors for Caddy runtime, Docker active/rotated JSON logs, journal, `/var/log`, Caddy config/data, LocalCast data/media, repository/Git, relevant `/tmp`, container metadata, and image history |
| Persistent sample projection through the canary feed | PASS — enclosure 1,262,592 bytes, SHA-256 `2a8d83087085974c226691ee285168c9f91a52c60cf74f39406b3240a8fa8071`; ffprobe MP3 duration `78.912000` seconds; 5 sections and 7 citations remain |
| `node --check` for the token/canary/deployment scripts and `git diff --check` | PASS |
| `docker exec -i caddy caddy validate --config - --adapter caddyfile < /opt/stacks/caddy/conf/Caddyfile` | PASS before recreation — exact dedicated-directory candidate valid under Caddy 2.11.1 |
| `docker compose -f /opt/stacks/caddy/compose.yml up -d --no-deps --force-recreate --no-build --pull never caddy` | PASS — only Caddy recreated; image ID, ports, network, data/config mounts, and restart policy retained |
| `docker compose -f /opt/stacks/caddy/compose.yml exec -T caddy caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile` | PASS after recreation; host and container configuration SHA-256 both `7df64b949d4438f4d8fb62706214960ff96b4b8142e4decc5d264b49e1c20e5a` |
| `docker compose -f /opt/stacks/caddy/compose.yml exec -T caddy caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile` | PASS — graceful no-op reload from the durable path; Caddy restart count remained 0 |
| Fresh post-recreation canary harness and all nine sink groups | PASS — accepted/rejected feed and enclosure GET/HEAD/range, exact 1,024-byte `206`, and `502` outage path; every sink `matches=0 errors=0`; original secret restored byte-for-byte, mode `600`, app-only; disposable files removed |

No OpenAI request was made and no additional authorized spend was used. The exported operator certificate is ignored `.operator/localcast-caddy-root.crt`, mode `0644`, file SHA-256 `9db855017b06949209510724b63fc433c1b2cfd4968b555e342a0da5e7758290`, subject `CN=Caddy Local Authority - 2026 ECC Root`, and certificate SHA-256 fingerprint `E7:33:C4:0B:63:DE:27:CE:20:F3:30:43:89:58:B1:03:35:16:E6:ED:69:1E:2B:E9:BA:72:E1:E2:4E:E1:A4:66`.

### Operator-attested client evidence

The operator attests that gPodder 3.11.5 Portable on Windows 11, installed outside synchronized storage with accounts, gPodder.net sync, cloud backup, OPML sharing, and file logging disabled, passed subscription add, feed refresh, approved-sample download/play, enclosure seeking, restart, refresh, and replay. The downloaded SHA-256 was `2a8d83087085974c226691ee285168c9f91a52c60cf74f39406b3240a8fa8071`, exactly matching the persisted LocalCast MP3. The operator's recursive gPodder configuration search for `*.log` files produced no output. These are operator-attested manual results, not independently automated observations. The manual client test preceded the mount-only remediation; post-recreation automated equivalence, TLS/health, sample-persistence, and zero-retention checks all passed afterward.

## Slice 3 result

Brief and deep generation are now complete, mode-persisted, and bounded by unique supplied evidence. Adequate brief output validates at 600–1,000 words; sparse but factual brief material may produce a shorter source-bounded result. Deep output requires at least 1,800 unique evidence words/7,200 characters and validates at 1,800–3,000 words. Empty, trivial, direction-only, duplicate-inflated, or failed-feed-only material fails honestly before provider or speech publication. A failed sync may continue only from adequate immutable stored snapshots and carries an explicit warning.

New scripts use version 1 ordered sections and stable segments with text, citation IDs, one `host` role, and optional speaker-label/voice-profile persistence fields. Historical monolithic rows remain unversioned rather than being mislabeled. Strict local validation and the provider support pass reject malformed structure, invalid/duplicate/unrelated citations, non-exact excerpts, injected instructions, unsupported/uncertain claims, and length violations.

The episode library now has durable status/mode URL filters, accessible progress, phase-safe failure detail, persistent attempts, and manual retry. Retry requests require a durable idempotency key; same-key replay creates no extra attempt, failures after evidence freeze reuse the immutable snapshot, and insufficiency exposes no retry. The API/UI distinguish whether evidence was frozen so pre-selection retries do not claim otherwise.

The real player supports play/pause, seeking, skip, speed, elapsed/duration, download, error, and keyboard control against the actual `<audio>` element. Long single-host OpenAI narration is rendered in at most eight 4,096-character transport chunks and concatenated by pinned ffmpeg into one strictly validated MP3. This preserves one host/voice and is not dialogue, multi-voice rendering, crossfading, or the deferred post-prototype audio milestone. Speech chunk writes, assembly, ffprobe, publication, lease loss, cancellation, retry, and cache-status paths are fenced and cleaned.

Three independent read-only reviewers covered architecture/correctness, runtime/Docker/tests, and security/privacy/accessibility. No reviewer edited files. All material findings were repaired before the gate: durable retry identity, unique-evidence sufficiency, truthful historical versioning, render cancellation/lease renewal, every-phase browser failure coverage, real ffmpeg assembly proof, partial-write cleanup/classification, production-shaped v2 restart recovery, cache-vs-live provider status, pre-freeze retry wording, evidence-derived support oracle, mobile player reflow, route-focus fallback, and duplicate failure announcements. Closure review found no remaining architecture or runtime regression; the final duplicate alert finding was removed before the full gate.

### Slice 3 verification evidence

| Exact command | Result |
| --- | --- |
| `npm run lint -- --pretty false` | PASS, exit 0 — no TypeScript diagnostics |
| `npm run test` | PASS, exit 0 — 8 files, 137 tests |
| `npm run test:integration` | PASS, exit 0 — 10 files, 63 tests, including v2 process restart/recovery and real workflow retry invariants |
| `npm run build` | PASS, exit 0 — Vite transformed 2,150 modules and all three server bundles emitted |
| `npm run test:e2e` | PASS, exit 0 — 7 Playwright tests covering all generation phases, safe failure/retry, filters, real player controls, axe, 320px reflow and 200% text |
| `npm run smoke:api` | PASS, exit 0 — station generation, persistence, idempotency, safe failure, media, and restart evidence |
| `npm run smoke:production` | PASS, exit 0 — fail-closed production artifact/startup and same-origin behavior |
| `npm run verify` | PASS, exit 0 with approved Docker access — lint, 137 unit, 63 integration, build, 7 browser, API, production, and isolated Compose gates |
| Compose stage within `npm run verify` | PASS — disposable build/init/app/worker/recreation topology plus two real MP3 chunks concatenated with production-equivalent ffmpeg and validated by real ffprobe |
| `env NPM_CONFIG_CACHE=/tmp/localcast-npm-audit-cache npm audit --omit=dev --audit-level=high` | EXIT 1 — unchanged two high React Router RSC-only advisories; this declarative `BrowserRouter` SPA has no RSC/framework/action/SSR path, and npm offers only a breaking forced downgrade |
| `stat -c '%F mode=%a' .env` and `git check-ignore -v .env` | PASS — regular file, mode `600`, ignored at `.gitignore:24`; no value read or printed |
| redacted `docker compose config --format json` assertion | PASS — only `worker` receives the configured OpenAI key; no credential value/header printed |
| `git diff --check` | PASS, exit 0 after durable-document reconciliation |

The first focused Vitest invocation omitted the required test runtime environment and failed during two suite collection steps on configuration validation; rerunning with the repository's explicit test environment passed. The first sandboxed `npm run verify` passed every stage through production smoke and failed only when BuildKit tried to update its read-only user activity file. The authorized exact rerun used the local Docker engine, passed, created only unique disposable `localcast-slice1-*` resources, and removed them. It did not touch the listening deployment, Caddy, or operator data. No live OpenAI call occurred and no additional authorized spend was used in Slice 3.

### Slice 4 entry decisions at the Slice 3 checkpoint

Slice 3 itself had no unresolved deterministic failure. Its checkpoint stopped before Slice 4 for O-001 (canonical trusted-LAN HTTPS origin, Caddy topology, and tokenized-path logging) and O-004 (reachable real client and local/cloud subscription handling), plus a protected server-side token contract. The operator resolved those inputs on 2026-08-06. Their accepted values and the current manual client gate are recorded above and in `DECISIONS.md`; this paragraph remains only as Slice 3 checkpoint history.

## Slice 2 result

RSS 2.0 and Atom sources are now a complete manual, bounded input path. Sources support add/edit/enable/delete/sync/inspection, conditional `ETag`/`Last-Modified` requests, stable dedupe, safe redirects and pinned DNS/IP connections, explicit private-host allowlisting, immutable per-item network provenance, SQLite sync leases, and safe health/backoff. A station job synchronizes only its enqueue-captured feeds, commits items/validators under the same URL/lease fence, freezes selected evidence before the provider boundary, and never retrieves linked article pages. FTS5 searches feed items and pasted notes with provenance across lifecycle, rebuild, backup, and restart.

Legacy credential-bearing feed URLs are hidden from browser APIs and cannot sync or enqueue until replaced; new source/item/note URLs reject credentials and credential-like query names. Private/unknown feed evidence cannot cross the OpenAI boundary under the current consent. Final evidence is capped at 50 items and 120,000 aggregate title/body/author/URL characters, with a 160,000-character provider request guard. The public API accepts only station-backed generation, so production cannot enqueue the obsolete payload that the real processor rejects.

The operator-approved Slice 1 sample remains unchanged and no live provider call occurred in Slice 2. The deferred post-prototype two-host milestone and loudness baseline are recorded in `PLAN.md` and `DECISIONS.md`; the single-host pipeline remains authoritative.

Three independent read-only reviewers covered architecture/correctness, runtime/Docker/tests, and security/privacy/accessibility. No reviewer edited files. Their material findings were fixed: stale lease/URL-edit writes, unbounded DNS/queue wait, migrated cached-item fallback, item-level private provenance, credential URL redaction, aggregate provider input, expired-lease UI recovery, obsolete public job payload, provider-boundary proof, inactive-selection removal, station revision changes, optional metadata clearing, and source-panel focus behavior.

### Slice 2 verification evidence

| Exact command | Result |
| --- | --- |
| `npm run lint -- --pretty false` | PASS, exit 0 — no TypeScript diagnostics |
| `npm run test` | PASS, exit 0 — 6 files, 108 tests |
| `npm run test:integration` | PASS, exit 0 — 9 files, 53 tests |
| `NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-vitest-slice2-review npx vitest run tests/unit/safe-feed-fetcher.test.ts tests/unit/source-validation.test.ts tests/unit/openai-provider.test.ts tests/integration/rss-ingestion.test.ts tests/integration/material-search.test.ts tests/integration/selected-feed-generation.test.ts tests/integration/station-generation.test.ts` | PASS, exit 0 — 7 files, 89 focused tests after review repairs |
| `npm run build` | PASS, exit 0 — Vite built 2,150 modules; all three server bundles emitted |
| `npm run test:e2e` | PASS, exit 0 — 3 Playwright flows, including RSS/Atom/FTS/selected-feed generation, keyboard inactive-selection removal, and source-panel focus restoration |
| `npm run smoke:api` | PASS, exit 0 — station-backed API/worker generation, idempotency, deterministic media endpoint, safe failure, and restart persistence |
| `npm run verify` | PASS, exit 0 with approved Docker access — lint, 108 unit, 53 integration, build, 3 browser, API, production, and isolated Compose build/init/health/recreation gates |
| `npm audit --omit=dev --audit-level=high` | EXIT 1 — the same two high React Router RSC-only advisories; LocalCast uses declarative `BrowserRouter`, no RSC/framework/action/SSR path, and npm offers only a breaking forced downgrade |
| `stat -c '%F mode=%a' .env` and `git check-ignore -v .env` | PASS — regular file, mode `600`, ignored at `.gitignore:24`; no value read or printed |
| redacted `docker compose config --format json` assertion | PASS — `credentialServices=["worker"]`, `workerOnly=true`; no credential value/header printed |
| `git diff --check` | PASS, exit 0 |

The first sandboxed `npm run verify` reached its Compose tail and failed only because BuildKit could not update `/home/mkimitch/.docker/buildx/activity` on the read-only sandbox filesystem. The authorized rerun used the local Docker engine, created only unique `localcast-slice1-*` smoke resources, passed, and removed its containers/network/volumes. It did not touch the separate listening deployment or Caddy.

### Slice 2 repair state

No deterministic failure remains. The initial focused safe-fetch implementation needed one custom-lookup repair before review. Playwright needed one polling/keyboard-selector repair before review. Post-review stale-writer/provenance repairs passed their first focused run. Updating API smoke from legacy jobs to the production station contract required two evidence-based harness repairs (media route vs storage filename, then run-specific citation IDs); the third run passed. No unresolved failure reached the three-attempt stop.

## Slice 1 result

O-002 is resolved. The repository now has saved pasted notes and stations, immutable generation requests/evidence, a durable OpenAI text/support/TTS pipeline, strict citation and MP3 validation, real same-origin media, resolved transcript citations, native browser playback, honest provider status, and server-only external-provider disclosure. Slice 2 subsequently enabled the bounded RSS-backed path; deep generation remains explicitly gated until Slice 3 rather than silently simulated.

Three bounded read-only reviewers independently audited architecture/correctness, runtime/Docker/tests, and security/privacy/accessibility after targeted implementation. No reviewer edited files. The primary thread fixed their converged findings: factual-transition grounding bypass, transcript/audio replay mismatch, PID-stable temp collisions, inherited ffprobe credentials, weak MP3 format checking, stale/live provider state, missing-key enqueueing, premature RSS/deep generation, deterministic v2 fixture publication, media integrity/path checks, migration-004 upgrade coverage, and visible playback failure state.

### Credential and provider boundary

- `.env` is a regular file, mode `600`, ignored by `.gitignore:24`; its value was never displayed, logged, copied, or committed.
- A redacted Compose config assertion returned only `credentialServices=[{name:"worker",present:true}]` and `workerOnly=true`. App and storage-init do not receive the key. `ffprobe` receives an explicit minimal environment without the key.
- The smallest live access probe was `GET /v1/models/gpt-5.4-mini`; it returned HTTP 200 with an exact model match. No response body, key, or Authorization header was retained.
- The live pipeline used `gpt-5.4-mini` with low reasoning effort, then `gpt-4o-mini-tts`, `marin`, MP3. Text and speech reached `LIVE VERIFIED` at `2026-08-06T04:39:25.308Z` and `2026-08-06T04:39:40.688Z` respectively.
- Live-call scope was one model-access probe, one draft, one support classification, one representative TTS render, and one TTS-only duration correction. Reliable account-level usage accounting was unavailable; the application does not claim to enforce the authorized $5 ceiling.

### Listening sample

- Episode: `run-737b6807-a8e1-4cff-95d7-9797138b7671`
- Page: `http://127.0.0.1:43182/episodes/run-737b6807-a8e1-4cff-95d7-9797138b7671`
- Media: `http://127.0.0.1:43182/media/audio-run-737b6807-a8e1-4cff-95d7-9797138b7671`
- The source note and station were created through LocalCast APIs; the persistent worker job used the immutable request/evidence records before either provider call. The completed run has 5 sections, 7 factual claims/citations, the spoken and visible AI-generated disclosure, and no external browser request.
- Persisted and HTTP media agree at 1,262,592 bytes with SHA-256 `2a8d83087085974c226691ee285168c9f91a52c60cf74f39406b3240a8fa8071` and `audio/mpeg`. `ffprobe` reports codec `mp3`, format `mp3`, duration `78.912000` seconds.
- Headless Chromium decoded the media at 78.912 seconds and observed real `loadedmetadata`, `play`, `playing`, `pause`, `seeking`, `seeked`, and `timeupdate` events, 7 resolved citations, no third-party origin, and no browser credential field.
- The database records, request/evidence, transcript/citations, provider checks, media metadata, and MP3 checksum survived app/worker container recreation. The isolated listening deployment remained loopback-only; the operator approved the sample at the Slice 1 checkpoint.

### Slice 1 verification evidence

| Exact command | Result |
| --- | --- |
| `NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-vitest-unit-review npx vitest run tests/unit/openai-provider.test.ts tests/unit/provider-status.test.ts tests/unit/config.test.ts tests/unit/migrations.test.ts` | PASS after one migration-fixture repair — 4 files, 60 tests |
| `NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-vitest-integration-review npx vitest run tests/integration/station-generation.test.ts tests/integration/media-route.test.ts` | PASS, exit 0 — 2 files, 7 tests |
| `npx playwright test tests/e2e/foundation.spec.ts tests/e2e/generation-phases.spec.ts` | PASS, exit 0 — note/station lifecycle plus persistent generation, resolved citation, real deterministic MP3 decode/play |
| `LOCALCAST_LIVE_URL=http://127.0.0.1:43182 LOCALCAST_LIVE_EPISODE_ID=run-737b6807-a8e1-4cff-95d7-9797138b7671 npm run verify:live-browser` | PASS, exit 0 — 78.912 seconds, required media events, 7 citations, zero external origins/credential fields |
| `npm run verify` | PASS, exit 0 at 2026-08-06 — 61 unit, 38 integration, build, 2 Playwright, API smoke, production smoke, and isolated Compose build/init/no-key/recreation smoke |
| `npm audit --omit=dev --audit-level=high` | EXIT 1 — two high advisories from `react-router` 7.18.2; GHSA-qwww-vcr4-c8h2 states it applies only to unstable RSC APIs. LocalCast uses declarative `BrowserRouter`, no RSC/framework/actions/SSR path. No patched 7.x release exists; this is recorded, not represented as zero risk. |

The first sandboxed full gate passed through production smoke and failed only because BuildKit could not write its user-level activity directory. The required rerun used approved Docker access. The final full gate created only unique `localcast-slice1-*` smoke resources and removed their containers, networks, and volumes. It did not touch the separate listening deployment or Caddy.

## Slice 0 result

The credential-free production foundation is complete. It now has strict environment and role contracts, explicit identity-bound storage initialization, additive migration 004, SQLite health checks, durable FIFO generation jobs and attempts, one separate heartbeating worker, process-level crash/recovery and graceful-stop behavior, deterministic test-only providers, a same-origin production build, and an isolated non-root Compose topology.

The rows closed by this slice are `GEN-01`, `GEN-06`, `DATA-01`, `JOB-01`, `JOB-02`, `PROV-02`, and `PROV-04`. Staged rows remain explicitly partial in `TEST_MATRIX.md`; this checkpoint does not claim real provider output, real MP3 behavior, podcast delivery, or follow-up grounding.

Three final read-only reviewers independently audited architecture, runtime/deployment, and security/privacy/accessibility. The primary thread fixed all Slice 0 blockers they identified. No subagent wrote files.

### Final verification evidence

The exact credential-free phase gate ran from 2026-08-05 18:30:42 CDT:

| Exact command | Result |
| --- | --- |
| `npm run verify` | PASS, exit 0 — lint; 31/31 unit; 31/31 integration; production web/server build; 2/2 Playwright; API/process smoke; production fail-closed/artifact smoke; Compose fresh-volume/init/topology/recreation smoke |
| `npm audit --omit=dev` | PASS, exit 0 — `found 0 vulnerabilities` |
| `git diff --check` | PASS, exit 0 — no whitespace errors after final documentation reconciliation at 2026-08-05 18:39:04 CDT |

The Compose portion used an approved local Docker-engine escalation. It created only uniquely named `localcast-slice0-*` test resources and removed its containers, network, and volumes in `finally`. No Caddy command or change occurred. Detailed targeted results and the repair ledger are in `BUILD_LOG.md`.

### Repair state

No deterministic failure remains. Browser selector/reload repairs passed on the third evidence run; Compose probe repairs passed on the third evidence run; the lease precision and test-launcher findings each passed their first focused rerun. The three-attempt hard stop was not reached for an unresolved failure.

## Bootstrap result

The repository has been inspected and the autonomous build contract has been frozen. This bootstrap changes documentation only; no product feature, dependency, runtime configuration, database schema, Docker setup, or Caddy state was changed.

Three bounded read-only reviews completed before documentation was written:

1. implementation and architecture map;
2. tests, runtime, Docker, deployment, persistence, jobs, media, and provider gaps;
3. security, privacy, accessibility, persistence, grounding, media, and podcast risks.

All three agreed that the incremental Git history and current React/Vite/Express/SQLite structure are coherent and should be extended rather than rewritten. Their material findings are reflected in `SPEC.md`, `PLAN.md`, `DECISIONS.md`, and `TEST_MATRIX.md`.

## Preconditions observed

Executed from the task-provided working directory before any write:

| Command | Result |
| --- | --- |
| `pwd` | PASS — `/opt/stacks/local-cast-prototype` |
| `git branch --show-current` | PASS — `codex/localcast-prototype` |
| `git status --porcelain=v1 --untracked-files=all` | PASS — no output; tracked and untracked working tree clean |

The initial compact status reported only `## codex/localcast-prototype`, with no file entries.

## Existing baseline

### Repository and history

- One root npm package; 62 tracked files before bootstrap.
- React 19, Vite 6, and TypeScript frontend.
- Express 4 API run through `tsx`.
- `better-sqlite3`, explicit migrations, foreign keys, WAL, and SQLite-backed sources/items/settings/runs/sections/audio metadata.
- Server-side `rss-parser` ingestion with timeout, item cap, stable hashed identity, unique per-source dedupe, persisted sync health, and 15-minute/1-hour/6-hour failure backoff.
- Text provider seam with mock, Gemini, and a generic OpenAI-compatible chat-completions adapter.
- Feature-oriented UI, API/mock service interfaces, layered CSS tokens, focus-visible styling, reduced-motion handling, appearance/contrast/text-size/density controls.
- One substantive API smoke script.
- No tracked Dockerfile, Compose file, Caddyfile, CI workflow, Vitest/Playwright configuration, or prior `docs/` directory.

Relevant history is incremental:

| Commit | Existing work |
| --- | --- |
| `cb1f61f` | Initial LocalCast UI scaffold |
| `eca25c0` | Accessibility and appearance settings |
| `1a61857` | Feature-oriented reorganization |
| `57bc67e` | Express API, provider seam, and CSS foundation |
| `e4aa752` / `c58afef` | SQLite persistence, validation, and smoke coverage |
| `feb7522` / `097adef` | RSS ingestion, migrations, dedupe, sync UI, and smoke expansion |
| `46e0fe7` / `910485b` | Ignore-rule expansion and merge |

### Current implemented behavior worth preserving

- LocalCast naming is used throughout the application and no Huxe naming was found, but `index.html` still has the legacy title `My Google AI Studio App`; identity is therefore only partial at baseline.
- Frontend screens exist for dashboard, sources, runs, episode detail, settings, and a simulated player.
- API routes exist for health, sources/items/sync, briefing runs, settings, and follow-up.
- Empty databases apply three ordered migrations and currently seed sample data.
- Existing smoke coverage exercises CORS allow/block behavior, validation, source creation, RSS fetch/dedupe/search/date filters, sync health/backoff/forced retry, secret stripping, mock generation, mock follow-up, migrations, and restart persistence.
- Feed fetches are server-side and do not currently scrape article pages.

### Critical baseline conflicts

- Frontend mode defaults to mocks unless `VITE_SERVICE_MODE=api`; backend provider parsing defaults unknown/unset values to mock.
- The production server does not serve the frontend, media, or podcast feed; the current build is frontend-only.
- Generation is a detached in-process promise with artificial delays, no durable job/attempt/lease, no concurrency limit, and no crash recovery.
- Empty/failed feeds become synthetic “source items”; manual topic instructions become evidence; empty inputs ask providers for placeholder prose.
- Provider JSON and citation IDs are coerced rather than strictly validated.
- “Audio” is `url: '#'`, a fixed duration, timer-based progress, and random visualizer data; there is no MP3 or `<audio>` playback.
- Follow-up uses a run title plus optional caller-authored context, not immutable episode evidence; the UI buttons are inert.
- There are no saved stations, pasted-note model, brief/deep mode, FTS5 schema, retry endpoint/UX, private feed, byte ranges, provider verification status, backup/restore, or Docker deployment.
- Browser-side automatic generation and optional server RSS intervals conflict with the manual-only scope.
- Settings advertise browser API keys, Gemini, ElevenLabs, and Web Speech behavior that is not the supported production contract.
- Production UI loads Google Fonts, contradicting a strict local/browser-egress posture.
- RSS fetching lacks SSRF/DNS/redirect/body-size controls and conditional requests.
- Run rows and several form/player interactions have keyboard/label/focus/contrast defects despite a good styling foundation.
- Production initialization seeds invented sources, transcript claims, citations, and placeholder audio, which can mask a missing persistent volume.

## Baseline verification evidence

Commands were run on 2026-08-05 with Node `v20.19.2` and npm `9.2.0`. Installed dependencies were already present; no install was run. Yarn is not installed (`yarn --version` returned command not found), reinforcing the existing npm decision.

### Dependency and capability checks

| Exact command | Result |
| --- | --- |
| `npm ls --depth=0` | PASS, exit 0 — dependency tree resolved with no missing/extraneous packages reported |
| `npm run` | PASS, exit 0 — scripts are `dev`, `dev:web`, `dev:api`, `dev:all`, `build`, `preview`, `clean`, `lint`, and `smoke:api`; no unit or browser test script exists |
| `node --input-type=module -e "import Database from 'better-sqlite3'; const db = new Database(':memory:'); const enabled = db.prepare(\"SELECT sqlite_compileoption_used('ENABLE_FTS5') AS enabled\").get().enabled; const version = db.prepare('SELECT sqlite_version() AS version').get().version; console.log(JSON.stringify({version, fts5: enabled === 1})); db.close();"` | PASS, exit 0 — `{"version":"3.53.2","fts5":true}` |

Installed top-level versions reported by `npm ls --depth=0` included React/React DOM `19.2.7`, Vite `6.4.3`, TypeScript `5.8.3`, Express `4.22.2`, `better-sqlite3` `12.11.1`, `rss-parser` `3.13.0`, and `tsx` `4.23.0`.

### Type/build/smoke checks

| Exact command | Result |
| --- | --- |
| `npm run lint` | PASS, exit 0 — `tsc --noEmit`; no diagnostics |
| `npm run build` | PASS, exit 0 — Vite `6.4.3`, 2,094 modules transformed, built in 6.41s; output included `dist/index.html` 0.41 kB, CSS 44.02 kB, JS 396.91 kB |
| `VITE_SERVICE_MODE=api VITE_API_BASE_URL=http://localhost:8787/api npm run build` | PASS, exit 0 — 2,094 modules transformed, built in 5.08s; API-mode JS 396.98 kB |
| `npm run smoke:api` | PASS, exit 0 — `API smoke checks passed` in 14.61s |
| `git status --porcelain=v1 --untracked-files=all` after baseline checks | PASS — no output; ignored `dist` changes and temporary smoke data did not dirty the tree |

The two builds write only ignored `dist/`. The smoke script starts loopback-only fixture/API servers, uses a uniquely named SQLite file under the OS temp directory, stops both servers, and removes its temporary database/WAL/SHM files.

After the bootstrap documents and independent review fixes were complete, the same regression gate was rerun: `npm run lint` passed with no diagnostics; `npm run smoke:api` passed with `API smoke checks passed`; `npm run build` passed with 2,094 modules in 5.00s; and `VITE_SERVICE_MODE=api VITE_API_BASE_URL=http://localhost:8787/api npm run build` passed with 2,094 modules in 4.89s. All four commands exited 0.

## Frozen architecture direction

- Preserve npm, Express, React/Vite/TypeScript, the service seams, and SQLite migration/store patterns.
- Adopt Zod only at new/touched boundaries; add React Router and TanStack Query incrementally for durable URLs and server state.
- Use SQLite plus FTS5 for durable application/job/chat/feed state and a persisted filesystem directory for validated MP3s.
- Run one API application and one separate worker from the same production image; only the API has a public origin.
- Use OpenAI text plus OpenAI TTS for the first real walking skeleton; add Ollama/LM Studio and Piper parity later.
- Keep Caddy operator-owned and outside agent authority.

See `DECISIONS.md` for the complete rationale and exceptions to the default stack.

## Current blockers and repair ledger

No Slice 4 deterministic implementation blocker remains. The Slice 1 listening gate was approved at checkpoint `1790e91f1b37d518b18f4834b59cb7d9ba160823`; O-001 and O-004, including the operator-attested gPodder evidence, are resolved. O-003 remains optional live verification for Slice 6.

| Slice | Deterministic failure or entry block | Attempts | State |
| --- | --- | --- | --- |
| 0 | Browser phase/reload scenario | 3 evidence-based repairs | GREEN |
| 0 | Compose profile/probe scenario | 3 evidence-based runs, 2 repairs | GREEN |
| 0 | Millisecond lease expiry | 1 repair | GREEN |
| 0 | SIGKILL targeted the TypeScript launcher rather than worker child | 1 repair | GREEN |
| 1 | O-002: OpenAI authority/configuration | Operator supplied the approved server-only configuration, consent, and spend boundary | RESOLVED |
| 1 | Live sample initially measured 96.360 seconds | One TTS-only speed correction to `1.05`; no second text generation | GREEN — 78.912 seconds |
| 1 | Reused-audio metadata timestamp and crash mismatch review findings | One content-binding/stable-metadata/unique-temp repair | GREEN — provider contracts pass |
| 1 | Frozen migration-004 fixture exposed unreconciled orphan history | One additive migration-005 reconciliation repair | GREEN — migration suite passes |
| 1 | API smoke retained the obsolete 417-byte fake MP3 assertion | One assertion repair against a real deterministic ID3 MP3 fixture | GREEN — API smoke passes |
| 1 | Compose empty credential failed schema parsing instead of reporting `NOT CONFIGURED` | One empty-to-unset config repair | GREEN — final Compose no-key startup passes |
| 2 | Safe-fetch fixture bypassed custom DNS lookup | One pinned-lookup repair | GREEN — focused and full fetch suites pass |
| 2 | Browser polling and inactive-selection keyboard selector raced rendered state | One polling/selector repair | GREEN — Playwright passes |
| 2 | Review found stale lease/URL writers and mutable source-wide provenance | One atomic fence and item-level provenance repair | GREEN — focused review suite passes |
| 2 | Station-backed API smoke retained legacy media-file and run-specific citation assumptions | Two harness repairs | GREEN — third evidence run and full gate pass |
| 3 | Initial focused Vitest command omitted explicit test runtime variables | One environment correction | GREEN — focused suites collect and pass |
| 3 | Retry replay lacked durable key identity; review also found pre-freeze wording ambiguity | One additive retry-request contract plus evidence-state copy repair | GREEN — replay/attempt/API/browser tests pass |
| 3 | Duplicate evidence could inflate deep sufficiency and the support oracle was too fixture-specific | One digest-unique sufficiency policy and evidence-derived oracle repair | GREEN — supported controls pass; duplicated/unrelated claims fail |
| 3 | Historical transcripts were over-versioned and v2 process recovery lacked production-shaped proof | One conditional migration backfill plus restart integration repair | GREEN — migration and process-recovery suites pass |
| 3 | Long speech assembly needed lease/cancellation, real-tool, partial-write, and cache-status evidence | One fenced transport/cleanup/status repair set | GREEN — unit/integration and real ffmpeg/ffprobe Compose evidence pass |
| 3 | Mobile player/focus/live announcements had reflow and duplicate semantics findings | One responsive/focus/alert repair set | GREEN — browser bounds, keyboard, axe and visual inspection pass |
| 4 | First live Compose build lacked an explicit installation ID in the shell | One operator helper read and reconciled the two persisted non-secret markers without displaying them | GREEN — image built and existing volumes mounted under the same identity |
| 4 | Caddy's single-file bind retained the old inode after the host pathname replacement | Initial stdin validation/reload preserved service; later separately authorized dedicated-directory mount and one Caddy recreation | GREEN — `/opt/stacks/caddy/conf/Caddyfile` and `/etc/caddy/Caddyfile` now have the same expected hash; exact migration backups are ready |
| 4 | First canary scan had permission errors for raw Docker logs, one external documentation symlink, and Git safe-directory checks | One bounded scanner repair plus a complete fresh-canary rerun | GREEN — all nine sink groups report zero matches and zero errors |
| 4 | Primary diff review found wrong-Origin podcast errors and vacuous no-factual-claim publication could fail more closed | One generic podcast-404 guard plus explicit AI-run/supported-cited-factual publication predicates | GREEN — focused 5/5, lint, complete 151/71/8/smoke gate, and app-only redeploy pass |
| 4 | First post-recreation canary launch could not resolve the verifier script inside its isolated bind mount | Finally path restored the real secret byte-for-byte and removed disposable files; one bounded launch repair used the same in-memory harness directly with the trusted CA | GREEN — fresh canary passed all assertions and nine sinks with zero matches/errors; restoration reverified |
| 4 | Final acceptance review found enclosure projection bypass, validator/Range precedence, nested copy live regions, and an undocumented multi-range result | One aligned publication-query, weak-validator/precedence, live-region, regression-test, and documentation repair | GREEN — focused 5 files/55 tests and private-feed Playwright pass; closure re-review found no blocker; complete 151/71/8/smoke gate passed |
| 4 | Deployment reviewer accidentally redirected Caddy validation messages to two `/tmp` files despite the read-only assignment | Primary removed the two exact safe files immediately and reconfirmed their absence | CLOSED — no repository, Caddy, service, credential, or token state changed |

No deterministic failure remained after three repair attempts for the same cause. Open operator decisions are listed in `DECISIONS.md`. Slice 4 is complete; Piper contract support can complete without a model, and only optional `LIVE VERIFIED` Piper evidence requires installation/model authorization.

## Assumptions recorded at bootstrap

- All clients that can reach the main application origin are trusted; there is intentionally no app authentication.
- Caddy already exists outside this repository, but its attachment topology and canonical URL were not inspected or inferred.
- The operator will provide credentials and tokens through server-side configuration, never tracked files.
- Existing user data must be migrated in place and historical evidence preserved; automatic cleanup is forbidden by the accepted prototype retention policy.
- The accepted prototype default is indefinite retention with no automatic deletion. Backup is a manual artifact to an operator-selected path; retention and encryption remain external operator responsibilities.
- Full-page scraping, search, scheduling, accounts, public deployment, vectors, Redis, distributed work, analytics, multiple speakers, and voice cloning remain frozen non-goals.

## Next action

Create the one green Slice 4 checkpoint after the complete repository gate and diff review, then stop for review. Do not start Slice 5 in this session.
