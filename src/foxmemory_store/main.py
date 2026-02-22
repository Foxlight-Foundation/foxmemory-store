from flask import Flask, request, jsonify

app = Flask(__name__)
_DB: list[dict] = []

@app.get('/health')
def health():
    return jsonify({'ok': True, 'service': 'foxmemory-store'})

@app.post('/memory.write')
def memory_write():
    body = request.get_json(force=True, silent=True) or {}
    item = {'id': len(_DB)+1, 'text': body.get('text', ''), 'tags': body.get('tags', [])}
    _DB.append(item)
    return jsonify({'ok': True, 'item': item})

@app.post('/memory.search')
def memory_search():
    body = request.get_json(force=True, silent=True) or {}
    q = str(body.get('query', '')).lower()
    limit = int(body.get('limit', 5))
    hits = [m for m in _DB if q in m['text'].lower()][:limit]
    return jsonify({'ok': True, 'hits': hits})
