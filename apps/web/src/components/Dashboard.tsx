'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchBook, fetchEvents, fetchTrades } from '@/lib/api';
import { REGIONS } from '@/lib/regions';
import type { BookSnapshot, FirehoseEvent, RegionCode, TradeView } from '@/lib/types';
import { fmtPrice } from '@/lib/format';
import { OrderBook } from './OrderBook';
import { OrderForm } from './OrderForm';
import { TradeTape } from './TradeTape';
import { LedgerView } from './LedgerView';
import { KnightCapitalMode } from './KnightCapitalMode';

const SYMBOL = 'BTC-USD';

export function Dashboard() {
  const [region, setRegion] = useState<RegionCode>('us');
  const [book, setBook] = useState<BookSnapshot | null>(null);
  const [trades, setTrades] = useState<TradeView[]>([]);
  const [events, setEvents] = useState<FirehoseEvent[]>([]);
  const [firehoseAvailable, setFirehoseAvailable] = useState(true);
  const [knightOpen, setKnightOpen] = useState(false);
  const [live, setLive] = useState(false);

  const refresh = useCallback(async () => {
    const [b, t, e] = await Promise.allSettled([
      fetchBook(SYMBOL),
      fetchTrades(SYMBOL),
      fetchEvents(SYMBOL),
    ]);
    if (b.status === 'fulfilled') {
      setBook(b.value);
      setLive(true);
    } else {
      setLive(false);
    }
    if (t.status === 'fulfilled') setTrades(t.value);
    if (e.status === 'fulfilled') {
      setEvents(e.value.events);
      setFirehoseAvailable(e.value.available);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 1000);
    return () => clearInterval(id);
  }, [refresh]);

  const bestBid = book?.bids[0]?.price;
  const bestAsk = book?.asks[0]?.price;

  return (
    <div className="mx-auto flex min-h-screen max-w-[1400px] flex-col gap-3 p-3">
      {/* Header */}
      <header className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-edge px-5 py-3.5">
        <div className="flex items-center gap-3">
          <span
            className="h-2.5 w-2.5 rotate-45 bg-gradient-to-br from-accent to-accent-deep"
            style={{ boxShadow: '0 0 14px rgba(230,200,146,.6)' }}
          />
          <span className="text-lg font-bold tracking-[0.18em] text-ink">AXIOM</span>
          <span className="hidden border-l border-edge pl-3 font-mono text-[9.5px] uppercase tracking-[0.15em] text-muted sm:inline">
            Exactly-Once Execution
          </span>
          <span className="rounded-md border border-edge bg-panel-raised px-2 py-1 font-mono text-sm text-ink">
            {SYMBOL}
          </span>
        </div>

        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
            <span className={`h-2 w-2 rounded-full ${live ? 'bg-buy' : 'bg-sell'}`} />
            {live ? 'API connected' : 'API offline'}
          </span>

          <label className="flex items-center gap-1.5 font-mono text-[11px] text-muted">
            region
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value as RegionCode)}
              className="rounded-md border border-edge bg-base/60 px-2 py-1 text-xs text-ink outline-none focus:border-accent"
            >
              {REGIONS.map((r) => (
                <option key={r.code} value={r.code} className="bg-base text-ink">
                  {r.flag} {r.label}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={() => setKnightOpen(true)}
            className="rounded-lg border border-alarm bg-sell-dim px-3 py-1.5 font-mono text-[11px] font-bold uppercase tracking-wider text-alarm transition-colors hover:bg-alarm hover:text-base"
          >
            ⚡ Knight Capital Mode
          </button>
        </div>
      </header>

      {/* Main 3-panel row */}
      <main className="grid grid-cols-1 gap-3 lg:h-[460px] lg:grid-cols-[320px_minmax(0,1fr)_360px]">
        <OrderBook book={book} />

        <div className="flex min-h-0 flex-col gap-3">
          <div className="glass grid grid-cols-3 gap-3 rounded-2xl border border-edge p-3 text-center">
            <Stat label="Best Bid" value={bestBid ? fmtPrice(bestBid) : '—'} color="text-buy" />
            <Stat label="Spread" value={book?.spread ? fmtPrice(book.spread) : '—'} color="text-accent" />
            <Stat label="Best Ask" value={bestAsk ? fmtPrice(bestAsk) : '—'} color="text-sell" />
          </div>
          <OrderForm symbol={SYMBOL} region={region} onPlaced={() => void refresh()} />
        </div>

        <TradeTape trades={trades} />
      </main>

      {/* Bottom: ledger + audit log */}
      <LedgerView trades={trades} events={events} firehoseAvailable={firehoseAvailable} />

      {knightOpen && (
        <KnightCapitalMode
          symbol={SYMBOL}
          region={region}
          onClose={() => setKnightOpen(false)}
          onActivity={() => void refresh()}
        />
      )}
    </div>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted">{label}</div>
      <div className={`tabular font-mono text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}
