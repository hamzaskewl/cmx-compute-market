import { PublicKey } from "@solana/web3.js";
import { getDbcMarket, getMarketCluster } from "@/lib/dbc-markets";
import { subscribeMarketTrades } from "@/lib/market-live";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  request: Request,
  context: RouteContext<"/api/markets/[address]/stream">,
) {
  const { address } = await context.params;
  try {
    new PublicKey(address);
  } catch {
    return Response.json({ error: "Invalid market address." }, { status: 400 });
  }
  const network = await getMarketCluster();
  const market = await getDbcMarket(address, { includeActivity: false }).catch(() => null);
  if (!market) return Response.json({ error: "Market stream is temporarily unavailable." }, { status: 503 });

  const encoder = new TextEncoder();
  let dispose = () => {};
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, payload: unknown) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
        } catch {
          closed = true;
        }
      };
      const subscription = subscribeMarketTrades(market, (trade) => send("trade", trade));
      const heartbeat = setInterval(() => send("heartbeat", { timestamp: Date.now() }), 20_000);

      dispose = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        subscription.unsubscribe();
        try { controller.close(); } catch { /* already closed by the client */ }
      };
      request.signal.addEventListener("abort", dispose, { once: true });
      try {
        await subscription.ready;
        send("ready", {
          commitment: "confirmed",
          network,
          transport: process.env.SOLANA_WSS_URL || process.env.SOLANA_RPC_URL
            ? "configured-rpc-websocket"
            : "solana-websocket",
        });
        void getDbcMarket(address, { fresh: true, network })
          .then((snapshot) => {
            if (snapshot) send("snapshot", snapshot);
          })
          .catch(() => undefined);
      } catch (error) {
        clearInterval(heartbeat);
        subscription.unsubscribe();
        if (!closed) controller.error(error);
      }
    },
    cancel() {
      dispose();
    },
  });

  return new Response(stream, {
    headers: {
      "Cache-Control": "no-cache, no-transform",
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
