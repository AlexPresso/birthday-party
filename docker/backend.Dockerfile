# Exact base versions keep rebuilds reproducible; update them deliberately.
# The Go version matches the toolchain used by CI (.github/workflows/tests.yml).
FROM golang:1.27.2-alpine3.24 AS build
WORKDIR /src
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /server ./cmd/server

FROM alpine:3.22.8
RUN apk add --no-cache ca-certificates ffmpeg \
    && addgroup -S -g 10001 app \
    && adduser -S -D -H -u 10001 -G app app \
    && mkdir /data \
    && chown app:app /data
COPY --from=build /server /usr/local/bin/birthday-server
USER app
ENV LISTEN_ADDR=0.0.0.0:8080 DATA_DIR=/data
EXPOSE 8080
ENTRYPOINT ["birthday-server"]
CMD ["serve"]
