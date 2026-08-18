# Leaf packages & the leaf-subpath rule

A **leaf package** carries none of the heavy cycle-causing dependencies
(inversify/DI, queue publishers, pipeline graphs, DB clients). Because it's a
leaf, transport code (routers, error mappers) and infra code (edge Workers,
messaging) can import it freely without pulling a big graph or creating a
package-level cycle. Building a feature well means **reaching for these first**
and putting genuinely shared concerns into a leaf rather than duplicating them or
importing a heavy barrel.

## The governing rule (root `AGENTS.md`)

> When injecting the whole service would close a package-level circular
> dependency (the importing package is already in the dependency's import
> closure), do not work around it with a resolver function or other narrow port.
> Extract the slice you need into a dedicated leaf package that carries none of
> the cycle-causing dependencies, then depend on that with its full type.

Canonical example: the billing-free lean team-read path lives at
`@inference-net/team-service/read` — a lean subpath of team-service with no
inversify/DI deps — so `billing-service` and edge Workers import it without
pulling the inversify graph or cycling back through
`@inference-net/team-service/service`.

## Standalone leaf packages

| Package | Path | What it's for | Deps (why it's a leaf) |
|---|---|---|---|
| `@inference-net/llm-ops-errors` | `packages/llm-ops-errors/` | Transport-agnostic HTTP-shaped error classes (`ApiError`, `BadRequestError`, `NotFoundError`, `InternalServerError`, `isApiError`) + utils | none — zero deps; any layer can import |
| `@inference-net/analytics-policy` | `packages/analytics-policy/` | Pure timeline/granularity policy (`GranularitySchema`, `TimeRangeSchema`, `getGranularityForTimeRange`, duration constants) | `zod` only |
| `@inference-net/cf-compatible-models` | `packages/cf-compatible-models/` | Cloudflare-Worker-safe model/message schemas (`./anthropic`, `./gemini`, `./openai`, `./training`) **and queue-payload schemas** (`./*-queue-payloads`, `./notification-envelope`, …) + the `Logger` interface (`./logger`) | `zod` only — edge-safe |
| `@kuzco/models` | `packages/models/` | Domain/service Zod models + constants (`./agent`, `./inference-analysis`, `./observability`, `./signal`, `./constants`); also re-exports `TransactionContext` | `cf-compatible-models`, `zod` |
| `@inference-net/cf-compatible-utils` | `packages/cf-compatible-utils/` | Worker-safe utilities: extraction, LaunchDarkly, S3 client, secret-crypto, webhook signatures, OTEL tracing (`./tracing`, `./worker-otel`) | only Worker-safe deps (sits one level above the schema leaves but stays cycle-safe) |

## Leaf SUBPATHS of heavy domain services

A heavy service exposes lean subpaths so cycle-sensitive consumers can import a
type / read-path / error class without dragging the full graph:

- **`@inference-net/team-service/read`** → `TeamReadService`, `TeamOwner`,
  `TeamReadStore`. Billing-free, no DI. (`./read/drizzle` carries the Drizzle
  store so importing the read path never pulls the DB client.) Sibling lean
  subpaths: `./api-keys`, `./profile`, `./members`, `./slug`, `./moderation`,
  `./directory`.
- **`@inference-net/inference-analysis-service/errors`** → launch-precondition
  error classes (`NoHaloEligibleModelsError`, `FixedEvalQuotaExceededError`). The
  barrel (`"."`) pulls halo-service + queue publishers; `./errors` is the leaf.

## The pattern in one sentence

When a transport package (e.g. `domain-trpc-errors.ts`) or an infra package needs
only a **type, read-service, or error class** from a heavy domain service, import
it from that service's dependency-free **leaf subpath** — or from a standalone
leaf package — rather than the service's main entrypoint. This keeps the inversify
/ DI / queue / pipeline graph out of the transport/infra module graph and prevents
package-level cycles.

## When building a feature

- Need a shared type/schema? It probably belongs in `cf-compatible-models` (edge)
  or `@kuzco/models` (server domain), not duplicated.
- Adding a queue payload? Define its schema in `cf-compatible-models` so both the
  publisher and consumer (and `rabbitmq-messaging`) can share it without a cycle.
- Adding a domain error a router must translate? Make sure its class lives on (or
  is re-exported from) a **leaf subpath** so `domain-trpc-errors.ts` can import it
  cleanly, then add the mapping branch there.
- Extracting a new shared concern? Make it a leaf: no DI, no DB client, no queue —
  just the slice, with its full stable type.
