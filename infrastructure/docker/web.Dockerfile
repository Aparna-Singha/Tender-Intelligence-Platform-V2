FROM node:22.18.0-alpine AS build
WORKDIR /workspace
RUN corepack enable

COPY . .
ENV DATABASE_URL=postgresql://build:build@localhost:5432/build
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ARG NEXT_PUBLIC_STORAGE_ORIGIN=http://localhost:9000
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV NEXT_PUBLIC_STORAGE_ORIGIN=${NEXT_PUBLIC_STORAGE_ORIGIN}
RUN pnpm install --frozen-lockfile
RUN pnpm turbo run build --filter=@tender/web...

FROM node:22.18.0-alpine AS runtime
ENV NODE_ENV=production
ENV WEB_PORT=3000
WORKDIR /app
COPY --from=build /workspace/apps/web/.next/standalone ./
COPY --from=build /workspace/apps/web/.next/static ./apps/web/.next/static
EXPOSE 3000
USER node
CMD ["node", "apps/web/server.js"]
