// Application shapes kept separate from the gpui-shell declarations.

interface LongbridgeTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
}

interface LongbridgeDeviceAuthorization {
  deviceCode: string;
  verificationUri: string;
  userCode: string;
  intervalMs: number;
  expiresAt: number;
}

type LongbridgeThemeMode = "light" | "dark";
type LongbridgeActionVariant = "primary" | "default" | "ghost" | "destructive";

interface LongbridgeQuoteRow {
  symbol: string;
  code: string;
  name: string;
  market: string;
  currency: string;
  last: string;
  prevClose: string;
  open: string;
  high: string;
  low: string;
  change: string;
  changePercent: string;
  volume: bigint;
  turnover: string;
  tradeStatus?: number;
  tradeSession?: number;
  sequence?: bigint;
  updatedAt: number;
  receivedAt: number;
}

interface LongbridgeHoldingRow {
  symbol: string;
  name: string;
  quantity: string;
  available: string;
  costPrice: string;
  currency: string;
}

type LongbridgePage = "watchlist" | "portfolio";
