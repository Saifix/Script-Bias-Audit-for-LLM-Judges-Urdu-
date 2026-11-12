import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Nav } from "../components/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "Script-Bias Audit",
  description: "Is the AI judge fair to Roman Urdu? Measuring script bias in LLM judges.",
  robots: { index: false, follow: false },
};

// Applies a saved dark-mode choice before first paint (light is the default).
const themeScript = `try{if(localStorage.getItem("theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <Nav />
        <main className="page">{children}</main>
      </body>
    </html>
  );
}
