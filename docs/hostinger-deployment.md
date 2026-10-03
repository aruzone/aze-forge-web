# Hostinger release runbook

Use this to deploy the current `main` branch to the Hostinger VM. The running service is the `azeweb` Docker container at `/opt/aze-forge-web`.

## 1. Connect and update

```bash
ssh root@187.126.117.183
cd /opt/aze-forge-web
git pull --ff-only origin main
IMAGE="aze-forge-web:$(git rev-parse --short HEAD)"
OLD_IMAGE="$(docker inspect --format '{{.Config.Image}}' azeweb)"
```

Stop if `git pull` fails or the checkout is dirty.

## 2. Build and smoke-test the image

The VM does not have Node/npm installed on the host. Run the smoke suite in a temporary container, using the host Docker daemon.

```bash
docker build --platform linux/amd64 -t "$IMAGE" .
docker volume create azeweb-smoke-node-modules >/dev/null
docker run --rm --network host --user root --entrypoint /bin/sh \
  -v "$PWD:/work" \
  -v azeweb-smoke-node-modules:/work/node_modules \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -w /work "$IMAGE" \
  -lc "npm ci && npm run smoke -- --image $IMAGE"
docker volume rm azeweb-smoke-node-modules
```

Continue only when the smoke suite reports `9 checks, 9 passed, 0 failed`.

## 3. Preserve configuration and replace the container

This keeps the existing deployment environment, including the access token and optional authoring configuration. The temporary environment file remains until the replacement passes readiness, so the rollback command can use it.

```bash
set -euo pipefail
umask 077
docker inspect --format '{{range .Config.Env}}{{println .}}{{end}}' azeweb > /run/azeweb-deploy.env
docker stop azeweb
docker rm azeweb
docker run -d --name azeweb \
  --read-only \
  --tmpfs /scratch:rw,noexec,nosuid,nodev,size=2g,mode=1777 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m,mode=1777 \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --security-opt=seccomp=unconfined \
  --memory=6g --memory-swap=6g --pids-limit=512 \
  --log-driver=local --log-opt max-size=50m --log-opt max-file=8 \
  --env-file /run/azeweb-deploy.env \
  -p 127.0.0.1:8080:8080 \
  "$IMAGE"
```

## 4. Verify and clean up

```bash
docker exec azeweb node -e '
const home = await fetch("http://127.0.0.1:8080/");
const html = await home.text();
const script = await fetch("http://127.0.0.1:8080/assets/site.js");
const ready = await fetch("http://127.0.0.1:8080/readyz");
if (!home.ok || !script.ok || !ready.ok || !html.includes("<script src=\"/assets/site.js\" defer></script>")) process.exit(1);
console.log({ home: home.status, navigationScript: script.status, ready: ready.status });
'
rm /run/azeweb-deploy.env
```

Expected output has `home: 200`, `navigationScript: 200`, and `ready: 200`.

## Roll back

If the new container fails before the environment file is removed, replace it with the previous image:

```bash
docker rm -f azeweb
docker run -d --name azeweb \
  --read-only \
  --tmpfs /scratch:rw,noexec,nosuid,nodev,size=2g,mode=1777 \
  --tmpfs /tmp:rw,noexec,nosuid,nodev,size=512m,mode=1777 \
  --cap-drop=ALL \
  --security-opt=no-new-privileges \
  --security-opt=seccomp=unconfined \
  --memory=6g --memory-swap=6g --pids-limit=512 \
  --log-driver=local --log-opt max-size=50m --log-opt max-file=8 \
  --env-file /run/azeweb-deploy.env \
  -p 127.0.0.1:8080:8080 \
  "$OLD_IMAGE"
```
