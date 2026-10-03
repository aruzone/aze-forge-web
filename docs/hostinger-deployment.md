# Hostinger release runbook

The `azeweb` container is owned by `aze-forge-web.service`. Do not run `docker stop`, `docker start`, or `docker rm` for this container. The service has `Restart=always`, so systemd recreates it with the image tag in `/etc/systemd/system/aze-forge-web.service`.

## TLS compatibility

`/etc/caddy/Caddyfile` sets `key_type rsa2048` for `azeforge.com` and `www.azeforge.com`. Keep it unless the affected corporate TLS-inspection network confirms it accepts the default ECDSA certificate chain.

## Deploy

```bash
ssh root@187.126.117.183
cd /opt/aze-forge-web
git pull --ff-only origin main
IMAGE="aze-forge-web:$(git rev-parse --short HEAD)"
docker build --platform linux/amd64 -t "$IMAGE" .
```

Run the smoke suite before the restart. The VM has Docker but no host Node/npm, so use the new image as the temporary test runner.

```bash
docker volume create azeweb-smoke-node-modules >/dev/null
docker run --rm --network host --user root --entrypoint /bin/sh \
  -v "$PWD:/work" \
  -v azeweb-smoke-node-modules:/work/node_modules \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -w /work "$IMAGE" \
  -lc "npm ci && npm run smoke -- --image $IMAGE"
docker volume rm azeweb-smoke-node-modules
```

Continue only when the result is `9 checks, 9 passed, 0 failed`.

Update the image tag in the service unit. Replace only the final image reference on the `ExecStart=` line with the value of `$IMAGE`.

```bash
nano /etc/systemd/system/aze-forge-web.service
systemctl daemon-reload
systemctl restart aze-forge-web.service
```

## Verify

```bash
systemctl is-active aze-forge-web.service
docker inspect --format '{{.Config.Image}} {{.State.Health.Status}}' azeweb
docker exec azeweb node -e '
const home = await fetch("http://127.0.0.1:8080/");
const html = await home.text();
const script = await fetch("http://127.0.0.1:8080/assets/site.js");
const ready = await fetch("http://127.0.0.1:8080/readyz");
if (!home.ok || !script.ok || !ready.ok || !html.includes("<script src=\"/assets/site.js\" defer></script>")) process.exit(1);
console.log({ home: home.status, navigationScript: script.status, ready: ready.status });
'
```

Expected results: service `active`, image matches `$IMAGE`, health is `healthy`, and every HTTP status is `200`.

## Roll back

Edit the same `ExecStart=` image tag back to the previous image, then reload and restart the service:

```bash
nano /etc/systemd/system/aze-forge-web.service
systemctl daemon-reload
systemctl restart aze-forge-web.service
```
