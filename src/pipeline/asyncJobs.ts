import { ASYNC_JOB_TTL_MS } from "../config/env.js";

export type AsyncJobStatus = "pending" | "running" | "completed" | "failed";

export interface AsyncJob {
  id: string;
  status: AsyncJobStatus;
  created_at: string;
  completed_at: string | null;
  result: any | null;
  error: string | null;
}

export const asyncJobs = new Map<string, AsyncJob>();

setInterval(() => {
  const cutoff = Date.now() - ASYNC_JOB_TTL_MS;
  for (const [id, job] of asyncJobs) {
    if (job.completed_at && new Date(job.completed_at).getTime() < cutoff) {
      asyncJobs.delete(id);
    }
  }
}, 300_000).unref();
