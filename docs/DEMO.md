# AXIOM — Demo Script & Rehearsal (< 3 minutes)

## Pre-flight (do before recording)

```bash
npm run db:up && npm run db:migrate && npm run dynamo:setup
npm run api:start &              # :3001
npm run dev -w @axiom/web        # :3000
npm run seed                     # clean resting book
```

Open `http://localhost:3000` in an incognito window. Confirm the header dot reads
"API connected", the order book shows bids (green) and asks (red), and the spread
is populated.

## Script

**0:00–0:20 — Hook.**
"In August 2012, a deployment bug at Knight Capital submitted duplicate orders
with no database-level safeguard. In 45 minutes it lost $440 million. AXIOM makes
that failure physically impossible."

**0:20–1:00 — Normal operation.**
Place 3–4 orders from the form (vary BUY/SELL, prices that cross). Point out:
- the order book updating (depth bars, spread),
- the trade tape printing executions (price-time priority — fills at the maker
  price),
- the settlement ledger and the DynamoDB audit log filling with
  SUBMITTED → MATCHED events, each tagged with its region.

**1:00–2:00 — Knight Capital Mode (the moment).**
Click **⚡ Knight Capital Mode**, then **FIRE 20 DUPLICATE ORDERS**. Narrate:
- Left (clearly labeled *Simulated/Illustrative*): a naive engine executes all 20
  → $200,000 exposure, $190,000 unintended loss.
- Right (*Actual · live API*): exactly **1 EXECUTED**, **19 BLOCKED (409)** — these
  are real HTTP 409s from the database's `UNIQUE(idempotency_key)` constraint.
"Nineteen duplicate executions, stopped by the database itself — not by app code."

**2:00–2:40 — Why this database.**
"Aurora DSQL gives us serializable-grade optimistic concurrency with strong
consistency across regions. The same order submitted from us-east-1 and eu-west-1
at once can only execute once — guaranteed at the database layer. That used to
require expensive proprietary matching tech; DSQL makes it accessible."

**2:40–3:00 — Close.**
"AXIOM is for emerging crypto exchanges, prediction markets, and ATSs priced out
of legacy matching engines. And it's proven, not just demoed — a concurrency test
fires 50 simultaneous conflicting orders and the book never double-fills."

## Rehearsal checklist

- [ ] Incognito window loads the dashboard; "API connected" is green.
- [ ] Placing a crossing order prints a trade and updates the ledger within ~1s.
- [ ] DynamoDB audit panel shows SUBMITTED + MATCHED with region badges.
- [ ] Knight Capital Mode shows exactly 1 EXECUTED / 19 BLOCKED (run it twice).
- [ ] `npm run verify:knight` prints 5/5 PASS just before recording.
- [ ] Re-run `npm run seed` between takes to reset the book to a clean state.

## Honesty notes (state these if asked)

- Regions are simulated via labeled requests (`X-Region`), not a live multi-region
  deployment — said plainly in the video, per the scope-cut plan.
- The "Without AXIOM" panel is a simulation, clearly labeled; the "With AXIOM"
  panel is the real, live system.
