import type { Metadata } from "next";
// Self-hosted brand faces (no runtime network fetch, no CLS):
//   Cormorant Garamond — editorial display serif
//   Manrope            — body / UI
//   JetBrains Mono     — figures, eyebrow labels
import "@fontsource-variable/cormorant-garamond";
import "@fontsource-variable/manrope";
import "@fontsource-variable/jetbrains-mono";
import "./globals.css";

export const metadata: Metadata = {
  title: "AnalystGenius — Buyer Portal",
  description:
    "Buyer-side intelligence on IT services, consulting and BPO vendors. Select the vendors you care about; AnalystGenius identifies where market change has created new commercial opportunity.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="halo-bg">{children}</body>
    </html>
  );
}
