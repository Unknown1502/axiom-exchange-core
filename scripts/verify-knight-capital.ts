/**
 * Phase 4 gate — Knight Capital Mode reliability.
 *
 * Replicates exactly what the dashboard's Knight Capital button does: fire BURST
 * concurrent orders sharing ONE idempotency key, through the same Next.js proxy
 * path the UI uses. Repeats RUNS times and asserts every run yields exactly one
 * acceptance (201) and BURST-1 duplicate rejections (409) — i.e. the
 * database-enforced safeguard holds with zero flake.
 *
 * Usage: `npm run verify:knight`  (requires web app on :3000 and API on :3001)
 */

import { randomUUID } from 'node:crypto';

const BASE = process.env.WEB_URL ?? 'http://localhost:3000';
const RUNS = Number(process.env.KNIGHT_RUNS ?? 5);
const BURST = 20;

async function fireBurst(): Promise<{ accepted: number; blocked: number; other: number }> {
  const sharedKey = `knight-${randomUUID()}`;
  const responses = await Promise.all(
    Array.from({ length: BURST }, () =>
      fetch(`${BASE}/api/orders`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Idempotency-Key': sharedKey,
          'X-Region': 'us',
        },
        body: JSON.stringify({ symbol: 'BTC-USD', side: 'BUY', price: '1000.00', quantity: '10' }),
      }).then(async (r) => {
        await r.text();
        return r.status;
      }),
    ),
  );
  return {
    accepted: responses.filter((s) => s === 201).length,
    blocked: responses.filter((s) => s === 409).length,
    other: responses.filter((s) => s !== 201 && s !== 409).length,
  };
}

async function main(): Promise<void> {
  console.log(`\n=== KNIGHT CAPITAL MODE — RELIABILITY (${RUNS} runs x ${BURST} duplicates) ===`);
  console.log(`Target: ${BASE}/api/orders\n`);
  let allPass = true;
  for (let run = 1; run <= RUNS; run++) {
    const { accepted, blocked, other } = await fireBurst();
    const ok = accepted === 1 && blocked === BURST - 1 && other === 0;
    allPass &&= ok;
    console.log(
      `Run ${run}: accepted=${accepted} blocked=${blocked} other=${other}  →  ${ok ? 'PASS ✅' : 'FAIL ❌'}`,
    );
  }
  console.log(`\n${allPass ? 'ALL RUNS PASSED ✅ — exactly 1 execution every time.' : 'FAILED ❌'}`);
  if (!allPass) process.exit(1);
}

main().catch((err: unknown) => {
  console.error('verify-knight-capital crashed:', err);
  process.exit(1);
});
