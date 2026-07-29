FROM node:22.18.0-alpine AS build
WORKDIR /workspace
RUN corepack enable

COPY . .
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@tender/api...
RUN pnpm deploy --filter=@tender/api --prod /output

FROM node:22.18.0-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build --chown=node:node /output ./
EXPOSE 4000
USER node
CMD ["node", "dist/main.js"]
