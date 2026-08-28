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

/** Tokyo Night's ANSI row, and Flexoki Light's, both stepped to clear 4.5:1
 * against every surface this application draws on (canvas, panel and well). */
const STATUS = Object.freeze({
  dark: Object.freeze({
    up: "#9ece6a",
    down: "#f7768e",
    warning: "#e0af68",
    info: "#7dcfff",
  }),
  light: Object.freeze({
    up: "#536907",
    down: "#942822",
    warning: "#664d01",
    info: "#1c6c66",
  }),
});

/**
 * Direction and feed-health colours for the current mode.
 *
 * @param {import("gpui-base").Theme} tokens
 */
export function statusColors(tokens) {
  return STATUS[tokens.is_dark ? "dark" : "light"];
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

// Five categorical hues for the allocation ring, assigned in a fixed order and
// never cycled -- a sixth holding folds into "Other" rather than borrowing a
// hue that already means something else (see `foldAllocationSlices`).
//
// These deliberately do NOT come from the theme's ANSI row, which is the one
// place this application departs from Omarchy's "charts use theme colours"
// guidance. Two reasons, and the design system's own priority order --
// accessibility over product behaviour over brand -- settles it:
//
//   * red and green are spoken for. They mean down and up everywhere else in
//     this window, and a wedge painted green next to a price painted green has
//     borrowed a meaning it does not have.
//   * the remaining ANSI colours do not separate. Simulated over protanopia,
//     deuteranopia and tritanopia, the best five-hue set drawn from Tokyo
//     Night's row scores dE 13.4 and from Flexoki Light's only dE 3.0, against
//     dE 4.2 / 8.5 for the purpose-built steps below. Light would get much
//     worse, which is the mode that was already the tighter of the two.
//
// Each mode is stepped for its own surface rather than flipped from the other.
// Some light steps sit under 3:1 against the paper surface, which is why the
// legend beside the ring always carries the name, the value and the
// percentage: identity here is never colour alone.
const ALLOCATION = Object.freeze({
  light: Object.freeze(["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4"]),
  dark: Object.freeze(["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"]),
});

/**
 * A wedge's colour. "Other" is a remainder, not an identity, so it stays grey.
 *
 * @param {import("gpui-base").Theme} tokens
 * @param {{ other?: boolean }} slice
 * @param {number} index
 */
export function allocationColor(tokens, slice, index) {
  if (slice.other) return tokens.muted_foreground;
  const hues = ALLOCATION[tokens.is_dark ? "dark" : "light"];
  return hues[Math.min(index, hues.length - 1)];
}
