# foxmemory-store

Memory storage API scaffold.

## API
- `GET /health`
- `POST /memory.write`
- `POST /memory.search`

## Run locally
```bash
pip install -r requirements.txt
PYTHONPATH=src uvicorn foxmemory_store.main:app --reload --port 8082
```
