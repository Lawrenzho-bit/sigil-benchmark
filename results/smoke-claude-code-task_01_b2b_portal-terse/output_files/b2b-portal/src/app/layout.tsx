import type { ReactNode } from "react";

export const metadata = {
  title: "B2B Portal",
  description: "Organization portal",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          margin: 0,
          background: "#f7f7f8",
          color: "#111",
        }}
      >
        <main style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
          {children}
        </main>
      </body>
    </html>
  );
}
