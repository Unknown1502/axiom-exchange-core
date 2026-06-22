import { NextRequest } from 'next/server';

export const dynamic = 'force-dynamic';

const BASE = process.env.INTAKE_API_URL ?? 'http://localhost:3001';

/** Proxy order submissions to the Fastify intake API, forwarding dedup/region headers. */
export async function POST(req: NextRequest): Promise<Response> {
  const body = await req.text();
  try {
    const upstream = await fetch(`${BASE}/orders`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': req.headers.get('idempotency-key') ?? '',
        'X-Region': req.headers.get('x-region') ?? 'us',
      },
      body,
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return Response.json({ error: 'UPSTREAM_UNAVAILABLE' }, { status: 502 });
  }
}
