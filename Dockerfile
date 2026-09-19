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

# The Docker CLI, and only the CLI: a TeX-enabled worker launches the trusted
# renderer as a short-lived sibling container through the host's Docker socket,
# which the TeX-enabled run command mounts. The daemon stays outside this image
# and nothing here runs one. The static release is pinned by version and
# checksum so the binary cannot move under a rebuild; the build stage keeps the
# 85 MiB tarball and the runtime image only gains the one executable.
ARG DOCKER_CLI_VERSION=29.7.2
ARG DOCKER_CLI_SHA256=803d433f226db4776e1768fd319fc6c6e4935a456acf84fcc0080818b854bc8f
ADD --checksum=sha256:${DOCKER_CLI_SHA256} \
    https://download.docker.com/linux/static/stable/x86_64/docker-${DOCKER_CLI_VERSION}.tgz /tmp/docker-cli.tgz
# `--strip-components=1` is load-bearing: the tarball's member is `docker/docker`
# (directory then file), and extracting it verbatim would leave a *directory*
# named `docker` for the COPY below to copy into place.
RUN mkdir -p /docker-cli \
 && tar -xzf /tmp/docker-cli.tgz -C /docker-cli --strip-components=1 docker/docker \
 && rm -f /tmp/docker-cli.tgz \
 && test -f /docker-cli/docker \
 && test -x /docker-cli/docker

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

# The CLI a TeX-enabled deployment's workers launch the renderer with. It is
# inert until the deployment supplies the renderer configuration and mounts the
# Docker socket; a deployment that does not enable TeX never runs it.
COPY --from=dependencies /docker-cli/docker /usr/local/bin/docker

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
# The Docker CLI pin is declared in the dependencies stage, so the manifest
# records the same version and checksum the ADD above verified rather than a
# second copy that could drift.
ARG DOCKER_CLI_VERSION=29.7.2
ARG DOCKER_CLI_SHA256=803d433f226db4776e1768fd319fc6c6e4935a456acf84fcc0080818b854bc8f
RUN AZEWEB_BASE_IMAGE="$AZEWEB_BASE_IMAGE" \
    DOCKER_CLI_VERSION="$DOCKER_CLI_VERSION" \
    DOCKER_CLI_SHA256="$DOCKER_CLI_SHA256" \
    node scripts/image-manifest.mjs > /app/image-manifest.json

USER node
EXPOSE 8080

# Liveness only, and detail-free: /readyz is the readiness verdict the service
# refuses work on, /healthz is "the process is listening".
HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.AZEWEB_PORT || 8080) + '/healthz').then((response) => process.exit(response.ok ? 0 : 1), () => process.exit(1))"

ENTRYPOINT ["/usr/local/bin/azeweb-entrypoint"]
