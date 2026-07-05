# LocalCast Prototype

LocalCast is a Vite + React + TypeScript prototype for a local-first personal audio briefing app. The UI, mock service layer, and accessibility settings remain usable without a backend or API keys. A first Express API and backend AI harness are available for local API-backed development.

## What works now

- Dashboard, sources, briefing runs, audio playback, settings, and accessibility preferences.
- Mock-only frontend mode with in-browser mock services.
- API-backed frontend mode pointed at a local Express server.
- In-memory backend stores for sources, settings, and briefing runs.
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

## AI providers

- `AI_PROVIDER=mock` is the default and requires no secrets.
- `AI_PROVIDER=gemini` uses `@google/genai` on the backend. Set `GEMINI_API_KEY` and optionally `AI_MODEL`; if the key is missing, briefing generation fails gracefully with a clear server-side error while mock mode remains unaffected.
- `AI_PROVIDER=openai_compatible` posts to an OpenAI-compatible chat completions endpoint. Use `AI_BASE_URL=http://localhost:1234` or `AI_BASE_URL=http://localhost:1234/v1` for LM Studio-style servers, and `AI_BASE_URL=http://localhost:11434` or `AI_BASE_URL=http://localhost:11434/v1` for Ollama OpenAI-compatible endpoints. `AI_API_KEY` is optional for endpoints that require a placeholder bearer token.

The Settings screen may display provider and model preferences for the prototype UI, but real backend AI selection is controlled by backend environment variables. API service code strips `apiKey` fields before saving settings to the backend.

## API routes

- `GET /api/health`
- `GET /api/sources`
- `POST /api/sources`
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

## Current limitations

- Stores are in memory and reset when the API server restarts.
- RSS fetching, Gmail, Calendar, auth, SQLite persistence, real TTS, podcast RSS, Docker, deployment, and vector search are not implemented.
- Generated audio is still a placeholder asset.
- The mock source gatherer creates synthetic source items from configured sources.

## Recommended next milestones

1. Add durable SQLite persistence for sources, settings, briefing runs, and gathered source items.
2. Implement real RSS fetching and source item normalization.
3. Add real TTS generation and serve generated audio assets.
4. Add focused API tests once the contract stabilizes beyond the prototype milestone.
