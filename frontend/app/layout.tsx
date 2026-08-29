import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'VetNet — the veteran service network',
  description:
    'Veterans commit to slots. Neighbors ask for help. One call matches them.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <header className="masthead">
          <div className="masthead-inner">
            <Link href="/" className="wordmark">
              VetNet
            </Link>
            <nav>
              <Link href="/request">Request help</Link>
              <Link href="/serve">Sign up to serve</Link>
            </nav>
          </div>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
