import { readServerDeployment } from "@/lib/server-deployment";
import type { Deployment } from "@/lib/chain-client";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return Response.json(await readServerDeployment<Deployment>());
  } catch {
    return Response.json(
      { error: "The Solana market deployment is not configured yet" },
      { status: 503 },
    );
  }
}
