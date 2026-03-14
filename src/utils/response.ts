export const v2Ok = (res: any, data: any, meta?: Record<string, unknown>) => {
  return res.json({ ok: true, data, ...(meta ? { meta } : {}) });
};

export const v2Err = (res: any, status: number, code: string, message: string, details?: unknown) => {
  const problemType = `https://docs.openclaw.ai/problems/${String(code || "INTERNAL_ERROR").toLowerCase()}`;
  return res.status(status).json({
    type: problemType,
    title: code,
    status,
    detail: message,
    ...(details ? { errors: details } : {}),
    ok: false
  });
};

export const extractIdsFromFilters = (filters: Record<string, unknown> | undefined): { user_id?: string; run_id?: string; orPairs?: Array<{user_id?: string; run_id?: string}> } => {
  if (!filters || typeof filters !== 'object') return {};
  const out: any = {};
  const f: any = filters;
  if (typeof f.user_id === 'string' && f.user_id.trim()) out.user_id = f.user_id.trim();
  if (typeof f.run_id === 'string' && f.run_id.trim()) out.run_id = f.run_id.trim();
  if (Array.isArray(f.OR)) {
    const pairs = f.OR
      .map((x: any) => ({
        user_id: typeof x?.user_id === 'string' ? x.user_id : undefined,
        run_id: typeof x?.run_id === 'string' ? x.run_id : undefined
      }))
      .filter((x: any) => x.user_id || x.run_id);
    if (pairs.length) out.orPairs = pairs;
  }
  if (Array.isArray(f.AND)) {
    for (const x of f.AND) {
      if (!out.user_id && typeof x?.user_id === 'string') out.user_id = x.user_id;
      if (!out.run_id && typeof x?.run_id === 'string') out.run_id = x.run_id;
    }
  }
  return out;
};
