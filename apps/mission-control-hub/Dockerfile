FROM oven/bun:1
WORKDIR /app
COPY package.json .
RUN bun install --frozen-lockfile 2>/dev/null || bun install
COPY src/ ./src/
EXPOSE 4001
CMD ["bun", "src/server.ts"]
