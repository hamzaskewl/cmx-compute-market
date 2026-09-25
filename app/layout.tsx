import type { Metadata } from "next";
import { Azeret_Mono, Onest } from "next/font/google";
import { WalletProvider } from "@/components/wallet-context";
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
  title: "CX — Compute Exchange",
  description: "The market for GPU-hours. Mint cmB200 and launch compute pairs with Meteora DBC on Solana devnet.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/brand/cx-emblem.png",
    shortcut: "/brand/cx-emblem.png",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${sans.variable} ${data.variable}`}><WalletProvider>{children}</WalletProvider></body>
    </html>
  );
}
