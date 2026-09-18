export type OrnnIndex = {
  symbol: "H100" | "H200" | "B200" | "A100" | "5090";
  name: string;
  price: number;
  region: string;
  date: string;
};

const GPU_TYPES = [
  { symbol: "B200", name: "B200" },
  { symbol: "H100", name: "H100 SXM" },
  { symbol: "H200", name: "H200" },
  { symbol: "A100", name: "A100 SXM4" },
  { symbol: "5090", name: "RTX 5090" },
] as const satisfies ReadonlyArray<{ symbol: OrnnIndex["symbol"]; name: string }>;

export type OrnnSnapshot = {
  indices: OrnnIndex[];
  date: string | null;
  source: "Composite reference";
};

export type OrnnHistoryPoint = {
  timestamp: string;
  price: number;
};

export async function getOrnnSnapshot(): Promise<OrnnSnapshot> {
  const responses = await Promise.allSettled(
    GPU_TYPES.map(async ({ symbol, name }) => {
      const response = await fetch(
        `https://api.ornnai.com/api/gpu/${encodeURIComponent(name)}`,
        { next: { revalidate: 300 }, signal: AbortSignal.timeout(8_000) },
      );
      if (!response.ok) throw new Error(`Ornn returned ${response.status} for ${name}`);
      const payload = (await response.json()) as {
        data?: { gpu_name: string; region: string; index_value: number; last_updated: string };
      };
      const row = payload.data;
      if (!row || !Number.isFinite(row.index_value)) throw new Error(`Ornn omitted ${name}`);
      return {
        symbol,
        name: row.gpu_name,
        price: row.index_value,
        region: row.region,
        date: row.last_updated,
      } satisfies OrnnIndex;
    }),
  );
  const indices = responses.flatMap((response) =>
    response.status === "fulfilled" ? [response.value] : [],
  );

  if (indices.length === 0) throw new Error("Ornn returned no usable GPU indexes");
  const latestDate = indices.map((index) => index.date).sort().at(-1) ?? null;

  return {
    indices,
    date: latestDate,
    source: "Composite reference",
  };
}

export async function getOrnnHistory(gpuName: string): Promise<OrnnHistoryPoint[]> {
  const response = await fetch(
    `https://api.ornnai.com/api/gpu/${encodeURIComponent(gpuName)}/index-history`,
    {
      next: { revalidate: 3_600 },
      signal: AbortSignal.timeout(8_000),
    },
  );

  if (!response.ok) throw new Error(`Ornn history returned ${response.status}`);

  const payload = (await response.json()) as {
    data?: Array<{ timestamp: string; index_value: number }>;
  };

  return (payload.data ?? [])
    .filter((point) => point.timestamp && Number.isFinite(point.index_value))
    .map((point) => ({ timestamp: point.timestamp, price: point.index_value }));
}
