import type { Request, Response, NextFunction } from "express";
import { registry } from "../registry/db.js";
import { REQUIRE_API_KEY_AUTH } from "../config/env.js";

declare global {
  namespace Express {
    interface Request {
      tenantId?: string;
    }
  }
}

const SKIP_PATHS = ["/health", "/v2/health"];

export const apiKeyAuth = (req: Request, res: Response, next: NextFunction): void => {
  if (!REQUIRE_API_KEY_AUTH) {
    next();
    return;
  }

  if (SKIP_PATHS.includes(req.path)) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer fmk_")) {
    res.status(401).json({ ok: false, error: "Missing or invalid API key" });
    return;
  }

  const key = authHeader.slice("Bearer ".length);

  if (!registry?.ready) {
    res.status(503).json({ ok: false, error: "Registry not available" });
    return;
  }

  const result = registry.validateApiKey(key);
  if (!result) {
    res.status(401).json({ ok: false, error: "Invalid or revoked API key" });
    return;
  }

  req.tenantId = result.tenantId;
  next();
};
