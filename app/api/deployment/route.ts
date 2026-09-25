import { readSelectedNetwork, readServerDeployment } from "@/lib/server-deployment";
import type { Deployment } from "@/lib/chain-client";

export const dynamic = "force-dynamic";

export async function GET() {
  const network = await readSelectedNetwork();
  try {
    return Response.json(await readServerDeployment<Deployment>(network));
  } catch {
    return Response.json(
      { error: network === "mainnet-beta" ? "Mainnet is not live yet." : "The Solana market deployment is not configured yet.", network },
      { status: 503 },
    );
  }
}
