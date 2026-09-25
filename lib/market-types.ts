export type MarketTrade = {
  signature: string;
  timestamp: number;
  side: "buy" | "sell";
  priceInPair: number;
  baseAmount: number;
  priceReliable?: boolean;
  quoteAmount: number;
};

export type MarketPricePoint = {
  timestamp: number;
  priceInPair: number;
  volumeQuote: number;
  priceReliable?: boolean;
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
  symbol: string;
  website: string;
  logo: string;
  feePercent: number;
  priceInPair: number;
  marketCapQuote: number | null;
  openingMarketCapQuote: number | null;
  graduationMarketCapQuote: number | null;
  usesCurrentCurve: boolean;
  quoteReserve: number;
  progressPercent: number;
  migrationReady: boolean;
  migrated: boolean;
  graduatedPool: string | null;
  createdAt: number | null;
  lastTradeAt: number | null;
  activityLoaded: boolean;
  tradeCount: number;
  volumeQuote: number;
  changePercent: number | null;
  history: MarketPricePoint[];
  trades: MarketTrade[];
  dexScreenerUrl: string | null;
};
