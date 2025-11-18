import { describe, it, expect } from "vitest";
import { coerceReadingTime, readingTimeProfiles } from "../src/readingTime";

describe("readingTime", () => {
  it("coerces unknown values to default", () => {
    expect(coerceReadingTime("unknown" as any)).toBe("default");
    expect(coerceReadingTime(null)).toBe("default");
  });

  it("keeps valid values", () => {
    expect(coerceReadingTime("quick")).toBe("quick");
    expect(coerceReadingTime("long")).toBe("long");
  });

  it("profiles are ordered by length", () => {
    expect(readingTimeProfiles.quick.maxTokens).toBeLessThan(readingTimeProfiles.long.maxTokens);
    expect(readingTimeProfiles.default.bulletCount).toBe(3);
  });
});
