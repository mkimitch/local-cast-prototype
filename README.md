# LocalCast

LocalCast is a local-first, single-user audio briefing prototype for a trusted LAN. The product contract lives in [`docs/codex/SPEC.md`](docs/codex/SPEC.md); the current implementation state and evidence are recorded in [`docs/codex/STATE.md`](docs/codex/STATE.md).

The current checkpoint is the credential-free Slice 0 foundation. It provides explicit runtime configuration, SQLite migrations and storage identity checks, a durable FIFO generation queue, a separate worker, test-only deterministic providers, same-origin production serving, and a non-root Compose topology. Real text and speech generation are intentionally not configured yet.

## Runtime shape

- React/Vite frontend and Express API share one production origin.
- SQLite and media use separate persistent directories.
- The API only enqueues work; one worker claims at most one generation job at a time.
- Episode creation and feed synchronization occur only after explicit user actions.
- Browser code always uses the relative `/api` endpoint and never accepts provider credentials.
- Production has no mock fallback. Missing providers are shown as `NOT CONFIGURED`, and generation stays disabled.
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
| `TEXT_PROVIDER` / `SPEECH_PROVIDER` | Slice 0 accepts `not_configured` in production and `fake` only under the test gate. |
| `LOCALCAST_ALLOW_FAKE_PROVIDERS` | Must be false outside tests. Production rejects true. |

`RSS_SYNC_ON_START` and `RSS_SYNC_INTERVAL_MINUTES` are rejected when enabled. Provider keys, endpoints, and voices will remain server-only as later provider slices are implemented.

## Persistence and jobs

Migrations `001` through `004` are ordered, additive, transactional, and recorded in `schema_migrations`. Migration 004 adds storage identity metadata, generation jobs, attempts, leases, and ordered events while scrubbing legacy browser provider/schedule fields from persisted appearance settings.

The durable phase sequence is:

```text
queued -> syncing -> selecting -> drafting -> validating -> rendering_audio -> complete | failed
```

One partial unique index enforces a single running generation lease. Later jobs remain FIFO queued. Expired leases recover to the queue with retained attempt history; shutdown interrupts and releases owned work. API enqueue and retry primitives are idempotent.

## Current limitations

This checkpoint is infrastructure, not the finished product. In particular, it does not claim live provider verification, real generated MP3s, saved stations/notes, citation support artifacts, the private podcast feed, grounded follow-up chat, or Caddy/podcast-client interoperability. Those belong to later slices in [`docs/codex/PLAN.md`](docs/codex/PLAN.md) and must not be represented as working until their evidence is green.
