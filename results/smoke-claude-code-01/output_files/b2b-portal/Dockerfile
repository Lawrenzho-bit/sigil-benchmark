# Multi-stage build producing a minimal standalone Next.js server.
FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate && npm run build

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
# Run as non-root.
RUN useradd --system --uid 1001 appuser
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
USER appuser
EXPOSE 3000
ENV PORT=3000
# Apply migrations then boot. Fails the container if migrations fail —
# we do not want to serve against an unmigrated schema.
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
