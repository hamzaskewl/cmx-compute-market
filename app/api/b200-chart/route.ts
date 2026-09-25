import { getOrnnHistory, getOrnnSnapshot } from "@/lib/ornn";

export async function GET() {
  const [history, snapshot] = await Promise.all([
    getOrnnHistory("B200").catch(() => []),
    getOrnnSnapshot().catch(() => null),
  ]);
  const b200 = snapshot?.indices.find((entry) => entry.symbol === "B200");
  if (history.length < 2 && !b200) {
    return Response.json({ error: "B200 reference is temporarily unavailable" }, { status: 503 });
  }
  return Response.json({ history, price: b200?.price ?? null, updatedAt: b200?.date ?? null });
}
