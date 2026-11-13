#!/bin/bash
# nightly pg_dump of the pharmacy database (waseela); keeps 14 days
set -euo pipefail
d=/opt/pharmacy/backups; f=$d/waseela-$(date -u +%Y%m%d-%H%M).dump
docker exec pharmacy-db pg_dump -U postgres -Fc waseela > "$f.part" && mv "$f.part" "$f"
find "$d" -name "waseela-*.dump" -mtime +14 -delete
echo "$(date -u "+%F %T") ok $(du -h "$f" | cut -f1)" >> /var/log/pharmacy-backup.log
