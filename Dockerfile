FROM alpine:3.20
RUN adduser -D app
USER app
WORKDIR /app
CMD ["sh", "-lc", "echo container scaffold ready; sleep infinity"]
