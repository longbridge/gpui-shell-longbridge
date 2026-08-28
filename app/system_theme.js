/** Parse the flat key/value format used by Omarchy's colors.toml. */
function parsePalette(source) {
  const palette = {};
  for (const line of source.split("\n")) {
    const match = line.match(/^\s*([A-Za-z0-9_-]+)\s*=\s*(["'])(.*?)\2/);
    if (match) palette[match[1]] = match[3];
  }
  return palette;
}

function first(palette, ...keys) {
  return keys.map((key) => palette[key]).find(Boolean);
}

export function omarchyBaseColors(source) {
  const palette = parsePalette(source);
  return [
    first(palette, "red", "color1"),
    first(palette, "green", "color2"),
    first(palette, "yellow", "color3"),
    first(palette, "blue", "color4"),
    first(palette, "magenta", "purple", "color5"),
    first(palette, "cyan", "color6"),
  ].filter(Boolean);
}

export function omarchyMarketColors(source) {
  const palette = parsePalette(source);
  return {
    down: first(palette, "red", "color1"),
    up: first(palette, "green", "color2"),
    warning: first(palette, "yellow", "color3"),
    info: first(palette, "cyan", "color6"),
  };
}

/** Project Omarchy's semantic colors into gpui-component theme tokens. */
export function omarchyTheme(source, fallback) {
  const palette = parsePalette(source);
  const background = first(palette, "background", "bg", "color0");
  const foreground = first(palette, "foreground", "fg", "color7");
  if (!background || !foreground) return null;

  const mode = first(palette, "mode", "theme_type") === "light" ? "light" : "dark";
  const accent = first(palette, "accent", "blue", "color4") ?? foreground;
  const muted = first(palette, "muted", "dark_foreground", "dark_fg") ?? foreground;
  const darkForeground = first(palette, "dark_foreground", "dark_fg") ?? muted;
  const lightForeground = first(palette, "light_foreground", "light_fg") ?? foreground;
  const brightForeground =
    first(palette, "bright_foreground", "bright_fg") ?? lightForeground;
  // Omarchy windows use the base background continuously; panels are
  // separated by borders and spacing, not a second field of raised color.
  const surface = background;
  const secondary = first(palette, "lighter_background", "lighter_bg") ?? background;
  const selection = palette.selection ?? muted;
  const destructive = first(palette, "red", "color1") ?? fallback.tokens.colors.destructive;

  return {
    ...fallback,
    appearance: mode,
    tokens: {
      ...fallback.tokens,
      colors: {
        ...fallback.tokens.colors,
        background,
        foreground,
        surface,
        surface_foreground: foreground,
        primary: accent,
        primary_foreground: brightForeground,
        secondary,
        secondary_foreground: lightForeground,
        muted,
        muted_foreground: darkForeground,
        accent: selection,
        accent_foreground: lightForeground,
        destructive,
        destructive_foreground: brightForeground,
        border: muted,
        input: muted,
        ring: accent,
      },
    },
  };
}
