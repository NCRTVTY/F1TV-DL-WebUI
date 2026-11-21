FROM node:22-bookworm-slim AS build

WORKDIR /app
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY package.json package-lock.json ./
COPY scripts ./scripts
RUN npm ci --no-audit --no-fund

COPY LICENSE THIRD_PARTY_NOTICES.md ./
COPY LICENSES ./LICENSES
COPY index.html vite.config.ts vitest.config.ts tsconfig.client.json tsconfig.server.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=43729 \
    DATA_DIR=/app/data \
    DOWNLOAD_DIR=/app/downloads \
    HOME=/app/data/f1tv-home \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    PUPPETEER_SKIP_DOWNLOAD=true

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates chromium ffmpeg tini \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/LICENSE /app/THIRD_PARTY_NOTICES.md ./
COPY --from=build /app/LICENSES ./LICENSES
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY scripts/reset-library.cjs ./scripts/reset-library.cjs

RUN mkdir -p /app/data/f1tv-home /app/downloads \
    && chown -R node:node /app/data /app/downloads

ARG DRONE_COMMIT=development
ENV DRONE_COMMIT=${DRONE_COMMIT}

USER node
EXPOSE 43729

HEALTHCHECK --interval=15s --timeout=8s --start-period=20s --retries=4 \
  CMD node -e "fetch('http://127.0.0.1:43729/api/health').then(async response=>{const body=await response.json();if(!response.ok||!body.ok||body.commit!==process.env.DRONE_COMMIT||!body.storage.writable)process.exit(1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/server/index.js"]
