import type { Metadata, Viewport } from "next";
import { Inter, Noto_Nastaliq_Urdu } from "next/font/google";
import type { ReactNode } from "react";
import { SiteFooter, SiteHeader } from "../components/ui";
import "./globals.css";

// Self-hosted at build time (no runtime requests to Google). Apple devices use SF Pro from the system;
// Inter is the closest match everywhere else. Urdu uses Noto Nastaliq Urdu, the Nastaliq face Apple ships for Urdu.
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const nastaliq = Noto_Nastaliq_Urdu({ subsets: ["arabic"], variable: "--font-nastaliq", display: "swap" });

export const metadata: Metadata = {
  title: "Script-Bias Audit",
  description: "Is the AI judge fair to Roman Urdu? Measuring script bias in LLM judges.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: [{ color: "#fbfbfd" }],
  width: "device-width",
  initialScale: 1,
};

// Applies a saved dark-mode choice before first paint (light is the default).
const themeScript = `try{if(localStorage.getItem("theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" className={`${inter.variable} ${nastaliq.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <div className="backdrop" aria-hidden="true"><span className="glow g1" /><span className="glow g2" /><span className="glow g3" /></div>
        <SiteHeader />
        <main className="page">{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
