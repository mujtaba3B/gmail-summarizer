import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../src/summarizer", () => {
  return {
    buildSummarizer: () => ({
      summarizeArticle: vi.fn(async ({ url }) => ({
        url,
        headline: `Headline for ${url}`,
        bullets: ["Point A", "Point B"],
      })),
    }),
  };
});

import worker from "../src/worker";

describe("worker.fetch", () => {
  beforeEach(() => {
    // mock fetch for article retrieval
    (globalThis as any).fetch = vi.fn(async () => {
      return new Response(
        "<html><title>Example</title><body><h1>Example</h1><p>content</p></body></html>",
        { status: 200 }
      );
    }) as any;
  });

  it("rejects non-json POST", async () => {
    const request = new Request("http://local/summaries", { method: "POST" });
    const response = await worker.fetch(request, { OPENAI_API_KEY: "test" });
    expect(response.status).toBe(400);
  });

  it("summarizes links", async () => {
    const request = new Request("http://local/summaries", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        links: ["https://example.com/news/example-article-title-goes-here"],
        readingTime: "quick",
      }),
    });

    const response = await worker.fetch(request, { OPENAI_API_KEY: "test" });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as any;
    expect(payload.summaries[0].headline).toBe("Example");
  });
});
