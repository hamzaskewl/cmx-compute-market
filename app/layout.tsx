import type { Metadata } from "next";
import { Azeret_Mono, Onest } from "next/font/google";
import { WalletProvider } from "@/components/wallet-context";
import { NetworkProvider } from "@/components/network-context";
import { hasServerDeployment, readSelectedNetwork } from "@/lib/server-deployment";
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
  description: "The market for GPU-hours. Mint cmB200 and launch compute pairs with Meteora DBC on Solana.",
  other: {
    "codex-preview": "development",
  },
  icons: {
    icon: "/brand/cx-emblem-green.png",
    shortcut: "/brand/cx-emblem-green.png",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const network = await readSelectedNetwork();
  const available = await hasServerDeployment(network);
  return (
    <html lang="en">
      <body className={`${sans.variable} ${data.variable}`}><NetworkProvider initialAvailable={available} initialNetwork={network}><WalletProvider>{children}</WalletProvider></NetworkProvider></body>
    </html>
  );
}
