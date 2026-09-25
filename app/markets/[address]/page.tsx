import { MarketPageLoader } from "@/components/market-page-loader";
import { NetworkUnavailable } from "@/components/network-unavailable";
import { hasServerDeployment, readSelectedNetwork } from "@/lib/server-deployment";

export const dynamic = "force-dynamic";

export default async function MarketPage({ params }: {
  params: Promise<{ address: string }>;
}) {
  const network = await readSelectedNetwork();
  if (!(await hasServerDeployment(network))) return <NetworkUnavailable network={network} />;
  const { address } = await params;
  return <MarketPageLoader address={address} />;
}
