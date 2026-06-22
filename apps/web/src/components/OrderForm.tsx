'use client';

import { useState, type FormEvent } from 'react';
import { newIdempotencyKey, placeOrder } from '@/lib/api';
import type { PlaceOrderResponse, RegionCode, Side } from '@/lib/types';
import { Panel } from './Panel';

type ResultKind = 'ok' | 'dup' | 'err';

export function OrderForm({
  symbol,
  region,
  onPlaced,
}: {
  symbol: string;
  region: RegionCode;
  onPlaced: () => void;
}) {
  const [side, setSide] = useState<Side>('BUY');
  const [price, setPrice] = useState('103.00');
  const [quantity, setQuantity] = useState('1');
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() => newIdempotencyKey());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ kind: ResultKind; text: string } | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setResult(null);
    try {
      const r = await placeOrder({ symbol, side, price, quantity, region, idempotencyKey });
      if (r.status === 201) {
        const b = r.body as PlaceOrderResponse;
        setResult({
          kind: 'ok',
          text: `${b.order.status} · filled ${b.order.filled_quantity} · ${b.trades.length} trade(s) · ${b.attempts} OCC attempt(s)`,
        });
      } else if (r.status === 409) {
        setResult({ kind: 'dup', text: 'REJECTED_DUPLICATE — idempotency key already used' });
      } else {
        setResult({ kind: 'err', text: `Error ${r.status}` });
      }
      setIdempotencyKey(newIdempotencyKey()); // fresh key so the next order isn't a dup
      onPlaced();
    } catch {
      setResult({ kind: 'err', text: 'Network error — is the intake API running?' });
    } finally {
      setBusy(false);
    }
  }

  const sideBtn = (s: Side) => {
    const active = side === s;
    const on = s === 'BUY' ? 'bg-buy text-black' : 'bg-sell text-black';
    return (
      <button
        type="button"
        onClick={() => setSide(s)}
        className={`flex-1 rounded py-2 text-sm font-bold tracking-wide transition ${
          active ? on : 'bg-panel-raised text-muted hover:text-gray-200'
        }`}
      >
        {s}
      </button>
    );
  };

  const resultColor =
    result?.kind === 'ok' ? 'text-buy' : result?.kind === 'dup' ? 'text-warn' : 'text-sell';

  return (
    <Panel title="Place Order">
      <form onSubmit={submit} className="flex flex-col gap-3 p-3">
        <div className="flex gap-2">
          {sideBtn('BUY')}
          {sideBtn('SELL')}
        </div>

        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-muted">
          Price
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            className="tabular rounded border border-edge bg-base px-2 py-2 text-sm text-gray-100 outline-none focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-muted">
          Quantity
          <input
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            inputMode="decimal"
            className="tabular rounded border border-edge bg-base px-2 py-2 text-sm text-gray-100 outline-none focus:border-accent"
          />
        </label>

        <div className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-muted">
          Idempotency Key
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded border border-edge bg-base px-2 py-1.5 text-[11px] normal-case text-muted">
              {idempotencyKey}
            </code>
            <button
              type="button"
              onClick={() => setIdempotencyKey(newIdempotencyKey())}
              className="rounded border border-edge px-2 py-1.5 text-[11px] text-muted hover:text-gray-200"
              title="Regenerate key"
            >
              ↻
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={busy}
          className={`rounded py-2.5 text-sm font-bold tracking-wide text-black transition disabled:opacity-50 ${
            side === 'BUY' ? 'bg-buy hover:brightness-110' : 'bg-sell hover:brightness-110'
          }`}
        >
          {busy ? 'Submitting…' : `${side} ${quantity} ${symbol} @ ${price}`}
        </button>

        {result && <p className={`text-xs ${resultColor}`}>{result.text}</p>}
      </form>
    </Panel>
  );
}
