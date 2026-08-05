ARG NODE_IMAGE=node:22-alpine@sha256:0340fa682d72068edf603c305bfbc10e23219fb0e40df58d9ea4d6f33a9798bf

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY index.html tsconfig.json vite.config.ts ./
COPY scripts ./scripts
COPY server ./server
COPY src ./src
RUN npm run build && npm prune --omit=dev

FROM ${NODE_IMAGE} AS runtime
LABEL org.opencontainers.image.title="LocalCast" \
	org.opencontainers.image.description="Trusted-LAN local-first audio briefing prototype"
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
RUN mkdir -p /var/lib/localcast/data /var/lib/localcast/media && chown -R node:node /var/lib/localcast
USER node
EXPOSE 8787
CMD ["node", "dist-server/index.js"]
