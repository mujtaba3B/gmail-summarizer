import { OpenAISummarizer } from "./openai";
import { SummarizerAdapter } from "../types";

export function buildSummarizer(env: { OPENAI_API_KEY?: string; SUMMARIZER?: string }): SummarizerAdapter {
  const adapter = env.SUMMARIZER?.toLowerCase() ?? "openai";
  if (adapter !== "openai") {
    throw new Error(`Unsupported summarizer adapter: ${adapter}`);
  }

  if (!env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY");
  }

  return new OpenAISummarizer({ apiKey: env.OPENAI_API_KEY });
}
