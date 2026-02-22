# Architecture (foxmemory-store)

## Responsibility boundary
This service owns memory persistence and retrieval APIs.

## Components (target)
- API layer
- metadata storage adapter
- vector retrieval adapter
- consolidation/maintenance workers

## Non-goals
- embedding model inference (lives in foxmemory-infer)
