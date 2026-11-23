# Portable single-instance ARS hosted application image.
# Deliberately no database service: use a separate, backed-up PostgreSQL host.
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production
ENV PORT=3000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/scripts/hosted-preflight.mjs ./scripts/hosted-preflight.mjs
COPY --from=build /app/scripts/provision-first-admin.mjs ./scripts/provision-first-admin.mjs
RUN mkdir -p /app/uploads && chown -R node:node /app
USER node
EXPOSE 3000
# Host MUST mount persistent external storage at /app/uploads; NEVER rely on the
# writable container layer for shop logos or product images. See hosted runbook.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:'+process.env.PORT+'/api/ready', r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"
CMD ["sh", "-c", "node scripts/hosted-preflight.mjs && exec node dist/server.cjs"]
