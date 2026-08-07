import { describe, it, expect } from "vitest";
import { targetSize, MAX_EDGE } from "../public/js/offline/imageResize.js";

describe("targetSize", () => {
  it("leaves an already-small image untouched", () => {
    expect(targetSize(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("scales a landscape image by its width", () => {
    expect(targetSize(4000, 3000)).toEqual({ width: 1600, height: 1200 });
  });

  it("scales a portrait image by its height", () => {
    expect(targetSize(3000, 4000)).toEqual({ width: 1200, height: 1600 });
  });

  it("returns whole pixels", () => {
    const { width, height } = targetSize(4032, 3024);
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
  });

  it("never returns a zero dimension for extreme aspect ratios", () => {
    const { width, height } = targetSize(10000, 3);
    expect(width).toBe(MAX_EDGE);
    expect(height).toBeGreaterThanOrEqual(1);
  });
});
