/**
 * Phase 2 gate — burst load test of the intake API.
 *
 * Fires N concurrent POST /orders (distinct idempotency keys) at a fresh symbol
 * with no crossing liquidity, so every order rests and produces exactly one
 * SUBMITTED firehose event. Then it verifies:
 *   1. Every request returned 201 (no unhandled errors / dropped requests).
 *   2. p99 latency is under the threshold.
 *   3. The number of SUBMITTED events in DynamoDB equals the number of accepted
 *      orders (no dropped firehose writes).
 *   4. A repeat submission with a reused key is rejected 409 (idempotency works
 *      through the full HTTP path, not just at the engine).
 *
 * Usage: `npm run loadtest`  (requires `npm run api:start` running)
 */

import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { countEvents } from '@axiom/dynamodb-client';

const API = process.env.API_URL ?? `http://localhost:${process.env.INTAKE_PORT ?? 3001}`;
const TOTAL = Number(process.env.LOAD_N ?? 200);
const P99_THRESHOLD_MS = 2000;
const SYMBOL = `LOADTEST-${Date.now()}`;

interface Outcome {
  status: number;
  ms: number;
}

async function fireOrder(index: number): Promise<Outcome> {
  const start = performance.now();
  const res = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `load-${SYMBOL}-${index}-${randomUUID()}`,
      'X-Region': 'us',
    },
    body: JSON.stringify({ symbol: SYMBOL, side: 'BUY', price: '50.00', quantity: '1' }),
  });
  await res.text();
  return { status: res.status, ms: performance.now() - start };
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[idx] ?? 0;
}

async function main(): Promise<void> {
  console.log(`\n=== AXIOM INTAKE LOAD TEST ===`);
  console.log(`Target: ${API}`);
  console.log(`Firing ${TOTAL} concurrent POST /orders on ${SYMBOL}...`);

  const wallStart = performance.now();
  const outcomes = await Promise.all(Array.from({ length: TOTAL }, (_u, i) => fireOrder(i)));
  const wallMs = performance.now() - wallStart;

  const statusCounts = new Map<number, number>();
  for (const o of outcomes) {
    statusCounts.set(o.status, (statusCounts.get(o.status) ?? 0) + 1);
  }
  const accepted = statusCounts.get(201) ?? 0;
  const latencies = outcomes.map((o) => o.ms).sort((a, b) => a - b);

  // Allow fire-and-forget firehose writes to flush, then count them.
  await sleep(2000);
  let firehoseCount = -1;
  let firehoseError: string | undefined;
  try {
    firehoseCount = await countEvents(SYMBOL);
  } catch (err) {
    firehoseError = (err as Error).message;
  }

  // Idempotency through the HTTP path: reuse one key twice.
  const reuseKey = `dup-${SYMBOL}-${randomUUID()}`;
  const headers = {
    'Content-Type': 'application/json',
    'Idempotency-Key': reuseKey,
    'X-Region': 'us',
  };
  const body = JSON.stringify({ symbol: SYMBOL, side: 'BUY', price: '50.00', quantity: '1' });
  const first = await fetch(`${API}/orders`, { method: 'POST', headers, body });
  await first.text();
  const second = await fetch(`${API}/orders`, { method: 'POST', headers, body });
  await second.text();

  const p50 = percentile(latencies, 50);
  const p99 = percentile(latencies, 99);
  const throughput = (TOTAL / wallMs) * 1000;

  console.log(`\nStatus codes:        ${JSON.stringify(Object.fromEntries(statusCounts))}`);
  console.log(`Accepted (201):      ${accepted}/${TOTAL}`);
  console.log(`Wall time:           ${wallMs.toFixed(0)}ms`);
  console.log(`Throughput:          ${throughput.toFixed(0)} orders/sec`);
  console.log(`Latency p50:         ${p50.toFixed(1)}ms`);
  console.log(`Latency p99:         ${p99.toFixed(1)}ms  (threshold ${P99_THRESHOLD_MS}ms)`);
  console.log(
    `Firehose events:     ${firehoseCount}  (must equal accepted ${accepted})` +
      (firehoseError ? `  [ERROR: ${firehoseError}]` : ''),
  );
  console.log(`Idempotency replay:  first=${first.status} (expect 201), second=${second.status} (expect 409)`);
  console.log(`==============================\n`);

  const failures: string[] = [];
  if (accepted !== TOTAL) failures.push(`expected ${TOTAL} accepted, got ${accepted}`);
  if (p99 > P99_THRESHOLD_MS) failures.push(`p99 ${p99.toFixed(0)}ms exceeds ${P99_THRESHOLD_MS}ms`);
  if (firehoseCount !== accepted) failures.push(`firehose ${firehoseCount} != accepted ${accepted} (dropped writes)`);
  if (first.status !== 201) failures.push(`first replay status ${first.status} != 201`);
  if (second.status !== 409) failures.push(`second replay status ${second.status} != 409`);

  if (failures.length > 0) {
    console.error('LOAD TEST FAILED:');
    for (const f of failures) console.error(`  - ${f}`);
    process.exit(1);
  }
  console.log('LOAD TEST PASSED ✅');
}

main().catch((err: unknown) => {
  console.error('Load test crashed:', err);
  process.exit(1);
});
