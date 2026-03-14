import { MIN_INPUT_CHARS, SKIP_PATTERNS } from "../config/env.js";

export const shouldSkipWrite = (messages: Array<{ role: string; content: string }>): string | null => {
  const combined = messages.map(m => m.content).join(" ");
  if (combined.length < MIN_INPUT_CHARS) return `content_too_short (${combined.length} < ${MIN_INPUT_CHARS} chars)`;
  for (const pat of SKIP_PATTERNS) {
    if (pat.test(combined)) return `matched_skip_pattern (${pat.source})`;
  }
  return null;
};
