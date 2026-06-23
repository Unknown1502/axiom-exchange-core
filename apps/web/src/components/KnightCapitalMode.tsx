'use client';

import { useState } from 'react';
import { newIdempotencyKey, placeOrder } from '@/lib/api';
import type { RegionCode } from '@/lib/types';

const BURST = 20;
const PRICE = '1000.00';
const QTY = '10';
const NOTIONAL = Number(PRICE) * Number(QTY); // $10,000 per order

type Phase = 'idle' | 'firing' | 'done';

function money(n: number): string {
  return `$${n.toLocaleString('en-US')}`;
}

export function KnightCapitalMode({
  symbol,
  region,
  onClose,
  onActivity,
}: {
  symbol: string;
  region: RegionCode;
  onClose: () => void;
  onActivity: () => void;
}) {
  const [phase, setPhase] = useState<Phase>('idle');
  const [statuses, setStatuses] = useState<number[]>([]);

  async function fire() {
    setPhase('firing');
    setStatuses([]);
    // One shared idempotency key for all 20 — the "stuck retry loop" scenario.
    const sharedKey = newIdempotencyKey();
    const results = await Promise.all(
      Array.from({ length: BURST }, () =>
        placeOrder({ symbol, side: 'BUY', price: PRICE, quantity: QTY, region, idempotencyKey: sharedKey }),
      ),
    );
    setStatuses(results.map((r) => r.status));
    setPhase('done');
    onActivity();
  }

  const accepted = statuses.filter((s) => s === 201).length;
  const blocked = statuses.filter((s) => s === 409).length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
      <div className="animate-alarmBorder flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border-2 bg-[#0c0d18]">
        <header className="flex items-center justify-between border-b border-edge bg-sell-dim px-5 py-3">
          <div>
            <h2 className="text-lg font-bold text-alarm">🚨 KNIGHT CAPITAL MODE</h2>
            <p className="text-xs text-muted">
              Fires {BURST} identical orders with ONE idempotency key — the duplicate-submission storm.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded border border-edge px-3 py-1 text-sm text-muted hover:text-gray-100"
          >
            ✕ Close
          </button>
        </header>

        <div className="grid flex-1 grid-cols-1 gap-px overflow-auto bg-edge md:grid-cols-2">
          {/* NAIVE / SIMULATED */}
          <div className="bg-panel p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-bold text-sell">❌ WITHOUT AXIOM</h3>
              <span className="rounded bg-sell-dim px-2 py-0.5 text-[10px] uppercase tracking-wider text-sell">
                Simulated · illustrative
              </span>
            </div>
            <div className="mb-3 max-h-48 overflow-auto rounded border border-edge bg-base p-2 text-xs tabular">
              {Array.from({ length: BURST }, (_u, i) => (
                <div key={i} className="flex justify-between px-1 py-[2px] text-gray-400">
                  <span>Attempt {String(i + 1).padStart(2, '0')}</span>
                  <span className="text-sell">EXECUTED ✅</span>
                </div>
              ))}
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Executions</dt>
                <dd className="tabular font-bold text-sell">{BURST}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Exposure</dt>
                <dd className="tabular font-bold text-sell">{money(BURST * NOTIONAL)}</dd>
              </div>
              <div className="flex justify-between border-t border-edge pt-1">
                <dt className="text-muted">Unintended loss</dt>
                <dd className="tabular font-bold text-alarm">{money((BURST - 1) * NOTIONAL)}</dd>
              </div>
            </dl>
          </div>

          {/* AXIOM / REAL */}
          <div className="bg-panel p-4">
            <div className="mb-2 flex items-center justify-between">
              <h3 className="font-bold text-buy">✅ WITH AXIOM</h3>
              <span className="rounded bg-buy-dim px-2 py-0.5 text-[10px] uppercase tracking-wider text-buy">
                Actual · live API
              </span>
            </div>
            <div className="mb-3 max-h-48 overflow-auto rounded border border-edge bg-base p-2 text-xs tabular">
              {phase === 'idle' && <p className="px-1 py-2 text-muted">Press FIRE to run the burst.</p>}
              {phase === 'firing' && <p className="px-1 py-2 text-warn">Firing {BURST} duplicates…</p>}
              {phase === 'done' &&
                statuses.map((s, i) => (
                  <div key={i} className="flex justify-between px-1 py-[2px]">
                    <span className="text-gray-400">Attempt {String(i + 1).padStart(2, '0')}</span>
                    {s === 201 ? (
                      <span className="text-buy">EXECUTED ✅</span>
                    ) : s === 409 ? (
                      <span className="text-accent">BLOCKED 🛡️ (409)</span>
                    ) : (
                      <span className="text-warn">ERR {s}</span>
                    )}
                  </div>
                ))}
            </div>
            <dl className="space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted">Executions</dt>
                <dd className="tabular font-bold text-buy">{phase === 'done' ? accepted : '—'}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Blocked duplicates</dt>
                <dd className="tabular font-bold text-accent">{phase === 'done' ? blocked : '—'}</dd>
              </div>
              <div className="flex justify-between border-t border-edge pt-1">
                <dt className="text-muted">Settled</dt>
                <dd className="tabular font-bold text-buy">
                  {phase === 'done' ? money(accepted * NOTIONAL) : '—'}
                </dd>
              </div>
            </dl>
          </div>
        </div>

        <footer className="border-t border-edge px-5 py-3">
          <p className="mb-3 text-center text-xs text-muted">
            In 2012, Knight Capital had no safeguard — 45 minutes, <span className="text-alarm">−$440M</span>.
            AXIOM&apos;s <code className="text-accent">idempotency_key UNIQUE</code> constraint in Aurora
            DSQL makes duplicate execution physically impossible — the 409s above are real database
            rejections, not application checks.
          </p>
          <div className="flex justify-center gap-3">
            <button
              onClick={fire}
              disabled={phase === 'firing'}
              className="animate-pulse rounded-lg bg-alarm px-6 py-2.5 font-mono text-sm font-bold uppercase tracking-wider text-base hover:brightness-110 disabled:animate-none disabled:opacity-50"
            >
              {phase === 'firing' ? 'FIRING…' : `⚡ FIRE ${BURST} DUPLICATE ORDERS`}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
}
