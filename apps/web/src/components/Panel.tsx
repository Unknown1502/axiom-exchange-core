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
    <section className={`glass flex min-h-0 flex-col rounded-2xl border border-edge ${className}`}>
      <header className="flex items-center justify-between border-b border-edge px-4 py-2.5">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">
          {title}
        </h2>
        {right}
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </section>
  );
}
