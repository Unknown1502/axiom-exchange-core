import { resolveRegion } from '@/lib/regions';

export function RegionBadge({ region }: { region: string }) {
  const r = resolveRegion(region);
  return (
    <span className="inline-flex items-center gap-1 rounded border border-edge bg-panel-raised px-1.5 py-0.5 text-[11px] text-muted">
      <span aria-hidden>{r.flag}</span>
      <span className="tabular">{r.label}</span>
    </span>
  );
}
