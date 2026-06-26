'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchBook, fetchEvents, fetchTrades, openMarketDataStream } from '@/lib/api';
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
  // Source of the live book/trade data: the SSE stream when connected, otherwise
  // polling. Shown in the header so the live feed is visible, not just assumed.
  const [streaming, setStreaming] = useState(false);

  // Wall-clock of the last stream payload; lets polling defer to a fresh stream.
  const lastStreamAtRef = useRef(0);

  // Poll the firehose audit log (not part of the market-data stream), and act as
  // the fallback for book/trades whenever the SSE stream has gone quiet.
  const poll = useCallback(async () => {
    const streamFresh = Date.now() - lastStreamAtRef.current < 3000;

    const tasks: Promise<unknown>[] = [
      fetchEvents(SYMBOL).then((e) => {
        setEvents(e.events);
        setFirehoseAvailable(e.available);
      }),
    ];

    // Only poll book/trades when the stream isn't carrying them.
    if (!streamFresh) {
      tasks.push(
        fetchBook(SYMBOL).then((b) => {
          setBook(b);
          setLive(true);
        }),
        fetchTrades(SYMBOL).then((t) => setTrades(t)),
      );
    }

    const results = await Promise.allSettled(tasks);
    if (!streamFresh && results.some((r) => r.status === 'rejected')) setLive(false);
  }, []);

  // Live market data over SSE (book + trade tape), with automatic reconnection.
  useEffect(() => {
    const unsubscribe = openMarketDataStream(SYMBOL, {
      onBook: (b) => {
        lastStreamAtRef.current = Date.now();
        setBook(b);
        setLive(true);
        setStreaming(true);
      },
      onTrades: (t) => {
        lastStreamAtRef.current = Date.now();
        setTrades(t);
      },
      onStatus: (ok) => setStreaming(ok),
    });
    return () => unsubscribe?.();
  }, []);

  // Firehose + fallback polling loop.
  useEffect(() => {
    void poll();
    const id = setInterval(() => void poll(), 1000);
    return () => clearInterval(id);
  }, [poll]);

  const bestBid = book?.bids[0]?.price;
  const bestAsk = book?.asks[0]?.price;

  const lastTrade = trades[0]?.price;

  return (
    <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col gap-4 px-4 py-5 lg:px-6">
      {/* ── Masthead ─────────────────────────────────────────────── */}
      <header className="flex flex-wrap items-center justify-between gap-4 border-b-2 border-ink pb-3">
        <div className="flex items-baseline gap-3">
          <span className="display text-3xl font-semibold tracking-tight text-ink">AXIOM</span>
          <span className="hidden font-mono text-[10px] uppercase tracking-[0.2em] text-muted sm:inline">
            Exactly-Once Execution Engine
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <span className="flex items-center gap-1.5 rounded-full border border-edge bg-panel px-2.5 py-1 font-mono text-[10.5px] text-ink-soft">
            <span
              className={`h-1.5 w-1.5 rounded-full ${live ? 'bg-buy' : 'bg-sell'} ${streaming ? 'animate-pulse' : ''}`}
              style={live ? { boxShadow: '0 0 0 3px rgba(14,143,94,0.18)' } : undefined}
            />
            {!live ? 'Offline' : streaming ? 'Streaming · SSE' : 'Live · polling'}
          </span>

          <label className="flex items-center gap-1.5 rounded-full border border-edge bg-panel px-2.5 py-1 font-mono text-[10.5px] text-muted">
            <span className="uppercase tracking-wider">Region</span>
            <select
              value={region}
              onChange={(e) => setRegion(e.target.value as RegionCode)}
              className="bg-transparent text-ink outline-none"
            >
              {REGIONS.map((r) => (
                <option key={r.code} value={r.code} className="bg-panel text-ink">
                  {r.flag} {r.label}
                </option>
              ))}
            </select>
          </label>

          <button
            onClick={() => setKnightOpen(true)}
            className="rounded-full border border-alarm px-3.5 py-1.5 font-mono text-[10.5px] font-bold uppercase tracking-wider text-alarm transition-colors hover:bg-alarm hover:text-base"
          >
            ⚡ Knight Capital Mode
          </button>
        </div>
      </header>

      {/* ── Price hero band ──────────────────────────────────────── */}
      <section className="glass accent-rule flex flex-wrap items-center justify-between gap-6 rounded-xl border px-6 py-5">
        <div className="flex items-baseline gap-4">
          <div>
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Instrument</div>
            <div className="display text-2xl font-semibold text-ink">{SYMBOL}</div>
          </div>
          <div className="border-l border-edge pl-4">
            <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">Last</div>
            <div className="display text-4xl font-semibold leading-none text-ink tabular">
              {lastTrade ? fmtPrice(lastTrade) : '—'}
            </div>
          </div>
        </div>

        <div className="flex items-stretch gap-8">
          <HeroStat label="Best Bid" value={bestBid ? fmtPrice(bestBid) : '—'} color="text-buy" />
          <HeroStat
            label="Spread"
            value={book?.spread ? fmtPrice(book.spread) : '—'}
            color="text-accent"
          />
          <HeroStat label="Best Ask" value={bestAsk ? fmtPrice(bestAsk) : '—'} color="text-sell" />
        </div>
      </section>

      {/* ── Trading row: book · ticket · tape ────────────────────── */}
      <main className="grid grid-cols-1 gap-4 lg:h-[500px] lg:grid-cols-[300px_minmax(0,1fr)_340px]">
        <OrderBook book={book} />
        <OrderForm symbol={SYMBOL} region={region} onPlaced={() => void poll()} />
        <TradeTape trades={trades} />
      </main>

      {/* ── Ledger + audit ───────────────────────────────────────── */}
      <LedgerView trades={trades} events={events} firehoseAvailable={firehoseAvailable} />

      <footer className="pb-2 pt-1 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-muted">
        Aurora DSQL · Source of Truth — one match, one settlement, no double-execution
      </footer>

      {knightOpen && (
        <KnightCapitalMode
          symbol={SYMBOL}
          region={region}
          onClose={() => setKnightOpen(false)}
          onActivity={() => void poll()}
        />
      )}
    </div>
  );
}

function HeroStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="text-right">
      <div className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted">{label}</div>
      <div className={`display text-2xl font-semibold tabular ${color}`}>{value}</div>
    </div>
  );
}
