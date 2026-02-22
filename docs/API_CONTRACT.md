# API Contract (scaffold)

## POST /memory.write
Request:
```json
{ "text": "Remember this", "tags": ["note"] }
```

## POST /memory.search
Request:
```json
{ "query": "remember", "limit": 5 }
```
