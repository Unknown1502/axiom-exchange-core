'use client';

import type { BookLevel, BookSnapshot } from '@/lib/types';
import { fmtPrice, fmtQty } from '@/lib/format';
import { Panel } from './Panel';

function DepthRow({
  level,
  side,
  maxQty,
}: {
  level: BookLevel;
  side: 'ask' | 'bid';
  maxQty: number;
}) {
  const pct = Math.min(100, (Number(level.quantity) / maxQty) * 100);
  const priceColor = side === 'ask' ? 'text-sell' : 'text-buy';
  const barColor = side === 'ask' ? 'bg-sell/15' : 'bg-buy/15';
  return (
    <div className="relative grid grid-cols-[1fr_1fr_2.5rem] items-center px-3 py-[3px] text-xs tabular">
      <div className={`absolute inset-y-0 right-0 ${barColor}`} style={{ width: `${pct}%` }} />
      <span className={`relative z-10 font-medium ${priceColor}`}>{fmtPrice(level.price)}</span>
      <span className="relative z-10 text-right text-ink">{fmtQty(level.quantity)}</span>
      <span className="relative z-10 text-right text-[10px] text-muted">{level.orderCount}</span>
    </div>
  );
}

export function OrderBook({ book }: { book: BookSnapshot | null }) {
  const asks = (book?.asks ?? []).slice(0, 8);
  const bids = (book?.bids ?? []).slice(0, 8);
  const maxQty = Math.max(1, ...[...asks, ...bids].map((l) => Number(l.quantity)));
  const asksTopDown = [...asks].reverse(); // worst ask on top, best ask above the spread

  return (
    <Panel title="Order Book" right={<span className="text-[10px] text-muted">price · size · #</span>}>
      <div className="flex h-full flex-col justify-center">
        <div>
          {asksTopDown.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">no asks</p>
          ) : (
            asksTopDown.map((l) => <DepthRow key={`a-${l.price}`} level={l} side="ask" maxQty={maxQty} />)
          )}
        </div>

        <div className="my-1 flex items-center justify-between border-y border-edge bg-panel-raised px-3 py-1.5">
          <span className="text-[10px] uppercase tracking-wider text-muted">Spread</span>
          <span className="tabular text-sm font-semibold text-accent">
            {book?.spread ? fmtPrice(book.spread) : '—'}
          </span>
        </div>

        <div>
          {bids.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted">no bids</p>
          ) : (
            bids.map((l) => <DepthRow key={`b-${l.price}`} level={l} side="bid" maxQty={maxQty} />)
          )}
        </div>
      </div>
    </Panel>
  );
}
