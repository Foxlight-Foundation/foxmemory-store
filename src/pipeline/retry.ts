import { ADD_RETRIES, ADD_RETRY_DELAY_MS } from "../config/env.js";
import { getMemory } from "../memory/factory.js";

export const addWithRetries = async (
  messages: Array<{ role: string; content: string }>,
  opts: { userId?: string; runId?: string; metadata?: Record<string, unknown> }
) => {
  const memory = getMemory();
  let last: any = { results: [] };
  for (let attempt = 1; attempt <= Math.max(1, ADD_RETRIES); attempt++) {
    try {
      last = await memory.add(messages, { ...opts, output_format: "v1.1" } as any);
      return last;
    } catch (err: any) {
      if (attempt >= ADD_RETRIES) throw err;
      console.warn(`[addWithRetries] attempt ${attempt} threw, retrying in ${ADD_RETRY_DELAY_MS}ms:`, err?.message || err);
      await new Promise((r) => setTimeout(r, ADD_RETRY_DELAY_MS));
    }
  }
  return last;
};
