# LocalCast build log

This append-only log records implementation checkpoints, reproducible gates, review findings, and repair evidence. Secrets, provider payloads, and operator data must never be recorded here.

## 2026-08-05 — Slice 0: durable generation foundation

Base HEAD: `e720d5818ab15efccfa143c94d6514c0c9a2baad`
Branch: `codex/localcast-prototype`
Runtime: Node `v20.19.2`, npm `9.2.0`, Docker `29.6.0`, Compose `5.1.4`

### Delivered

- Strict Zod runtime/role/provider configuration with production fail-closed behavior and exact provider status labels.
- Explicit, identity-bound production storage initialization; ordered migration 004; SQLite integrity/FTS checks; no demo seeds.
- Durable FIFO jobs, attempts, events, millisecond-precise leases, heartbeats, process-unique fencing, retry primitives, and a separate worker.
- Test-only deterministic transcript/MP3 generation isolated from production build entrypoints and Docker context.
- Same-origin production UI/API serving, relative browser API access, no browser credential fields or mock fallback, and no third-party font request.
- Digest-pinned non-root/read-only Compose app and worker with separate persistent SQLite/media volumes and profile-gated initialization.
- Vitest, Playwright, API/process, production-artifact, and Compose test layers.

### Independent read-only reviews

Three reviewers separately covered architecture, runtime/deployment, and security/privacy/accessibility. Material findings were fixed before the final gate: explicit storage initialization, lease heartbeat/fencing and precise expiry, production/test artifact separation, identity-before-migration, legacy status reconciliation, active shutdown evidence, process-level claim/crash tests, legacy topic quarantine, fake repeatability, browser phase/reload/no-autosync evidence, and accessibility/error-state cleanup. No subagent edited files.

### Repair ledger

| Area | Failing evidence | Evidence-based repair | Final result |
| --- | --- | --- | --- |
| Browser generation scenario | `npm run test:e2e` first found ambiguous `Sources`; later runs showed reload returned to the in-memory Dashboard and `View` matched `View history`. | Required exact accessible names, reopened the persisted run after reload, and lengthened deterministic phase visibility. | Targeted scenario and final two-test browser gate pass. |
| Worker crash harness | `npm run test:integration` first intermittently let the validating attempt complete; after lease precision was corrected, all six crash cases consistently showed the killed launcher’s child surviving. | Serialized Vitest files and launched test TypeScript with `node --import tsx`, so SIGKILL targets the actual worker. | All phase kills and post-publication replay pass; final integration suite is 31/31. |
| Lease heartbeat | `npm run test:integration` allowed a competitor to reclaim a heartbeating lease within the same second. | Compared fixed-width UTC ISO timestamps directly instead of SQLite `datetime()`, which discarded milliseconds; aligned the lease index. | Focused heartbeat/queue suite 16/16; final integration suite passes. |
| Compose smoke | Initial runs omitted the profile-gated initializer from static config, then used top-level `await` in a CommonJS `node -e` probe. | Inspected config with the `init` profile and wrapped probes in async functions with correct escaping. | Final Compose gate proves fresh-volume refusal, explicit init, healthy non-root roles, no host port, clean artifact, and persistence across container recreation. |

No deterministic failure remained after three repair attempts. Docker verification required approved access to the local engine because sandboxed BuildKit metadata was read-only; it used only unique `localcast-slice0-*` projects and removed their containers, networks, and volumes.

### Targeted evidence

| Exact command | Result |
| --- | --- |
| `npm audit --omit=dev` | PASS, exit 0 — `found 0 vulnerabilities` |
| `npm run lint` | PASS, exit 0 — TypeScript emitted no diagnostics |
| `npm run test` | PASS, exit 0 — 2 files, 31 tests |
| `npm run test:integration` | PASS, exit 0 — 4 files, 31 tests |
| `NODE_ENV=test LOCALCAST_RUNTIME_MODE=test DATABASE_PATH=:memory: MEDIA_PATH=/tmp/localcast-vitest-media npx vitest run tests/integration/worker-process-recovery.test.ts` | PASS, exit 0 — 8 process tests, including competing workers, every persisted phase, active SIGTERM, and post-publication replay |
| `npx playwright test tests/e2e/generation-phases.spec.ts` | PASS, exit 0 — explicit sync/generation, zero pre-action fetches/jobs, all phases, reload/reopen, persisted completion |
| `npm run smoke:api` | PASS, exit 0 — API/worker separation, deterministic repeatability, safe failure, restart persistence |
| `npm run smoke:compose` | PASS, exit 0 — isolated image/topology/storage/recreation gate |
| `git diff --check` | PASS, exit 0 at 2026-08-05 18:39:04 CDT — no whitespace errors after documentation reconciliation |

### Full phase gate

Started 2026-08-05 18:30:42 CDT:

```text
npm run verify
```

PASS, exit 0:

- `npm run lint`: no diagnostics;
- `npm run test`: 31/31;
- `npm run test:integration`: 31/31;
- `npm run build`: Vite transformed 2,090 modules; server emitted `index.js`, `worker.js`, and `storageInit.js` without source maps;
- `npm run test:e2e`: 2/2;
- `npm run smoke:api`: passed;
- `npm run smoke:production`: passed;
- `npm run smoke:compose`: passed.

The next slice requires O-002: server-side OpenAI configuration, explicit cloud-processing consent, and a minimal authorized live-test budget.
