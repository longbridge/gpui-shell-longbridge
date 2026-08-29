// Pure selected-symbol market-detail reducers. Protocol values keep their
// provider precision (decimal prices and BigInt quantities) until rendering.

const VISIBLE_LEVELS = 5;
const DEFAULT_TRADE_LIMIT = 20;

function absolute(value) {
  if (typeof value === "bigint") return value < 0n ? -value : value;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.abs(numeric) : 0;
}

function numericMagnitude(value) {
  const magnitude = absolute(value);
  return typeof magnitude === "bigint" ? Number(magnitude) : magnitude;
}

/** A depth level is visible only when both its price and quantity are usable. */
export function validDepthLevel(level) {
  const price = decimalParts(level?.price);
  const volume = level?.volume;
  const positiveVolume =
    typeof volume === "bigint"
      ? volume > 0n
      : Number.isFinite(Number(volume)) && Number(volume) > 0;
  return price?.sign === 1 && positiveVolume;
}

function compareQuantity(left, right) {
  const leftMagnitude = absolute(left);
  const rightMagnitude = absolute(right);
  if (typeof leftMagnitude === "bigint" && typeof rightMagnitude === "bigint") {
    return leftMagnitude < rightMagnitude ? -1 : leftMagnitude > rightMagnitude ? 1 : 0;
  }
  const leftNumber = Number(leftMagnitude);
  const rightNumber = Number(rightMagnitude);
  return leftNumber < rightNumber ? -1 : leftNumber > rightNumber ? 1 : 0;
}

function levelPosition(level) {
  const position = Number(level?.position);
  return Number.isFinite(position) ? position : Number.POSITIVE_INFINITY;
}

function visibleLevels(levels) {
  if (!Array.isArray(levels)) return Object.freeze([]);
  return Object.freeze(
    levels
      .filter((level) => level && typeof level === "object")
      .map((level, index) => ({ level: Object.freeze({ ...level }), index }))
      .sort(
        (left, right) =>
          levelPosition(left.level) - levelPosition(right.level) || left.index - right.index,
      )
      .slice(0, VISIBLE_LEVELS)
      .map(({ level }) => level),
  );
}

/** Returns the five nearest book levels for each side without altering its input. */
export function normalizeDepth(snapshot) {
  const source = snapshot && typeof snapshot === "object" ? snapshot : {};
  return Object.freeze({
    symbol: source.symbol,
    asks: visibleLevels(source.asks),
    bids: visibleLevels(source.bids),
  });
}

/** Returns the visible bid/ask share of total depth volume. */
export function depthRatio(depth) {
  const total = (levels) =>
    (Array.isArray(levels) ? levels : [])
      .filter(validDepthLevel)
      .reduce((sum, level) => sum + numericMagnitude(level.volume), 0);
  const bids = total(depth?.bids);
  const asks = total(depth?.asks);
  const combined = bids + asks;
  if (!Number.isFinite(combined) || combined <= 0) return Object.freeze({ bid: 0, ask: 0 });
  return Object.freeze({ bid: bids / combined, ask: asks / combined });
}

/** A stable identity for de-duplicating detail trades supplied without an ID. */
export function tradeIdentity(trade) {
  const source = trade && typeof trade === "object" ? trade : {};
  return [
    source.timestamp,
    source.price,
    source.volume,
    source.tradeType,
    source.direction,
    source.tradeSession,
  ]
    .map((value) => String(value ?? ""))
    .join("|");
}

function decimalParts(value) {
  const matched = /^([+-]?)(\d+)(?:\.(\d*))?$/.exec(String(value).trim());
  if (!matched) return null;
  const digits = `${matched[2]}${matched[3] ?? ""}`.replace(/^0+/, "");
  if (digits.length === 0) return { sign: 0, digits: "0", magnitude: 0 };
  return {
    sign: matched[1] === "-" ? -1 : 1,
    digits,
    magnitude: digits.length - (matched[3] ?? "").length,
  };
}

function compareDecimals(left, right) {
  const leftParts = decimalParts(left);
  const rightParts = decimalParts(right);
  if (leftParts === null || rightParts === null) return null;
  if (leftParts.sign !== rightParts.sign) return leftParts.sign - rightParts.sign;
  if (leftParts.sign === 0) return 0;
  if (leftParts.magnitude !== rightParts.magnitude) {
    return (leftParts.magnitude - rightParts.magnitude) * leftParts.sign;
  }
  const width = Math.max(leftParts.digits.length, rightParts.digits.length);
  for (let index = 0; index < width; index += 1) {
    const leftDigit = leftParts.digits.charCodeAt(index) || 48;
    const rightDigit = rightParts.digits.charCodeAt(index) || 48;
    if (leftDigit !== rightDigit) return (leftDigit - rightDigit) * leftParts.sign;
  }
  return 0;
}

function compareText(left, right) {
  const leftText = String(left ?? "");
  const rightText = String(right ?? "");
  return leftText < rightText ? -1 : leftText > rightText ? 1 : 0;
}

function compareTrades(left, right) {
  const timestamp = compareQuantity(right.timestamp, left.timestamp);
  if (timestamp !== 0) return timestamp;
  const price = compareDecimals(right.price, left.price) ?? compareText(right.price, left.price);
  if (price !== 0) return price;
  const volume = compareQuantity(right.volume, left.volume);
  if (volume !== 0) return volume;
  const tradeType = compareText(left.tradeType, right.tradeType);
  if (tradeType !== 0) return tradeType;
  const direction = compareQuantity(right.direction, left.direction);
  if (direction !== 0) return direction;
  return compareQuantity(right.tradeSession, left.tradeSession);
}

/**
 * Prepends detail updates logically, removes duplicate stable records, then
 * returns the newest bounded sequence without modifying either input array.
 */
export function mergeTrades(current, incoming, limit = DEFAULT_TRADE_LIMIT) {
  const maximum = Number.isFinite(limit)
    ? Math.min(DEFAULT_TRADE_LIMIT, Math.max(0, Math.floor(limit)))
    : DEFAULT_TRADE_LIMIT;
  const unique = new Map();
  for (const trade of [
    ...(Array.isArray(incoming) ? incoming : []),
    ...(Array.isArray(current) ? current : []),
  ]) {
    if (!trade || typeof trade !== "object") continue;
    const identity = tradeIdentity(trade);
    if (!unique.has(identity)) unique.set(identity, Object.freeze({ ...trade }));
  }
  return Object.freeze(Array.from(unique.values()).sort(compareTrades).slice(0, maximum));
}

/** The square-root bar scale used to keep small trades visible beside large ones. */
export function tradeVolumeRatio(volume, maximum) {
  const numerator = numericMagnitude(volume);
  const denominator = numericMagnitude(maximum);
  if (
    !Number.isFinite(numerator) ||
    !Number.isFinite(denominator) ||
    numerator <= 0 ||
    denominator <= 0
  ) {
    return 0;
  }
  return Math.sqrt(Math.min(1, numerator / denominator));
}
