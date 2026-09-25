export const dynamic = "force-dynamic";

function clean(value: string | null, max: number) {
  return (value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max);
}

function cleanImage(value: string | null, fallback: string) {
  const cleaned = clean(value, 180);
  if (!cleaned) return fallback;
  try {
    const parsed = new URL(cleaned);
    return parsed.protocol === "https:" ? parsed.toString() : fallback;
  } catch {
    return fallback;
  }
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const name = clean(url.searchParams.get("n") ?? url.searchParams.get("name"), 32) || "CMX B200 Launch";
  const symbol = clean(url.searchParams.get("s") ?? url.searchParams.get("symbol"), 8).toUpperCase() || "B200";
  const description = clean(url.searchParams.get("d") ?? url.searchParams.get("description"), 72)
    || "A permissionless launch paired against the cmB200 GPU-hour index on Solana.";
  const fallbackImage = new URL("/assets/b200-nvl8-v2-web.png", url.origin).toString();

  return Response.json({
    name,
    symbol,
    description,
    image: cleanImage(url.searchParams.get("i") ?? url.searchParams.get("image"), fallbackImage),
    attributes: [
      { trait_type: "Quote asset", value: "cmB200" },
      { trait_type: "Market", value: "Meteora DBC" },
      { trait_type: "Network", value: "Solana" },
    ],
  });
}
