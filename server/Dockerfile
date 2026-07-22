FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./

RUN npm ci --omit=dev \
  && npm cache clean --force

COPY --chown=node:node . .

RUN mkdir -p /app/var \
  && chown -R node:node /app/var

ENV NODE_ENV=production \
  HOST=0.0.0.0 \
  PORT=3000

EXPOSE 3000

USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "scripts/health-check.js"]

CMD ["node", "bot.js"]
