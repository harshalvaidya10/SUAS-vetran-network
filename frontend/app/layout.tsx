import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';

export const metadata: Metadata = {
  title: 'VetNet — put your hours on the board',
  description:
    'Veterans list what they can do and commit to blocks of time. Requests route to whoever committed.',
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
              <Link href="/serve?new=1">Sign up to serve</Link>
              <Link href="/serve">My commitments</Link>
            </nav>
          </div>
        </header>
        <main className="shell">{children}</main>
      </body>
    </html>
  );
}
