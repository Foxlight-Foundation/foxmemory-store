import { z } from "zod";
import { MODEL_ROLES } from "../config/env.js";

export const requireScopeSchema = z
  .object({
    user_id: z.string().trim().min(1).optional(),
    run_id: z.string().trim().min(1).optional()
  })
  .refine((v) => Boolean(v.user_id || v.run_id), {
    message: "One of user_id or run_id is required"
  });

export const writeAliasSchema = z
  .object({
    text: z.string().trim().min(1),
    user_id: z.string().trim().min(1).optional(),
    run_id: z.string().trim().min(1).optional()
  })
  .refine((v) => Boolean(v.user_id || v.run_id), {
    message: "One of user_id or run_id is required"
  });

export const rawWriteSchema = z
  .object({
    text: z.string().trim().min(1),
    user_id: z.string().trim().min(1).optional(),
    run_id: z.string().trim().min(1).optional(),
    metadata: z.record(z.unknown()).optional()
  })
  .refine((v) => Boolean(v.user_id || v.run_id), {
    message: "One of user_id or run_id is required"
  });

export const v2WriteSchema = z
  .object({
    text: z.string().trim().min(1).optional(),
    messages: z.array(z.object({ role: z.string(), content: z.string() })).min(1).optional(),
    user_id: z.string().trim().min(1).optional(),
    run_id: z.string().trim().min(1).optional(),
    metadata: z.record(z.unknown()).optional(),
    infer_preferred: z.boolean().optional(),
    fallback_raw: z.boolean().optional(),
    async: z.boolean().optional(),
    idempotency_key: z.string().trim().min(1).max(255).optional()
  })
  .refine((v) => Boolean(v.user_id || v.run_id), {
    message: "One of user_id or run_id is required"
  })
  .refine((v) => Boolean(v.text || (v.messages && v.messages.length)), {
    message: "Either text or messages is required"
  });

export const addSchema = z
  .object({
    messages: z.array(z.object({ role: z.string(), content: z.string() })).min(1),
    user_id: z.string().trim().min(1).optional(),
    run_id: z.string().trim().min(1).optional(),
    metadata: z.record(z.unknown()).optional()
  })
  .refine((v) => Boolean(v.user_id || v.run_id), {
    message: "One of user_id or run_id is required"
  });

export const searchSchema = z
  .object({
    query: z.string().trim().min(1),
    user_id: z.string().trim().min(1).optional(),
    run_id: z.string().trim().min(1).optional(),
    top_k: z.number().int().positive().max(100).optional()
  })
  .refine((v) => Boolean(v.user_id || v.run_id), {
    message: "One of user_id or run_id is required"
  });

export const searchAliasSchema = z
  .object({
    query: z.string().trim().min(1),
    user_id: z.string().trim().min(1).optional(),
    run_id: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().positive().max(100).optional()
  })
  .refine((v) => Boolean(v.user_id || v.run_id), {
    message: "One of user_id or run_id is required"
  });

export const v2FilterSchema = z.record(z.unknown()).optional();

export const v2UpdateSchema = z.object({
  text: z.string().trim().min(1),
  metadata: z.record(z.unknown()).optional(),
  idempotency_key: z.string().trim().min(1).max(255).optional()
});

export const v2SearchSchema = z
  .object({
    query: z.string().trim().min(1),
    scope: z.enum(["session", "long-term", "all"]).optional(),
    user_id: z.string().trim().min(1).optional(),
    run_id: z.string().trim().min(1).optional(),
    filters: v2FilterSchema,
    top_k: z.coerce.number().int().positive().max(100).optional(),
    threshold: z.coerce.number().min(0).max(1).optional(),
    keyword_search: z.boolean().optional(),
    reranking: z.boolean().optional(),
    rerank: z.boolean().optional(),
    fields: z.array(z.string()).optional(),
    source: z.string().trim().min(1).optional()
  })
  .refine((v) => Boolean(v.user_id || v.run_id || v.scope === "all" || v.filters), {
    message: "One of user_id/run_id/filters is required unless scope=all"
  });

export const v2ListSchema = z
  .object({
    scope: z.enum(["session", "long-term", "all"]).optional(),
    user_id: z.string().trim().min(1).optional(),
    run_id: z.string().trim().min(1).optional(),
    filters: v2FilterSchema,
    page: z.coerce.number().int().positive().optional(),
    page_size: z.coerce.number().int().positive().max(500).optional(),
    fields: z.array(z.string()).optional()
  })
  .refine((v) => Boolean(v.user_id || v.run_id || v.scope === "all" || v.filters), {
    message: "One of user_id/run_id/filters is required unless scope=all"
  });

export const v2StatsMemoriesQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().default(30),
});

export const v2WriteEventsQuerySchema = z.object({
  user_id:    z.string().trim().min(1).optional(),
  run_id:     z.string().trim().min(1).optional(),
  memory_id:  z.string().uuid().optional(),
  event_type: z.enum(["ADD", "UPDATE", "DELETE", "NONE"]).optional(),
  limit:      z.coerce.number().int().positive().max(500).default(50),
  before:     z.string().optional(),
});

export const v2GraphRelationsSchema = z
  .object({
    user_id: z.string().trim().min(1).optional(),
    run_id: z.string().trim().min(1).optional(),
    limit: z.coerce.number().int().positive().max(1000).optional(),
  })
  .refine((v) => Boolean(v.user_id || v.run_id), {
    message: "One of user_id or run_id is required",
  });

export const v2GraphQuerySchema = z.object({
  user_id: z.string().trim().min(1).optional(),
  run_id: z.string().trim().min(1).optional(),
  limit: z.coerce.number().int().positive().max(1000).default(500),
});

export const v2GraphNodesListSchema = z.object({
  user_id: z.string().trim().min(1).optional(),
  run_id: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().nonnegative().default(0),
  page_size: z.coerce.number().int().positive().max(200).default(100),
});

export const v2GraphSearchBodySchema = z.object({
  query: z.string().trim().min(1),
  user_id: z.string().trim().min(1).optional(),
  run_id: z.string().trim().min(1).optional(),
});

export const v2GraphStatsQuerySchema = z.object({
  user_id: z.string().trim().min(1).optional(),
  run_id: z.string().trim().min(1).optional(),
});

export const v2PromptSchema = z.object({
  prompt: z.string().min(1).nullable(),
});

export const v2CaptureConfigSchema = z.object({
  capture_message_limit: z.number().int().min(1).max(50),
});

export const v2RolesConfigSchema = z.object({
  user: z.string().trim().min(1).max(100).optional(),
  assistant: z.string().trim().min(1).max(100).optional(),
});

export const v2SetModelSchema = z.object({
  key:   z.enum(["llm_model", "graph_llm_model"]),
  value: z.string().min(1),
});

export const v2CatalogUpsertSchema = z.object({
  id:          z.string().min(1),
  name:        z.string().min(1),
  description: z.string().nullable().optional(),
  roles:       z.array(z.enum(MODEL_ROLES)).min(1),
  input_mtok:  z.number().nonnegative().nullable().optional(),
  cached_mtok: z.number().nonnegative().nullable().optional(),
  output_mtok: z.number().nonnegative().nullable().optional(),
});

export const v2ForgetSchema = z.object({
  memory_ids: z.array(z.string().uuid()).min(1).max(1000),
  cascade_graph: z.boolean().optional().default(false),
  idempotency_key: z.string().trim().min(1).max(255).optional(),
});
