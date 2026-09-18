import type { Metadata } from "next";
import { Azeret_Mono, Onest } from "next/font/google";
import "./globals.css";

const sans = Onest({
  subsets: ["latin"],
  variable: "--type-sans",
});

const data = Azeret_Mono({
  subsets: ["latin"],
  variable: "--type-data",
});

export const metadata: Metadata = {
  title: "Compute Market — GPU-hour indexes on Solana",
  description: "Aggregated GPU-hour reference indexes for Solana compute markets.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${data.variable}`}>{children}</body>
    </html>
  );
}
