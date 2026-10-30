import { Parkinsans, JetBrains_Mono } from "next/font/google";
import { DesignMotionProvider } from "../components/zai/provider";
import type { Metadata } from "next";
import type { ReactNode } from "react";

import "./globals.css";

const parkinsans = Parkinsans({
  variable: "--font-parkinsans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  display: "swap",
});
const mono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  description:
    "Independent AI-assisted tender intelligence and bid-readiness platform.",
  title: "Tender Intelligence Platform",
};

export default function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>): React.JSX.Element {
  return (
    <html lang="en">
      <body
        className={`${parkinsans.variable} ${mono.variable} antialiased bg-background text-foreground`}
        style={{ fontFamily: "var(--font-parkinsans), system-ui, sans-serif" }}
      >
        <DesignMotionProvider>{children}</DesignMotionProvider>
      </body>
    </html>
  );
}
