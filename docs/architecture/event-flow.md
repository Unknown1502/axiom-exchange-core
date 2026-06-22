# Event Flow — the DynamoDB firehose

Every meaningful order lifecycle event is appended to the DynamoDB
`order_events` table as an immutable audit record, independently of the
authoritative state in Aurora DSQL.

## Table

- **Partition key:** `symbol`
- **Sort key:** `event_sk` = `<ISO8601 created_at>#<order_id>[#<trade_id>]`
- **Attributes:** `order_id`, `side`, `price`, `quantity`, `region_origin` (AWS
  region name), `event_type`, `idempotency_key`, `raw_payload`, optional
  `trade_id` / `trade_price`, `created_at`.

## Event types

| Event | When | Written by |
|---|---|---|
| `SUBMITTED` | An order is accepted at intake | `writeOrderEvent` |
| `MATCHED` | A trade executes (one per fill) | `writeTradeEvent` |
| `REJECTED_DUPLICATE` | A submission hits the `UNIQUE(idempotency_key)` constraint | `writeRejectedDuplicateEvent` |

## Write semantics

Firehose writes are **fire-and-forget** from the intake API: they are dispatched
without blocking the HTTP response and any failure is logged, never propagated.
This guarantees the audit log can never add latency to — or cause the failure of
— a trade. The authoritative record is always Aurora DSQL; DynamoDB is the
high-throughput observability/audit stream.

The region is mapped from the order's compact code to its AWS region name
(`us → us-east-1`, `eu → eu-west-1`, `apac → ap-southeast-1`) at write time, so
the audit log reads in AWS terms while the order book stays compact.

## Why DynamoDB and not Aurora DSQL

Append-only, single-item, burst-write workload with no cross-row transaction
requirement — DynamoDB's strength and the wrong fit for the relational core. See
[../ARCHITECTURE.md](../ARCHITECTURE.md#why-dynamodb-for-the-firehose-not-aurora-dsql).
