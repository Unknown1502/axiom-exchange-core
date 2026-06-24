'use client';

import { useState, type FormEvent } from 'react';
import { newIdempotencyKey, placeOrder } from '@/lib/api';
import type { OrderType, PlaceOrderResponse, RegionCode, Side } from '@/lib/types';
import { Panel } from './Panel';

type ResultKind = 'ok' | 'dup' | 'err';

const ORDER_TYPES: { value: OrderType; label: string; hint: string }[] = [
  { value: 'GTC', label: 'GTC', hint: 'Rest the unfilled remainder on the book.' },
  { value: 'IOC', label: 'IOC', hint: 'Fill what crosses now, cancel the rest. Never rests.' },
  { value: 'FOK', label: 'FOK', hint: 'Fill the entire quantity now or nothing at all.' },
  { value: 'POST_ONLY', label: 'POST', hint: 'Add liquidity only — rejected if it would cross.' },
];

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
  const [orderType, setOrderType] = useState<OrderType>('GTC');
  const [accountId, setAccountId] = useState('');
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
      const r = await placeOrder({
        symbol,
        side,
        price,
        quantity,
        region,
        idempotencyKey,
        orderType,
        accountId,
      });
      if (r.status === 201) {
        const b = r.body as PlaceOrderResponse;
        const skipped = Number(b.order.stp_skipped_quantity);
        const stpNote = skipped > 0 ? ` · STP skipped ${b.order.stp_skipped_quantity}` : '';
        setResult({
          kind: 'ok',
          text: `${b.order.order_type} · ${b.order.status} · filled ${b.order.filled_quantity} · ${b.trades.length} trade(s) · ${b.attempts} OCC attempt(s)${stpNote}`,
        });
      } else if (r.status === 409) {
        setResult({ kind: 'dup', text: 'REJECTED_DUPLICATE — idempotency key already used' });
      } else if (r.status === 422) {
        setResult({
          kind: 'dup',
          text: 'REJECTED_POST_ONLY — would cross (take liquidity), so it was rejected',
        });
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

  const typeBtn = (t: { value: OrderType; label: string; hint: string }) => {
    const active = orderType === t.value;
    return (
      <button
        key={t.value}
        type="button"
        onClick={() => setOrderType(t.value)}
        title={t.hint}
        className={`flex-1 rounded py-1.5 text-[11px] font-bold tracking-wide transition ${
          active ? 'bg-accent text-base' : 'well text-muted hover:text-ink'
        }`}
      >
        {t.label}
      </button>
    );
  };

  const sideBtn = (s: Side) => {
    const active = side === s;
    const on = s === 'BUY' ? 'bg-buy text-base' : 'bg-sell text-base';
    return (
      <button
        type="button"
        onClick={() => setSide(s)}
        className={`flex-1 rounded py-2 text-sm font-bold tracking-wide transition ${
          active ? on : 'well text-muted hover:text-ink'
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

        <div className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-muted">
          Time in force
          <div className="flex gap-1.5">{ORDER_TYPES.map(typeBtn)}</div>
          <span className="normal-case tracking-normal text-[10px] text-muted/80">
            {ORDER_TYPES.find((t) => t.value === orderType)?.hint}
          </span>
        </div>

        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-muted">
          Price
          <input
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal"
            className="tabular rounded border border-edge well px-2 py-2 text-sm text-ink outline-none focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-muted">
          Quantity
          <input
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            inputMode="decimal"
            className="tabular rounded border border-edge well px-2 py-2 text-sm text-ink outline-none focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-muted">
          Account <span className="normal-case tracking-normal text-[10px] text-muted/70">(optional · enables self-trade prevention)</span>
          <input
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            placeholder="anonymous"
            className="rounded border border-edge well px-2 py-2 text-sm text-ink outline-none placeholder:text-muted/60 focus:border-accent"
          />
        </label>

        <div className="flex flex-col gap-1 text-[11px] uppercase tracking-wider text-muted">
          Idempotency Key
          <div className="flex items-center gap-2">
            <code className="flex-1 truncate rounded border border-edge well px-2 py-1.5 text-[11px] normal-case text-ink-soft">
              {idempotencyKey}
            </code>
            <button
              type="button"
              onClick={() => setIdempotencyKey(newIdempotencyKey())}
              className="rounded border border-edge px-2 py-1.5 text-[11px] text-muted hover:text-ink"
              title="Regenerate key"
            >
              ↻
            </button>
          </div>
        </div>

        <button
          type="submit"
          disabled={busy}
          className={`rounded py-2.5 text-sm font-bold tracking-wide text-base shadow-sm transition disabled:opacity-50 ${
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
