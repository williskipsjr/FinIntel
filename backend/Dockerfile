# Stage 1: Dependency caching and compilation
FROM rust:1-bookworm AS builder

WORKDIR /app/backend

# Pre-cache dependencies
COPY Cargo.toml Cargo.lock ./
RUN mkdir src \
    && echo "fn main() {}" > src/main.rs \
    && cargo build --release \
    && rm -rf src

# Copy source code and build final binary
COPY src ./src
RUN touch src/main.rs && cargo build --release

# Stage 2: Clean minimal runtime
FROM debian:bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app/backend
COPY --from=builder /app/backend/target/release/finintel-backend /usr/local/bin/finintel-backend
RUN mkdir -p storage/statements

EXPOSE 8080
CMD ["finintel-backend"]
