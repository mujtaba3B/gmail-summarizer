import { buildSummarizer } from "./summarizer";
import { coerceReadingTime } from "./readingTime";
import { summarizeLinks } from "./articles";
import { SummaryRequestPayload } from "./types";

export interface Env {
  OPENAI_API_KEY?: string;
  SUMMARIZER?: string;
}

async function parseRequest(request: Request): Promise<SummaryRequestPayload> {
  if (request.method !== "POST") {
    throw badRequest("Only POST is supported");
  }

  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    throw badRequest("Expected application/json payload");
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    throw badRequest("Invalid JSON");
  }

  if (typeof body !== "object" || body === null) {
    throw badRequest("Invalid payload");
  }

  const links = Array.isArray((body as any).links)
    ? (body as any).links.filter((l: unknown) => typeof l === "string")
    : [];

  if (links.length === 0) {
    throw badRequest("No links provided");
  }

  const readingTime = coerceReadingTime((body as any).readingTime);
  const articleLimit = clampNumber((body as any).articleLimit, 0, 50);
  const maxArticles = clampNumber((body as any).maxArticles, 1, 50);

  return { links, readingTime, articleLimit, maxArticles };
}

function badRequest(message: string, init?: ResponseInit): Response {
  return new Response(JSON.stringify({ error: message }), {
    status: 400,
    headers: baseHeaders(),
    ...init,
  });
}

function baseHeaders(): HeadersInit {
  return {
    "content-type": "application/json",
    "content-encoding": "identity",
    "access-control-allow-origin": "*",
    "access-control-allow-headers": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
  };
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: baseHeaders() });
    }

    if (request.method === "GET") {
      return new Response(
        JSON.stringify({ status: "ok", service: "email-reader", version: "0.1.0" }),
        { headers: baseHeaders() }
      );
    }

    try {
      const payload = await parseRequest(request);
      const adapter = buildSummarizer(env);
      console.log("[worker] received request", {
        links: payload.links.length,
        readingTime: payload.readingTime,
        articleLimit: payload.articleLimit,
        maxArticles: payload.maxArticles,
      });
      const { summaries, skipped, meta } = await summarizeLinks({
        links: payload.links,
        readingTime: payload.readingTime,
        adapter,
        articleLimit: payload.articleLimit,
        maxArticles: payload.maxArticles,
      });
      console.log("[worker] completed summarization", {
        received: payload.links.length,
        deduped: meta.dedupedCount,
        openaiCalls: meta.adapterCalls,
        summaries: summaries.length,
        skipped: skipped.length,
        avgAdapterMs: meta.avgAdapterMs,
      });

      return new Response(JSON.stringify({ summaries, skipped, meta }), {
        headers: baseHeaders(),
      });
    } catch (error: any) {
      console.error("worker error:", error);
      if (error instanceof Response) return error;
      const status = error?.message?.toLowerCase().includes("missing openai") ? 500 : 500;
      return new Response(
        JSON.stringify({ error: error?.message ?? "Internal error" }),
        { status, headers: baseHeaders() }
      );
    }
  },
};

function clampNumber(value: any, min: number, max: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(num)) {
    return Math.min(max, Math.max(min, Math.floor(num)));
  }
  return min;
}
