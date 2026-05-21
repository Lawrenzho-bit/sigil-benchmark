import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "B2B Portal",
  description: "B2B SaaS portal — authentication, billing, and team management.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
