import type { Metadata } from 'next';
import { CookieConsent } from '@/components/CookieConsent';
import './globals.css';

export const metadata: Metadata = {
  title: 'B2B SaaS Portal',
  description: 'Enterprise workflow management portal',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* GDPR: functional opt-in consent banner, rendered app-wide. */}
        <CookieConsent />
      </body>
    </html>
  );
}
