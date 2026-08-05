# LocalCast acceptance test matrix

Status: bootstrap baseline, 2026-08-05
Legend: `PRESENT`, `PARTIAL`, `MISSING`, `CONFLICT`, `DECISION`

The status column describes the inspected baseline, not the target. Replace it with dated green evidence as slices complete. No row is complete because code appears plausible; the observable evidence column is the contract.

## Evidence rules

- Automated evidence must include the exact command, exit code, environment mode, and relevant artifact/result in `STATE.md`.
- Tests use isolated temporary SQLite/media directories and local fixture servers. They never use operator data.
- Live-provider evidence is redacted and records adapter/model/voice labels, verification time, request class, result, and bounded cost—not keys, prompts, or user material.
- Manual podcast evidence records client/version, trusted-LAN origin, add/refresh/play/seek result, and enclosure checksum without recording the token.
- Static review may prove absence/scope but cannot prove runtime behavior alone.
- A deferred or blocked row must identify the decision/authorization and residual risk. It must not be marked green.

## Identity, trust, and primary workflow

| ID | Requirement | Observable acceptance evidence | Slice | Baseline |
| --- | --- | --- | --- | --- |
| ID-01 | Product is named/branded LocalCast, with no Huxe identity or compatibility claim. | Case-insensitive production-source/bundle/UI scan (excluding contract documents that state the prohibition) plus browser title/landmark E2E finds LocalCast and no Huxe/Google-AI-Studio scaffold naming; reviewer confirms original product copy. | 0/final | PARTIAL — UI says LocalCast, but `index.html` has a legacy Google AI Studio title |
| TRUST-01 | One user; every client reaching the application origin is explicitly treated as trusted; no hidden account boundary. | Deployment/UI docs state the model; API/schema/E2E show no accounts, sessions, roles, or per-user filtering; security review confirms Caddy/LAN is the main boundary. | 6 | PARTIAL |
| SRC-01 | Add/edit/enable/delete/manually sync/inspect RSS 2.0 and Atom without article scraping. | Integration fixture covers RSS and Atom CRUD/sync/inspection; outbound-request spy proves only feed URLs are fetched and item links are never requested. | 2 | PARTIAL — RSS exists; Atom not explicitly tested |
| SRC-02 | Save pasted notes with factual content and optional provenance. | API/unit validation plus keyboard E2E creates, edits, reloads, selects, and deletes a multiline note; empty/oversized/unsafe URL cases fail safely. | 1 | MISSING |
| SRC-03 | ETag/Last-Modified conditional fetch and `304` preserve dedupe across restart. | Fixture server asserts request headers and returns 200/304/changed 200; database counts/identities remain correct before and after process restart. | 2 | MISSING |
| SRC-04 | Feed fetch is bounded and safe. | Tests cover scheme, DNS/IP, each redirect, loop, timeout, slow stream, content type, byte cap, item/field cap, public host, explicit private allowlist, and blocked link-local/metadata destination. | 2 | PARTIAL — scheme, timeout, and item cap only |
| SRC-05 | SQLite FTS5 searches supplied material with provenance. | Migration asserts FTS5; query tests cover feed/note insert/update/delete, punctuation, ranking, empty query, rebuild, and restart; browser search resolves provenance. | 2 | MISSING — runtime supports FTS5, schema uses `LIKE` |
| SRC-06 | Historical evidence survives original source refresh/delete. | Complete fixture episode, mutate and delete originals, restart, then byte-compare transcript and source snapshots/citation rendering. | 2 | CONFLICT — current cascade/mutable item model |
| STN-01 | Saved station persists name, topic, mode, selected feeds, and selected notes. | API/schema tests plus browser E2E create, edit, deep-link, reload, generate from, and delete a station. A fixture with selected and unselected feeds proves only selected URLs are synchronized and only their items can enter evidence. | 1/2 | MISSING |
| STN-02 | Topic directions are not evidence or citations. | Database/provider fixture asserts station text has a distinct field, never creates a source item/snapshot, and cannot be returned as a citation ID. | 1 | CONFLICT — `manual_topic` becomes source material |
| STN-03 | Topic never triggers search, tools, page fetches, or non-feed acquisition. | Provider request snapshot has tools/search disabled/absent; outbound-request fixture allows only configured feed/provider endpoints; adversarial station instruction cannot add a request. | 1/2 | CONFLICT — UI copy implies “gather,” though no search exists |
| GEN-01 | Only explicit user action synchronizes and generates. | Fake-clock/process tests observe no jobs/fetches after startup or elapsed time; E2E proves only **Sync and generate** or explicit feed sync creates activity. | 0 | CONFLICT — browser and server interval hooks exist |
| GEN-02 | Each job records an immutable request at enqueue and final evidence after selected-feed sync but before provider use. | Transaction test mutates station/notes after enqueue and preserves the captured request; fixture feed adds items during worker sync; selecting atomically freezes only selected-feed/current captured-note evidence; a barrier proves provider invocation starts only after commit. | 1/2 | MISSING |
| GEN-03 | Brief mode targets 600–1,000 words without padding unsupported material. | Deterministic adequate fixture stays within budget; sparse fixture produces a shorter supported episode or typed insufficiency, never invented filler. | 3 | MISSING |
| GEN-04 | Deep mode targets 1,800–3,000 words and is materially deeper than brief. | Same adequate evidence produces mode-persisted outputs with deep > brief and within budget; sparse evidence fails rather than padding. | 3 | MISSING |
| GEN-05 | Insufficient supplied material fails honestly. | Empty, trivial, failed-feed-only-without-history, and direction-only fixtures terminate `INSUFFICIENT_SOURCE_MATERIAL`; provider/TTS spies see no publishable completion. A failed sync with adequate prior stored items may continue only with those item snapshots and an explicit sync warning; the error itself is never evidence. | 1/3 | CONFLICT — baseline creates placeholder/synthetic evidence |
| GEN-06 | Persisted phases are queued/syncing/selecting/drafting/validating/rendering/terminal. | Job integration and browser E2E observe ordered persisted transitions, safe detail, restart continuity, and exactly one terminal state. | 0 | PARTIAL — different run statuses persist, execution is detached |

## Grounding, library, and retry

| ID | Requirement | Observable acceptance evidence | Slice | Baseline |
| --- | --- | --- | --- | --- |
| GRD-01 | Text output is schema-validated into sections and atomic claims/support artifacts; malformed output fails. | Provider contracts cover invalid JSON, wrong types, missing claims/excerpts, oversized text, invalid enum, and extra unsafe data; none silently complete or fall back to prose. | 1/3 | CONFLICT — coercion/fallback exists |
| GRD-02 | Every factual claim has valid episode-snapshot citations and exact supporting excerpts. | Unit/property tests cover unknown, duplicate-only, original-item, station, missing, wrong-snapshot, absent/non-matching excerpt, and valid multi-source support; only snapshot membership plus exact excerpt coverage passes. | 1/3 | CONFLICT — arbitrary IDs accepted |
| GRD-03 | UI resolves citations to title, provenance, excerpt, and safe URL. | Browser E2E inspects rendered citation details/links and confirms raw IDs are not the only presentation; unsafe schemes are inert. | 1/3 | PARTIAL — raw ID chips only |
| GRD-04 | Completed transcript/citations are immutable history. | Snapshot test across source edit/delete, retry, restart, backup, and restore yields identical episode transcript and cited evidence. | 1/2/6 | MISSING |
| GRD-05 | Provider treats material as evidence, not instructions, and rejects unsupported/uncertain claims. | A deterministic fact oracle defines allowed facts, forbidden claims, support excerpts, unrelated-but-valid citations, and prompt injection. ID/excerpt validation plus the structured support pass must reject every forbidden, unrelated, `unsupported`, or `uncertain` claim; live review samples the same rubric. | 3 | MISSING |
| LIB-01 | Usable, deep-linkable episode library shows mode/status/transcript/citations/media/provider summary. | Playwright navigation/reload/back-forward tests on queued, failed, and complete episodes; accessible names and persisted metadata asserted. | 1/3 | PARTIAL — non-URL local navigation and basic run list |
| LIB-02 | Accessible progress survives browser/server restart. | E2E reloads at each injected phase and after API restart; phase resumes accurately with a polite, deduplicated live announcement. | 1/3 | PARTIAL — polling exists, crash recovery does not |
| LIB-03 | Failure shows stable code, safe message, phase, attempts, and retryability. | Phase-failure fixtures assert API/UI shape and redaction; raw stack/provider body/source content never appears. | 1/3 | CONFLICT — raw message stored in summary |
| LIB-04 | Retryable failures retry idempotently; insufficiency requires new inputs. | Inject one failure at every phase, click retry, assert one added attempt and one final transcript/media/feed item; insufficiency has no retry button until a new generation action. | 3 | MISSING |

## Provider contracts and status

| ID | Requirement | Observable acceptance evidence | Slice | Baseline |
| --- | --- | --- | --- | --- |
| TXT-01 | Server-side OpenAI text adapter supports structured generation and claim-support validation. | Shared adapter contract fixture passes; minimal authorized live verify/generation/support pass succeeds with configured model and redacted evidence. Follow-up behavior is covered by `CHAT-*`. | 1 | MISSING — only generic compatible adapter |
| TXT-02 | Ollama OpenAI-compatible adapter works with explicit URL/model. | OpenAI-compatible fixture verifies exact endpoint/auth/body/schema/errors and honest `CONTRACT TESTED ONLY`/`NOT CONFIGURED` status. An authorized local Ollama probe is optional evidence that upgrades the deployment to `LIVE VERIFIED`. | 6 | PARTIAL — generic adapter can target it but has no status/contracts |
| TXT-03 | LM Studio OpenAI-compatible adapter works with explicit URL/model. | The same shared fixture verifies explicit LM Studio label/config and honest `CONTRACT TESTED ONLY`/`NOT CONFIGURED` status. An authorized local probe is optional evidence that upgrades to `LIVE VERIFIED`. | 6 | PARTIAL — generic adapter can target it but has no status/contracts |
| TXT-04 | Text calls have timeout, cancellation, response cap, schema validation, safe error class. | Shared adapter suite covers hang, disconnect, 4xx/5xx, malformed/empty/oversized bodies, abort, and redacted retry classification. | 1/6 | MISSING |
| TTS-01 | Server-side OpenAI TTS adapter produces speech. | Shared speech contract fixture plus minimal authorized live output; MP3 validation/checksum/duration evidence and status recorded. | 1 | MISSING |
| TTS-02 | Piper adapter safely produces speech. | Deterministic fake-executable contract covers arguments/stdin/timeouts/exit/output caps, WAV/MP3 normalization, and honest `CONTRACT TESTED ONLY`/`NOT CONFIGURED` status. An authorized pinned executable/model probe is optional `LIVE VERIFIED` evidence. | 6 | MISSING |
| TTS-03 | Completed audio is non-empty decodable MP3 with measured metadata. | `ffprobe` or equivalent parser succeeds; persisted byte length/checksum/duration match file and HTTP metadata; browser decodes it. | 1 | CONFLICT — `#` metadata only |
| TTS-04 | Audio publication is atomic. | Kill/fail renderer before validation/rename; no completed media route/feed entry exists and temp cleanup/recovery is deterministic. | 1/6 | MISSING |
| PROV-01 | All provider configuration/secrets are server-side. | Browser bundle/storage/network/browser-facing API snapshot contains no key fields/values; server config validation tests cover each adapter; UI shows redacted labels only; outbound fixture asserts credentials appear only in the configured provider authorization header. | 0/1 | CONFLICT — API strips keys, but UI solicits them |
| PROV-02 | Production never falls back to mock. | Production config matrix covers unset, unknown, fake, unavailable, and valid providers; generation is disabled/typed-failed and no mock output appears. Frontend production bundle has no mock default. | 0 | CONFLICT |
| PROV-03 | Status is exactly LIVE VERIFIED / CONTRACT TESTED ONLY / NOT CONFIGURED. | Unit/API/E2E matrix covers missing config, green contract/no probe, failed probe, successful probe, changed config invalidating prior live result, safe reason, and timestamp. | 1/6 | MISSING |
| PROV-04 | Fakes are deterministic and impossible in production. | Fake repeatability/failure-injection tests pass; production build/runtime test rejects fake flag/provider and image scan contains no selectable fake route. | 0 | CONFLICT — mocks are default |
| PROV-05 | UI discloses every external provider data flow before verify/use. | Keyboard E2E captures disclosure before the first external call; outbound spy proves no call before action; copy separately names station/evidence sent to text generation, final narration sent to TTS, and episode transcript/evidence plus question sent to follow-up. | 1/5 | CONFLICT — current “stay on device” copy is misleading |

## Persistence and jobs

| ID | Requirement | Observable acceptance evidence | Slice | Baseline |
| --- | --- | --- | --- | --- |
| DATA-01 | Ordered additive migrations; no silent reset. | Migrate empty DB and snapshots at migrations 001/002/003; verify old data, new schema/migration records, repeat no-op, and failure rollback. | 0 | PRESENT/PARTIAL — three migrations are ordered and transactional |
| DATA-02 | Foreign keys/WAL/busy timeout/version/integrity/FTS checks. | Startup/integration assertions cover PRAGMAs, expected schema version, `quick_check`, `foreign_key_check`, FTS capability, corruption/wrong-version failure, and clean close. | 0/6 | PARTIAL — FK/WAL exist |
| DATA-03 | Production requires correct writable persistent mounts and no demo seeding. | Container tests for missing, read-only, wrong, initialized, and fresh authorized volumes; fresh DB is empty, wrong volume fails clearly, sample episode never appears. | 0/6 | CONFLICT — directories auto-create and seed demos |
| DATA-04 | FTS remains consistent through all lifecycle operations. | Transaction/migration/rebuild/backup/restore tests compare canonical SQL rows with FTS results after each insert/update/delete. | 2/6 | MISSING |
| JOB-01 | Exactly one worker claims generation work. | Compose/process inspection plus DB concurrency test starts competing claim loops and observes one lease owner; API does not execute work. | 0 | CONFLICT — API detached promises |
| JOB-02 | At most one active generation; later jobs stay FIFO queued. | Enqueue at least three jobs concurrently, block first provider, assert one active lease and FIFO start order after release. | 0 | MISSING |
| JOB-03 | Restart recovers stale running work safely. | Kill worker at every phase, advance lease clock, restart, assert persisted attempt/requeue/resume policy and no publishable partial output. | 0/6 | MISSING |
| JOB-04 | Enqueue/retry/restart are idempotent. | Duplicate request/idempotency-key, double click, lease race, and retry replay tests assert one logical episode and one set of sections/citations/media/feed entry. | 0/3 | MISSING |
| JOB-05 | Worker shutdown drains/releases safely and closes SQLite. | SIGTERM integration blocks provider at known point, asserts no new claim, bounded exit, safe lease state, clean DB, then successful recovery. | 0/6 | MISSING |

## Media and private podcast feed

| ID | Requirement | Observable acceptance evidence | Slice | Baseline |
| --- | --- | --- | --- | --- |
| MEDIA-01 | Browser controls real audio and actual media events. | Playwright with fixture MP3 asserts play/pause/seek/skip/speed/elapsed/duration/error and keyboard control against `<audio>`/media state, not timers. | 1/3 | CONFLICT — simulated timers/visualizer |
| MEDIA-02 | GET/HEAD return correct MP3 metadata and range capability. | Byte fixture integration asserts `audio/mpeg`, exact Content-Length, ETag/Last-Modified policy, `Accept-Ranges`, no body for HEAD, and checksum. | 1/4 | MISSING |
| MEDIA-03 | Byte ranges are exact for full/bounded/open/suffix/invalid/multi policy. | Table-driven HTTP test compares every response byte and 200/206/416 headers to fixture; real-client seek succeeds. | 4 | MISSING |
| MEDIA-04 | Media IDs cannot traverse/read temp/arbitrary files. | Encoded traversal, separator, symlink, unknown ID, unpublished asset, and direct temp-path tests all fail without filesystem disclosure. | 4/6 | MISSING |
| POD-01 | Exactly one feed lists completed episodes newest first. | Feed integration creates mixed statuses and asserts one configured route/feed, completed-only ordering, and immutable episode projection. | 4 | MISSING |
| POD-02 | At least 256-bit opaque token protects feed/enclosures and is masked outside explicit operator copy/reveal. | Production rejects missing/default/weak token config. Missing/malformed/wrong/old/rotated requests return identical generic no-store `404` status/body; timing-safe digest test passes. Only user-initiated dedicated response/clipboard and authorized feed traffic contain the clear token; application/proxy logs, routine APIs, default UI snapshots, and persistent browser storage do not. | 4 | MISSING |
| POD-03 | Feed is valid RSS 2.0/podcast XML with accurate enclosures. | Strict XML parse/schema/validator assertions cover namespaces, absolute validated-origin URLs, stable GUID, RFC-822 dates, `audio/mpeg`, exact bytes, titles/descriptions. | 4 | MISSING |
| POD-04 | A real trusted-LAN podcast client can import, refresh, play/download, and seek. | Operator-approved client/version evidence records each action and downloaded checksum through Caddy, with token redacted. Evidence confirms local-only subscription storage or records explicit vendor-cloud token disclosure acceptance and a successful rotation drill. | 4 | MISSING |

## Follow-up chat

| ID | Requirement | Observable acceptance evidence | Slice | Baseline |
| --- | --- | --- | --- | --- |
| CHAT-01 | Chat requires one completed episode. | API/E2E rejects omitted, unknown, queued, failed, and deleted episode IDs; completed episode succeeds. | 5 | CONFLICT — `runId` is optional |
| CHAT-02 | Server builds context only from immutable transcript/snapshots. | Client sends forged context, original sources are changed/deleted, and provider request snapshot still contains only immutable server-loaded episode evidence. | 5 | CONFLICT — caller context accepted, run title only |
| CHAT-03 | Every factual answer claim cites and is supported by episode snapshots. | Provider contract covers valid, unknown, missing, unrelated, and non-matching-excerpt citations plus `unsupported`/`uncertain` support results; UI renders title/excerpt/provenance and rejects invalid answer publication. | 5 | MISSING |
| CHAT-04 | Unsupported questions receive an honest refusal with no browsing. | Deterministic and minimal live tests ask planted supported/unsupported questions; unsupported answer uses refusal code/copy; outbound spy sees no search/tool/page request. | 5 | MISSING |
| CHAT-05 | Questions/answers/citations/failures persist. | E2E submits, injects failure/retry, restarts app/worker/browser, and observes ordered unchanged history with timestamps/citations. | 5 | MISSING |

## Deployment, security, privacy, and operations

| ID | Requirement | Observable acceptance evidence | Slice | Baseline |
| --- | --- | --- | --- | --- |
| DEP-01 | Built UI/API/media/feed share one Express origin. | Production smoke requests UI route/reload, API, media, and feed from one base URL; no Vite server or cross-origin API URL is needed. | 0/4 | MISSING |
| DEP-02 | Supported deployment is behind Caddy; app port is not reachable from another LAN host. | Authorized topology check through HTTPS Caddy succeeds; direct LAN socket/curl fails; `PUBLIC_BASE_URL` controls absolute URLs; Caddy remains externally managed. | 4/6 | MISSING |
| DEP-03 | Compose has non-root app + one worker, pinned image, health/readiness, persisted DB/media, graceful stop. | `docker compose config`, image inspection, temp-volume smoke, UID check, health/readiness transitions, process count, restart, and SIGTERM tests pass. | 0/6 | MISSING |
| DEP-04 | Agents never mutate Caddy without authorization. | Git/diff and execution log contain no Caddy changes/commands; any operator action is separately recorded. | Every slice | DECISION |
| SEC-01 | RSS SSRF policy validates DNS/IP and every redirect/rebinding path. | Dedicated fixtures simulate private/link-local/metadata addresses, redirect changes, multiple answers, and rebinding-safe connection policy; allowed exception hosts are explicit. | 2 | MISSING |
| SEC-02 | Untrusted content is text; external links allow only HTTP(S). | DOM tests with HTML/script/event/Unicode/unsafe schemes show escaped text, inert bad links, `noopener noreferrer`, and no execution. | 2/6 | PARTIAL — React escapes text; URL scheme unvalidated |
| SEC-03 | Prompts isolate source instructions and disable tools/search. | Provider request snapshots/adversarial fixtures prove delimiter/instruction hierarchy, no tool configuration, and invalid/unsupported output failure. | 1/3/5 | MISSING |
| SEC-04 | Provider secrets stay server-side; podcast token has only the explicit transient copy/reveal exception. | Canary tests find no provider key in built assets, browser storage/network, browser-facing responses, logs, Git diff, image, or backup; a server fixture proves it appears only in the configured provider authorization header and trace tooling redacts it. Podcast-token canary appears only in the user-initiated dedicated response/clipboard and authorized feed request, never in bundles, persistent storage, routine APIs, logs, snapshots, image, or backup. | 1/4/6 | PARTIAL — API strips provider keys; UI still handles them |
| SEC-05 | Same-origin/Host/proxy rules fail closed; absolute URLs use validated config. | Production integration covers wildcard/unexpected Origin, Host, Forwarded headers, direct port, and malicious host; feed URLs remain canonical. | 0/4/6 | PARTIAL — development CORS only |
| SEC-06 | Inputs/outputs have size/time/resource bounds. | Boundary table tests JSON, note, question, feed, provider body, transcript, TTS, media ranges, concurrency, and subprocess limits at below/equal/above thresholds. | 1/2/5/6 | PARTIAL |
| SEC-07 | Client/log errors are safe and correlated. | Inject every phase/provider/feed/media error; API shows stable code/correlation ID, logs omit bodies/secrets and retain diagnostic phase; no stack/internal path in client. | 3/6 | CONFLICT — global raw messages |
| PRIV-01 | Loading production UI causes no third-party browser egress. | Playwright route interception/network log allows only canonical origin; fonts/assets are local and no analytics/CDN/provider request occurs before explicit server action. | 1/6 | CONFLICT — Google Fonts import |
| PRIV-02 | UI/docs honestly explain LAN trust, local storage, backup, and external provider flow. | Copy review against network/storage behavior; E2E verifies disclosure placement; no “stays on device” claim when external inference is active. | 1/6 | CONFLICT |
| OPS-01 | Backup is DB-consistent and includes published media + manifest/checksums. | Live/quiesced backup test writes a new artifact while WAL is active; manifest version/count/checksums match a consistent point and excludes temp files/secrets. | 6 | MISSING |
| OPS-02 | Restore validates and does not silently overwrite user data. | Restore to empty target succeeds; non-empty target refuses without explicit operator flag; corrupt/missing/wrong-version manifest fails before mutation. | 6 | MISSING |
| OPS-03 | Restore proof covers DB/FTS/jobs/evidence/chat/feed/media. | Clean deployment from artifact passes integrity/FK/FTS queries and exact record/checksum comparison; corrupt/missing media is surfaced. | 6 | MISSING |
| OPS-04 | Backups exclude credentials/token and document re-supply/rotation. | Canary scan of archive returns no secrets; restore starts `NOT CONFIGURED` until server secrets are supplied; same/rotated token behavior is documented/tested. | 6 | MISSING |

## Accessibility and usability

| ID | Requirement | Observable acceptance evidence | Slice | Baseline |
| --- | --- | --- | --- | --- |
| A11Y-01 | Core flows meet WCAG 2.2 AA with zero unadjudicated applicable automated violations. | Playwright+axe covers all routes/states in light/dark/high-contrast and representative viewport sizes; every applicable violation is fixed, while any documented false positive has manual evidence; screen-reader spot check recorded. | 3/6 | PARTIAL |
| A11Y-02 | Entire core workflow is keyboard-operable. | Keyboard-only E2E manages feed/note/station, sync/generate, progress/failure/retry, citations, audio, feed setup, and chat without pointer. | 3–6 | CONFLICT — clickable run divs and inert controls |
| A11Y-03 | Semantic controls, labels, visible focus, correct focus restoration/hidden state. | Role/name/focus assertions cover every form, row, panel/player, dialog-like surface, external link, and route transition; no hidden focusable player. | 3/6 | PARTIAL |
| A11Y-04 | Status changes have concise live announcements. | Screen-reader/DOM tests observe sync/generate/verify/save/fail/retry updates once, with polite/assertive choice documented. | 3/6 | PARTIAL — saving status only |
| A11Y-05 | Theme/contrast/color/text/density/reduced motion/320px reflow/200% text resize work. | Visual/DOM/contrast tests cover modes, reduced-motion media query, 320 CSS-pixel viewport reflow, 200% text resize, clipping/overlap/focus, and permitted data-table/media exceptions; text/background ratios meet AA. | 3/6 | PARTIAL — controls exist; known contrast/layout risks |
| A11Y-06 | Transcript and citations are available whenever audio is available. | Data invariant plus E2E asserts no completed/playable/feed episode without complete visible transcript and resolved citations. | 1/3/4 | PARTIAL — transcript exists but citations unresolved/audio fake |

## Architectural acceptance

| ID | Requirement | Observable acceptance evidence | Slice | Baseline |
| --- | --- | --- | --- | --- |
| ARC-01 | Preserve React/Vite/TypeScript, Express, feature layout, and service boundaries. | Architecture/diff review shows extension rather than rewrite; focused tests protect existing source/run/settings flows. | Every slice | PRESENT |
| ARC-02 | Keep established npm single package/lockfile. | `package.json` has no incidental workspace migration; one `package-lock.json`; documented npm commands reproduce clean install/build. | 0/final | PRESENT |
| ARC-03 | Zod validates new/touched external boundaries. | Unit tests exercise environment/API/provider schemas and inferred TS types; no unsafe cast bypass at new boundaries. | 0 onward | MISSING — handwritten validation |
| ARC-04 | React Router and TanStack Query manage URLs/server state incrementally. | Reload/back-forward/deep-link E2E plus query invalidation/poll-stop tests; no full component rewrite. | 0/3 | MISSING |
| ARC-05 | `better-sqlite3`, explicit migrations, and FTS5 remain persistence stack. | Dependency/schema inspection and migration tests; no ORM/vector/Redis introduction. | 0/2 | PARTIAL — FTS absent |
| ARC-06 | Vitest + Playwright + retained API smoke provide layered tests. | Scripts run unit/integration/browser/a11y/smoke suites from clean checkout; tests are deterministic and isolated. | 0 onward | MISSING — only smoke script |
| ARC-07 | Reproducible server/client production artifact excludes dev data/secrets/mocks. | Two clean builds have controlled output; image/context scan excludes `.env`, DB/media, caches, source maps if disallowed, and selectable mock mode; production start smoke passes. | 0/6 | MISSING |

## Explicit non-goal regression guards

| ID | Must remain absent | Observable acceptance evidence | Slice | Baseline |
| --- | --- | --- | --- | --- |
| NG-01 | Gmail ingestion | UI/API/schema/provider/dependency scan and outbound tests show no Gmail connector; old placeholder type removed. | 6 | CONFLICT — placeholder type exists, no behavior |
| NG-02 | Calendar ingestion | Same scoped scan/test; old placeholder type and schedule copy removed. | 6 | CONFLICT — placeholder/schedule UI exists |
| NG-03 | General web search/autonomous research | Provider tool snapshots and outbound allowlist show no search endpoint/tool/request; prompts explicitly forbid it. | 1/2/5/6 | PRESENT behavior, ambiguous copy |
| NG-04 | Full-page/article scraping | Feed fixture item links are never requested; no scraper/browser HTTP dependency or route exists. | 2/final | PRESENT |
| NG-05 | Authentication/accounts | Routes/schema/UI/dependencies contain no account/session/role system; trusted-LAN warning is explicit. Podcast token is documented as feed-only. | 6 | PRESENT |
| NG-06 | Public deployment | Runbook labels LAN-only; supported Compose exposes only Caddy attachment and direct/public exposure tests fail. | 6 | MISSING deployment |
| NG-07 | Automatic scheduling | Fake-clock/startup tests observe zero automatic sync/generation; schedule types/config/UI/timers removed. | 0/final | CONFLICT |
| NG-08 | Embeddings/vector databases | Dependency/schema/provider scans and tests show FTS5 only; no embedding calls. | 2/final | PRESENT |
| NG-09 | Redis/distributed workers | Dependency/Compose/process/schema review shows SQLite queue and exactly one worker; no broker or scale replicas. | 0/final | PRESENT/MISSING worker |
| NG-10 | Multiple speakers | Transcript/audio config and UI expose one voice per installation/episode; no diarization/dialogue synthesis. | 1/6 | PRESENT |
| NG-11 | Voice cloning | Provider config accepts only provider/Piper voice identifiers; no upload/training/reference-audio flow or dependency. | 1/6 | PRESENT |
| NG-12 | Native mobile apps | Tracked files/build scripts contain only responsive web app and podcast feed; no iOS/Android/native project. | final | PRESENT |
| NG-13 | Analytics/telemetry | Browser/server network/log dependency scan shows no analytics endpoint/SDK/tracker; production network trace stays first-party except explicit server provider/feed calls. | 6 | PRESENT |
| NG-14 | Provider keys in browser | Canary-secret bundle/storage/network/API scan is empty; settings UI has no secret fields. | 0/1/final | CONFLICT |

## Gate summaries by slice

| Slice | Minimum green evidence before checkpoint |
| --- | --- |
| 0 | Config/mock-fail-closed matrix; migrations from baseline fixtures; job concurrency/recovery/idempotency/shutdown; test harness; same-origin build; initial Compose smoke; baseline regressions |
| 1 | Note/station E2E; OpenAI text/TTS contracts; redacted live verification; real MP3/transcript/citation/playback; insufficiency/no-secret/privacy proof |
| 2 | RSS+Atom conditional/dedupe/restart; SSRF/resource fixtures; FTS lifecycle; immutable historical evidence; no scraping |
| 3 | Brief/deep/insufficiency; grounding/adversarial fixtures; library/progress/failure/retry; real player; affected accessibility flows |
| 4 | Token matrix; XML validity; byte-exact ranges; approved real client through Caddy; canonical URL/direct-port proof |
| 5 | Completed-episode-only chat; server-built context; cited/refusal/prompt-injection/restart tests; minimal live grounded/refusal check |
| 6 | Provider parity; Piper authorization/evidence; full axe/keyboard/contrast/zoom; security/privacy/failure injection; backup/restore; hardened image/Compose/Caddy-boundary proof; every required row rerun |

## Bootstrap evidence already green

These checks establish only the pre-change baseline; they do not satisfy missing product rows:

```text
npm ls --depth=0                                                        PASS
npm run lint                                                            PASS
npm run build                                                           PASS
VITE_SERVICE_MODE=api VITE_API_BASE_URL=http://localhost:8787/api npm run build  PASS
npm run smoke:api                                                       PASS
SQLite 3.53.2 compile option ENABLE_FTS5                                PASS
git status --porcelain=v1 --untracked-files=all after checks            CLEAN
```

Exact outputs and timings are recorded in `STATE.md`.
