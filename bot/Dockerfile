# Sud tizimi bot: build context is the bot/ folder (Render: Dockerfile path ./bot/Dockerfile, context ./bot)
FROM rust:1-slim-bookworm AS build
WORKDIR /src
COPY Cargo.toml Cargo.lock ./
COPY src ./src
COPY static ./static
COPY tests ./tests
RUN cargo build --release --locked

FROM debian:bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/target/release/sud-bot /usr/local/bin/sud-bot
ENV PORT=10000
EXPOSE 10000
CMD ["sud-bot"]
