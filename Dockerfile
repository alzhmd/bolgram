# Bolgram server (API + merchant panel + owner panel + checkout)
FROM node:22-bookworm-slim AS build
WORKDIR /srv
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
ENV NODE_ENV=production PORT=4000 DB_PATH=/data/bolgram.db UPLOAD_DIR=/data/uploads
WORKDIR /srv
COPY --from=build /srv/node_modules ./node_modules
COPY --from=build /srv/dist ./dist
COPY package.json ./
COPY public ./public
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:4000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "dist/index.js"]
