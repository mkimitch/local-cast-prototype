# LocalCast autonomous build plan

Status: Slice 4 remains green; Slice 5 is complete 2026-08-21; Slice 6A–6D deterministic checkpoints, Daily Driver 1A, the station evidence-selection repair, the provider-status restart repair, and the generation validation/status repair are complete 2026-10-08
Current slice: **PROVIDER-STATUS RESTART REPAIR COMPLETE; REMAINING OPERATIONAL SLICE 6 GATES OPEN**
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

The representative 78.912-second sample was the only live episode generated in this slice. The operator approved it at checkpoint `1790e91f1b37d518b18f4834b59cb7d9ba160823` as the functional single-host baseline, with `marin` acceptable for prototype use but not the preferred final audio identity. No longer live episode was generated in Slice 2.

## Slice 2 — RSS/Atom ingestion, deduplication, conditional fetching, and FTS5 — COMPLETE 2026-08-06

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

## Slice 3 — Brief/deep modes, citations, library, progress, failure, and retry UX — COMPLETE 2026-08-06

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

OpenAI's per-request speech input bound requires long single-host narrations to be rendered as bounded transport chunks and assembled into one validated MP3. This is an implementation detail of the approved single-host format, not dialogue generation, multiple voices, per-turn production, crossfades, or the deferred two-host milestone.

### Targeted evidence

- Deterministic fixtures prove brief/deep word budgets, deep > brief for adequate identical evidence, and deep insufficiency failure for sparse evidence.
- Invalid JSON, unknown citations, uncited substantive sections, prompt injection, and unsupported-claim fixtures never complete.
- Injected retryable failures at every phase show safe UI detail, one new attempt, no duplicates, and successful recovery.
- Browser restart and server restart retain exact progress/failure/library state.

### Rows closed by this slice

`GEN-03` through `GEN-05`, `GRD-01` through `GRD-03`, `GRD-05`, `LIB-01` through `LIB-04`, `JOB-04`, `MEDIA-01`, and `ARC-04`. Accessibility, prompt-isolation, and safe-error evidence for all flows implemented so far is mandatory for this checkpoint, but the cross-product `A11Y-*`, `SEC-03`, and `SEC-07` rows remain open for their later listed evidence.

### Checkpoint

Suggested commit: `feat(prototype): finish grounded episode workflow`

## Slice 4 — Private RSS delivery, byte-range MP3s, and real podcast clients — COMPLETE 2026-08-06

### Entry requirements

- O-001 and O-004 are resolved.
- The operator has supplied the podcast token through server-side configuration.
- The operator has confirmed that the Caddy access-log policy does not retain tokenized feed/enclosure paths.
- Any Caddy change is performed or explicitly authorized by the operator, not inferred by an agent.

### Outcome

The one private feed validates, imports into an approved real client on the trusted LAN, refreshes, downloads/streams a real episode, and seeks through byte ranges.

Deterministic tests, the authorized Caddy attachment, HTTPS/TLS health, real persisted enclosure delivery, app/worker recreation, and fresh-canary zero-retention checks are green. The operator attests that gPodder 3.11.5 Portable passed add, refresh, download/play, seek, restart, refresh, and replay with a downloaded SHA-256 exactly matching LocalCast persistence and no `*.log` file found in the client configuration. After that manual gate, a separately authorized mount-only remediation moved the canonical Caddyfile to `/opt/stacks/caddy/conf/Caddyfile`, recreated only Caddy, and re-proved configuration, route, TLS, certificate, persistence, and zero-retention equivalence.

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

## Slice 5 — Episode-grounded follow-up chat — COMPLETE 2026-08-21

Repository implementation and deterministic synthetic evidence are present. O-006 completed the protected backup, migration 008, deployment, loopback-health, and controlled-restart gate on 2026-08-21. O-005 then completed the separately authorized live supported-answer/refusal acceptance on the retained atomic synthetic fixture: the supported answer was grounded to `18 hours`, the refusal returned `EVIDENCE_INSUFFICIENT`, exactly three provider requests occurred, and there were no retries or duplicate dispatches. Final work was quiescent and the bound app/worker deployment remained healthy. Slice 6A subsequently began the deterministic provider-parity checkpoint only; it does not claim the remaining Slice 6 gates.

### Outcome

The user can ask questions from a completed episode and receive persisted, cited answers based only on that episode’s immutable transcript and source snapshots, with honest refusals outside the evidence.

### Work

- Require a completed episode and build all grounding context server-side.
- Remove/reject arbitrary client context.
- Add bounded chat provider schemas, citation validation, prompt-injection isolation, refusal behavior, safe failures, and persistence. Pin chat independently to `gpt-5.4-mini-2026-03-17`; reject any other chat model; serialize and cap each complete provider request body at 131,072 UTF-8 bytes before fetch; retain the existing 2,500-token draft and 750-token support ceilings.
- Limit a supported answer to two provider calls per claimed attempt, a refusal ordinarily to one, and every turn to an initial attempt plus one explicit retry. Reserve each draft/support stage transactionally under a current lease before entering its provider-adapter method. A runtime-validated native SQLite store must commit the stage row before it registers the mandatory process-private one-use grant bound to the exact episode/turn/attempt/stage/worker/row and row-scoped lifecycle operations; a crash between commit and registration leaves the slot consumed. No exported issuer, structural database substitute, no-op observer, or unrestricted lifecycle mutator may manufacture execution authority. A reserved stage with an unconfirmed outcome or finalization is non-retryable; permit the one explicit retry only after a pre-dispatch/no-reservation failure, a safely finalized retryable provider result, or stale recovery after all existing stages finalized and before any next stage/publication, with durable proof that no provider work remains unresolved or in flight. Persist only bounded lifecycle, usage, and provider-identifier metadata, and require exact finalized rows for publication.
- Add accessible chat UI, suggested-question actions, pending/error/retry state, citation resolution, and history. Reconcile lost submission/retry responses only when durable history proves that exact submission key or accepted retry turn/key/attempt identity. One empty authoritative response does not prove rejection: retain a minimal non-content action identity in same-origin shared storage, continue a bounded exact-identity check across polling/reload/tabs, then remain safely blocked for manual reconciliation if still uncertain. Give every effect lifetime a fresh epoch and fence every mutation, automatic/manual history fetch, timer, cache write, persistent-record change, focus/status change, and lock change by that epoch, exact action generation, and a shared monotonic history-response generation. Migration 008 must keep one authoritative episode lock for queued/running turns and for every unpublished failed turn containing any provider-call lifecycle row, including a finalized row. Its ordinary-DML integrity triggers must release only an exact answer/refusal publication whose current and prior attempt/lifecycle history is complete and compatible, or a zero-provider terminal failure; reject conflict-resolution replacement paths before retained rows can be displaced; preserve lifecycle evidence against reparenting/deletion while parent history remains; and allow only production lifecycle transitions. Concurrent distinct-key tabs have one transaction winner even when browser coordination races; same-key replay remains idempotent, an eligible explicit retry stays on the locked turn, and a new sequential question is allowed only after exact publication or a provable terminal failure before provider reservation.
- Ensure chat invokes no search/tools and survives original source deletion plus restart.
- Isolate API and production smokes with explicit child-environment allowlists, temporary credential-free storage roots, absolute entry paths, and loopback-only ephemeral listeners. Production children use temporary working directories so dotenv cannot discover the repository `.env`; API children use the repository working directory only with entrypoints that do not load dotenv.

### Targeted evidence

- Tests cover unknown/incomplete episode, arbitrary client context, original-note deletion, unsupported question, prompt injection, malformed answer, unknown citation, draft/support body boundaries, Unicode/escaping overhead, NUL/lone-surrogate rejection, timeout, ambiguous outcomes, one-retry/two-attempt caps, native-SQLite commit-before-adapter authorization, strict lifecycle-required publication, stale `reserved` and `response_received` recovery, episode locking after every unpublished provider-using failure including finalized rejection/validation outcomes, bounded usage metadata, simultaneous retry contention, retry-versus-new-question contention, first-empty-history exact UI reconciliation, real development StrictMode replay, stale success/failure history ordering, unmount/remount callback fencing, malformed shared-record recovery, advisory same-origin tab coordination, independently stored two-client contention with authoritative convergence, transactional distinct-key initial contention, and app/worker/browser restart.
- Deterministic tests prove source-grounded answer and deliberately unsupported refusal behavior without an external network request. Smoke regression evidence proves parent credentials, root `.env`, and external secret paths cannot cross into child processes. The separately authorized live minimal supported/refusal evidence is complete as recorded in `STATE.md` and `TEST_MATRIX.md`.

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

### Slice 6A — provider parity checkpoint — COMPLETE 2026-08-21

This bounded checkpoint closes only `TXT-02` through `TXT-04`, `TTS-02`, and `PROV-03` with deterministic contract evidence. It also advances Piper’s atomic-publication evidence. It adds no migration, backup/restore behavior, accessibility expansion, Docker/Compose hardening, deployment operation, or live provider probe. All remaining Slice 6 work and its final phase gate stay open.

### Slice 6B — versioned backup and safe restore checkpoint — COMPLETE 2026-08-21

This bounded checkpoint closes `OPS-01` through `OPS-04` with synthetic, isolated evidence. It adds manual `backup:create` and `backup:restore` commands for a canonical version-1 artifact containing a SQLite backup-API snapshot, only referenced published media, categorical validation, and a SHA-256 chain. Restore verifies the complete artifact before mutation and publishes only into absent or explicitly empty targets, then revalidates schema, integrity, foreign keys, identity cardinality, quiescence, FTS, relationships, media, feed, jobs, citations, and chat. Credentials, tokens, environment files, raw provider payloads, logs, source/build output, and unrelated media are outside the allowlisted artifact; restored provider status remains `NOT CONFIGURED` until external configuration is supplied.

No schema migration, production backup, production restore, Docker/Compose action, provider/network request, retention/deletion automation, or encryption feature is part of 6B. Accessibility expansion, security/deployment hardening, live provider evidence, and the full Slice 6 phase gate remain open.

### Slice 6C — accessibility expansion checkpoint — COMPLETE 2026-08-22

This bounded checkpoint adds semantic destructive confirmations, route-heading focus after keyboard navigation, contrast and reflow corrections, and deterministic browser coverage for all five core routes in light, dark, and high-contrast themes. The coverage includes keyboard skip and route navigation, dialog focus trapping and restoration, status/focus behavior, 320 CSS-pixel layout at 200% text size, reduced motion, and existing real-media keyboard controls. It closes deterministic evidence for `A11Y-02` through `A11Y-05` and advances `A11Y-01` to automated green evidence. A human screen-reader spot check remains operator-attested and keeps `A11Y-01` partially open; all security, deployment, live-provider, and full Slice 6 phase gates remain open.

### Slice 6D — deterministic security, privacy, and failure-injection checkpoint — COMPLETE 2026-08-23

This bounded checkpoint closes the source-testable gaps in mixed-provider disclosure, HTTP security headers and parser ordering, provider/Piper bounds, media validation amplification, generation lease expiry, storage path/link safety, backup publication/FTS/relationship validation, exact cleanup scope, cloud-metadata SSRF denial, browser first-party-only loading, honest trusted-LAN/backup copy, and non-goal dependency/import regression. All fixtures are synthetic and all network listeners are loopback test processes; no provider, production data, Docker, Compose, Caddy, image, backup evidence, or external system was accessed or changed.

This checkpoint intentionally does not close `A11Y-01`, operational `DEP-02`/`DEP-03`/`ARC-07` evidence, live provider checks, real capacity/read-only/corruption drills, or non-cooperative Compose shutdown. Durable generation pre-dispatch ambiguity fencing, deterministic pre-existing audio byte identity, and crash-atomic two-target restore publication require separately authorized designs; no migration or topology change is introduced here. Slice 6 as a whole therefore remains open.

## Daily Driver 1A — OpenAI credential replacement — COMPLETE 2026-09-29

This bounded product checkpoint adds a dedicated Settings surface for replacing and explicitly testing the OpenAI API key. It stores the managed credential in a private file in the existing persisted data volume, resolves it ahead of the compatible worker environment fallback for each new generation job and chat turn, and projects only configured state plus an optional final-four hint. The fixed-origin authenticated connection test performs model metadata retrieval only and updates the existing provider-status lifecycle; it never runs automatically or mutates LocalCast content.

Deterministic evidence covers atomic mode-`0600` persistence, unsafe-file rejection, precedence without environment copying, app/worker runtime refresh without restart, response/log/status/browser redaction, bounded error classification, provider-status fingerprint invalidation, backup exclusion, keyboard dialog focus/restoration, live-region feedback, and full retained gates. No production credential, provider endpoint, deployment, Compose/Caddy state, database schema, dependency, fixture-retirement item, or user content is changed by this checkpoint.

## Station evidence-selection repair — COMPLETE 2026-09-30

This bounded maintenance checkpoint restores visible native checkboxes and explicit label associations for pasted-note and RSS/Atom station selections. It preserves controlled React state and the existing transactional station join persistence, adds an obvious selected-card state and visible focus treatment, and explains why an inactive or invalid-URL feed is unavailable. A previously selected unavailable feed remains enabled so the operator can remove it.

Deterministic browser evidence covers control click, text-label click, Space activation, multiple notes, multiple active feeds, mixed selections, save/reload/edit restoration, category-preserving deselection, disabled-state reasoning, and accessible labels. Integration evidence covers exact mixed join persistence and removal. No schema migration, dependency, provider request, production data mutation, deployment, Compose/Caddy action, or citation-validation change is part of this repair.

## Provider-status restart repair — COMPLETE 2026-10-05

This bounded maintenance checkpoint replaces startup's last-writer-wins provider-status write with evidence precedence. App status loading remains read-only. Worker startup still runs deterministic configuration reconciliation, but its conditional upsert preserves a same-descriptor `LIVE VERIFIED` or contract-only row and overwrites only absent, stale, or categorically weaker state. Explicit live success/failure and existing missing-credential deletion remain authoritative.

Deterministic regressions reproduce the deployment failure as persisted OpenAI text/speech `LIVE VERIFIED` rows followed by repeated real worker-construction reconciliation, with exact row equality and zero network calls. Additional coverage proves app-startup preservation, credential replacement/fingerprint mismatch, missing/unsafe credential invalidation, model/voice/local configuration invalidation, contract/failure-reason idempotence, successful explicit promotion, and capability-scoped Ollama, LM Studio, Piper, and mixed-provider behavior. No schema, dependency, station, health-route, citation, fixture, Compose/Caddy, volume, credential, provider-request, production-data, build-image, or deployment change is part of this repair.

## Generation citation/status classification repair — COMPLETE 2026-10-08

The generation contract now makes the existing per-factual-segment unique-`snapshotId` invariant explicit in OpenAI and OpenAI-compatible prompts and in the strict OpenAI schema. It directs one strongest verbatim excerpt per source, distinct IDs for independent sources, and atomic segment splitting instead of duplicate IDs. Validation remains fail-closed and does not deduplicate or weaken excerpt/support checks; the user-safe duplicate message now covers mixed duplicate arrays accurately.

Generation errors now carry an explicit provider-status impact. Only provider/capability failures downgrade verification; citation/excerpt/support validation and local persistence/media/publication failures preserve still-applicable evidence. Deterministic tests cover repeated validation failures, excerpt membership, semantic support, local persistence/media failure, provider authentication/protocol failure, existing fingerprint invalidation, local/mixed provider behavior, and zero startup/live network use. No schema, dependency, station, evidence construction, credential storage, restart-preservation, health, TTS/publication behavior, fixture, Compose/Caddy, volume, production-data, or deployment change is part of this repair.

## First post-prototype audio milestone — deferred two-host format

This milestone begins only after the currently defined prototype and must preserve the green single-host path. `Sol` is a qualitative benchmark only: it is not assumed to be an API voice and must not be imitated or treated as a dependency.

The milestone covers a source-grounded outline and fact ledger before dialogue; restrained dialogue without invented anecdotes, fake experiences, or manufactured disagreement; two configurable voice profiles; ordered bounded turns; per-turn TTS caching, provenance, and retry; deterministic pauses, stitching, and loudness normalization; speaker-labelled transcripts and per-turn citations; and listening-quality comparisons with the single-host format.

When current slices naturally touch script/transcript boundaries, backwards-compatible versioned ordered segments may carry stable segment ID, text, citation IDs, and optional speaker-role/voice-profile fields. The current format remains one `host`; optional speaker labels must not require a broad migration or weaken the walking skeleton. Slice 6 media hardening measures delivered loudness and documents a podcast-compatible normalization target, using the approved sample’s approximately `-22.7 LUFS` integrated and `-5.2 dBFS` true peak as baseline evidence rather than a Slice 2 prerequisite.

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
