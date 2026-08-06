# LocalCast build state

Last updated: 2026-08-06 00:19 CDT
Branch: `codex/localcast-prototype`
Pre-bootstrap HEAD: `910485b77ead63450660b0b97544889960e45e3f`
Slice 0 base HEAD: `e720d5818ab15efccfa143c94d6514c0c9a2baad`
Current base checkpoint: Slice 0 at `c2604ed93b4c6b0a977405b5f74a7f40baae3f47`
Current checkpoint: **Slice 1 — the commit containing this state document**
Implementation slice: **1 — GREEN**
Next action: **operator listening approval; Slice 2 is not started**
Overall state: **STOPPED AT THE AUTHORIZED LISTENING GATE**

## Slice 1 result

O-002 is resolved. The repository now has saved pasted notes and stations, immutable generation requests/evidence, a durable OpenAI text/support/TTS pipeline, strict citation and MP3 validation, real same-origin media, resolved transcript citations, native browser playback, honest provider status, and server-only external-provider disclosure. RSS-backed and deep generation remain explicitly disabled until Slice 2 and the listening approval respectively; neither is silently simulated.

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
- The database records, request/evidence, transcript/citations, provider checks, media metadata, and MP3 checksum survived app/worker container recreation. The isolated listening deployment remains loopback-only and running for operator review.

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

No Slice 1 implementation blocker remains. The active stop is the operator-requested listening approval gate, not a failed check. O-001 and O-004 remain future Slice 4 inputs; O-003 remains optional live verification for Slice 6.

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

No deterministic failure remained after three repair attempts for the same cause. Open operator decisions are listed in `DECISIONS.md`. Slice 4 still requires Caddy origin/topology/log handling and a real podcast client. Piper contract support can complete without a model; only optional `LIVE VERIFIED` Piper evidence requires installation/model authorization.

## Assumptions recorded at bootstrap

- All clients that can reach the main application origin are trusted; there is intentionally no app authentication.
- Caddy already exists outside this repository, but its attachment topology and canonical URL were not inspected or inferred.
- The operator will provide credentials and tokens through server-side configuration, never tracked files.
- Existing user data must be migrated in place and historical evidence preserved; automatic cleanup is forbidden by the accepted prototype retention policy.
- The accepted prototype default is indefinite retention with no automatic deletion. Backup is a manual artifact to an operator-selected path; retention and encryption remain external operator responsibilities.
- Full-page scraping, search, scheduling, accounts, public deployment, vectors, Redis, distributed work, analytics, multiple speakers, and voice cloning remain frozen non-goals.

## Next action

The operator should listen at the recorded loopback URL and approve or reject the voice, pacing, and overall sample. Do not start Slice 2 and do not generate longer audio before that approval.
