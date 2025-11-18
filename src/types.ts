export type ReadingTime = "quick" | "default" | "long";

export interface SummaryRequestPayload {
  links: string[];
  readingTime: ReadingTime;
  articleLimit?: number;
  maxArticles?: number;
}

export interface SummaryResult {
  url: string;
  headline: string;
  bullets: string[];
}

export interface SummarizerAdapter {
  summarizeArticle(input: {
    url: string;
    title?: string;
    content: string;
    readingTime: ReadingTime;
  }): Promise<SummaryResult>;
}
