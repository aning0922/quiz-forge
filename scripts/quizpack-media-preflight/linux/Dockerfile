FROM docker.io/library/node@sha256:450617c43da25e890a85e935526b3f6a8cfc5377155404a0074cb3116f48f06c
WORKDIR /worker
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund && node -e "if(require('sharp').versions.sharp!=='0.35.5') process.exit(1)"
COPY media-worker.mjs fault-worker.mjs identity.mjs native-probe ./
RUN chmod 0555 /worker/native-probe && chmod -R a+rX /worker && chmod -R a-w /worker
USER 10001:10001
ENV NODE_ENV=production UV_THREADPOOL_SIZE=4 MALLOC_ARENA_MAX=2
HEALTHCHECK NONE
ENTRYPOINT ["/usr/local/bin/node", "/worker/media-worker.mjs"]
CMD ["8388608", "8192", "16000000"]
