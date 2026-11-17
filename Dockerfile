FROM node:22-alpine

ENV NODE_ENV=production

# pnpm is provided through corepack. It installs the exact version named in
# the "packageManager" field of package.json, so the version lives in one place.
RUN corepack enable

WORKDIR /usr/src/app
RUN chown node:node /usr/src/app
USER node

COPY --chown=node:node package.json pnpm-lock.yaml ./
RUN corepack install && pnpm install --frozen-lockfile --prod

COPY --chown=node:node . .

EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 5000) + '/readyz').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
