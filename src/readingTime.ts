import { ReadingTime } from "./types";

export interface ReadingTimeProfile {
  bulletCount: number;
  maxTokens: number;
  headlineMaxLength: number;
}

export const readingTimeProfiles: Record<ReadingTime, ReadingTimeProfile> = {
  quick: { bulletCount: 2, maxTokens: 120, headlineMaxLength: 90 },
  default: { bulletCount: 3, maxTokens: 220, headlineMaxLength: 120 },
  long: { bulletCount: 5, maxTokens: 360, headlineMaxLength: 160 },
};

export function coerceReadingTime(value: string | null | undefined): ReadingTime {
  if (value === "quick" || value === "long") return value;
  return "default";
}
