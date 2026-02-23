# Architecture (foxmemory-store)

## Responsibility boundary
`foxmemory-store` is a Node.js + TypeScript REST API that wraps Mem0 OSS memory operations.

## Core components
- Express API server
- Mem0 OSS SDK (`mem0ai/oss`) runtime
- Optional external vector backend (Qdrant) via environment config
- Optional external LLM/embedder provider config via environment variables

## Why this shape
- keeps service language aligned with the broader Node/TS stack
- preserves self-hosting and provider flexibility
- exposes stable HTTP endpoints for agents/services

## Non-goals
- embedding inference service implementation (belongs in infer layer if separated)
- UI/dashboard concerns
