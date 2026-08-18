---
name: new-feature-development
description: >-
  The end-to-end playbook for building a NET-NEW feature in the inference
  monorepo — the umbrella that turns "I want to build X" into shipped,
  observable, well-tested, service-pattern-compliant code. Use this whenever
  the user wants to add a feature, endpoint, page, service, queue consumer,
  cron, or capability ("build…", "add…", "implement…", "we need a way to…",
  "spec out…", "let's ship…", "wire up…", "expose…"), even if they don't say
  the word "feature", and even if they hand you a half-formed idea. It clarifies
  ambiguity first, grounds the work in the product's first principles, writes a
  living plan in `.ai-docs/`, delegates implementation across a diverse set of
  models, keeps the code observable and functional, runs the test + `task check`
  gates, and drives adversarial review. Prefer this skill over jumping straight
  into code for anything larger than a one-file change. Do NOT use it for pure
  debugging of an existing bug (use `fixing-a-bug`), ops/infra queries, or narrow
  scaffolds already owned by a dedicated skill (the `launchdarkly-*` family) —
  though this skill will hand off TO those at the right moment.
metadata:
  managed-by: context-labs/inf-internal-skills
  category: project-specific/inference-platform
---

# New Feature Development

You are the **architect** for a new feature in the inference monorepo. Your job
is not to type the most code — it's to make sure the right feature gets built
the right way: understood before started, planned before written, observable and
tested by default, reviewed adversarially, and green on `task check` before it's
called done. You orchestrate; you delegate the bulk of the typing to a diverse
set of models and keep judgment, structure, and verification for yourself.

This skill is an **umbrella**. It owns the *flow* and hands off to the
specialist skills that already own each step (`running-tests`,
`writing-tests`, the `launchdarkly-*` family, `multi-model-orchestration`).
When a step says
"use skill X," actually invoke it — don't reimplement it from memory.

The reference files hold the repository-specific detail. Read the one relevant
to the step you're on rather than loading everything up front:

- `references/architecture.md` — the service/transport/store pattern, how domain
  errors reach the wire, and the lint rules that enforce all of it. **Read
  before writing or delegating any router/service/store code.**
- `references/leaf-packages.md` — the dependency-free shared packages you build
  on, and the leaf-subpath rule that keeps the graph acyclic.
- `references/infra.md` — RabbitMQ, Postgres, Redis caching, tRPC, feature flags,
  and observability: what's available and how features are expected to use it.
- `references/datastores.md` — Postgres vs ClickHouse: which one owns which kind
  of data, worked examples of the choice, and how to read/write each safely
  (parameterized queries, batched inserts, no transactions or unique constraints
  in ClickHouse). **Read before deciding where a feature's data lives.**
- `references/database-migrations.md` — the Drizzle schema-to-migration flow:
  where tables live, the `task db-generate` / `task db-migrate` / `task db-check`
  commands, custom SQL migrations for backfills, the expand/migrate/contract rule
  for rolling deploys, and the single-leaf DAG recovery after a rebase. **Read
  whenever the feature adds or changes a Postgres table, column, index, or enum.**
- `references/configuration.md` — how a config value gets from Infisical into a
  service: the one-`config.ts`-per-app boundary, placeholders in every
  environment, Worker typegen and deploy-time secret pushes, what the PR must
  say, and safe rolling deploys for required variables. **Read whenever the
  feature adds or renames an environment variable.**
- `references/local-dev.md` — running the stack, resetting/seeding the DB,
  logging in, and the `task check` gate.
- `references/seeding.md` — the local data-seeding system: what
  `task reset-database -- -y` seeds and where, the well-known test users/IDs,
  and the pattern for extending the seed so a new feature is tryable after a
  reset. **Read when deciding whether the feature needs seed data (step 7).**
- `references/linear-ticket-hygiene.md` — what you owe a Linear ticket while you
  work it: state transitions, which comments are worth posting, and the
  `linear`-skill mechanics. **Read as soon as the work is tied to a ticket.**
- `../../../general-capabilities/multi-model-orchestration/model-routing.md`
  — which models write the plan vs type the code. **Read before step 4** —
  ask which planner (do not assume fable), then route implementation to
  grok 4.6 high/xhigh and gpt-5.6-terra at `--effort xhigh`.

## Design principles (apply throughout)

These aren't a step — they shape every design decision. Hold them in mind from
the plan onward, not as a cleanup pass at the end:

- **Build for failure and scale from the start.** Prefer designs that are
  **idempotent** (a retried message or replayed request produces the same state,
  not a double-charge or duplicate row), **resumable** (long/multi-step work can
  pick up where it left off rather than restart), **durable** (state that matters
  survives a crash — persisted before it's acted on), and **paginated/streamed**
  (reads and responses are bounded — never "load all rows" or buffer an unbounded
  response). When a design can't be idempotent, say why in the plan and make the
  window as small as possible.
- **Precise types, not loose ones.** Avoid `any`/`unknown`, gratuitous optionality,
  and cast-heavy code that hides the real shape. Model the domain with explicit
  types / Zod schemas so the compiler catches mistakes the tests won't. A loose
  type is a latent bug and a maintenance tax.
- **No hardcoded strings — name every fixed value.** A string literal repeated
  across files is invisible to the compiler and to rename/refactor tooling. Any
  value from a closed set (statuses, roles, tiers, event/channel names, queue and
  cache-key prefixes, feature-flag keys, error codes, metric/span names, route
  paths, header names) belongs in a named `const`, a `const` object with a derived
  union type, or a Zod enum — exported from the module that owns the concept
  (usually a leaf package) and imported by every caller. The same applies to magic
  numbers: timeouts, limits, page sizes, and retry counts get names, not inline
  digits. Type the parameter as the union, never as bare `string`, so passing an
  unlisted value is a compile error and adding a member forces every `switch` to
  be updated. Prefer `as const` objects / Zod enums over TypeScript `enum`s
  (`enum` isn't erasable-syntax safe and doesn't survive `isolatedModules`-style
  builds cleanly). Genuinely one-off literals — a single log message, a test
  fixture, a one-call-site SQL fragment — stay inline; the rule is about values
  that cross a boundary or repeat.
- **Configuration is parsed once, at the boundary.** `process.env` and a
  Worker's `c.env` belong in the app's `src/config.ts` and nowhere else. Parse
  and validate there with Zod, then pass typed values inward as explicit
  dependencies — a service that reads the environment in a method body can't be
  tested without mutating globals, fails when the code path runs instead of at
  boot, and breaks in Workers where the environment arrives per-request. New
  variables are required by default and should crash on startup when missing.
  A change that adds one has Infisical, Worker-typegen, PR, and rolling-deploy
  obligations — see `references/configuration.md` before writing the code.
- **Worker portability: no `Bun.*` in new code.** Several apps run in Cloudflare
  Workers, where the Bun runtime APIs don't exist. Don't reach for `Bun.file`,
  `Bun.env`, `Bun.$`, etc. — use standard Web/Node-compatible APIs (and the repo's
  Worker-safe leaf packages) so the code runs everywhere, not just under Bun.
- **Progressive rollout with LaunchDarkly.** For user-facing or risky changes,
  consider gating the feature behind a LaunchDarkly flag so it can ship dark and
  roll out gradually (and A/B test). It's available and often the right call — but
  not mandatory; use judgment, and reach for the `launchdarkly-*` skills
  (`launchdarkly-flag-create`, `launchdarkly-guarded-rollout`, …) when a flag fits.

## Keep the Linear ticket current (throughout)

If the user gave you a Linear ticket — an identifier like `INF-1234`, an issue
URL, "pick up the X ticket", or a plan folder named after one — **the ticket is
part of the deliverable and you keep it up to date without being asked.** Move it
to a `started` state when you begin, comment when a decision or scope change
lands, move it to the team's review state and link the PR when you open one, and
only mark it complete once the change has actually merged. Use the `linear`
skill for the reads and writes; read `references/linear-ticket-hygiene.md` for
what to post at each point and the state/comment mechanics.

Ticket updates are a side channel, not a substitute for talking to the user —
still report what you did in the conversation.

## The loop

Work the steps in order. Steps 0–3 are cheap and prevent expensive mistakes; do
not skip them because the feature "seems small." Steps 4–9 are the build.

### 0. Clarify ambiguity before doing anything

A feature request is almost always underspecified, and building the wrong thing
well is the most expensive outcome there is. Before you plan, surface the
ambiguity and get answers. Ask about: the actual user problem (not the proposed
solution), who the caller is (dashboard session? API key? internal consumer?),
the read/write shape, what "done" looks like, non-goals, and any product
constraints you're unsure about. Prefer a short batch of concrete questions over
open-ended ones. If the user gave you a rich brief, confirm your understanding in
one or two sentences and flag only the genuine unknowns — don't interrogate them
about things they already answered.

The rule of thumb: **you should be able to write the plan's "Goal" and
"Non-goals" sections without guessing.** If you can't, you haven't clarified
enough.

### 1. Ground in the product's first principles

Before designing, check `docs/product-source-of-truth/` for the first-principles
description of the product area you're touching, and make the plan adhere to it.
(This directory is new and may not exist yet — if it's absent, say so, proceed on
the user's stated intent, and note the gap in the plan so it can be reconciled
later. Do not invent product doctrine to fill the void.) If it does exist, read
the relevant docs and cite the principles your design depends on, so a reviewer
can check the feature against the source of truth rather than your interpretation
of it.

### 2. Understand the architecture you're building into

Read `references/architecture.md` and `references/leaf-packages.md`. The
non-negotiables you are designing around:

- **Transport layers never hold business logic.** Routers (tRPC/HTTP) parse,
  authenticate, authorize, and delegate to a service — nothing else. They must
  not touch DB stores directly. Business logic lives in services; **stores are
  zero-logic data repositories reached only through a service.** This is enforced
  by lint, not just convention.
- **Reuse the layer that already owns the concept.** Prefer extending an existing
  service over inventing a narrow one-method service; prefer an existing leaf
  package/helper over a bespoke one. New shared concerns become leaf packages so
  infra/transport can depend on them without cycles.
- **Depend on leaf subpaths, not heavy barrels,** when a transport or infra
  module needs a type or error class from a domain service.

Decide, and write down in the plan: which existing services/packages this
extends, what (if any) new service or leaf package is needed, the transport
surface (tRPC procedures? a queue consumer? a cron? a web page?), the data model,
and which infra it leans on (see step 3).

### 3. Pick the infra deliberately

Read `references/infra.md`. Build on what's there rather than hand-rolling:

- **tRPC** for request/response transport (dashboard + API-key callers).
- **Pick the datastore first.** **Postgres is the default** — the transactional
  system of record for ~97 tables, including high-volume append-only logs like
  `billing_records` and `credit_transactions` that stay there because
  correctness depends on uniqueness, FKs, and transactions. **ClickHouse is the
  analytics plane**: a dozen enormous fact tables and their rollups (`inferences`
  at 800M+ rows, `spans*`, training logs/metrics, `*_stats_*`) whose defining
  read is a `GROUP BY` over a huge number of rows. The discriminator is query
  shape and scale, not append-only-ness; ClickHouse has no transactions, no
  unique constraints, no cross-store joins, and no read-your-writes. Read
  `references/datastores.md` for the decision questions, worked examples, and
  the read/write patterns for each.
- **Postgres via `@kuzco/db`** (drizzle stores, request-scoped `createRequestDb`).
  Schema changes are generated, never hand-written: edit the table under
  `packages/db/src/tables/`, export it from `src/schema.ts`, then
  `task db-generate` and `task db-migrate` and commit the generated folder in
  `apps/migrations/src/migrations/`. Read `references/database-migrations.md`
  before designing the data model — the rolling-deploy constraint (expand,
  migrate, contract across separate PRs) changes what a single PR can do.
  When a unit of work spans multiple stores or services and must be atomic, thread
  a **`TransactionContext`** through — it gives you all-or-nothing commit *without*
  creating circular dependencies between services and their stores (the executor
  is passed in, not imported). See `references/architecture.md`.
- **ClickHouse via `@inference-net/llm-ops-clickhouse`** for event/analytics data:
  store functions take the client as their first argument, queries are
  `{name:Type}`-parameterized and tenant-filtered, inserts are batched and
  retried, and schema changes are hand-written numbered SQL under that package's
  `migrations/` (applied by `task db-migrate-clickhouse`). Time-series/chart
  reads come off the MV rollups (`task_stats_1h`, `platform_inference_stats_1d`)
  rather than scanning `inferences`; per-row browsing still queries the fact
  table directly.
- **RabbitMQ (`@inference-net/rabbitmq-messaging`)** for async / decoupled work —
  define a channel, publish after commit, consume idempotently.
- **Redis / `@inference-net/cache`** (`RuntimeCache.getOrLoad` /
  `getOrLoadStaleWhileRevalidate`) for hot-path reads that are expensive to
  recompute.

Prefer the boring, scalable composition: a service method that does its work in a
transaction, publishes an event if downstream work is needed, and caches
read-heavy lookups. Call out in the plan anything that could leave state
half-applied, and make it atomic.

### 4. Write a living plan in `.ai-docs/`

**Pick the planner first.** Ask the user which model should write the plan —
fable (recommended), opus, or gpt-5.6-sol — using a structured question.
Do not silently start as fable; opus and sol are fine when the user picks
them. See
`../../../general-capabilities/multi-model-orchestration/model-routing.md`.
If this session is not the chosen planner, delegate the plan write through
`multi-model-orchestration`.

Create the plan as an initiative folder with a `README.md` entry point:
`.ai-docs/plans/<inf-ticket-or-slug>/README.md`. Follow the de-facto format used
by neighbors there: an H1 title, a `Branch:` line, a short "What this does" /
"Goal", "Non-goals", the design (services/stores/schemas/transport with concrete
file paths), the infra choices, the observability plan, the seed-data plan (does this
feature need seeded data to be tryable after a reset? — see step 7), the test
plan (which levels — see step 8), and an ordered task breakdown.

This document is **the shared source of truth for the implementation** — you,
the delegated model lanes, and any reviewer read it. Keep it updated as you go:
check off tasks, record decisions and deviations, and leave enough breadcrumbs
that a fresh agent could pick the work up mid-stream. A stale plan is worse than
no plan.

**Checkpoint:** get the user's sign-off on the plan before writing code. This is
the cheapest place to correct course.

### 5. Implement — grok 4.6 high/xhigh and gpt-5.6-terra at xhigh

Once the plan is approved, drive the build through
`multi-model-orchestration`. You are the architect: decompose the plan into
well-specified units and route each to the **implementer** roster in
`../../../general-capabilities/multi-model-orchestration/model-routing.md`
— grok 4.6 at `--effort high` or `xhigh`, and
`gpt-5.6-terra` at `--effort xhigh`. Do not send implementation to fable, opus, or
gpt-5.6-sol. Race grok against terra on the same spec when correctness
matters and pick the stronger diff. If this session is already one of those
implementers, it may type the code itself and send the other as the
cross-check. Keep the judgment (architecture, interfaces, spec-writing,
verifying diffs) yourself; keep your own context lean. Read
`multi-model-orchestration` for the spec contract, the lane preflight, and
how to invoke a lane — and do not judge a lane unavailable from a CLI's
self-reported login state; use the skill's round-trip preflight.

As code lands, keep the `.ai-docs` plan current and re-read
`references/architecture.md` to make sure the delegated code respects the
transport/service/store boundary and the error-mapping pattern (bare handlers +
`mapDomainErrors`, error classes from leaf subpaths — never per-handler
try/catch).

**Write functional code where it fits.** Prefer pure functions and explicit data
flow over stateful, side-effecting tangles: it's easier to test, reason about,
and delegate. Push I/O to the edges (stores, publishers) and keep the core logic
pure.

### 6. Make it observable — always

Observability is not a follow-up; unobservable code is a liability the moment it
ships. Every meaningful operation must be traceable and logged:

- Wrap operations in spans with `TracerUtil.trace(name, cb, attributes)` so the
  work shows up in traces with useful attributes.
- Use child loggers named after the function/operation
  (`logger.child("operationName")`) with structured properties via
  `setProperties`, not string-concatenated messages.
- Never swallow errors silently — if something is intentionally non-fatal, log at
  least a warning with enough context to debug it.

See `references/infra.md` (Observability) for the exact helpers.

### 7. Seed the data QA needs to try it

Every feature should be **tryable on a freshly-seeded local stack**: someone
runs `task reset-database -- -y`, logs in as `test@inference.net` / `t`, and
your feature is right there with realistic data behind it — no hand-crafted
rows, no tribal knowledge. Ask explicitly: *does this feature need seed data to
be exercised?* A new page with nothing to show, an endpoint whose entities
don't exist locally, or a workflow that needs a specific team/tier/state is
effectively untestable for QA until the seed covers it.

Read `references/seeding.md` and follow its extension pattern: a typed
`XXX_SEEDS` fixture array + an idempotent `seedX()` with deterministic IDs in
`apps/relay/src/scripts/seed-test-resources.ts`, attached to the well-known
identities from `packages/api/src/lib/const.ts`, called from `main()` in FK
order. Catalog data that every environment needs goes in
`packages/db/src/seed/` instead. Verify by resetting and walking the feature end
to end on seeded data alone, and name the seeded entry point (user/project/IDs)
in the PR description.

Not every feature needs new seed data — pure infra or an internal refactor may
not. But make that a deliberate decision recorded in the plan, not an omission.

### 8. Test at the right level

Use the **`running-tests`** skill to run tests and the **`writing-tests`** skill
for how to write them. Choose the level by what you're actually de-risking —
don't reach for the heaviest tool by default:

- **Unit** — pure logic, query/prompt builders, service business logic against a
  memory store. The default; cheapest and fastest.
- **Integration** — real DB/ClickHouse/queue behavior, store correctness,
  cross-service wiring.
- **Web e2e (Playwright)** — authenticated, cross-layer dashboard workflows where
  the value is real integration across browser + auth + tRPC + downstream stores.
  These are expensive (full service mesh, DB reset+seed, cold-hydration waits),
  so reserve them for user-visible acceptance flows — not for logic a unit test
  covers. `running-tests` documents how they're set up, how to write them, and
  when they're worth it.

A feature is under-tested if a plausible regression wouldn't fail any test, and
over-tested if it spins up a browser to check a pure function.

### 9. Gate on `task check`, then review adversarially

- **`task check` must pass** before the feature is "done" — it's the scoped
  typecheck + lint + affected-tests gate that CI mirrors. Run it (and
  `task check-fix` for autofixable lint/format + Worker typegen) as part of the
  writing loop, not just at the end. See `references/local-dev.md`.
  If the change touched the Postgres schema, the generated migration folder must
  be committed alongside it — `task check` runs `db-check:scoped`, and CI's
  freshness job re-runs `drizzle-kit generate` and fails on any diff. See
  `references/database-migrations.md`.
  If the change touched a Worker binding or env var, run `task check-fix`
  **first** and commit the regenerated `worker-configuration.d.ts` — only
  `check-fix` runs typegen; plain `task check` just validates, so on its own it
  reports the stale binding as a type error in your code.
- **Adversarial code review with diverse models.** Run
  `/thermo-nuclear-code-quality-review` on the change to push hard on structure,
  simplification, and maintainability, and get a second cross-vendor perspective
  by sending the diff to a lane from another model family (see
  `multi-model-orchestration`) so the code isn't rubber-stamped by the same model
  that wrote it. Fix what survives review;
  don't accept "it works" that leaves the codebase messier.

- **Close the loop on the ticket.** When the PR is up, move the Linear issue to
  the team's review state and comment with the PR link, a short summary of what
  shipped, and how it was verified. See `references/linear-ticket-hygiene.md`.

Do not write changelog entries as part of this flow — the `changelog` skill
runs only when the user explicitly asks for it.

## Anti-patterns to refuse

- Writing business logic into a router "just this once," or into a **store** —
  stores are zero-business-logic repositories, reached only through a service.
- A router importing a DB store, or a service importing a heavy domain barrel
  where a leaf subpath exists.
- Reaching for ClickHouse because the data is append-only or high-volume. It's
  for tables read as aggregations over hundreds of millions of rows; anything
  whose correctness needs a transaction, a unique constraint, an FK, or
  read-your-writes belongs in Postgres regardless of volume (`billing_records`
  is exactly that).
- Interpolating values into a ClickHouse query string instead of using
  `{name:Type}` params, inserting one row per call, or editing an
  already-applied ClickHouse migration file instead of adding a new numbered one.
- Hand-writing or editing SQL in `apps/migrations/src/migrations/` instead of
  generating it with `task db-generate` (use `db:generate:custom` for backfills),
  or hand-editing `snapshot.json` / `prevIds` to paper over a multi-leaf DAG.
- A single PR that both stops writing a column and drops it — during a rolling
  deploy the old pods are still writing it. Expand, migrate, contract.
- Querying the outer `db` handle inside a transaction (self-deadlock; lint blocks
  it — thread `tx` via `TransactionContext`).
- `Bun.*` APIs in code that can run in a Cloudflare Worker (it will break there).
- Loose types (`any`/`unknown`/cast-heavy) that hide the real shape.
- Hardcoded string literals or magic numbers for values from a closed set —
  statuses, roles, tiers, queue/channel names, cache-key prefixes, flag keys,
  error codes, route paths. Export a named constant / `as const` union / Zod enum
  and type the parameter as the union, not `string`.
- A queue consumer or retryable path that isn't idempotent, or a read that loads
  an unbounded result set instead of paginating/streaming.
- Shipping a code path with no span and no structured log.
- Shipping a user-facing feature that is invisible on a freshly-seeded stack —
  no seed data, so QA can't try it without hand-crafting rows (step 7).
- Skipping the clarify/plan steps and delegating a fuzzy spec — the cheap lanes
  will faithfully build the wrong thing.
- Calling it done with `task check` red or without an adversarial review pass.
- Working a ticketed feature while the Linear issue sits in `Todo` with no
  comments, or opening the PR without moving the issue to review and linking it.
