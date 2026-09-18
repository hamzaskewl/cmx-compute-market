import { getDbcMarkets } from "@/lib/dbc-markets";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json({ markets: await getDbcMarkets() });
  } catch {
    return Response.json({ error: "Markets are temporarily unavailable" }, { status: 503 });
  }
}
