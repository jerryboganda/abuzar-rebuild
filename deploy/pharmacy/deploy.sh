#!/bin/bash
# Deploy a commit of jerryboganda/abuzar-rebuild to pharmacy.polytronx.com (run on the VPS as root):
#   /opt/pharmacy/deploy.sh <commit>
# Builds the image from /opt/pharmacy/src, switches the app container, and sets the version in the proxy host so browsers
# fetch the new code and data (/v/<commit>-<data hash>/...; the old version stays cached under its own address).
set -euo pipefail
commit=${1:?usage: deploy.sh <commit>}
cd /opt/pharmacy
git -C src fetch -q origin
git -C src checkout -q "$commit"
short=$(git -C src rev-parse --short=8 HEAD)
nice -n 10 docker build -q -f Dockerfile -t "pharmacy-app:$short" src >/dev/null
data=$(cd web-data && find . -type f | LC_ALL=C sort | xargs sha1sum | sha1sum | cut -c1-8)
ver="$short-$data"
proxy=/opt/docker/nginx-proxy-manager/data/nginx/proxy_host
cp "$proxy/pharmacy-manual.conf" "/opt/pharmacy/pharmacy-manual.conf.prev"
for f in "$proxy/pharmacy-manual.conf" "$proxy/zz-pharmacy-test.conf"; do
  [ -f "$f" ] && sed -i -E "s#\"/v/[^/]+/(src|data)/#\"/v/$ver/\1/#g" "$f"
done
cp "$proxy/pharmacy-manual.conf" /opt/pharmacy/pharmacy-manual.conf
sed -i "s/^APP_TAG=.*/APP_TAG=$short/" .env
docker compose up -d app
if docker exec nginx-proxy-manager-app-1 nginx -t 2>/dev/null; then
  docker exec nginx-proxy-manager-app-1 nginx -s reload
else
  cp /opt/pharmacy/pharmacy-manual.conf.prev "$proxy/pharmacy-manual.conf"
  echo "proxy configuration rejected: previous one restored" >&2
  exit 1
fi
echo "deployed $short (version $ver)"
