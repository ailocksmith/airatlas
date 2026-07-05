FROM node:22-alpine

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV PNPM_HOME=/pnpm
ENV PATH="$PNPM_HOME:$PATH"

COPY package.json pnpm-lock.yaml ./
RUN corepack enable \
  && corepack prepare pnpm@10.15.1 --activate \
  && pnpm install --prod --frozen-lockfile

COPY src ./src
COPY public ./public

EXPOSE 3000

RUN mkdir -p /app/data && chown -R node:node /app
USER node

CMD ["node", "src/server.js"]
