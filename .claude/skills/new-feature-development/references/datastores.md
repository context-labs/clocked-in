# Postgres vs ClickHouse — which store, and how to use each

Two databases back this platform, and they are not interchangeable. Postgres is
the transactional system of record for ~97 tables. ClickHouse is the analytics
plane: a handful of enormous fact tables and their rollups.

## The rule

**ClickHouse is for data whose defining question is an aggregation over a huge
number of rows.** Proxied inferences, OTEL spans, per-task aggregate stats,
training logs and metrics — tables in the hundreds of millions of rows
(`inferences` is 800M+) that are read as `GROUP BY` / time-bucketed scans, not
one row at a time. **Everything else is Postgres.**

The discriminator is **query shape and scale, not append-only-ness.** Postgres
holds plenty of high-volume append-only logs and keeps them deliberately:

- `billing_records` — one row per billable event, read with windowed
  `COUNT`/`SUM` during billing authorization. It stays in Postgres because
  `referenceId` uniqueness is the idempotency mechanism that prevents
  double-charging, and ClickHouse has no unique constraint to offer.
- `credit_transactions` — the append-only money ledger, with a checkpoint table
  it must stay consistent with inside a transaction.
- `generations_v2`, `webhook_invocation_logs`, `training_job_events` — per-event
  rows that are read back by entity id and joined to their parents.

So "it's an event" does not mean ClickHouse. Ask instead:

1. **Does correctness depend on this row?** Exactly-once, atomic-with-something-
   else, FK-referenced, uniquely-keyed, read-your-writes → Postgres, whatever the
   volume. ClickHouse has no transactions, no unique constraints, no FKs, and
   inserts you can't immediately read back.
2. **Is the volume per-inference or per-span, and is the read a big aggregation
   over a time range?** → ClickHouse.
3. **Neither?** → Postgres. It's the default; ClickHouse is the exception you
   justify.

| | **Postgres** (`@kuzco/db`) | **ClickHouse** (`@inference-net/llm-ops-clickhouse`) |
| --- | --- | --- |
| Holds | ~97 tables: entities, config, money, auth, job state, and per-event logs that need integrity | ~a dozen fact tables + their rollups: `inferences`, `spans*`, `training_job_logs`, `training_metrics`, `*_stats_{1m,1h,1d,all_time}` |
| Typical size | thousands to low millions of rows | hundreds of millions (`inferences` 800M+) |
| Read shape | point lookups, joins, windowed aggregates by entity | `GROUP BY` over a time range; charts served from MV rollups |
| Transactions | yes — `TransactionContext`, all-or-nothing | **no** |
| Uniqueness / FKs | PKs, unique indexes, FKs | **none** — dedup is best-effort via `ReplacingMergeTree` at merge time |
| Update / delete | normal `UPDATE`/`DELETE` | async mutations; admin-only last resort |
| Consistency | read-your-writes | async inserts; a just-written row may not read back yet |
| Migrations | Drizzle-generated (`task db-generate`) | hand-written numbered SQL (see below) |

Cross-store joins do not exist. When a ClickHouse read needs entity names, query
ClickHouse for the aggregate and Postgres for the entities, then stitch in the
service layer — that's normal here, not a smell.

## Choosing: worked examples

- **A proxied LLM request writes to both.** The billing record goes to Postgres
  (idempotent, transactional, gates the charge); the inference row goes to
  ClickHouse (the observability payload, browsed and charted in aggregate). The
  ClickHouse insert happens only after billing succeeds — see
  `docs/inference/api-inference-net-examples.md`. Same event, two stores, split
  by what each half is for.
- **"Show tokens/sec per model for the last 30 days."** ClickHouse, off a rollup
  (`task_stats_1h`, `platform_inference_stats_1d`) rather than scanning
  `inferences`. Rollups exist for the chart path; raw `inferences` scans are
  still the right call for browsing/filtering individual requests, and most
  store functions do exactly that.
- **"Ingest customer OTEL traces."** ClickHouse (`spans`, `spans_by_trace`,
  `spans_by_session` — the same rows written under different `ORDER BY`s so each
  access pattern is a prefix scan, since there are no secondary indexes to lean
  on).
- **"Charge a team and decrement its balance."** Postgres, in a transaction —
  even though it's one row per event at high volume. Money needs atomicity and
  a uniqueness constraint for idempotency.
- **"Track a training job."** Both: the job, its status, and its checkpoints in
  Postgres; its per-step logs and metrics in ClickHouse, because those are
  hundreds of rows per second read as time series.
- **"Let a user name and archive a task."** Postgres, by the rule — but note
  `task_config` and `task_status` actually live in **ClickHouse**, because they
  are read inside the same queries as the inference facts they describe. They're
  small mutable satellite tables in the analytics plane, and they carry the
  costs of that (plain `MergeTree`, so an "update" is a new row and readers take
  the latest; read-after-write is not guaranteed). Existing satellites are fine
  to extend; don't put *new* mutable state there unless it must be queried
  alongside the facts.

For the genuinely ambiguous case: if one lost or duplicated row is a bug you'd
get paged for, it's Postgres. If one lost row in ten million would slightly skew
a chart, it's ClickHouse.

## Using Postgres

Schema in `packages/db/src/tables/*.drizzle.ts`, exported from `src/schema.ts`;
migrations generated with `task db-generate`. See `database-migrations.md`.
Access goes through a Drizzle store behind a service, and multi-store work
threads a `TransactionContext` — see `architecture.md`.

## Using ClickHouse

Everything lives in `packages/llm-ops-db-clickhouse`:

- `src/clients/clickhouse.client.ts` — `createClickhouseClient(config)`. Apps
  build it once in `src/context.ts` / runtime wiring from their own `config.ts`,
  never inside a store.
- `src/stores/*.store.ts` — exported functions taking the client as the first
  argument (there's no DI container here). Still reached through a service, same
  boundary rule as Drizzle stores.
- `migrations/NNN_description.sql` — hand-written, numbered, applied in filename
  order.
- `migrations/README.md` — **read before touching any `mv_*` or rollup
  migration.**

### Reading — always parameterize

```ts
const result = await client.query({
  query: `
    SELECT task_config_id, team_id, status, created_at
    FROM task_status
    WHERE team_id = {teamId:String} AND task_config_id = {taskConfigId:String}
    ORDER BY created_at DESC
    LIMIT 1
  `,
  query_params: { teamId, taskConfigId },
  format: "JSONEachRow",
});
const rows = await result.json();
```

`{name:Type}` parameters, never string interpolation — and every tenant-scoped
query filters on `team_id` / `project_id` first, because that's the `ORDER BY`
prefix as well as the tenancy boundary. Parse the returned rows with a Zod
schema: ClickHouse hands back strings for 64-bit numeric types, and column types
drift as migrations land.

### Writing — batch, validate, retry

```ts
await retry(
  () =>
    client.insert({
      table: TABLE_NAME,
      values: validatedRows,      // an array, not one row per call
      format: "JSONEachRow",
      abort_signal: opts?.abortSignal,
    }),
  { maxRetries: CH_INSERT_MAX_RETRIES, shouldRetry: isTransientChError },
);
```

- **Batch.** One insert per row melts ClickHouse. The consumers accumulate and
  call `insertMany*`.
- **Inserts are retried, so writes must be idempotent-ish.** There are no unique
  constraints: a retry that actually landed the first time duplicates the row.
  Give the table a `ReplacingMergeTree` dedup key where duplicates matter, and
  pass the caller's `abortSignal` so an abandoned attempt can't land behind a
  retried delivery.
- **`FINAL` / dedup is eventual.** `ReplacingMergeTree` collapses duplicates at
  merge time, not insert time. Reads that must not double-count need `FINAL`,
  an aggregate that tolerates duplicates, or `argMax` over the version column.
- **Stamp `ingested_at`.** It's the version column and the watermark backfills
  bound on.

### Deleting

`ALTER TABLE ... DELETE` is an async mutation that rewrites whole parts. It is
for account purges and incident cleanup (`account-purge.store.ts`, submitted
with `mutations_sync: "0"` and polled), not for anything on a request path. If a
feature needs to delete ClickHouse rows routinely, the data model is wrong —
prefer a TTL or a status column filtered at read time.

### Migrations

ClickHouse migrations are **hand-written**, unlike Postgres:

1. Add `packages/llm-ops-db-clickhouse/migrations/NNN_short_description.sql`,
   numbered after the current highest. Lead with a comment naming the ticket and
   why. Use `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` so a rerun
   is safe.
2. Apply locally with `task db-migrate-clickhouse` (external-telemetry schema:
   `task db-migrate-clickhouse-external-telemetry`, whose migrations live in
   `apps/external-telemetry/migrations` against the `external_telemetry`
   database).
3. Deploys run `scripts/run-migrations.sh`, which records a **sha256 per applied
   file**. Editing a file that already ran is not an update — the script logs a
   hash-mismatch WARN, skips it, and someone must hand-run it in every
   environment. Ship a new numbered migration instead.

Choose the engine and `ORDER BY` deliberately; they can't be changed later
without a side-by-side `_v2` table and a cutover. The house pattern is
`PARTITION BY toYYYYMM(<event time>)` plus an `ORDER BY` that starts with the
tenancy columns and ends with a uniquifier —
`ORDER BY (team_id, project_id, sent_at, id)` on `inferences`. A second access
pattern gets a second table fed by a materialized view, not a secondary index.

Materialized views are insert triggers: the rows live in the target table, and
existing rows never re-run through a changed view. `migrations/README.md` has the
decision tree (swap the query, add a column, or rebuild side-by-side) — follow
it rather than dropping and re-scanning 800M rows.
