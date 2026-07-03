# LocalCast Prototype

This repository is a functional React prototype of **LocalCast** — a local-first, personalized audio briefing application. The goal of this prototype is to establish the core user flows, the UI architecture, and the domain models for content aggregation and audio synthesis without introducing full backend complexity.

## What this prototype does

- **Dashboard:** Provides an overview of active sources, recent runs, and current system configuration.
- **Sources Management:** Allows users to view and mock-add RSS feeds or manual topics for their briefing.
- **Briefing Runs:** Generates a mock "briefing run" that progresses through state transitions (queued -> gathering -> summarizing -> drafting -> rendering audio -> complete).
- **Audio Playback:** Simulates playing a generated briefing with an interactive, animated fluid orb visualizer.
- **Settings & Preferences:** Supports configurable AI models (for transcription and summarization), TTS providers, and a complete accessibility theme engine (high contrast, color vision optimizations, text sizing, and UI density).

## What is mocked

To keep this prototype self-contained and purely client-side, the following subsystems are fully mocked behind clean service interfaces (found in `src/services/mock/`):
- **Data Persistence:** Settings, Sources, and Briefing Runs are stored in-memory in mock service classes. They will reset on page reload.
- **Content Fetching:** "Syncing" an RSS feed or local calendar does not actually make network requests or parse XML/JSON.
- **AI Processing (Summarization & Scripting):** Summarizing sources and generating the podcast script uses a placeholder timeout delay, and returns hardcoded script sections.
- **Audio Synthesis (TTS):** The audio player simulates playback. No real Text-to-Speech API is called, and the visualizer animation is driven by a mock audio amplitude loop rather than real frequency analysis.

## Evolving into a real Node + SQLite implementation

The codebase has been refactored to make replacing the mocks straightforward. 

1. **Backend Integration:**
   - Migrate the implementation of `SourceService`, `BriefingService`, and `ProviderService` in `src/services/api/` to make real `fetch()` calls to a Node.js backend.
   - The backend should use an SQLite database (e.g., using `better-sqlite3` or an ORM like Drizzle/Prisma) to durably store Sources, Runs, and Settings.
2. **Real Content Aggregation:**
   - Implement backend workers/cron jobs that periodically parse real RSS feeds (using libraries like `rss-parser`), scrape websites, or ingest local notes, storing raw items in SQLite.
3. **Real AI & TTS Integration:**
   - Implement the `AiProvider` interface using actual SDKs (e.g., `@google/genai`, `openai`, `ollama` local endpoints) on the Node server.
   - When a Briefing Run transitions to "rendering_audio", call an actual TTS provider (OpenAI TTS, ElevenLabs, or local Web Speech API) and stream/store the `.mp3` result to the client.
4. **Real Audio Visualization:**
   - Connect the `OrbVisualizer` in `src/features/audio/OrbVisualizer.tsx` to the HTML5 Web Audio API `AnalyserNode` to drive the animation variables (`audioLevel` and `frequencies`) using real byte data from the `<audio>` element.

## Recommended next milestones

- **Milestone 1:** Stand up a basic Express/Node backend with SQLite. Connect the UI services to the backend APIs and verify data persists across reloads.
- **Milestone 2:** Implement the real RSS fetching and web scraping pipeline on the backend.
- **Milestone 3:** Wire up a real AI provider (like Gemini or OpenAI) to generate the briefing scripts from the downloaded RSS content.
- **Milestone 4:** Add real TTS generation and replace the mock audio player with an actual HTML5 audio element playing the synthesized speech.
