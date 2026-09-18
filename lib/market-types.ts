export type MarketTrade = {
  signature: string;
  timestamp: number;
  side: "buy" | "sell";
  priceInPair: number;
  baseAmount: number;
  quoteAmount: number;
};

export type MarketPricePoint = {
  timestamp: number;
  priceInPair: number;
  volumeQuote: number;
  side: "buy" | "sell";
};

export type CandleIntervalSeconds = 1 | 3 | 5 | 60;

export type MarketCandle = {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volumeQuote: number;
  buyVolumeQuote: number;
  sellVolumeQuote: number;
  tradeCount: number;
};

export type SolanaCluster = "devnet" | "mainnet-beta";

export type DbcMarket = {
  address: string;
  creator: string;
  mint: string;
  cluster: SolanaCluster;
  pairSymbol: "B200";
  name: string;
  website: string;
  logo: string;
  feePercent: number;
  priceInPair: number;
  quoteReserve: number;
  progressPercent: number;
  migrationReady: boolean;
  migrated: boolean;
  graduatedPool: string | null;
  createdAt: number | null;
  lastTradeAt: number | null;
  tradeCount: number;
  volumeQuote: number;
  changePercent: number | null;
  history: MarketPricePoint[];
  trades: MarketTrade[];
  dexScreenerUrl: string | null;
};
