import { SummaryResult, ReadingTime, SummarizerAdapter } from "./types";

export interface ArticleIngestionResult {
  url: string;
  title?: string;
  content: string;
}

export async function fetchArticle(url: string): Promise<ArticleIngestionResult> {
  const unwrapped = unwrapTracking(url);
  const resolved = await resolveRedirect(unwrapped);
  const response = await fetch(resolved, {
    redirect: "follow",
    headers: {
      // Some sites block generic Workers UA; mimic a browser.
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    },
  });
  if (!response.ok) {
    throw new Error(`Failed to fetch article: ${resolved} (${response.status})`);
  }

  const html = await response.text();
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const rawTitle = titleMatch?.[1]?.trim();
  const bodyText = stripHtml(html);

  return {
    url: resolved,
    title: rawTitle ? cleanTitle(rawTitle) : undefined,
    content: bodyText,
  };
}

export async function summarizeLinks(input: {
  links: string[];
  readingTime: ReadingTime;
  adapter: SummarizerAdapter;
  articleLimit?: number;
  maxArticles?: number;
}): Promise<{
  summaries: SummaryResult[];
  skipped: Array<{ url: string; reason: string }>;
  meta: { dedupedCount: number; adapterCalls: number; avgAdapterMs: number };
}> {
  const seen = new Set<string>();
  const deduped = input.links
    .map((link) => unwrapTracking(link))
    .filter((link) => {
      const normalized = normalizeUrl(link);
      if (seen.has(normalized)) return false;
      seen.add(normalized);
      return true;
    });
  console.log("[worker] deduped links", deduped.length);

  const limit = clampNumber(input.articleLimit ?? 0, 0, 50);
  const maxArticles = clampNumber(input.maxArticles ?? 10, 1, 50);
  const allowedCount = limit > 0 ? Math.min(limit, maxArticles) : maxArticles;
  const limited = deduped.slice(0, allowedCount);

  const results: SummaryResult[] = new Array(limited.length);
  const skipped: Array<{ url: string; reason: string }> = [];
  let adapterCalls = 0;
  const adapterDurations: number[] = [];

  await Promise.all(
    limited.map(async (url, idx) => {
      if (!isLikelyArticleUrl(url)) {
        skipped.push({ url, reason: "Not a likely article URL" });
        console.warn("[worker] skip non-article url", url);
        return;
      }
      try {
        const article = await fetchArticle(url);
        const started = Date.now();
        const summary = await input.adapter.summarizeArticle({
          url: article.url,
          title: article.title,
          content: article.content,
          readingTime: input.readingTime,
        });
        adapterCalls += 1;
        adapterDurations.push(Date.now() - started);
        const headline = cleanTitle(article.title ?? summary.headline ?? article.url);
        results[idx] = {
          ...summary,
          headline,
        };
        console.log("[worker] summarized", url);
      } catch (error: any) {
        skipped.push({ url, reason: error?.message ?? "Failed to summarize" });
        console.warn("[worker] skip link", url, error);
      }
    })
  );

  const avgAdapterMs =
    adapterDurations.length === 0
      ? 0
      : adapterDurations.reduce((acc, cur) => acc + cur, 0) / adapterDurations.length;

  return {
    summaries: results.filter(Boolean),
    skipped,
    meta: {
      dedupedCount: deduped.length,
      adapterCalls,
      avgAdapterMs,
    },
  };
}

function stripHtml(html: string): string {
  return html.replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<\/?[^>]+(>|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 12000);
}

function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return url;
  }
}

function clampNumber(value: any, min: number, max: number): number {
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isFinite(num)) {
    return Math.min(max, Math.max(min, Math.floor(num)));
  }
  return min;
}

async function resolveRedirect(url: string): Promise<string> {
  try {
    const response = await fetch(url, { method: "GET", redirect: "manual" });
    const location = response.headers.get("location");
    if (location && response.status >= 300 && response.status < 400) {
      return new URL(location, url).toString();
    }
  } catch {
    // fall back to original url
  }
  return url;
}

function isLikelyArticleUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname || "";
    if (!path || path === "/" || path.length < 10) return false;
    const segments = path.split("/").filter(Boolean);
    const slug = segments.find((seg) => {
      const hyphenWords = seg.split("-").filter((p) => p.length >= 3 && /[a-zA-Z]/.test(p));
      return hyphenWords.length >= 3;
    });
    return Boolean(slug);
  } catch {
    return false;
  }
}

function unwrapTracking(url: string): string {
  try {
    const parsed = new URL(url);

    // check common query params like url/target/u
    const qpTargets = ["url", "u", "target", "redirect"];
    for (const key of qpTargets) {
      const val = parsed.searchParams.get(key);
      if (val) {
        try {
          const decoded = decodeURIComponent(val);
          if (decoded.startsWith("http")) return decoded;
        } catch {
          // ignore
        }
        if (val.startsWith("http")) return val;
      }
    }

    // check path segments for base64 encoded target
    for (const segment of parsed.pathname.split("/")) {
      if (!segment || segment.length < 16) continue;
      try {
        const decoded = atob(segment.replace(/-/g, "+").replace(/_/g, "/"));
        if (decoded.startsWith("http")) return decoded;
      } catch {
        // ignore
      }
    }
  } catch {
    // fall through
  }
  return url;
}

function cleanTitle(title: string): string {
  const parts = title.split("|");
  if (parts.length > 1) {
    return parts[0].trim();
  }
  const dashParts = title.split(" - ");
  if (dashParts.length > 1) {
    return dashParts[0].trim();
  }
  return title.trim();
}
