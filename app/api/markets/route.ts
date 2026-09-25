import { getDbcMarkets } from "@/lib/dbc-markets";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const detailed = new URL(request.url).searchParams.get("detailed") === "1";
    return Response.json({ markets: await getDbcMarkets({ includeActivity: detailed }) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown market data error";
    const safeMessage = [process.env.SOLANA_DEVNET_RPC_URL, process.env.SOLANA_MAINNET_RPC_URL, process.env.SOLANA_RPC_URL]
      .filter((url): url is string => Boolean(url))
      .reduce((text, url) => text.replaceAll(url, "[rpc]"), message);
    console.error("Market directory error:", safeMessage);
    return Response.json({ error: "Markets are temporarily unavailable" }, { status: 503 });
  }
}
