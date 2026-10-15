# Generation trace and offline replay

This is an opt-in local diagnostic for one attempt, including rejected attempts. It does not enable generation, relax validation, retry a request, or expose an HTTP endpoint. The implementation has not been deployed. Use the production commands below only after a separately authorized deployment of this checkpoint. Do not restart the currently unhealthy application to use it.

## October 15 inventory (read-only)

The inspected image was `sha256:d9b7e4a846c26a14e44e0decf6f4a568b62df113fe682c3fe6eab2c5fcf739c9`. App/worker started at 11:00:20.844 / 11:00:21.027 UTC. Worker configuration selected OpenAI, `gpt-5.4-mini`, low reasoning. The generation adapter uses that same model and low reasoning for support; this is configuration/code evidence, not a retained HTTP request proving historical dispatch details.

Morning Signal's immutable request is `request-dc209a63-6995-485c-9a67-409e19dde080`, run `run-653438fc-37f5-4942-a07d-c6de151bc836`, job `job-05a066a9-0b8d-42e7-b552-8ef6962f6650`, attempt `attempt-83a53efe-8c87-4586-87a5-f8af74a1ce9c` (attempt 1). Station revision 9 requested Brief/Compact; request hash is `3a59d95edbb146b4096cea80dfc4e047539341d4aa85653929e480c1bbb0dc72`. Direction length is 3,485 characters. The request selected one feed source; 50 immutable evidence rows retain 49 public feed items (6,670 body characters total) and one user-supplied note (169 characters). Source bodies, private direction, and titles were not copied into this document.

| UTC time, October 15 | CDT | Durable event |
| --- | --- | --- |
| 11:50:42.402 | 06:50:42.402 | queued, explicit user action |
| 11:50:42.595 | 06:50:42.595 | attempt 1 claimed, syncing |
| 11:50:43.091 | 06:50:43.091 | selecting |
| 11:50:43.101 | 06:50:43.101 | drafting |
| 11:50:48.724 | 06:50:48.724 | validating |
| 11:50:53.495 | 06:50:53.495 | failed, `UNSUPPORTED_GENERATED_CLAIM` |

The terminal event retains exactly `stage=semantic_support`, `category=unsupported_claims`, `rejectedCount=6`. The job is nonretryable, with one attempt. There are zero briefing sections, transcript claims, episode citations, and audio assets for this run. Failed-run text-provider/model fields are null because publication never occurred.

The precise path is `ConfiguredGenerationProcessor.process` → `OpenAiTextProvider.generateEpisode` → JSON extraction/schema → `resolveEvidenceReferences` → canonical section/disclosure transformation → `assertGeneratedEpisode` (citation membership and length) → support request → strict support schema → map verdicts by claim ID. Any count/identity mismatch or any claim whose mapped status is not `supported` throws this error. Six means six expected claims had a missing or non-supported mapped verdict. It does **not** identify which claims, distinguish missing from uncertain/unsupported, establish the total claim count, or explain why. The configured classifier receives each factual claim and its cited exact excerpts, not the complete evidence bodies, and is told to accept only complete direct support without outside knowledge. Its schema requests only claim ID/status, no explanations. The support classifier is another model request, not a deterministic entailment engine.

Reaching this error establishes that earlier structured parsing, Architecture B resolution, canonical membership, evidence sufficiency, and length gates passed. It does not establish factual correctness. TTS/publication were not reached.

### Existing data lifecycle and recovery boundary

| Artifact | Existing lifecycle before this patch |
| --- | --- |
| Station/request revision, direction, requested mode/preset/hash | Durable `generation_requests` snapshot |
| Selected notes and selected feed identities | Durable `generation_request_notes` / `generation_request_sources` |
| Frozen evidence bodies, identities, hashes, order | Durable `episode_evidence_snapshots`; independent of later source edits |
| Job, attempt, phase times and safe failure count | Durable `generation_jobs`, `generation_attempts`, `generation_job_events` |
| Exact HTTP prompts/body, response/request IDs, usage on rejection | Ephemeral adapter variables, not generation audit rows |
| Raw draft, parsed draft, catalog, resolved claims, narration | Ephemeral adapter variables until validation succeeds |
| Support request, raw response, per-claim verdict | Ephemeral adapter variables; discarded on rejection |
| Accepted transcript/citations/audio | Published transaction only after validation and speech; absent here |

The inspected data-volume root contained only SQLite, WAL and SHM files (hidden credential storage was not read). Worker `/tmp` was empty; the failure-minute worker log had zero lines. Code inspection finds no generation raw-output write path. No retained rejected draft/support response was found in these application-owned stores. No heap dump, memory forensics, provider dashboard recovery, or search of unrelated private directories was attempted. Once those local variables are released, their contents cannot be recovered through supported application interfaces. Do not reconstruct them using another LLM or claim a regenerated catalog proves the original response.

### SQLite correlation, separate from output correctness

The first retained app `health_not_ready` log is **11:50:45.042 UTC / 06:50:45.042 CDT**, while the job was drafting, before the semantic rejection. It reports `database_audit`, `quick_check_failed`, `non_ok_result`, one row, expected column shape, `inTransaction=false`, `connectionReadonly=false`, duration 6.436 ms. Subsequent minute-rate logs have the same category, typically 28–29 suppressed probes. At the 14:13 UTC inspection there were 140 such events and no recovery event; a fresh app-local `/api/health` returned `503 {"ok":false,"service":"local-cast-api","code":"NOT_READY"}`. Worker health remained healthy (its healthcheck checks process/database existence, not this SQLite audit).

The user reported prior healthy readiness. The retained diagnostic logger emits failures and recovery, not every healthy probe; this inventory cannot timestamp the last `200` or independently prove the full earlier healthy interval. The first failure predates semantic rejection by approximately 8.45 seconds. Correlation is not causation.

A disposable, network-disabled container used the same immutable image with the production data volume mounted **read-only**, a new `better-sqlite3` connection opened with `readonly: true`, and `query_only=ON`. It returned canonical `quick_check=ok`, `integrity_check=ok`, zero foreign-key violations, migrations 001–009. This does not validate the app's existing connection. No production SQL writes, checkpoints, migrations, restart, or readiness changes were made. An initial read-only count query used a nonexistent `episode_citations.run_id`; it was corrected to join through `transcript_claims`, returning zero. No repair to production was attempted.

Proposed disposable reproduction: create a fresh temporary WAL database with migrations 001–009 and synthetic note/station data. Keep an app connection open across repeated health requests using the real health handler; open a separate worker connection and run real `GenerationJobStore` enqueue/claim/select/draft/validate/fail transitions through `GenerationWorker` and the configured processor with an injected deterministic HTTP response fixture that rejects semantic support. Probe readiness between each transition, after failure, and after a second explicit enqueue. Compare the long-lived connection's raw `quick_check` results (synthetic storage only) with a newly opened read-only connection, then `integrity_check` and FK checks. Run on the deployed image's Node/better-sqlite3 versions. Never mount production storage, contact a provider, or publish audio. A non-reproduction is useful evidence but does not resolve the production discrepancy. This work's integration fixtures exercise the actual job transitions; they are not a claim to reproduce the long-lived production connection defect.

## Enable exactly one future attempt

Build locally with `npm run build`. The CLI bundle imports filesystem and pure parsing/validation code; it does not load server configuration, credentials, database services, provider clients, speech, or publication code.

The worker looks only for `.generation-traces/armed.json` beside its configured SQLite file. There is no global capture environment switch. The arm names a station, expires after one hour, and is consumed by its next configured generation attempt, including a failed attempt. Other stations do not consume it. An arm does not enqueue or authorize a generation. At most ten unpurged captures can be armed sequentially.

For the current container layout, **after a separately authorized deployment**, run as the worker's normal user:

```bash
STATION_ID='replace-with-the-station-id'
docker exec localcast-slice1-listening-worker-1 node dist-server/generationTrace.js arm --root /var/lib/localcast/data/.generation-traces --station "$STATION_ID" --retention-hours 24
```

Then explicitly choose the desired generation in the existing UI. No live generation was initiated during this implementation. For a development worker, use its actual SQLite parent directory instead:

```bash
npm run generation:trace -- arm --root /absolute/data-parent/.generation-traces --station "$STATION_ID" --retention-hours 1
```

The private parent must already exist and must not be a web/media directory or a synchronized/cloud-backed directory. The trace root must be owned by the worker/CLI user, mode 0700, with no symlink path. Files use 0600. Credentials never enter the capture API as headers/configuration objects. Known configured provider keys, recognizable authentication fields/Bearer/OpenAI-key text, credential URL parameters, URL userinfo and podcast paths are redacted; redaction is explicitly flagged. Arbitrary secrets pasted into prose cannot be identified universally. Do not include credentials in source material. Sensitive content belongs only in this private local directory; never attach private captures to issues or commits.

## Inspect and replay locally

Use an OS filesystem listing to identify `trace-<uuid>.json`. For production-container captures, inspect/replay through `docker exec` with the corresponding path, or copy the capture into a local 0700 directory and set the copied file to 0600. Copies have their own retention responsibility. The normal podcast/feed/API never links or returns captures.

```bash
npm run generation:trace -- inspect /absolute/data-parent/.generation-traces/trace-UUID.json
npm run generation:trace -- replay /absolute/data-parent/.generation-traces/trace-UUID.json
```

`inspect` creates a sibling 0600 `.html` file, refusing to overwrite an existing file. Open that file directly in a local browser; do not serve it with an HTTP server. The report has no scripts or remote resources, escapes all source/model text, and enforces a deny-network CSP. It separates raw inputs/responses from parsed/transformed/derived artifacts; includes original generated text, full frozen sources, excerpts/offsets, ordered reference mapping, claim IDs/text/citations, original support verdict and rejected indices, gate failure, elapsed stage times, and observed TTS/publication stages.

`replay` prints a local JSON result (which can contain private narration/excerpts). It rebuilds the catalog from checksummed evidence; parses the original provider envelope with the shared adapter extraction function and schema; resolves references; validates canonical membership, structure and length. It uses **this checkout's rules**, not a virtualized historical build. It never calls a provider, synthesizes speech, publishes, opens SQLite, or changes application state. It displays the original support verdict only. A deterministic PASS is not semantic approval or authorization to publish. Exit 2 means deterministic rejection or unproven capture; exit 1 means invalid command/file/schema. A redacted/size-limited capture is unproven for exact replay.

## Bounds, retention, and failure semantics

Each artifact is capped at 2 MiB; the attempt JSON is capped at 8 MiB with at most 100 entries. Oversized artifacts are replaced by explicit omission markers, never silently truncated. HTML is capped at 32 MiB. Raw response capture follows the existing 256 KiB provider response bound; unavailable/oversized response streams cannot be retained exactly. For valid UTF-8 JSON, raw response text preserves whitespace before transformation; invalid byte sequences may be replaced by the existing UTF-8 decoder. No audio bytes or HTTP authorization headers are captured.

Retention is configurable from one minute to 24 hours, default 24 hours. The worker sweeps expired captures/reports/arms at the next idle poll, at most once per minute; an active attempt is allowed to finish. When the worker is stopped, automatic cleanup cannot run. Crash-left temporary or damaged files use a 24-hour fallback. A hard crash can leave status `running`; absent later artifacts do not prove later actions never occurred. Processor outcome is observed before the worker's separate failure-event write, not an independent proof that that write committed. Disk/permission capture failures emit only a fixed safe log code and do not weaken or fail generation validation. Use explicit purge for stopped workers, copied reports, or immediate removal:

```bash
npm run generation:trace -- purge --root /absolute/data-parent/.generation-traces
npm run generation:trace -- purge --root /absolute/data-parent/.generation-traces --all
```

The first removes expired captures, reports and arms. `--all` removes all recognized trace files and cancels the arm. It never deletes SQLite or media. Purge after an attempt has stopped; purging an active capture cannot prevent its later writes. Filesystem removal is not guaranteed secure erasure on SSDs/backups.

No migration, dependency, provider prompt, support acceptance rule, readiness rule, public route, deployment, or additional external transmission was added. The original October 15 narration and individual verdicts remain unavailable retroactively.

## Synthetic example

`GENERATION_TRACE_EXAMPLE.html` is a committed report containing only synthetic evidence and an explicitly supplied `uncertain` classifier fixture. It is not a live model result or a new offline semantic decision. Recreate it without providers or a database:

```bash
npm run generation:trace -- example --root /absolute/existing-parent/.generation-traces
# Inspect the resulting trace-UUID.json using the commands above.
```
