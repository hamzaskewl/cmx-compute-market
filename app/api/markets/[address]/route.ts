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
      includeActivity: new URL(request.url).searchParams.get("summary") !== "1",
    });
    if (!market) return Response.json({ error: "Market not found" }, { status: 404 });
    return Response.json({ market });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Invalid public key")) {
      return Response.json({ error: "Invalid market address" }, { status: 400 });
    }
    console.error("Market snapshot is temporarily unavailable:", error instanceof Error ? error.name : "RPC error");
    return Response.json({ error: "Market data is temporarily unavailable" }, { status: 503 });
  }
}
