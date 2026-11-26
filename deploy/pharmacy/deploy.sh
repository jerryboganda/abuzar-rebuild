#!/bin/bash
# Deploy a commit of jerryboganda/abuzar-rebuild to pharmacy.polytronx.com (run on the VPS as root):
#   /opt/pharmacy/deploy.sh <commit>
# Builds the image and the generated web data (classes, DataWindows, SQL) from the same commit with
# src/deploy/pharmacy/Dockerfile, swaps /opt/pharmacy/web-data (previous one kept as web-data.prev; files only the
# server has, assets/, are carried over), switches the app container, and sets the version in the proxy host so
# browsers fetch the new code and data (/v/<commit>-<data hash>/...; the old version stays cached under its own address).
# Rollback: mv web-data web-data.bad && mv web-data.prev web-data, then deploy.sh <previous commit>.
set -euo pipefail
commit=${1:?usage: deploy.sh <commit>}
cd /opt/pharmacy
git -C src fetch -q origin
git -C src checkout -q "$commit"
short=$(git -C src rev-parse --short=8 HEAD)
dockerfile=src/deploy/pharmacy/Dockerfile
nice -n 10 docker build -q -f "$dockerfile" -t "pharmacy-app:$short" src >/dev/null
new="web-data.new"
rm -rf "$new"
nice -n 10 docker build -q -f "$dockerfile" --target data-out -o "type=local,dest=$new" src >/dev/null
n=$(find "$new/classes" -name '*.json' | wc -l)
if [ ! -s "$new/sql.json" ] || [ ! -s "$new/names.json" ] || [ "$n" -lt 2000 ] || [ -z "$(ls -A "$new/dw")" ]; then
  echo "generated web data incomplete ($n class files): web-data left unchanged" >&2
  exit 1
fi
[ -d web-data/assets ] && cp -a web-data/assets "$new/"
data=$(cd "$new" && find . -type f | LC_ALL=C sort | xargs sha1sum | sha1sum | cut -c1-8)
ver="$short-$data"
rm -rf web-data.prev
mv web-data web-data.prev
mv "$new" web-data
proxy=/opt/docker/nginx-proxy-manager/data/nginx/proxy_host
cp "$proxy/pharmacy-manual.conf" "/opt/pharmacy/pharmacy-manual.conf.prev"
for f in "$proxy/pharmacy-manual.conf" "$proxy/zz-pharmacy-test.conf"; do
  [ -f "$f" ] && sed -i -E "s#\"/v/[^/]+/(src|data)/#\"/v/$ver/\1/#g" "$f"
done
cp "$proxy/pharmacy-manual.conf" /opt/pharmacy/pharmacy-manual.conf
sed -i "s/^APP_TAG=.*/APP_TAG=$short/" .env
# recreate even when the tag is unchanged: the bind mount must follow the swapped web-data directory
docker compose up -d --force-recreate app
if docker exec nginx-proxy-manager-app-1 nginx -t 2>/dev/null; then
  docker exec nginx-proxy-manager-app-1 nginx -s reload
else
  cp /opt/pharmacy/pharmacy-manual.conf.prev "$proxy/pharmacy-manual.conf"
  echo "proxy configuration rejected: previous one restored" >&2
  exit 1
fi
echo "deployed $short (version $ver)"