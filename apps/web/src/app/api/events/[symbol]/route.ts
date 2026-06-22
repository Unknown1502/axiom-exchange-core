export const dynamic = 'force-dynamic';

const BASE = process.env.INTAKE_API_URL ?? 'http://localhost:3001';

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ symbol: string }> },
): Promise<Response> {
  const { symbol } = await ctx.params;
  try {
    const upstream = await fetch(`${BASE}/events/${encodeURIComponent(symbol)}`, { cache: 'no-store' });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch {
    return Response.json({ events: [], available: false }, { status: 200 });
  }
}
