# Deployment & Operations Runbook

## A. Run the full stack locally (what the build is verified against)

Requires Node 22+ and Docker (for Postgres + DynamoDB Local). If Docker's engine
is unavailable, `npm test` falls back to an embedded PostgreSQL automatically.

```bash
npm install
cp .env.example .env            # defaults target local Docker
npm run db:up                   # Postgres (55432) + DynamoDB Local (8000)
npm run db:migrate              # apply schema
npm run dynamo:setup            # create order_events table locally
npm run api:start &             # Fastify intake API on :3001
npm run dev -w @axiom/web       # dashboard on :3000
npm run seed                    # optional: resting liquidity for the demo
```

Verify: `npm test` (concurrency proofs), `npm run loadtest`, `npm run verify:knight`.

> Local Postgres is published on **55432** (not 5432) to avoid colliding with a
> native PostgreSQL install. `.env` already reflects this.
>
> No Docker? `npm test` auto-starts an **embedded PostgreSQL** when nothing is
> reachable at `DATABASE_URL`, so the correctness proofs run with zero setup.

## B. Provision real AWS resources (for the submission screenshots)

The recommended path uses the AWS SDK directly (no AWS CLI needed). Credentials
are resolved via the default provider chain — `aws configure` or
`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` in `.env`; they are never printed.

```bash
# 1. Provision the Aurora DSQL cluster (waits until ACTIVE) + order_events table.
npm run provision:aws            # prints DSQL_CLUSTER_ENDPOINT — add it to .env

# 2. Apply migrations to the live cluster (rewrites CREATE INDEX → CREATE INDEX ASYNC).
npm run db:migrate:dsql

# 3. (optional) Print live resource proof for the submission, and smoke-test DSQL.
npm run aws:proof                # cluster ARN/status + DynamoDB table details
npm run test:dsql:connect        # confirm an IAM-token connection succeeds
```

> The older shell scripts (`scripts/provision-dsql.sh`,
> `scripts/provision-dynamodb.sh`, `scripts/dsql-connect.sh`) provide the same
> outcome via the AWS CLI and remain available if you prefer them.

Aurora DSQL has **no static password** — the auth token *is* the password and
expires (this build uses a ~1-hour token; connections also drop at ~1h). The
provisioning/migration scripts generate a fresh token with
`@aws-sdk/dsql-signer` (`DsqlSigner.getDbConnectAdminAuthToken()`) and embed it
in the connection string at invocation time. For a long-running intake API
against DSQL, regenerate the token and restart the API before it expires (or
inject a freshly-signed `DATABASE_URL` on each restart).

`provision:aws` enables **deletion protection** on the cluster. To tear it down
later, disable protection first, then delete the cluster.

Screenshot for submission: the Aurora DSQL console showing the cluster `ACTIVE`,
and the DynamoDB console showing the `order_events` table — or just the
`npm run aws:proof` output.

### Optionally run the concurrency proofs against the live cluster

```bash
USE_DSQL=true npm run test:concurrency   # skips the embedded Postgres, targets DSQL
```

## C. Deploy

**Dashboard (Vercel):** import `apps/web`. Set env `INTAKE_API_URL` to the public
URL of the intake API. The dashboard is a standard Next.js 15 app and deploys as-is.

**Intake API (Fastify):** this is a persistent Node server, so host it where long-
running processes are supported (Render / Railway / Fly.io / EC2), not as a Vercel
serverless function. On that host set: `DATABASE_URL` (DSQL, via the token),
`DATABASE_SSL=require`, `DATABASE_TARGET=dsql`, `AWS_REGION`, `DYNAMODB_TABLE_NAME`,
and AWS credentials (unset `DYNAMODB_ENDPOINT` so it uses real DynamoDB). Point
Vercel's `INTAKE_API_URL` at it.

> For the demo video specifically, running the intake API locally against the
> real Aurora DSQL + DynamoDB resources is sufficient to demonstrate live AWS
> usage; the published Vercel link hosts the dashboard.

## D. Operations notes

- **Health:** `GET /health` on the intake API.
- **OCC retries** are expected under contention and are handled automatically
  (bounded attempts + jittered backoff). A spike in retries indicates hot-key
  contention on a single symbol — expected during stress demos.
- **Firehose failures** never block trading (writes are fire-and-forget and
  logged); the audit-log panel shows "offline" if DynamoDB is unreachable.
- **DSQL limits to respect:** 1 DDL/transaction, ≤3,000 row mods/transaction
  (the matching sweep is bounded at 1,000 resting orders), 1-hour connection cap.
