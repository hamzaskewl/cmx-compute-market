import { hasServerDeployment, readSelectedNetwork, readServerDeployment } from "@/lib/server-deployment";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 1_000_000;
const MAX_BATCH_SIZE = 20;

function validCall(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const method = (value as { method?: unknown }).method;
  return typeof method === "string"
    && /^(get[A-Z]|sendTransaction$|simulateTransaction$|isBlockhashValid$|requestAirdrop$)/.test(method);
}

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > MAX_BODY_BYTES) {
    return Response.json({ error: "RPC request is too large." }, { status: 413 });
  }
  const body = await request.text();
  if (Buffer.byteLength(body) > MAX_BODY_BYTES) {
    return Response.json({ error: "RPC request is too large." }, { status: 413 });
  }
  let payload: unknown;
  try { payload = JSON.parse(body); }
  catch { return Response.json({ error: "Invalid RPC request." }, { status: 400 }); }
  const calls = Array.isArray(payload) ? payload : [payload];
  if (!calls.length || calls.length > MAX_BATCH_SIZE || !calls.every(validCall)) {
    return Response.json({ error: "Unsupported RPC request." }, { status: 400 });
  }

  const network = await readSelectedNetwork();
  if (!await hasServerDeployment(network)) {
    return Response.json({ error: "This network is not live yet." }, { status: 503 });
  }
  const endpoint = network === "devnet"
    ? process.env.SOLANA_DEVNET_RPC_URL ?? process.env.SOLANA_RPC_URL
    : process.env.SOLANA_MAINNET_RPC_URL;
  const rpcUrl = endpoint ?? (await readServerDeployment<{ cluster: typeof network; rpcUrl: string }>(network)).rpcUrl;

  try {
    const upstream = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      cache: "no-store",
      signal: AbortSignal.timeout(20_000),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { "content-type": upstream.headers.get("content-type") ?? "application/json", "cache-control": "no-store" },
    });
  } catch {
    return Response.json({ error: "Solana RPC is temporarily unavailable." }, { status: 502 });
  }
}
