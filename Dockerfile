# syntax=docker/dockerfile:1.7
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev=false

FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json tsconfig.json ./
COPY src ./src
RUN npx tsc -p tsconfig.json

FROM node:22-bookworm-slim AS mcp
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY assets ./assets
EXPOSE 8070
CMD ["node", "dist/index.js"]
