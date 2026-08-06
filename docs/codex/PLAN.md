# LocalCast autonomous build plan

Status: Slice 1 green on 2026-08-06; the commit containing this plan is its checkpoint
Current slice: **1 — COMPLETE; STOPPED AT OPERATOR LISTENING APPROVAL GATE**
Execution policy: one vertical slice, one green checkpoint commit

## How to use this plan

The numbered order is mandatory. Each slice must leave a usable end-to-end increment, not disconnected layers. A later slice may not be started to conceal a current failure.

At the end of every slice, the primary agent must:

1. run targeted checks;
2. delegate up to three independent read-only reviews;
3. reconcile and fix material findings;
4. run the full phase gate;
5. update `STATE.md`, `DECISIONS.md`, and `TEST_MATRIX.md` with exact evidence;
6. review unstaged and staged diffs, including `git diff --check`;
7. create exactly one green checkpoint commit;
8. continue automatically when the slice is green and no open decision or authorization blocks the next slice.

The primary agent is the only writer. The three-repair-attempt stop rule in `AGENTS.md` applies to every deterministic failure.

In the slice sections below, a row is "closed" only when every acceptance check in that matrix row is satisfied. A slash-separated slice value in `TEST_MATRIX.md` identifies staged evidence; the row remains open until its last listed slice.

## Verification ladder

Slice 0 established the following credential-free verification ladder without weakening the original checks:

Expected steady-state scripts:

```bash
npm run lint
npm run test
npm run test:integration
npm run build
npm run test:e2e
npm run smoke:api
npm run smoke:production
npm run verify
```

`npm run verify` should aggregate the credential-free full gate. Live OpenAI, local-provider, Piper, podcast-client, and Caddy checks stay explicit because they require operator configuration or external resources. Docker commands and their exact environment must be recorded when used.

Every check writes only to ignored build output or a unique temporary directory/database. Tests must not use the operator’s production SQLite or media paths.

## Bootstrap checkpoint

Purpose: freeze scope and autonomous operating policy without changing product behavior.

Deliverables:

- `AGENTS.md`
- `docs/codex/SPEC.md`
- `docs/codex/PLAN.md`
- `docs/codex/STATE.md`
- `docs/codex/DECISIONS.md`
- `docs/codex/TEST_MATRIX.md`

Required commit:

```text
chore(prototype): define autonomous build contract
```

After this commit, stop for operator review. This one-time stop overrides automatic continuation.

## Slice 0 — Baseline, environment contracts, persistence, jobs, and deterministic fakes — COMPLETE 2026-08-05

### Outcome

A production-shaped, credential-free foundation: explicit runtime modes, validated configuration, durable domain/job storage, one worker/one active generation, deterministic fake providers for tests, reproducible server/client builds, and a minimal same-origin/Compose smoke path.

### Work

- Preserve npm, Express, React/Vite, existing service seams, RSS behavior, SQLite migration history, and accessible styling.
- Add Node/package/runtime contracts and Zod schemas for environment, API boundaries touched in this slice, provider results, and persisted job payloads.
- Make production frontend/API mode explicit. Remove all silent mock normalization. Permit fake providers only through an explicit non-production test gate.
- Move shared domain contracts out of browser-owned modules when necessary, without creating a workspace.
- Add only the minimum additive persistence needed for durable jobs, attempts, leases, safe errors, and provider-test state on top of the existing run records. Feature-owned station/note/evidence/media/chat migrations belong to the slice that first uses them.
- Add SQLite startup checks, busy timeout, migration verification, FTS5 capability check, clean shutdown, production no-demo-seed behavior, and clear failure for missing/unwritable/wrong persisted database or media mounts.
- Replace detached API generation with a separate worker entry point that claims FIFO work transactionally and runs at most one generation job.
- Implement stale-lease recovery, persisted phases/errors, idempotent retry primitives, and safe shutdown.
- Add deterministic fake text/TTS adapters and fixture MP3 bytes for tests. Fake outputs must exercise valid citations and controllable phase failures.
- Add Vitest and Playwright foundations, fixture factories, temporary database/media isolation, and split reusable assertions from the current API smoke script.
- Add server build/start scripts and have Express serve the built frontend and API on one origin.
- Add an initial non-root Docker image and Compose application/worker topology with persisted data/media mounts and health checks. Do not edit Caddy.
- Remove or gate automatic browser generation, RSS startup/interval sync, fake production seeds, browser provider-key fields, unsupported provider/source choices, and legacy Google AI Studio page metadata.
- Bundle fonts locally or use a system stack so the production browser makes no third-party request at load.

### Targeted evidence

- Environment-table tests cover unset, unknown, explicit production, and explicit test modes.
- Migration tests upgrade empty and current three-migration fixtures without data loss.
- Queue tests enqueue two jobs and observe only one active lease.
- Kill/restart tests recover a job at each persisted phase and retain attempt history.
- Idempotency tests replay enqueue/retry/worker claim without duplicate sections, citations, or media records.
- Production-mode tests prove fake provider selection and mock frontend mode are rejected.
- Same-origin smoke loads the built UI and API from one Express origin.
- Compose config/image inspection proves separate app/worker roles and declared persisted mounts.

### Rows closed by this slice

`GEN-01`, `GEN-06`, `DATA-01`, `JOB-01`, `JOB-02`, `PROV-02`, and `PROV-04`. Slice 0 advances `ID-01`, `DATA-02`, `DATA-03`, `JOB-03` through `JOB-05`, `PROV-01`, `DEP-01`, `DEP-03`, and the architecture/invariant rows; those remain open for their later listed evidence.

### Checkpoint

Suggested commit: `feat(prototype): establish durable generation foundation`

## Slice 1 — True walking skeleton with one real text and one real speech provider — COMPLETE 2026-08-06

### Entry requirements

- Slice 0 is green.
- O-002 is resolved.
- The operator has supplied a server-side OpenAI credential and authorized a minimal live-test budget without putting the key in tracked files or chat.

### Outcome

From the browser, the operator saves one station and one pasted note, clicks **Sync and generate**, sees a durable job complete through OpenAI text and OpenAI TTS, reads a validated cited transcript, and plays a real persisted MP3.

### Work

- Add the minimum station, note, episode evidence, claim/citation, media, and provider-check migrations with usable note/station flows, keeping topic direction separate from evidence.
- At enqueue, capture the station/mode/note request snapshot; before provider use, atomically finalize the selected evidence snapshot.
- Introduce React Router and TanStack Query for the walking-skeleton episode URL, mutations, invalidation, and reliable job polling.
- Implement the OpenAI text adapter with timeouts, cancellation, size bounds, atomic claim/support output, deterministic ID/excerpt checks, a bounded structured support pass, and safe failures.
- Implement the OpenAI TTS adapter and atomic MP3 validation/publication.
- Implement explicit provider verification and the three required status labels.
- Expose job progress/failure through API/query state and an accessible episode detail page.
- Add safe basic full-response MP3 delivery, then replace simulated playback with real media events and a native audio element/media API. `HEAD`/validators/range semantics remain Slice 4.
- Show the external-provider privacy disclosure before first verification/use.
- Prove that empty or inadequate material fails without invoking TTS or publishing an episode.

### Targeted evidence

- Deterministic OpenAI HTTP fixture covers success, timeout, cancellation, 4xx/5xx, malformed/oversized output, invalid citations, and no fallback.
- Live verification reaches `LIVE VERIFIED` for the configured OpenAI text and speech pair with timestamped, redacted evidence.
- One minimal live episode produces a decodable MP3, measured duration/checksum, transcript, resolved citations, and real browser playback.
- A network capture/browser assertion proves the key never reaches the client and separately records station/evidence sent to text generation and final narration sent to TTS.

### Rows closed by this slice

`SRC-02`, `STN-02`, `TXT-01`, `TTS-01`, `TTS-03`, and `PROV-01`. The walking skeleton advances `STN-01`, `STN-03`, `GEN-02`, `GEN-05`, `GRD-01` through `GRD-04`, `TXT-04`, `TTS-04`, `PROV-03`, `PROV-05`, `LIB-01` through `LIB-03`, `MEDIA-01`, `MEDIA-02`, `PRIV-01`, `PRIV-02`, and `ARC-04`; each remains open for its later listed evidence.

### Checkpoint

Suggested commit: `feat(prototype): complete real provider walking skeleton`

The representative 78.912-second sample is the only live episode generated in this slice. The operator-requested listening gate overrides automatic continuation: do not start Slice 2 or generate longer audio until the operator approves that sample.

## Slice 2 — RSS/Atom ingestion, deduplication, conditional fetching, and FTS5

### Outcome

Stations can use safely synchronized RSS/Atom sources. Conditional requests, immutable episode snapshots, dedupe, and FTS5 search work across restart without scraping linked pages.

### Work

- Evolve the existing RSS service rather than replacing it.
- Add feed validators, fetch timestamps, bounded response streaming, content-type/field limits, redirect caps, DNS/IP revalidation, safe item-link schemes, and configurable private-host allowlisting.
- Add Atom fixtures and preserve current RSS dedupe/backoff/health behavior where it remains useful for manual actions.
- Ensure explicit user sync is observable and does not create synthetic source items for errors.
- Add FTS5 migrations, synchronization, query escaping/ranking, provenance display, and rebuild verification.
- Synchronize only the station feeds captured at enqueue; atomically snapshot selected feed items before provider calls. Source refresh/delete must not change completed episode citations.
- Add a source-item review/search flow and station source selection.
- Confirm no code retrieves article/page URLs.

### Targeted evidence

- RSS 2.0 and Atom fixture servers cover 200, ETag, Last-Modified, 304, changed entries, duplicate identity, and restart.
- Security fixtures cover oversized/slow/malformed feeds, redirect loops, redirect-to-private/link-local/metadata destinations, unsafe item links, and concurrent sync attempts.
- FTS tests cover insert/update/delete, ranking, punctuation, migration rebuild, backup fixture, and restart.
- Historical citation test refreshes and deletes an original source while an earlier episode remains unchanged.
- A station with selected and unselected feeds proves only selected feed URLs are requested and only their items enter the evidence snapshot.

### Rows closed by this slice

`SRC-01`, `SRC-03` through `SRC-06`, `STN-01`, `STN-03`, `GEN-02`, `SEC-01`, and `ARC-05`. This slice advances `GRD-04`, `DATA-04`, `SEC-02`, and `SEC-06`; backup/restore and cross-product security evidence keep those rows open until Slice 6.

### Checkpoint

Suggested commit: `feat(prototype): harden feed ingestion and search`

## Slice 3 — Brief/deep modes, citations, library, progress, failure, and retry UX

### Outcome

Both episode modes are usable and honestly grounded. The library makes progress, transcript evidence, safe failures, and retry behavior clear and accessible.

### Work

- Add brief/deep selection, persisted mode, prompt budgets, and material-sufficiency rules.
- Strengthen atomic claim/support validation, structured semantic-support fixtures, and resolved citation UI.
- Finish durable episode URLs, list filters/statuses, progress phase details, failure panels, and manual retry.
- Classify failures by safe stable code and retryability; never place raw provider errors in summaries.
- Make retry use the same immutable snapshot for provider/TTS failures and require a fresh generation action when inputs are insufficient.
- Complete actual audio transport controls, errors, download, speed, seeking, and transcript synchronization where useful.
- Add keyboard, live-region, focus, responsive, and reduced-motion coverage for every flow touched.

### Targeted evidence

- Deterministic fixtures prove brief/deep word budgets, deep > brief for adequate identical evidence, and deep insufficiency failure for sparse evidence.
- Invalid JSON, unknown citations, uncited substantive sections, prompt injection, and unsupported-claim fixtures never complete.
- Injected retryable failures at every phase show safe UI detail, one new attempt, no duplicates, and successful recovery.
- Browser restart and server restart retain exact progress/failure/library state.

### Rows closed by this slice

`GEN-03` through `GEN-05`, `GRD-01` through `GRD-03`, `GRD-05`, `LIB-01` through `LIB-04`, `JOB-04`, `MEDIA-01`, and `ARC-04`. Accessibility, prompt-isolation, and safe-error evidence for all flows implemented so far is mandatory for this checkpoint, but the cross-product `A11Y-*`, `SEC-03`, and `SEC-07` rows remain open for their later listed evidence.

### Checkpoint

Suggested commit: `feat(prototype): finish grounded episode workflow`

## Slice 4 — Private RSS delivery, byte-range MP3s, and real podcast clients

### Entry requirements

- O-001 and O-004 are resolved.
- The operator has supplied the podcast token through server-side configuration.
- The operator has confirmed that the Caddy access-log policy does not retain tokenized feed/enclosure paths.
- Any Caddy change is performed or explicitly authorized by the operator, not inferred by an agent.

### Outcome

The one private feed validates, imports into an approved real client on the trusted LAN, refreshes, downloads/streams a real episode, and seeks through byte ranges.

### Work

- Implement one RSS 2.0 podcast feed of completed immutable episodes and standard podcast metadata.
- Implement at least 256-bit CSPRNG path-token validation for feed and enclosure routes, weak/default-token rejection, constant-time digest comparison, identical generic no-store invalid-token responses, rotation behavior, and redaction.
- Generate absolute enclosure URLs only from validated `PUBLIC_BASE_URL`.
- Implement `GET`/`HEAD`, validators, exact lengths, single byte ranges, suffix/open-ended ranges, `416`, and a documented multi-range policy.
- Make browser media and tokenized enclosure routes share validated storage logic without permitting path traversal.
- Add feed URL copy/setup UX without exposing the token through general settings APIs or logs.
- Exercise the actual client over the operator’s Caddy HTTPS origin; use a local-only subscription client or record explicit operator acceptance of vendor-cloud token exposure plus rotation guidance.

### Targeted evidence

- XML parser/validator tests assert RSS namespaces, GUID/date/enclosure correctness and completed-only ordering.
- Missing, default, weak, malformed, wrong, and rotated token tests cover both feed and media and assert indistinguishable status/body/cache policy.
- Byte-exact integration tests cover full, HEAD, bounded, open-ended, suffix, unsatisfiable, and multi-range policy.
- Real-client evidence records client/version, add/refresh result, streamed/downloaded checksum, and seek behavior.

### Rows closed by this slice

`MEDIA-02`, `MEDIA-03`, `POD-01` through `POD-04`, and `DEP-01`. This slice advances `MEDIA-04`, `DEP-02`, `SEC-04`, `SEC-05`, `PRIV-02`, and the accessibility rows; their cross-product or hardening evidence keeps them open until Slice 6.

### Checkpoint

Suggested commit: `feat(prototype): deliver private podcast feed`

## Slice 5 — Episode-grounded follow-up chat

### Outcome

The user can ask questions from a completed episode and receive persisted, cited answers based only on that episode’s immutable transcript and source snapshots, with honest refusals outside the evidence.

### Work

- Require a completed episode and build all grounding context server-side.
- Remove/reject arbitrary client context.
- Add bounded chat provider schemas, citation validation, prompt-injection isolation, refusal behavior, safe failures, and persistence.
- Add accessible chat UI, suggested-question actions, pending/error/retry state, citation resolution, and history.
- Ensure chat invokes no search/tools and survives original source deletion plus restart.

### Targeted evidence

- Tests cover unknown/incomplete episode, arbitrary client context, source deletion, unsupported question, prompt injection, malformed answer, unknown citation, timeout, retry, and restart.
- A live minimal question has source-grounded answer evidence; a deliberately unsupported question produces a refusal.

### Rows closed by this slice

`CHAT-01` through `CHAT-05`, `PROV-05`, and `SEC-03`. Grounding, prompt-isolation, bounds, safe-error, and accessibility evidence for chat is mandatory, while the other cross-product `SEC-*` and all `A11Y-*` rows close in Slice 6.

### Checkpoint

Suggested commit: `feat(prototype): add grounded episode chat`

## Slice 6 — Provider parity, accessibility, security, recovery, backup/restore, and deployment hardening

### Entry requirements

- Any optional Piper live verification requires O-003 and explicit download/install authorization. Deterministic Piper adapter contracts do not.
- Any final Caddy/deployment action has explicit authorization.

### Outcome

Every provider path has honest status and contract evidence; the deployment is recoverable, accessible, private, bounded, and ready for sustained trusted-LAN use.

### Work

- Complete distinct Ollama and LM Studio OpenAI-compatible configurations and deterministic contracts; run live-local probes only when already configured and authorized.
- Add Piper speech execution, resource bounds, voice/model verification, safe subprocess invocation, MP3 normalization, deterministic fake-executable contracts, and status. Run a real model only when configured and authorized.
- Remove leftover unsupported Gemini/ElevenLabs/Web Speech/local-file/Gmail/Calendar/scheduling code and unused dependencies/artifacts when safe; their production UI/config surfaces were already removed in Slice 0.
- Complete CSP/security headers, same-origin/Host/proxy validation, redacted structured logs, rate/resource bounds, image hardening, and graceful process behavior.
- Re-prove zero browser third-party egress across the completed application.
- Complete WCAG 2.2 AA review across themes, zoom, mobile layout, keyboard flows, focus management, live regions, and real media controls.
- Implement consistent backup/manifest and safe restore into a new target; reconcile database, FTS, media, jobs, citations, chat, and feed identity.
- Add production volume/readiness checks, media/database reconciliation, shutdown-drain tests, and operator runbooks.
- Run failure injection for process crash, provider outage, disk full/read-only, missing media, corrupt backup, unavailable model, and Caddy-origin misconfiguration.
- Resolve or explicitly accept every release-blocking open decision and residual risk; optional live-provider inputs may remain open with an honest non-live status.

### Targeted evidence

- All text/speech adapters pass the same deterministic contract suite and show an honest required status.
- Deterministic adapter contracts close Ollama, LM Studio, and Piper support rows at `CONTRACT TESTED ONLY`; authorized configured probes may upgrade a deployment to `LIVE VERIFIED` but are not required for release.
- Axe/keyboard/contrast/zoom/reduced-motion gates pass across all core routes and themes.
- Backup/restore drill recreates a clean deployment with matching DB integrity, FTS results, episode/chat data, feed identity, and MP3 checksums.
- Production image and network inspection prove non-root runtime, declared volumes, one origin, one worker, no direct LAN port, no secrets/data/caches in the image, and no mock path.

### Rows closed by this slice

`ID-01`, `TRUST-01`, `GRD-04`, `TXT-02` through `TXT-04`, `TTS-02`, `TTS-04`, `PROV-03`, `DATA-02` through `DATA-04`, `JOB-03`, `JOB-05`, `MEDIA-04`, `DEP-02` through `DEP-04`, all still-open `SEC-*` and `PRIV-*` rows, `OPS-01` through `OPS-04`, all `A11Y-*` rows, the still-open `ARC-*` rows, and `NG-01` through `NG-14`. The final gate reruns every non-deferred matrix row, including requirements closed in earlier slices.

## Final phase gate

This is Slice 6's full phase gate and must complete before its checkpoint commit. The clean-tree assertion is the one post-commit confirmation; a failure there reopens the checkpoint. Matrix rows whose slice is `final` close only here.

The prototype is review-ready only when:

- `npm run verify` passes from a clean checkout with credential-free fixtures;
- the production image builds and Compose smoke passes with temporary persisted volumes;
- required live provider evidence is current and redacted;
- the approved real podcast-client workflow passes through the operator’s Caddy origin;
- backup/restore proof passes;
- `TEST_MATRIX.md` contains no unexplained required gaps;
- `STATE.md` records exact commands/results, resolved decisions, residual risks, and the final checkpoint;
- Git is clean after the final green checkpoint.

### Checkpoint

Suggested commit: `feat(prototype): harden local production release`

Never push, merge, deploy, tag, or modify Caddy as part of this plan without separate authorization.
