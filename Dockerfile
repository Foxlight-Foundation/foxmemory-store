FROM python:3.12-slim

RUN groupadd -r app && useradd -r -g app app
WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY src ./src
RUN chown -R app:app /app

USER app
ENV PYTHONPATH=/app/src
EXPOSE 8082
CMD ["gunicorn", "--bind", "0.0.0.0:8082", "foxmemory_store.main:app"]
