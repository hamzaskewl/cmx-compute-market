import { getOrnnB200Price } from "@/lib/ornn";

export async function GET() {
  try {
    return Response.json({ price: await getOrnnB200Price() });
  } catch {
    return Response.json({ error: "B200 reference is temporarily unavailable" }, { status: 503 });
  }
}
