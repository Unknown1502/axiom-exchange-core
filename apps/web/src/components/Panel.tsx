import type { ReactNode } from 'react';

export function Panel({
  title,
  right,
  children,
  className = '',
}: {
  title: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`glass flex min-h-0 flex-col rounded-xl border ${className}`}>
      <header className="flex items-center justify-between gap-2 border-b border-edge px-4 py-2.5">
        <h2 className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.22em] text-ink-soft">
          {title}
        </h2>
        <div className="font-mono text-[10px] text-muted">{right}</div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}
