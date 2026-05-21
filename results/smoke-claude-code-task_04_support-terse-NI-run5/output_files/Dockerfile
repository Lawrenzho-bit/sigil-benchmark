# --- build stage ---
FROM node:20-slim AS build
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
COPY db ./db
RUN npm run build

# --- runtime stage ---
FROM node:20-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY db ./db
COPY public ./public
# ts-node is needed for the migration runner and workers in this image.
RUN npm install ts-node typescript @types/node
USER node
EXPOSE 3000
# Default entrypoint runs the API; workers override the command (see docker-compose.yml).
CMD ["node", "dist/src/server.js"]
