'use client';

import type { FirehoseEvent, TradeView } from '@/lib/types';
import { fmtPrice, fmtQty, fmtTime, shortId } from '@/lib/format';
import { Panel } from './Panel';
import { RegionBadge } from './RegionBadge';

const EVENT_STYLES: Record<FirehoseEvent['event_type'], string> = {
  SUBMITTED: 'text-accent',
  MATCHED: 'text-buy',
  REJECTED_DUPLICATE: 'text-sell',
  CANCELLED: 'text-muted',
};

export function LedgerView({
  trades,
  events,
  firehoseAvailable,
}: {
  trades: TradeView[];
  events: FirehoseEvent[];
  firehoseAvailable: boolean;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <Panel
        title="Settlement Ledger"
        right={<span className="text-[10px] text-muted">Aurora DSQL · source of truth</span>}
      >
        {trades.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted">no settled trades</p>
        ) : (
          <table className="w-full text-xs tabular">
            <thead className="text-[10px] uppercase tracking-wider text-muted">
              <tr className="border-b border-edge">
                <th className="px-3 py-1.5 text-left">trade</th>
                <th className="px-3 py-1.5 text-right">price</th>
                <th className="px-3 py-1.5 text-right">qty</th>
                <th className="px-3 py-1.5 text-right">time</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((t) => (
                <tr key={t.trade_id} className="border-b border-edge/50">
                  <td className="px-3 py-1 text-muted">{shortId(t.trade_id)}</td>
                  <td className="px-3 py-1 text-right text-ink">{fmtPrice(t.price)}</td>
                  <td className="px-3 py-1 text-right text-ink">{fmtQty(t.quantity)}</td>
                  <td className="px-3 py-1 text-right text-muted">{fmtTime(t.executed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Panel>

      <Panel
        title="DynamoDB Audit Log"
        right={
          <span className="text-[10px] text-muted">
            firehose {firehoseAvailable ? '· live' : '· offline'}
          </span>
        }
      >
        {events.length === 0 ? (
          <p className="px-3 py-3 text-xs text-muted">
            {firehoseAvailable ? 'no events yet' : 'firehose unavailable'}
          </p>
        ) : (
          <ul>
            {events.map((e) => (
              <li
                key={e.event_sk}
                className="flex items-center justify-between gap-2 border-b border-edge/50 px-3 py-1 text-xs"
              >
                <span className={`w-40 shrink-0 font-medium ${EVENT_STYLES[e.event_type]}`}>
                  {e.event_type}
                </span>
                <span className="tabular text-muted">{e.side}</span>
                <span className="tabular text-ink">{fmtPrice(e.price)}</span>
                <RegionBadge region={e.region_origin} />
                <span className="tabular text-muted">{fmtTime(e.created_at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
