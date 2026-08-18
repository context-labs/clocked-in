# Infrastructure building blocks

Build features on these rather than hand-rolling. Each entry: the package, what
it gives you, and how a feature is expected to use it.

## tRPC transport — `@kuzco/trpc-router` (+ `apps/*-trpc-api`)

The request/response transport for dashboard sessions and API-key callers.

- Core setup in `packages/trpc-router/src/trpc.ts`: `initTRPC.context<TRPCContext>()`,
  routers via `createTRPCRouter = t.router`, composed in `src/root.ts`
  (`serverRouter`).
- Procedures build on a `baseContextProcedure` that seeds `httpRequestContext`
  (requestId, userId, teamId, path, method) and enforces maintenance mode. The
  middleware stack layers `enforceSuperadminReadonly` → `enforceActiveUser` →
  `enforceActiveTeam` → `enforcePhoneVerified`, exposed as `publicProcedure`,
  `protectedProcedure`, `verifiedUserProcedure`. Pick the procedure whose auth
  guarantees match your endpoint; don't re-check auth in the handler.
- Routers only parse/authenticate/authorize/delegate (see `architecture.md`);
  domain errors are mapped centrally via `mapDomainErrors` + `domain-trpc-errors.ts`.

**Use for:** any synchronous read/write a client calls. Add a procedure, put its
input schema under `routers/schemas/*`, delegate to a service.

## Postgres — `@kuzco/db`

Drizzle-based relational storage.

- `createDrizzleClient` → `{ db, pool, destroy }` (wraps a `pg.Pool`). Stores live
  under `src/stores/*` and do data ops only.
- Request-scoped access: `src/request-context.ts` keeps clients in an
  `AsyncLocalStorage` keyed by role (`primary` / `read-only` /
  `analytics-read-only`). In Workers, always go through `createRequestDb`
  (`apps/llm-ops-trpc-api/src/lib/request-db.ts`) — single Hyperdrive connection,
  `max: 1`, bounded timeout, caller destroys it.
- Transactions: `createDrizzleTransactionContext({ executor: tx })`
  (`src/transaction.ts`) wraps a `tx` so services thread the transaction executor
  through. **Every query in a `db.transaction()` body runs on `tx`** — the
  `@kuzco/no-outer-db-in-transaction` lint rule enforces it.

**Use for:** durable relational state. Keep related writes in one transaction so
they can't half-apply; thread `tx` (via `TransactionContext`) into every store
call inside it — including across services, which gives cross-service atomicity
without importing one service's store into another (no cycle). **Bound your
reads:** paginate list endpoints and stream large result sets — never "select all
rows" into memory.

## RabbitMQ — `@inference-net/rabbitmq-messaging`

Typed channel abstraction over rascal for async / decoupled work.

- `defineChannel<Payload>({ subscription, publication? })` (`src/define-channel.ts`)
  returns a `Channel<T>` with `publisher(broker, opts)`,
  `delayedPublisher(broker, opts)` (parks on a `.delay` queue, then dead-letters
  into the work queue after `delayMs`), and `consumer(broker, handler, opts)`.
- All channels are exported from `src/index.ts` (`AgentTraceExportChannel`,
  `EvalJudgeChannel`, `NotificationDeliveryChannel`, …) and defined in
  `src/channels/*.ts`. **Payload types come from the `cf-compatible-models` leaf**
  (e.g. `@inference-net/cf-compatible-models/agent-queue-payloads`), with rascal
  key constants from `@kuzco/models/constants`. This keeps `rabbitmq-messaging` a
  near-leaf that doesn't depend on domain-service packages.
- Publish: `SomeChannel.publisher(broker).send(payload)`. Consume: register
  `SomeChannel.consumer(broker, handler)`.

**Use for:** work that shouldn't block the request, needs retry/backoff, or fans
out to other services. **Publish after the DB commit** (don't emit an event for
work that then rolls back), and make consumers **idempotent** (a payload may be
delivered more than once).

## Redis / fast caching — `@inference-net/cache`

Pluggable cache primitives shared across Workers.

- `RuntimeCache` (`src/index.ts`): `getOrLoad<T>()` (cache-or-compute with
  in-flight dedup + optional null caching) and `getOrLoadStaleWhileRevalidate<T>()`
  (serve stale, refresh in the background).
- Backend chosen by the `CACHE_BACKEND` env (`auto`/`memory`/`kv`/`redis`) — flip
  between Cloudflare KV and Redis-over-the-VPC-tunnel without code changes. Also
  ships `src/rate-limit.ts`.

**Use for:** hot-path reads that are expensive to recompute and tolerate mild
staleness (config, policy, catalog lookups). Reach for
`getOrLoadStaleWhileRevalidate` when you'd rather serve slightly stale than block;
`getOrLoad` when correctness needs the fresh value but you want request
coalescing.

## Observability — `@kuzco/open-telemetry`

Shipped code must be observable. Two primitives:

- **Spans:** `TracerUtil.trace(name, cb, attributes?)` (`src/tracer-util.ts`)
  wraps any operation in a child span (merging trace + HTTP-request-context
  attributes); `TracerUtil.entryPoint(name, cb)` for request roots;
  `addAttributesToSpan` / `recordExceptionToActiveSpan` for enrichment.
- **Logging:** the `Logger` interface lives in the leaf
  `@inference-net/cf-compatible-models/logger` — `child(name, properties?)` makes
  a named child logger (name it after the function/operation), `setProperties`
  merges structured fields. Concrete impls in `packages/utils/src/logging/*` and
  `packages/server-utils/src/log/*`.

**Use for:** every meaningful operation — wrap it in a span, log through a child
logger named after it with structured properties. Structured fields over
string-concatenated messages; never swallow an error without at least a warning.

## Feature flags / progressive rollout — LaunchDarkly

Feature flags gate a change so it can ship dark, roll out gradually, and be A/B
tested. This is available and often the right call for user-facing or risky
features — but not mandatory; use judgment. Consult the `launchdarkly-*` skills to
create a flag (`launchdarkly-flag-create`), wrap code in it, set targeting, or run
a guarded rollout (`launchdarkly-guarded-rollout`). Access flags through the
repo's LaunchDarkly client/leaf utilities rather than a bespoke integration, and
keep the flag's default variation equal to today's behavior so turning it off is a
clean rollback.

**Portability note:** several apps run in Cloudflare Workers — write new code
against standard Web/Node-compatible APIs and the Worker-safe leaf packages, never
`Bun.*` runtime globals, so a feature isn't accidentally pinned to the Bun
runtime.
