import { describe, it, expect } from "vitest";
import { buildSummarizer } from "../src/summarizer";

describe("summarizer factory", () => {
  it("throws when key missing", () => {
    expect(() => buildSummarizer({})).toThrow("Missing OPENAI_API_KEY");
  });

  it("rejects unsupported adapters", () => {
    expect(() => buildSummarizer({ OPENAI_API_KEY: "k", SUMMARIZER: "other" })).toThrow(
      "Unsupported summarizer adapter: other"
    );
  });

  it("builds openai by default", () => {
    const adapter = buildSummarizer({ OPENAI_API_KEY: "test" });
    expect(adapter).toBeDefined();
  });
});
