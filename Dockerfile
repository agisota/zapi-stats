FROM oven/bun:1.3 AS build

WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

COPY . .
RUN bunx vite build

FROM oven/bun:1.3-slim

WORKDIR /app

COPY --from=build /app/package.json /app/bun.lock ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/server ./server
COPY --from=build /app/dist ./dist

ENV NODE_ENV=production
ENV PORT=20129
EXPOSE 20129

CMD ["bun", "server/index.ts"]
