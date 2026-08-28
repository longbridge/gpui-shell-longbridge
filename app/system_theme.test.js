import { describe, expect, test } from "bun:test";
import { omarchyBaseColors, omarchyMarketColors, omarchyTheme } from "./system_theme.js";

const FALLBACK = {
  appearance: "dark",
  tokens: {
    colors: { background: "#000000", foreground: "#ffffff" },
    spacing: { sm: 8 },
    radius: { md: 0 },
  },
};

describe("omarchyTheme", () => {
  test("maps the current Omarchy semantic palette to GPUI tokens", () => {
    const theme = omarchyTheme(
      `
mode = "dark"
accent = "#9c2331"
selection = "#521321"
muted = "#4e4547"
background = "#0a0708"
dark_background = "#060405"
lighter_background = "#161112"
foreground = "#bfb8b6"
dark_foreground = "#7a6f72"
light_foreground = "#d8d1c8"
bright_foreground = "#f5eedc"
red = "#e24848"
`,
      FALLBACK,
    );

    expect(theme.appearance).toBe("dark");
    expect(theme.tokens.colors).toMatchObject({
      background: "#0a0708",
      foreground: "#bfb8b6",
      surface: "#0a0708",
      primary: "#9c2331",
      accent: "#521321",
      muted: "#4e4547",
      muted_foreground: "#7a6f72",
      destructive: "#e24848",
      border: "#4e4547",
      ring: "#9c2331",
    });
    expect(theme.tokens.spacing).toEqual(FALLBACK.tokens.spacing);
    expect(theme.tokens.radius).toEqual(FALLBACK.tokens.radius);
  });

  test("supports legacy aliases used by older Omarchy themes", () => {
    const theme = omarchyTheme(
      `theme_type = 'light'\nbg = '#eeeeee'\nfg = '#111111'\ncolor1 = '#cc0000'`,
      FALLBACK,
    );

    expect(theme.appearance).toBe("light");
    expect(theme.tokens.colors.background).toBe("#eeeeee");
    expect(theme.tokens.colors.foreground).toBe("#111111");
    expect(theme.tokens.colors.destructive).toBe("#cc0000");
  });

  test("returns null for a missing or unusable palette", () => {
    expect(omarchyTheme("", FALLBACK)).toBeNull();
    expect(omarchyTheme('mode = "dark"', FALLBACK)).toBeNull();
  });

  test("exposes the six Omarchy base colors in a stable order", () => {
    expect(
      omarchyBaseColors(
        'red="#1"\ngreen="#2"\nyellow="#3"\nblue="#4"\nmagenta="#5"\ncyan="#6"',
      ),
    ).toEqual(["#1", "#2", "#3", "#4", "#5", "#6"]);
    expect(
      omarchyMarketColors('red="#1"\ngreen="#2"\nyellow="#3"\ncyan="#6"'),
    ).toEqual({ down: "#1", up: "#2", warning: "#3", info: "#6" });
  });
});
