import type { Metadata, Viewport } from 'next';
import { Exo_2 } from 'next/font/google';
import './globals.css';

const exo = Exo_2({ subsets: ['latin'], weight: ['400', '500', '600', '700'], variable: '--font-exo' });

export const metadata: Metadata = {
  title: 'Nova · Flowminds',
  description: 'Run your CRM with one prompt.'
};

export const viewport: Viewport = { themeColor: '#121314', width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={exo.variable}>
      <body className="min-h-dvh font-sans">{children}</body>
    </html>
  );
}
