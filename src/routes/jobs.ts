import { Router } from "express";
import { v2Err } from "../utils/response.js";
import { asyncJobs } from "../pipeline/asyncJobs.js";

export const createJobsRouter = () => {
  const router = Router();

  router.get("/v2/jobs/:id", (req, res) => {
    const job = asyncJobs.get(req.params.id);
    if (!job) return v2Err(res, 404, "NOT_FOUND", `Job ${req.params.id} not found or expired`);

    const data: Record<string, unknown> = {
      job_id: job.id,
      status: job.status,
      created_at: job.created_at,
      completed_at: job.completed_at,
    };
    if (job.status === "completed") data.result = job.result;
    if (job.status === "failed") data.error = job.error;

    const httpStatus = job.status === "completed" || job.status === "failed" ? 200 : 202;
    return res.status(httpStatus).json({ ok: true, data, meta: { version: "v2" } });
  });

  return router;
};
