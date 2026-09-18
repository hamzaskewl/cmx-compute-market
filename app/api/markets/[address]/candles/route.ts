import { PublicKey } from "@solana/web3.js";
import { getDbcMarket } from "@/lib/dbc-markets";
import { buildMarketCandles, isCandleInterval } from "@/lib/market-candles";

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: RouteContext<"/api/markets/[address]/candles">,
) {
  const { address } = await context.params;
  try {
    new PublicKey(address);
  } catch {
    return Response.json({ error: "Invalid market address." }, { status: 400 });
  }
  const intervalValue = Number(new URL(request.url).searchParams.get("interval") ?? "1");
  if (!isCandleInterval(intervalValue)) {
    return Response.json({ error: "Interval must be 1, 3, 5, or 60 seconds." }, { status: 400 });
  }
  const market = await getDbcMarket(address);
  if (!market) return Response.json({ error: "Market not found." }, { status: 404 });
  return Response.json({
    address: market.address,
    intervalSeconds: intervalValue,
    source: "solana-swaps",
    candles: buildMarketCandles(market.history, intervalValue),
  });
}
