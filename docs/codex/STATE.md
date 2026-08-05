# LocalCast build state

Last updated: 2026-08-05 18:33 CDT
Branch: `codex/localcast-prototype`
Pre-bootstrap HEAD: `910485b77ead63450660b0b97544889960e45e3f`
Slice 0 base HEAD: `e720d5818ab15efccfa143c94d6514c0c9a2baad`
Current checkpoint: Slice 0 green; checkpoint commit pending final diff review
Implementation slice: **0 — COMPLETE**
Next slice: **1 — entry blocked by O-002 (OpenAI credential, cloud-processing consent, model/voice, and minimal live-test budget)**
Overall state: **SLICE 0 FULL GATE GREEN; CHECKPOINT PENDING**

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

No Slice 0 implementation blocker remains. Slice 1 cannot perform its required fixture-free OpenAI text/TTS chain without O-002.

| Slice | Deterministic failure or entry block | Attempts | State |
| --- | --- | --- | --- |
| 0 | Browser phase/reload scenario | 3 evidence-based repairs | GREEN |
| 0 | Compose profile/probe scenario | 3 evidence-based runs, 2 repairs | GREEN |
| 0 | Millisecond lease expiry | 1 repair | GREEN |
| 0 | SIGKILL targeted the TypeScript launcher rather than worker child | 1 repair | GREEN |
| 1 | O-002: no authorized OpenAI credential/cloud-processing consent/live-test budget | 0 repair attempts; external input required | ENTRY BLOCKED after Slice 0 checkpoint |

Open operator decisions are listed in `DECISIONS.md`. Slice 1 requires an OpenAI credential and live-test budget. Slice 4 requires Caddy origin/topology/log handling and a real podcast client. Piper contract support can complete without a model; only an optional `LIVE VERIFIED` Piper check requires installation/model authorization.

## Assumptions recorded at bootstrap

- All clients that can reach the main application origin are trusted; there is intentionally no app authentication.
- Caddy already exists outside this repository, but its attachment topology and canonical URL were not inspected or inferred.
- The operator will provide credentials and tokens through server-side configuration, never tracked files.
- Existing user data must be migrated in place and historical evidence preserved; automatic cleanup is forbidden by the accepted prototype retention policy.
- The accepted prototype default is indefinite retention with no automatic deletion. Backup is a manual artifact to an operator-selected path; retention and encryption remain external operator responsibilities.
- Full-page scraping, search, scheduling, accounts, public deployment, vectors, Redis, distributed work, analytics, multiple speakers, and voice cloning remain frozen non-goals.

## Next action

Review and commit the green Slice 0 diff as `feat(prototype): establish durable generation foundation`. Then enter Slice 1 and hard-stop on O-002 unless the operator supplies server-side OpenAI configuration, explicit consent to send the minimal synthetic live-check material to OpenAI, and a live-test spend boundary. Never place the credential in Git, documentation, logs, screenshots, or chat.
