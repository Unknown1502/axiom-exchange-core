'use client';

import { useEffect, useRef } from 'react';
import type { TradeView } from '@/lib/types';
import { fmtPrice, fmtQty, fmtTime } from '@/lib/format';
import { Panel } from './Panel';

export function TradeTape({ trades }: { trades: TradeView[] }) {
  const seenRef = useRef<Set<string>>(new Set());

  // Mark trades seen after paint so the first appearance pulses, later ones don't.
  useEffect(() => {
    for (const t of trades) seenRef.current.add(t.trade_id);
  }, [trades]);

  return (
    <Panel
      title="Trade Tape"
      right={<span className="text-[10px] text-muted">time · price · size</span>}
    >
      {trades.length === 0 ? (
        <p className="px-3 py-3 text-xs text-muted">no trades yet — place a crossing order</p>
      ) : (
        <ul>
          {trades.map((t, i) => {
            const cur = Number(t.price);
            const older = i + 1 < trades.length ? Number(trades[i + 1].price) : cur;
            const dir = cur > older ? 'up' : cur < older ? 'down' : 'flat';
            const color = dir === 'up' ? 'text-buy' : dir === 'down' ? 'text-sell' : 'text-gray-300';
            const arrow = dir === 'up' ? '▲' : dir === 'down' ? '▼' : '·';
            const isNew = !seenRef.current.has(t.trade_id);
            return (
              <li
                key={t.trade_id}
                className={`grid grid-cols-[auto_1fr_1fr] items-center gap-2 px-3 py-[3px] text-xs tabular ${
                  isNew ? 'animate-pulseRow' : ''
                }`}
              >
                <span className="text-muted">{fmtTime(t.executed_at)}</span>
                <span className={`text-right font-medium ${color}`}>
                  {arrow} {fmtPrice(t.price)}
                </span>
                <span className="text-right text-gray-300">{fmtQty(t.quantity)}</span>
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
