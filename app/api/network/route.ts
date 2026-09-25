import { cookies } from "next/headers";
import { NETWORK_COOKIE, hasServerDeployment, readSelectedNetwork } from "@/lib/server-deployment";
import type { SolanaCluster } from "@/lib/market-types";

export const dynamic = "force-dynamic";

export async function GET() {
  const network = await readSelectedNetwork();
  return Response.json({ network, available: await hasServerDeployment(network) });
}

export async function POST(request: Request) {
  let network: SolanaCluster;
  try {
    const body = await request.json() as { network?: unknown };
    if (body.network !== "devnet" && body.network !== "mainnet-beta") {
      return Response.json({ error: "Choose Devnet or Mainnet." }, { status: 400 });
    }
    network = body.network;
  } catch {
    return Response.json({ error: "Choose Devnet or Mainnet." }, { status: 400 });
  }

  (await cookies()).set(NETWORK_COOKIE, network, {
    httpOnly: true,
    maxAge: 60 * 60 * 24 * 60,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
  return Response.json({ network, available: await hasServerDeployment(network) });
}
