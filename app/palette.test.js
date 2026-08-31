import { describe, expect, test } from "bun:test";
import {
  allocationColor,
  avatarColor,
  setOmarchyAvatarColors,
  setOmarchyMarketColors,
  statusColors,
} from "./palette.js";

describe("avatarColor", () => {
  test("maps initials deterministically and softens the base color", () => {
    setOmarchyAvatarColors(["#ff0000", "#00ff00", "#0000ff"]);
    const tokens = { background: "#000000", primary: "#ffffff", destructive: "#ffffff", ring: "#ffffff" };
    expect(avatarColor(tokens, "A", 0.2)).toBe("#330000");
    expect(avatarColor(tokens, "B", 0.2)).toBe("#003300");
    expect(avatarColor(tokens, "A", 0.2)).toBe("#330000");
  });

  test("uses Omarchy colors for market and chart readings", () => {
    setOmarchyAvatarColors(["#111111", "#222222", "#333333"]);
    setOmarchyMarketColors({
      success: "#00aa00",
      danger: "#aa0000",
      warning: "#aaaa00",
      info: "#00aaaa",
    });
    const tokens = { primary: "#p", destructive: "#d", muted_foreground: "#m", ring: "#r" };
    expect(statusColors(tokens)).toEqual({
      up: "#00aa00",
      down: "#aa0000",
      warning: "#aaaa00",
      info: "#00aaaa",
    });
    expect(allocationColor(tokens, {}, 1)).toBe("#222222");
  });
});
