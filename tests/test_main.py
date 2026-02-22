from foxmemory_store.main import app


def test_store_flow():
    c = app.test_client()
    assert c.get('/health').status_code == 200
    w = c.post('/memory.write', json={'text':'purple otter', 'tags':['test']})
    assert w.status_code == 200
    s = c.post('/memory.search', json={'query':'otter', 'limit':5})
    assert s.status_code == 200
    assert len(s.get_json()['hits']) >= 1
