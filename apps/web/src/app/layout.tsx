import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AXIOM — Distributed Exchange Core',
  description:
    'Exactly-once trade execution on Aurora DSQL. One match, one settlement — even under duplicate order bursts.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-base min-h-screen">{children}</body>
    </html>
  );
}
