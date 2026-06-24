import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AXIOM — Exactly-Once Execution',
  description:
    'Exactly-once trade execution on Aurora DSQL. One match, one settlement — even under duplicate order bursts.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,400;0,6..72,500;0,6..72,600;1,6..72,400;1,6..72,500&family=Hanken+Grotesk:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="relative min-h-screen overflow-x-hidden">
        {/* Faint warm atmosphere — barely-there amber/sage washes that keep the
            paper background from reading flat, without muddying the light theme. */}
        <div className="pointer-events-none fixed inset-[-12%] z-0">
          <div className="animate-drift1 absolute left-[-2%] top-[-4%] h-[680px] w-[680px] rounded-full opacity-[0.18] blur-[90px] [background:radial-gradient(circle,#E6C892,transparent_64%)]" />
          <div className="animate-drift2 absolute right-[-6%] top-[6%] h-[640px] w-[640px] rounded-full opacity-[0.12] blur-[94px] [background:radial-gradient(circle,#9FB89A,transparent_64%)]" />
          <div className="animate-drift3 absolute bottom-[-16%] left-[34%] h-[720px] w-[720px] rounded-full opacity-[0.10] blur-[96px] [background:radial-gradient(circle,#D8A8A2,transparent_64%)]" />
        </div>
        <div className="relative z-10">{children}</div>
      </body>
    </html>
  );
}
