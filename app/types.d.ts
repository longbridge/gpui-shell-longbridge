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

interface LongbridgeOrderRow {
  orderId: string;
  symbol: string;
  code: string;
  market: string;
  name: string;
  side: string;
  sideKind: "buy" | "sell" | "unknown";
  sideLabel: string;
  type: string;
  status: string;
  statusLabel: string;
  statusKind: "filled" | "working" | "rejected" | "ended" | "unknown";
  quantity: string;
  executedQuantity: string;
  price: string;
  executedPrice: string;
  lastDone: string;
  triggerPrice: string;
  currency: string;
  timeInForce: string;
  outsideRth: string;
  tag: string;
  submittedAt: number;
  updatedAt: number;
  message: string;
  remark: string;
}

interface LongbridgeOrdersState {
  status: "idle" | "loading" | "ready" | "error";
  /** Whether a read has ever succeeded, which is what makes the list a list. */
  loaded: boolean;
  today: readonly LongbridgeOrderRow[];
  history: readonly LongbridgeOrderRow[];
  error: string;
}

type LongbridgePage = "watchlist" | "portfolio" | "orders";
type PriceChartMode = "intraday" | "5D" | "1m" | "5m" | "15m" | "1D";

interface PriceChartPreparedPoint {
  timestamp: number;
  close: number;
  date: string;
  dayIndex: number;
}

interface PriceChartLaidOutPoint extends PriceChartPreparedPoint {
  x: number;
  y: number;
}

interface PriceChartSeries {
  symbol: string;
  days: Array<{ date: string; points: Array<Record<string, unknown>> }>;
  points: PriceChartPreparedPoint[];
}

interface PriceChartGeometry {
  symbol: string;
  days: Array<{ date: string; points: Array<Record<string, unknown>> }>;
  points: PriceChartLaidOutPoint[];
  width: number;
  height: number;
  min: number | null;
  max: number | null;
}

interface PriceChartProps {
  symbol: string;
  mode: PriceChartMode;
  series: PriceChartSeries;
  chartSeries:
    | PriceChartSeries
    | {
        candles: Array<Record<string, unknown>>;
        sessionBoundaries?: Array<Record<string, unknown>>;
      };
  state: "idle" | "loading" | "ready" | "error";
  layout: {
    width: number;
    height: number;
    dayGap: number;
  };
  themeRevision: number;
}

interface LongbridgeChartCacheEntry {
  identity: string;
  candles: Array<Record<string, unknown>>;
}

type LongbridgeDetailStatus = "idle" | "loading" | "ready" | "error";

interface LongbridgeDepthLevel {
  position?: number;
  price?: string;
  volume?: bigint;
  orderNum?: bigint;
}

interface LongbridgeDepthState {
  symbol: string | null;
  status: LongbridgeDetailStatus;
  asks: LongbridgeDepthLevel[];
  bids: LongbridgeDepthLevel[];
  error: string;
}

interface LongbridgeTrade {
  price?: string;
  volume?: bigint;
  timestamp?: bigint;
  tradeType?: string;
  direction?: number;
  tradeSession?: number;
}

interface LongbridgeTradesState {
  symbol: string | null;
  status: LongbridgeDetailStatus;
  trades: LongbridgeTrade[];
  error: string;
}
