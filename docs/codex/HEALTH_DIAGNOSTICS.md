# Recurring readiness failure — October 8, 2026

## Observed production evidence

Production remained on revision `e8a115423fc58eeea06063306dad070a0393ad67`, image `sha256:4e4b8776d22780c3e485465a677b924ffd67bae648e3ceae4dc41b68c14db8d4`. The app was running/unhealthy, the worker healthy. The final read-only check at approximately `2026-10-09T03:04Z` still returned HTTP 503 with `{ok:false,service:"local-cast-api",code:"NOT_READY"}` and reported 51,936 consecutive failed probes. App/worker start times remained October 7 at 17:34:58Z / 20:21:24Z; restart counts remained zero.

Earlier interleaved app-local requests returned health 503 in 5–24 ms while `/api/settings`, `/api/sources`, and `/api/materials` returned 200 in 2–5 ms. Settings successfully used the same provider-summary service as health. Provider state was text `CONTRACT TESTED ONLY`, speech `LIVE VERIFIED`; this investigation did not change it.

A separate better-sqlite3 connection was opened with `readonly:true`, `fileMustExist:true`, and `query_only=ON`. It reported SQLite 3.53.2, FTS5 enabled, one `quick_check=ok` row, zero foreign-key violations, and exactly the eight ordered migrations ending in `008_episode_grounded_chat`. Generation had zero queued/running jobs; chat had only answered/failed/refused rows. No writable application database initializer, migration, checkpoint, journal-mode change, or repair operation was invoked.

Media read/write permission checks passed without creating a file. There were roughly 20.4 GB and 3.29 million inodes available. App descriptors for SQLite, WAL, and SHM pointed to the current mounted file inodes and none were deleted. Database/WAL/SHM sizes were 688,128 / 943,512 / 32,768 bytes. The managed credential was only inspected for regular-file status, nonempty length, single link, and private `0600` mode; its contents were not read.

The main Node listener remained present with 22 descriptors, 11 threads, low CPU, and no finite container memory/PID cap. Host memory remained available. The inspected app log contained only two startup lines; it contained no recorded readiness exception, SQLite code, credential-store error, or filesystem/resource error. The deployed bundle confirmed the bare health-handler catch discards the exception.

**Root cause: unresolved.** The evidence rules out neither a connection-specific audit failure nor an intermittent check failure inside the original process. A passing new read-only connection does not prove the long-lived app connection passes its audit. SQLite corruption, credentials, media permissions, and resource exhaustion were not established as causes. No debugger was attached and no restart was used to clear evidence.

## Exact execution and connection lifecycle

1. `inspectDatabaseHealth(db)` prepares/executes `sqlite_version`, FTS5 compile-option, `quick_check`, `foreign_key_check`, and ordered migration queries. Preparation, execution, result access, and assertions can throw. After all queries it asserts FTS5, quick-check, zero FK violations, and exact migration identity/order/count.
2. `fs.accessSync(mediaPath, R_OK | W_OK)` checks media permissions and may throw a system error.
3. Response timestamp creation runs before provider summary and can throw; runtime-mode/property access is ordinary local state.
4. `openAiCredentialService.providerSummary` resolves the managed/fallback credential, computes provider descriptors/fingerprints, and reads provider-check rows. Its internal catch retries a summary without the key; that fallback can still throw. No live provider request is made.
5. `res.json` constructs/serializes/writes the response and may throw. The existing catch sends the generic 503 JSON; failure of that error-response write itself is outside the original catch's protection.

The app opens one module-level better-sqlite3 connection at startup, configures foreign keys, a 5-second busy timeout and WAL, validates storage/identity/schema, and retains it until shutdown/listener failure. Health, source/settings/material stores and provider-check reads share that connection. Health prepares its own statements and wraps no transaction. Ordinary synchronous store transactions run on this same connection but cannot asynchronously interleave inside the synchronous health callback. The worker has a separate process/connection sharing WAL storage. A separate `docker exec` read-only audit cannot reveal the main process's connection/transaction internals.

## Diagnostic checkpoint

`8c3467c9a348608d39289eaa462f3d0af3608f6e` — `fix(health): log safe readiness failure stages`

Only the health route, a pure diagnostic helper, and two new test files are in this commit. All readiness checks, check order, successful response fields and the public 503 response remain unchanged. Stages are `database_audit`, `media_access`, `provider_summary`, and `response`. Fixed classifications distinguish the four known audit assertions, recognized SQLite/system codes, and generic error categories. Exception names, messages, stacks, SQL, arbitrary codes, private paths, settings, keys and tokens are never serialized.

Example format only; **this is not an observed production cause**:

```json
{"event":"health_not_ready","stage":"database_audit","classification":"sqlite","code":"SQLITE_BUSY_SNAPSHOT","suppressed":29}
{"event":"health_recovered","previousStage":"database_audit","suppressed":3}
```

A process-local monotonic timer admits at most one failure entry per minute across all stages, plus one recovery for a reported incident. Keeping the limit across recovery prevents rapid flapping from flooding logs. Suppressed probe totals are reported. Sink/clock/classification failures are contained. Docker's existing log timestamps provide wall-clock correlation.

## Validation

Final October 8 local / October 9 UTC evidence: TypeScript no-emit passed; 310 unit tests passed, including 16 diagnostic cases; all 108 integration tests passed, including six health HTTP cases; server bundles built; isolated API/worker and production same-origin smokes passed. All provider interactions were deterministic fixtures. No browser component changed, and no browser run was needed. Independent read-only review found an incomplete extended SQLite-code allowlist; it was completed and re-reviewed with no remaining finding. Initial typecheck caught an incomplete provider-summary test fixture; adding its required safe adapter/reason fields resolved it. Schema, dependencies, deployment files and prior feature implementations are unchanged.

## Separate deployment strategy — recommendation only

The diagnostic commit's complete patch was checked with `git apply --cached --check` against `e8a1154` in a disposable alternate index. It applies without the citation/provider commits. For a later separately authorized rollout, create an isolated branch/worktree from exactly `e8a1154` and cherry-pick **only** `8c3467c`; verify that its diff contains just these four health/test files. Do not deploy the feature branch HEAD if the intent is diagnostics only. This document and ledger updates are a separate documentation checkpoint.

Because existing readiness is already failing, an operator must explicitly authorize a diagnostic maintenance rollout with that known failed preflight. Record the 503 as failed, then independently verify ordinary read APIs, process/listener state, read-only schema/integrity/FK checks, storage access, quiescence, credential metadata and provider-state baseline. Require a protected validated current-state snapshot including managed credentials, and retain the exact baseline image. If independent checks fail materially, stop. Build/smoke only the baseline-plus-diagnostic image against disposable storage before replacing only the app; the worker has no changed behavior and need not be restarted. No health assertion or Docker health configuration should be bypassed or weakened.

The purpose of that rollout is to capture the failing stage/code, not to declare the original defect fixed. If recreation clears the symptom, record that fact and retain diagnostics for recurrence; recovery alone does not establish a root cause. If 503 persists while independent checks remain healthy, read the bounded diagnostic log under the explicitly accepted maintenance condition. For new material regressions, revert the app image while preserving current volumes. No such rollout, build image, snapshot, restart, or rollback occurred in this investigation.
