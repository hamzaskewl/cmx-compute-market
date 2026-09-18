import { readFile } from "node:fs/promises";
import path from "node:path";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await readFile(
      path.join(process.cwd(), "deployment", "devnet.json"),
      "utf8",
    );
    return Response.json(JSON.parse(data));
  } catch {
    return Response.json(
      { error: "The Solana market deployment is not configured yet" },
      { status: 503 },
    );
  }
}
