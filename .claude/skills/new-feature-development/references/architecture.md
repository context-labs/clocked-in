# Architecture: service / transport / store discipline

The source of truth is the repo's `AGENTS.md` files (root and per-app;
`CLAUDE.md` are symlinks to them). This condenses the rules a feature must obey
and points at the enforcement so you can trust them rather than re-derive them.

## The layering

```
transport (tRPC/HTTP router, queue consumer, cron)
   → parses input, authenticates, authorizes, delegates
service (business logic; the only layer that orchestrates a workflow)
   → calls one or more stores, publishes events, enforces rules
store (data operations ONLY; one row-shape ↔ one table/query)
   → drizzle (production) / in-memory (tests)
```

### Transport layers never hold business logic
- Routers **parse, authenticate, authorize, and delegate to a service** — nothing
  more. No business rules, no orchestration, no data massaging beyond
  input parsing.
- **Routers must not import or call DB stores directly.** DB-backed workflows live
  in `src/services/*`. (Enforced — see lint below.)
- Keep substantial input schemas out of the router body: put them under
  `src/routers/schemas/*` and import named schemas.
- Shared auth helpers live in `src/auth`/router validation utilities; shared HTTP
  response helpers in `src/http/*` — not inlined per handler.
- Logger child names should match the current function/operation name exactly.

### Business logic belongs in services
- Prefer extending an **existing** service when the responsibility fits. Do not
  create narrow one-method services when an existing service already owns the
  workflow.
- Services take their dependencies (stores, other services, publishers, logger)
  by constructor injection and own the workflow end to end.

### Stores do only data operations
- A store is a **pure repository with zero business logic** — reads and writes,
  nothing else. No policy, no orchestration, no conditionals that encode a rule.
- Stores are **always accessed through a service layer**, never directly from a
  router/transport or another store. The service owns the workflow; the store
  just persists and fetches.
- A store method is a single, honest data operation. Its **name describes the
  operation, not the business intent** — prefer `updateLastActivityAt` over
  `touchActivity`.

## The store / service triad (packages/services/*)

A domain service package is a **port + two adapters + a service**:

```
src/stores/foo-store.ts            # the FooStore interface (the port)
src/stores/drizzle-foo-store.ts    # production, Drizzle-backed
src/stores/in-memory-foo-store.ts  # unit tests + dry-run smoke
src/foo.service.ts                 # business logic; ctor takes store: FooStore
```

The in-memory store lets unit tests exercise real service logic with no DB. See
`advertising-service`, `team-service`, `billing-service`, `user-service` for
canonical examples. (The `service-package-generator` skill scaffolds this shape —
use it when a genuinely new domain service is warranted.)

## Domain errors → transport errors

Handlers stay **bare** — never wrap a handler body in try/catch to translate
domain errors into `TRPCError` codes. Instead:

1. Services throw typed domain error classes (`NotFoundError`,
   `FixedEvalQuotaExceededError`, `ProjectNotFoundError`, …).
2. Every procedure runs the **`mapDomainErrors`** middleware
   (`src/routers/trpc.ts`). When a resolver throws a non-TRPC error, the
   middleware routes the cause through **`src/services/domain-trpc-errors.ts`**,
   whose `toDomainTrpcError()` maps each error class to a `TRPCError` code.
3. To support a new domain error on the wire, **add one `instanceof` branch in
   `domain-trpc-errors.ts`** — do not scatter try/catch across routers (routes
   added later silently miss the mapping, and it buries transport policy in
   business code).

**Critical leaf-import rule:** error classes consumed by `domain-trpc-errors.ts`
must be importable **without pulling the owning service's full graph** — import
them from a dependency-free leaf subpath (e.g.
`@inference-net/inference-analysis-service/errors`,
`@inference-net/team-service/api-keys`), never the heavy barrel. Importing the
barrel drags queue/pipeline/DI deps into every router's module graph and can
create cycles or — as we learned the hard way — dual module instances that break
`instanceof`. See `leaf-packages.md`.

## Database connections & transactions (Worker rules)

Workers talk to Postgres through Hyperdrive on a **single-connection pool per
request** (`max: 1`). Three hard rules (from `apps/llm-ops-trpc-api/AGENTS.md`):

- Create request-scoped clients only via `createRequestDb` (`src/lib/request-db.ts`)
  — never `createDrizzleClient`/`createPostgresPool` directly. It carries the
  `max: 1` + bounded `connectionTimeoutMillis` in one place.
- Every request-scoped client MUST be destroyed when the response is done
  (`executionCtx.waitUntil(destroy())` or `try/finally`). Thread the existing
  `db` through rather than creating a second client.
- Inside `db.transaction(async (tx) => …)`, **every query must run on `tx`**, never
  the outer `db` handle — a `max: 1` pool self-deadlocks otherwise. Thread `tx`
  into services via `createDrizzleTransactionContext({ executor: tx })`.

**Cross-service atomicity without cycles.** When a unit of work must commit
all-or-nothing across **multiple stores or services** (e.g. create the row *and*
record the billing charge, so a failure rolls both back), use a
**`TransactionContext`**: the caller opens the transaction and passes the context
(the `tx` executor) down through each service/store method as a parameter. Because
the executor is *passed in* rather than one service importing another's store or
db handle, you get atomicity **without introducing circular dependencies** between
services and their stores. Every store method takes an optional
`ctx?: TransactionContext` from day one so it can enlist in a caller's transaction
later; retrofitting it afterward is painful. (See `wire-billing-charge` /
`service-package-generator` for the canonical shape.)

## What enforces this (custom lint rules)

`tooling/eslint-config/` registers `@kuzco/*` rules — you don't have to
police these by eye, but you should know they'll fail `task check`:

- **`@kuzco/no-outer-db-in-transaction`** — flags a reference to `db` / `ctx.db` /
  `this.deps.db` inside a `.transaction(cb)` callback. `{ db: tx }` is allowed. If
  you must intentionally touch the outer handle, disable the rule for that line
  with a comment explaining why it can't deadlock.
- **`@kuzco/no-db-types-outside-store`** — keeps DB/drizzle types confined to
  stores, reinforcing the store boundary.
- Plus `no-inline-web-data-fetching` (apps/web) and others.

## Other repo-wide rules worth internalizing (from root `AGENTS.md`)

- Dependencies must be explicit and fully wired — don't make a dep optional/nullable
  just because a path doesn't use it yet; pass the real dependency through.
- Name dependency fields after the injected service (`teamReadService:
  TeamReadService`), typed with the whole stable interface — not a `Pick<>` or a
  new role-alias interface.
- Prefer Zod schemas / built-in `in`/`Array.isArray`/`typeof` over custom runtime
  validators or type guards.
- Never swallow a promise rejection with `.catch(() => undefined)`; log a warning
  with context if it's intentionally non-fatal.
- Don't put independent async work in a serial `for` loop — use bounded-concurrency
  helpers (`limitConcurrency`).
- New config is required-by-default and fails fast when missing (no defensive
  fallbacks unless the user asked for a gradual rollout).
- **Avoid loose types.** No `any`/`unknown`/cast-heavy code or gratuitous
  optionality where a precise typed model or Zod schema would make the shape
  explicit. Don't use resolved TS utility types (`ReturnType`, `Parameters`,
  `Awaited`) — import the underlying type.
- **No `Bun.*` APIs in code that can run in a Cloudflare Worker.** Bun's runtime
  globals don't exist there; use standard Web/Node-compatible APIs and the
  Worker-safe leaf packages instead. Assume new service/transport/util code may
  end up in a Worker unless you know it can't.
- Comment the code as it *is*, not the story of how it changed. No temporal /
  change-narration comments.

## What's enforced vs advisory (and lint candidates)

Some of this is caught deterministically by `task check`; the rest is discipline
you and reviewers have to hold. Knowing which is which tells you where to trust
the machine and where to look harder:

- **Enforced by custom lint today:** `@kuzco/no-outer-db-in-transaction`,
  `@kuzco/no-db-types-outside-store`, `@kuzco/no-inline-web-data-fetching`,
  `@kuzco/no-store-imports-in-routers` (routers may not import DB stores; put
  store access behind a service), plus format/typecheck.
- **Advisory today, but good candidates for a lint rule** (worth proposing if this
  guidance keeps getting missed): no `Bun.*` in true Cloudflare-Worker packages
  (needs a curated worker-app allowlist — `wrangler.jsonc` alone isn't a reliable
  signal, e.g. `openai-rest-server` runs under `Bun.serve`); error classes imported
  from leaf subpaths (not heavy barrels) in transport code; stores containing no
  control-flow/business logic. When you notice a rule being violated repeatedly,
  the durable fix is a lint rule in `tooling/eslint-config/rules/`, not another
  line in a doc.
