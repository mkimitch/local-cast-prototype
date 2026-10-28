# LocalCast agent operating contract

This repository is intended for a mostly autonomous, evidence-driven build. This file is the operational contract for every agent working here.

## Authority and required reading

Before changing code, read these files in order:

1. `AGENTS.md`
2. `docs/codex/SPEC.md`
3. `docs/codex/DECISIONS.md`
4. `docs/codex/PLAN.md`
5. `docs/codex/STATE.md`
6. `docs/codex/TEST_MATRIX.md`
7. `docs/codex/BUILD_LOG.md`

The latest user instruction wins over repository documents. `SPEC.md` defines product scope, `DECISIONS.md` records architectural choices, `PLAN.md` defines slice order, `STATE.md` is the current execution ledger, `TEST_MATRIX.md` defines observable completion evidence, and `BUILD_LOG.md` retains checkpoint commands and repair history. Do not silently reinterpret conflicts; record them and stop if they materially affect the current slice.

## Hard preflight

At the start of every implementation session, confirm:

```bash
pwd
git branch --show-current
git status --porcelain=v1 --untracked-files=all
```

Required values are:

- repository path: `/opt/stacks/local-cast-prototype`
- branch: `codex/localcast-prototype`
- clean working tree

If any check fails, do not edit. Return a concise `BLOCKED` report with the observed path, branch, and status. Never discard or overwrite unknown changes.

## Writer and delegation policy

- The primary agent is the only writer and the only agent allowed to stage or commit.
- Delegate only bounded, read-only investigation or review tasks. State explicitly that subagents must not edit, create, delete, format, stage, or commit files.
- Use at most three read-only subagents at once. Good boundaries are architecture, tests/runtime/deployment, and security/privacy/accessibility.
- Never permit simultaneous edits by multiple agents, including “small” documentation edits.
- Wait for every delegated report and reconcile disagreements before the primary agent writes.
- Treat subagent claims as review input, not proof. The primary agent must inspect the relevant evidence before acting.

## Vertical-slice loop

Work on exactly one numbered slice from `PLAN.md` at a time. Do not start a later slice to avoid a failure in the current one.

For each slice:

1. Reconfirm the preflight and the current state in `STATE.md`.
2. Map the smallest end-to-end change that satisfies the slice acceptance IDs.
3. Inspect surrounding code and preserve established project patterns.
4. Implement only that slice. Keep migrations additive and changes reviewable.
5. Run the narrowest useful tests while developing.
6. Run all targeted checks named by the slice.
7. Delegate independent read-only reviews after the implementation is stable.
8. Reconcile and fix material review findings within the same slice.
9. Run the full phase gate.
10. Update `STATE.md`, `DECISIONS.md` when a decision changed, and `TEST_MATRIX.md` with exact evidence.
11. Review `git diff`, `git diff --check`, and the staged diff for scope, secrets, generated files, and accidental churn.
12. Create one green checkpoint commit for the slice.
13. Continue automatically to the next slice when the checkpoint is green and no authorization or product decision is required.

Do not combine slices in one checkpoint. Do not create a checkpoint with a known failing required check.

## Verification and evidence

- Use repository package scripts. This repository currently uses npm and `package-lock.json`; do not migrate package managers as incidental work.
- Run targeted unit/integration/browser checks first, then the full gate specified in `PLAN.md` and `TEST_MATRIX.md`.
- Record the exact command, exit code or clear result, timestamp, and relevant environment mode in `STATE.md`.
- Live-provider and real podcast-client checks are evidence, not substitutes for deterministic automated tests.
- Never weaken, skip, delete, or rewrite a test merely to make a gate pass.
- Never substitute a mock for production behavior required by the current slice.
- Test-only fake providers must be explicitly enabled and must be impossible to select in production.
- If a check cannot run, state why and treat its acceptance row as unproven.

### Deterministic failure limit

For the same deterministic failure, make no more than three evidence-based repair attempts:

- Record each attempt in `STATE.md` with the failing command, observed error, hypothesis, change, and new result.
- An attempt counts only when the evidence or implementation materially changes.
- After the third failed attempt, set the slice state to `BLOCKED`, preserve the evidence, and stop. Do not churn through speculative variants.

## Product and production invariants

- LocalCast is its own local-first product. Do not introduce Huxe naming, branding, or implied compatibility.
- A topic station directs synthesis of material that the user supplied. It never authorizes web research, search, or page scraping.
- An episode without adequate supplied evidence must fail honestly. Never turn an error, a topic instruction, or an empty input into factual source material.
- Every factual transcript claim and grounded chat answer must cite immutable episode-source snapshots with validated support artifacts. Unknown, unrelated, or invalid citations fail validation.
- Production must never silently select mock services or providers. Unknown configuration must fail closed or report `NOT CONFIGURED`.
- Provider status uses exactly `LIVE VERIFIED`, `CONTRACT TESTED ONLY`, or `NOT CONFIGURED`, with a safe reason and verification time where applicable.
- Provider keys remain server-side and may be sent only in the server’s authorization request to the configured provider. They must never enter browser bundles/storage/network, browser-facing API payloads, screenshots, logs, fixtures, or commits. The podcast token may be disclosed transiently only through the explicit trusted-operator feed-URL copy/reveal flow; it must remain masked by default and absent from bundles, persistent browser storage, routine APIs, logs, fixtures, screenshots, and commits.
- SQLite and media are durable user data. Use explicit migrations, atomic media publication, and recoverable operations.
- The production topology has one public application origin behind Caddy, one worker, and at most one active episode-generation job.
- Automatic scheduling, public deployment, accounts, general web search, embeddings, vector databases, Redis, distributed workers, analytics, multiple speakers, and voice cloning remain out of scope.

## Safety and authorization boundaries

Never do any of the following without explicit user authorization:

- push, merge, deploy, tag, rebase, amend, force-push, or destructively reset Git history;
- delete user data or replace a database/media directory;
- modify Caddy or another stack outside this repository;
- install or pull large local models, including Piper voice assets;
- rotate secrets or podcast tokens;
- expose the application publicly;
- add paid, unusually large, network-heavy, or security-sensitive dependencies.

Do not log or print environment files or secrets while debugging. Prefer temporary databases and fixture media under the OS temp directory for tests.

## Repository-specific implementation guidance

- Preserve the existing React/Vite/TypeScript frontend and Express route/service/store/provider separation.
- Preserve explicit `better-sqlite3` migrations, WAL, foreign keys, RSS deduplication, sync health/backoff, and the existing accessible design tokens.
- Add Zod for new or substantially changed external boundaries; migrate handwritten validators only when touched.
- Introduce React Router and TanStack Query incrementally where durable URLs, cache invalidation, polling, or mutation state require them.
- Prefer TypeScript and native platform APIs. Do not add abstractions before there is real duplication.
- Keep production provider selection in validated server configuration. The browser may display redacted status but may not configure secrets.
- Keep tests deterministic. Real-provider tests must use minimal synthetic material, explicit opt-in, and a documented cost boundary.
- Keep Caddy external to this repository. The application may document the proxy contract, but agents must not edit Caddy configuration without authorization.

## Stop conditions

Stop and return `BLOCKED` when:

- a hard precondition fails;
- the same deterministic failure survives three evidence-based repair attempts;
- the current slice needs a missing credential, paid call authorization, large model download, Caddy change, destructive data operation, or unresolved product choice;
- a required check cannot be made reliable without weakening its contract;
- unknown user changes overlap the files that must be edited.

A blocked report must contain the slice, exact command or decision, observed evidence, attempts already made, and the smallest user action needed to continue.
