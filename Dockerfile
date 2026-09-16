# AzeForge Web: one container, one Node service, one pinned browser.
#
# The image is offline at runtime: the pinned compiler release, the pinned
# chrome-headless-shell, and the woff2 fonts the compiler inlines are all baked
# here, so provisioning is verified once per image instead of at runtime on a
# foreign host. Egress is blocked at the container network, not by this file;
# the run command that does that, together with the rootfs/capability/resource
# hardening, is the documented one in README.md ("Deployment").

# Node 24 LTS, inside the compiler's `engines` range (>=22 <23 || >=24 <25),
# pinned by manifest-list digest so the base cannot move under a rebuild.
FROM node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553 AS dependencies

WORKDIR /app
COPY package.json package-lock.json ./

# `unzip` is what extracts the browser archive; it stays in this stage only.
RUN apt-get update \
 && apt-get install -y --no-install-recommends unzip \
 && rm -rf /var/lib/apt/lists/*

# Puppeteer's own install script is disabled: the browser is installed below by
# the compiler's own installer, at the version the compiler publishes, so the
# pin has exactly one source and the platform mapping is the one the compiler
# will itself use when it launches the browser.
RUN PUPPETEER_SKIP_DOWNLOAD=true npm ci --omit=dev --no-audit --no-fund
# Puppeteer keeps a partial archive after an interrupted download and will not
# replace it on a later install. Start this cache-owning stage clean so the
# browser copied into the runtime image is always extracted and executable.
RUN rm -rf /root/.cache/puppeteer \
 && npx --no-install puppeteer browsers install \
      "chrome-headless-shell@$(node --input-type=module -e 'const pin = await import("@aruzone/aze-forge/adapters"); process.stdout.write(pin.CHROME_HEADLESS_SHELL_VERSION)')"

FROM node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553

# The shared libraries the pinned chrome-headless-shell links against. No font
# packages: every font the Artifact may use is inlined from the compiler's own
# woff2 assets, and a system fallback is exactly what deterministic rendering
# must not be able to reach for.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 \
      libcairo2 libcups2 libdbus-1-3 libdrm2 libexpat1 libgbm1 \
      libglib2.0-0 libnspr4 libnss3 libpango-1.0-0 libudev1 libx11-6 \
      libxcb1 libxcomposite1 libxdamage1 libxext6 libxfixes3 libxkbcommon0 \
      libxrandr2 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
COPY --from=dependencies /app/node_modules ./node_modules
COPY src ./src
COPY scripts/image-manifest.mjs ./scripts/

# The pinned browser cache belongs to the non-root user that launches it, and
# is read-only at runtime: the compiler only ever resolves an executable path.
COPY --from=dependencies /root/.cache/puppeteer /home/node/.cache/puppeteer

# Image defaults. Every one of these is an `AZEWEB_*` deployment setting with a
# documented default in src/service/limits.mjs; the image picks the ones the
# container layout dictates. Port and heap are the only pins the entrypoint
# owns; configuration the service validates (token, limits, retention) is
# supplied by the deployment and rejected here if it is wrong.
ENV NODE_ENV=production \
    HOME=/home/node \
    AZEWEB_PORT=8080 \
    AZEWEB_SCRATCH_DIR=/scratch

COPY docker/entrypoint.sh /usr/local/bin/azeweb-entrypoint
RUN chmod 0755 /usr/local/bin/azeweb-entrypoint \
 && chown -R node:node /app /home/node/.cache

# Build-time provenance: exact pins for the compiler, the browser and every
# resolved dependency. Read by the deployment acceptance smoke suite.
ARG AZEWEB_BASE_IMAGE=node:24.21.0-bookworm-slim@sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553
RUN AZEWEB_BASE_IMAGE="$AZEWEB_BASE_IMAGE" node scripts/image-manifest.mjs > /app/image-manifest.json

USER node
EXPOSE 8080

# Liveness only, and detail-free: /readyz is the readiness verdict the service
# refuses work on, /healthz is "the process is listening".
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.AZEWEB_PORT || 8080) + '/healthz').then((response) => process.exit(response.ok ? 0 : 1), () => process.exit(1))"

ENTRYPOINT ["/usr/local/bin/azeweb-entrypoint"]
