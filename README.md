# LocalCast

LocalCast is a local-first, single-user audio briefing prototype for a trusted LAN. The product contract lives in [`docs/codex/SPEC.md`](docs/codex/SPEC.md); the current implementation state and evidence are recorded in [`docs/codex/STATE.md`](docs/codex/STATE.md).

The current checkpoint includes the completed Slice 5 grounded-chat product and the deterministic Slice 6 provider, backup/restore, accessibility, security, and privacy contracts. LocalCast supports explicit RSS/note ingestion, grounded episode generation, private podcast delivery, episode-scoped chat, Ollama/LM Studio/OpenAI text adapters, and OpenAI/Piper speech adapters. Provider status distinguishes configuration, deterministic contract evidence, and live verification; production never silently selects a mock.

## Runtime shape

- React/Vite frontend and Express API share one production origin.
- SQLite and media use separate persistent directories.
- The API only enqueues work; one worker claims at most one generation job at a time.
- Episode creation and feed synchronization occur only after explicit user actions.
- Browser code always uses the relative `/api` endpoint. The Settings credential form submits a complete replacement key once to the same-origin API, clears it immediately, and never receives a stored credential back.
- Production has no mock fallback. Provider status is honest (`NOT CONFIGURED`, `CONFIGURED UNVERIFIED`, `CONTRACT TESTED ONLY`, or `LIVE VERIFIED`), and generation remains disabled without sufficient status evidence.
- Deterministic text/speech fakes are available only with explicit `test` runtime gates.

## Local development

Install the locked dependencies:

```bash
npm ci
```

Start the API, worker, and Vite frontend in separate terminals:

```bash
npm run dev:api
npm run dev:worker
npm run dev:web
```

The API defaults to `127.0.0.1:8787`, Vite to port `3000`, and development data to `data/localcast.sqlite` plus `data/media`. The frontend proxies `/api` to the API. Development starts with both providers unconfigured, so the UI is inspectable but **Sync and generate** is disabled.

Do not enable fake providers for ordinary development or production. The accepted fake configuration requires all of the following and is reserved for isolated tests:

```env
LOCALCAST_RUNTIME_MODE=test
LOCALCAST_ALLOW_FAKE_PROVIDERS=true
TEXT_PROVIDER=fake
SPEECH_PROVIDER=fake
```

## Verification

The credential-free full gate is:

```bash
npm run verify
```

Its component commands are:

```bash
npm run lint
npm run test
npm run test:integration
npm run build
npm run test:e2e
npm run smoke:api
npm run smoke:production
npm run smoke:compose
```

Tests use temporary databases, media directories, ports, containers, and named volumes. They do not use operator data. The Compose smoke requires a working Docker engine and may need permission to update Docker build metadata.

## Production storage and Compose contract

`compose.yml` defines three roles:

- `storage-init` is an explicit one-time profile that authorizes and marks new SQLite/media volumes, applies migrations, and exits;
- `app` serves the built UI and API on container port `8787`;
- `worker` claims durable generation jobs.

All roles run as the non-root `node` user with a read-only root filesystem and shared named data/media volumes. The base Compose file deliberately has no `ports` mapping. Caddy connectivity and the exact trusted-LAN origin remain operator decisions; do not expose an application port or modify Caddy implicitly.

Fresh volumes are never initialized by ordinary `docker compose up`. After reviewing the resolved volume targets, an operator must explicitly authorize first-time initialization:

```bash
docker compose --profile init run --rm storage-init
```

Only after that command succeeds may `app` and `worker` start. Losing or replacing the initialized volumes therefore causes startup failure rather than silent creation of an empty installation.

Before an authorized deployment, copy `.env.example` to an untracked `.env` and replace both example values:

- `LOCALCAST_INSTALLATION_ID` is a stable, unique identifier with at least 16 characters. It binds the database and media mounts together.
- `LOCALCAST_TRUSTED_ORIGINS` is the exact comma-separated HTTP(S) browser origin allowed to send Origin-bearing requests, normally the Caddy HTTPS origin. Wildcards are rejected.

Production requires absolute `DATABASE_PATH` and `MEDIA_PATH` values in distinct directories. Startup fails on missing, partial, mismatched, unreadable, unwritable, corrupt, or newer-version storage. It never seeds demo rows or silently recreates a missing initialized database.

### OpenAI credential management

Settings → Provider Status can replace the OpenAI API key and run an explicit connection test. A UI-managed key is stored at `.credentials/openai-api-key` beside the SQLite database in the existing LocalCast data volume. LocalCast creates the directory as mode `0700`, atomically replaces the key file at mode `0600`, never returns the complete value, and resolves credentials in this order:

1. the installation credential written through LocalCast;
2. the existing worker `OPENAI_API_KEY` environment value;
3. unconfigured.

The environment value is never copied into the installation store merely by starting LocalCast. An environment-only installation continues to generate normally, but the app cannot read that worker-only fallback; replace it once through Settings before using the UI connection test. After that replacement, app and worker read the shared protected file for new work without a container restart. No new volume or environment variable is required because the credential directory lives in the existing data volume.

The connection test makes bounded authenticated model-metadata requests only for selected OpenAI capabilities. It does not generate text or audio and does not mutate LocalCast content. Successful requests update the existing provider-check records; failures retain only a safe category.

## Environment contract

Important server-only variables are:

| Variable | Contract |
| --- | --- |
| `LOCALCAST_RUNTIME_MODE` | Required: `development`, `test`, or `production`. |
| `LOCALCAST_PROCESS_ROLE` | `app`, `worker`, or `storage-init`; each entry point validates its role. |
| `DATABASE_PATH` | SQLite path; explicit absolute path required in production. |
| `MEDIA_PATH` | Media directory; explicit absolute path required in production. |
| `LOCALCAST_INSTALLATION_ID` | Stable storage identity, required in production. |
| `LOCALCAST_TRUSTED_ORIGINS` | Exact comma-separated HTTP(S) origins; no wildcard. |
| `TEXT_PROVIDER` / `SPEECH_PROVIDER` | Explicit server-side adapter selection; supported production values are `openai`, `ollama`, or `lm_studio` for text and `openai` or `piper` for speech. |
| `LOCALCAST_ALLOW_FAKE_PROVIDERS` | Must be false outside tests. Production rejects true. |

`RSS_SYNC_ON_START` and `RSS_SYNC_INTERVAL_MINUTES` are rejected when enabled. Stored provider keys, configured endpoints, executable paths, and voices remain server-only. The dedicated Settings replacement form sends a newly entered key once to the same-origin server, which never returns a stored key through browser APIs or bundles.

## Persistence and jobs

Migrations `001` through `008` are ordered, additive, transactional, and recorded in `schema_migrations`. They cover storage identity, durable generation, immutable grounding, private podcast publication, and episode-scoped grounded chat.

The durable phase sequence is:

```text
queued -> syncing -> selecting -> drafting -> validating -> rendering_audio -> complete | failed
```

One partial unique index enforces a single running generation lease. Later jobs remain FIFO queued. Expired leases recover to the queue with retained attempt history; shutdown interrupts and releases owned work. API enqueue and retry primitives are idempotent.

## Backup and restore privacy

Build the server entry points before running the versioned offline operators. Stop all writers and verify quiescence before backup:

```bash
npm run build:server
npm run backup:create -- --database /absolute/data/localcast.sqlite --media /absolute/media --destination /private/backups/localcast-YYYYMMDD --max-media-bytes 10737418240
npm run backup:restore -- --backup /private/backups/localcast-YYYYMMDD --data-target /new/empty/data --media-target /new/empty/media
```

Backups are private, checksum-bound, versioned artifacts. They contain SQLite records and published media in plaintext, including supplied source bodies, transcripts, citations, and chat history. Store them in an operator-controlled `0700` location and apply host-level encryption, retention, and deletion policy appropriate to that content. Backup artifacts deliberately exclude the `.credentials` installation directory, provider credentials, configured provider endpoints, environment files, and the podcast bearer token. A restored installation therefore requires the operator to re-enter provider credentials (or re-supply the deployment environment value), supply current server configuration, and supply a podcast token separately. Restore accepts only new or empty targets and fails closed on malformed, linked, oversized, corrupt, inconsistent, or active-work artifacts.

## Current limitations

Deterministic contract evidence is not live-provider verification. Caddy/LAN isolation, deployed-image inspection, non-cooperative shutdown, real capacity/read-only/corruption drills, reproducible-image comparison, and the A11Y-01 human screen-reader spot check remain operator-gated. See [`docs/codex/STATE.md`](docs/codex/STATE.md) and [`docs/codex/TEST_MATRIX.md`](docs/codex/TEST_MATRIX.md) for the exact evidence state.
