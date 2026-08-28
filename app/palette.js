// The colour roles the semantic token set cannot carry.
//
// gpui-base's theme is seventeen fixed roles -- background, foreground,
// primary, destructive and so on. A market terminal needs two more that are
// not interface roles at all but readings: whether a number moved up or down,
// and how healthy the feed is. Omarchy's colour model has exactly these as its
// ANSI row (green, red, yellow, cyan), so this module is that row, per mode,
// and nothing else reintroduces a literal colour.
//
// Keeping them out of `primary` is the point. `primary` is the interactive
// accent -- focus, links, the one filled button -- and a terminal that paints a
// rising price in the same colour as its buttons has said two different things
// with one mark.

let omarchyAvatarColors = [];
let omarchyMarketColors = {};

export function setOmarchyAvatarColors(colors) {
  omarchyAvatarColors = colors.slice(0, 6);
}

export function setOmarchyMarketColors(colors) {
  omarchyMarketColors = { ...colors };
}

export function avatarColor(tokens, initial, strength = 0.55) {
  const colors = omarchyAvatarColors.length
    ? omarchyAvatarColors
    : [tokens.primary, tokens.destructive, tokens.ring];
  const letter = String(initial || "-").toUpperCase().charCodeAt(0);
  const base = colors[(letter - 65 + colors.length * 26) % colors.length];
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(base);
  const background = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(tokens.background);
  if (!match || !background) return base;
  const channel = (index) =>
    Math.round(
      Number.parseInt(background[index], 16) * (1 - strength) +
        Number.parseInt(match[index], 16) * strength,
    )
      .toString(16)
      .padStart(2, "0");
  return `#${channel(1)}${channel(2)}${channel(3)}`;
}

/**
 * Direction and feed-health colours for the current mode.
 *
 * @param {import("gpui-base").Theme} tokens
 */
export function statusColors(tokens) {
  return {
    up: omarchyMarketColors.up ?? tokens.primary,
    down: omarchyMarketColors.down ?? tokens.destructive,
    warning: omarchyMarketColors.warning ?? tokens.muted_foreground,
    info: omarchyMarketColors.info ?? tokens.ring,
  };
}

/**
 * The colour a signed, pre-formatted market string is drawn in. Neither sign
 * is a state of the interface, so neither comes from a token.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {string} change A rendered change, e.g. `+8.00` or `-1.2%`.
 */
export function changeTone(tokens, change) {
  const status = statusColors(tokens);
  if (change.startsWith("-")) return status.down;
  if (change.startsWith("+")) return status.up;
  return tokens.foreground;
}

/**
 * The colour a signed number is drawn in.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {number} value
 */
export function valueTone(tokens, value) {
  const status = statusColors(tokens);
  if (value < 0) return status.down;
  if (value > 0) return status.up;
  return tokens.foreground;
}

/**
 * A wedge's colour. "Other" is a remainder, not an identity, so it stays grey.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {{ other?: boolean }} slice
 * @param {number} index
 */
export function allocationColor(tokens, slice, index) {
  if (slice.other) return tokens.muted_foreground;
  const hues = omarchyAvatarColors.length
    ? omarchyAvatarColors
    : [tokens.primary, tokens.ring, tokens.destructive, tokens.muted_foreground];
  return hues[Math.min(index, hues.length - 1)];
}
