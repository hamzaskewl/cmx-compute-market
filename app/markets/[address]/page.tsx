import { notFound } from "next/navigation";
import { MarketTerminal } from "@/components/market-terminal";
import { getDbcMarket } from "@/lib/dbc-markets";
import { getOrnnSnapshot } from "@/lib/ornn";

export const dynamic = "force-dynamic";

export default async function MarketPage({ params }: {
  params: Promise<{ address: string }>;
}) {
  const { address } = await params;
  const market = await getDbcMarket(address).catch(() => null);
  if (!market) notFound();
  const snapshot = await getOrnnSnapshot().catch(() => null);
  const b200ReferencePrice = snapshot?.indices.find((index) => index.symbol === "B200")?.price ?? null;
  return <MarketTerminal b200ReferencePrice={b200ReferencePrice} initialMarket={market} />;
}
