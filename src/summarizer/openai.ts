import { readingTimeProfiles } from "../readingTime";
import { ReadingTime, SummarizerAdapter, SummaryResult } from "../types";

export interface OpenAISummarizerConfig {
  apiKey: string;
  model?: string;
  endpoint?: string;
}

export class OpenAISummarizer implements SummarizerAdapter {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly endpoint: string;

  constructor(config: OpenAISummarizerConfig) {
    this.apiKey = config.apiKey;
    this.model = config.model ?? "gpt-4o-mini";
    this.endpoint = config.endpoint ?? "https://api.openai.com/v1/chat/completions";
  }

  async summarizeArticle(input: {
    url: string;
    title?: string;
    content: string;
    readingTime: ReadingTime;
  }): Promise<SummaryResult> {
    const profile = readingTimeProfiles[input.readingTime];
    const system = [
      "You are a concise news summarizer.",
      `Write ${profile.bulletCount} bullet points for a busy reader.`,
      "Preserve factual accuracy; avoid speculation.",
    ].join(" ");

    const user = [
      `URL: ${input.url}`,
      input.title ? `Title: ${input.title}` : "",
      "Content:",
      input.content.slice(0, 8000),
      "Return JSON with shape {headline, bullets[]} where headline is <= headlineMaxLength characters.",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: this.model,
        temperature: 0.4,
        max_tokens: profile.maxTokens,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI API error: ${response.status} ${response.statusText}`);
    }

    const data: any = await response.json();
    const raw = typeof data?.choices?.[0]?.message?.content === "string"
      ? data.choices[0].message.content
      : "{}";

    let parsed: { headline?: string; bullets?: string[] } = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = {};
    }

    const headline = (parsed.headline ?? input.title ?? input.url).slice(
      0,
      profile.headlineMaxLength
    );
    const bullets = Array.isArray(parsed.bullets) ? parsed.bullets.slice(0, profile.bulletCount) : [];

    return {
      url: input.url,
      headline,
      bullets,
    };
  }
}
