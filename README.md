# LocalCast Prototype

LocalCast is a Vite + React + TypeScript prototype for a local-first personal audio briefing app. The UI, mock service layer, and accessibility settings remain usable without a backend or API keys. A first Express API and backend AI harness are available for local API-backed development.

## What works now

- Dashboard, sources, briefing runs, audio playback, settings, and accessibility preferences.
- Mock-only frontend mode with in-browser mock services.
- API-backed frontend mode pointed at a local Express server.
- SQLite-backed backend stores for sources, gathered source items, settings, briefing runs, sections, and placeholder audio assets.
- Lightweight SQLite migrations applied at API startup.
- Server-side RSS/Atom ingestion with sync metadata, backoff, and source item review.
- Backend AI provider seam with `mock`, `gemini`, and `openai_compatible` providers.

## Run mock-only frontend

Mock mode is the default. It does not require the backend or API keys.

```bash
npm install
npm run dev:web
```

Open the Vite URL shown in the terminal. `npm run dev` is an alias for `npm run dev:web`.

## Run the backend

```bash
cp .env.example .env
npm run dev:api
```

The API listens on `http://localhost:8787/api` by default. Health check:

```bash
curl http://localhost:8787/api/health
```

The backend allows `http://localhost:3000` by default for local CORS requests. To allow a different frontend origin, set `CORS_ORIGIN` to one or more comma-separated origins. Use `CORS_ORIGIN=*` only when you intentionally want unrestricted local API access.

## Run frontend against backend

Start the backend in one terminal:

```bash
npm run dev:api
```

Start the frontend in API mode in another terminal:

```bash
VITE_SERVICE_MODE=api VITE_API_BASE_URL=http://localhost:8787/api npm run dev:web
```

There is also a convenience script that starts the API in the background and the API-backed frontend in the foreground:

```bash
npm run dev:all
```

For day-to-day work, two terminals are easier to stop and inspect than the combined script.

## Environment variables

Backend-only values are read by `server/config.ts` and are never exposed to browser code:

```env
PORT=8787
CORS_ORIGIN=http://localhost:3000
DATABASE_PATH=data/localcast.sqlite
RSS_SYNC_ON_START=false
RSS_SYNC_INTERVAL_MINUTES=
AI_PROVIDER=mock
AI_MODEL=mock-localcast
AI_BASE_URL=
AI_API_KEY=
GEMINI_API_KEY=
```

Frontend values must use Vite's `VITE_*` prefix:

```env
VITE_SERVICE_MODE=mock
VITE_API_BASE_URL=http://localhost:8787/api
```

`VITE_SERVICE_MODE=mock` uses `src/services/mock/*`. `VITE_SERVICE_MODE=api` uses `src/services/api/*`. If `VITE_SERVICE_MODE` is unset or any value other than `api`, the app falls back to mock mode.

## Persistence

The backend stores data in SQLite at `DATABASE_PATH`, defaulting to `data/localcast.sqlite`. Empty databases are bootstrapped with the same prototype sources, settings, and sample briefing run that the in-memory version used.

Migrations run at API startup through `server/database/migrations.ts` and are recorded in `schema_migrations`. The current migrations create the initial schema, add RSS item identity columns/indexes, and add RSS sync metadata columns without dropping existing local data.

Persisted tables include `schema_migrations`, `sources`, `source_items`, `briefing_runs`, `briefing_run_sources`, `briefing_sections`, `audio_assets`, and `app_settings`. RSS source items are fetched server-side and stored in `source_items`; manual topic source items are still generated from the source instructions during briefing creation.

To reset local development data, stop the API server and remove the SQLite files:

```bash
rm -f data/localcast.sqlite data/localcast.sqlite-wal data/localcast.sqlite-shm
```

The next API startup recreates the schema and seed data.

## RSS ingestion

RSS and Atom feeds are fetched by the backend only. Use the Sources screen sync button in API mode, or call the API directly:

```bash
curl -X POST http://localhost:8787/api/sources/:id/sync
curl -X POST http://localhost:8787/api/sources/sync
curl -X POST 'http://localhost:8787/api/sources/sync?force=true'
curl http://localhost:8787/api/sources/:id/items
curl 'http://localhost:8787/api/source-items?sourceId=src-1&q=ai&limit=25&offset=0'
```

Fetched items capture title, content/summary, URL, author when available, published time, gathered time, and an internal external identity. Duplicate prevention uses a stable hash of RSS guid/id/link/title data and a unique `(source_id, external_id)` SQLite index.

RSS source responses include optional sync health fields: `lastSyncedAt`, `lastSyncStatus`, `lastSyncError`, `consecutiveSyncFailures`, `nextSyncAfter`, and computed `itemCount`. Failed feeds use simple backoff: first failure retries after 15 minutes, second after 1 hour, and later failures after 6 hours. Sync-all skips sources still in backoff unless `force=true` is provided.

`GET /api/source-items` and `GET /api/sources/:id/items` support `limit`, `offset`, `q`, `from`, and `to`; `GET /api/source-items` also supports `sourceId`.

Optional scheduler prep is disabled by default. Set `RSS_SYNC_ON_START=true` to run a backoff-aware sync when the API starts. Set `RSS_SYNC_INTERVAL_MINUTES` to a positive number to run the same sync-all path on an interval.

## AI providers

- `AI_PROVIDER=mock` is the default and requires no secrets.
- `AI_PROVIDER=gemini` uses `@google/genai` on the backend. Set `GEMINI_API_KEY` and optionally `AI_MODEL`; if the key is missing, briefing generation fails gracefully with a clear server-side error while mock mode remains unaffected.
- `AI_PROVIDER=openai_compatible` posts to an OpenAI-compatible chat completions endpoint. Use `AI_BASE_URL=http://localhost:1234` or `AI_BASE_URL=http://localhost:1234/v1` for LM Studio-style servers, and `AI_BASE_URL=http://localhost:11434` or `AI_BASE_URL=http://localhost:11434/v1` for Ollama OpenAI-compatible endpoints. `AI_API_KEY` is optional for endpoints that require a placeholder bearer token.

The Settings screen may display provider and model preferences for the prototype UI, but real backend AI selection is controlled by backend environment variables. API service code strips `apiKey` fields before saving settings to the backend.

## API routes

- `GET /api/health`
- `GET /api/sources`
- `POST /api/sources`
- `POST /api/sources/sync`
- `POST /api/sources/:id/sync`
- `GET /api/source-items`
- `GET /api/sources/:id/items`
- `PATCH /api/sources/:id`
- `DELETE /api/sources/:id`
- `GET /api/briefing-runs`
- `POST /api/briefing-runs`
- `GET /api/briefing-runs/:id`
- `GET /api/settings`
- `PUT /api/settings`
- `POST /api/follow-up`

Responses use the frontend contracts in `src/types.ts` for `Source`, `BriefingRun`, `BriefingSection`, and `AppSettings`.

## Manual verification

```bash
npm run lint
npm run build
npm run smoke:api
```

Mock mode smoke check:

```bash
npm run dev:web
```

API mode smoke check:

```bash
npm run dev:api
VITE_SERVICE_MODE=api VITE_API_BASE_URL=http://localhost:8787/api npm run dev:web
```

Then add a source, start a briefing run, and confirm the detail screen polls through `queued`, `gathering`, `summarizing_sources`, `drafting`, `rendering_audio`, and `complete`.

RSS ingestion smoke check:

1. Add an RSS source in API mode.
2. Click the sync button on that source.
3. Open the source item review panel from the Sources screen.
4. Confirm `GET /api/sources/:id/items` returns stored source items.
5. Start a briefing run using that RSS source.
6. Confirm the generated summary references the stored RSS item titles.
7. Try a broken RSS URL and confirm error metadata plus `nextSyncAfter` are shown in the API response.

Frontend mode build checks:

```bash
npm run build
VITE_SERVICE_MODE=api VITE_API_BASE_URL=http://localhost:8787/api npm run build
```

## Current limitations

- SQLite persistence is local-file only; migrations are intentionally lightweight and prototype-scoped.
- RSS ingestion is primarily on demand; the optional interval hook is prototype-level scheduler prep, not a durable background job system.
- RSS fetching does not yet use conditional HTTP caching, feed ETags, or full feed history management.
- Gmail, Calendar, auth, real TTS, podcast RSS, Docker, deployment, and vector search are not implemented.
- Generated audio is still a placeholder asset.
- Manual topic source items are generated from configured source instructions.

## Recommended next milestones

1. Add feed fetch metadata such as ETag/Last-Modified and conditional requests.
2. Add feed item retention controls and a source item detail view.
3. Add real TTS generation and serve generated audio assets.
4. Add focused API tests once the contract stabilizes beyond the prototype milestone.
