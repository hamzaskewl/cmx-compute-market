import { getOrnnSnapshot } from "@/lib/ornn";

export async function GET() {
  try {
    return Response.json(await getOrnnSnapshot());
  } catch {
    return Response.json(
      { error: "Composite index feed is temporarily unavailable" },
      { status: 503 },
    );
  }
}
