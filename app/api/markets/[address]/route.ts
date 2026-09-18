import { PublicKey } from "@solana/web3.js";
import { getDbcMarket } from "@/lib/dbc-markets";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ address: string }> },
) {
  try {
    const { address } = await params;
    new PublicKey(address);
    const market = await getDbcMarket(address, {
      fresh: new URL(request.url).searchParams.get("fresh") === "1",
    });
    if (!market) return Response.json({ error: "Market not found" }, { status: 404 });
    return Response.json({ market });
  } catch {
    return Response.json({ error: "Invalid or unavailable B200 market" }, { status: 400 });
  }
}
