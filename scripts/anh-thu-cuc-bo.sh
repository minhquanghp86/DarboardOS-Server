#!/bin/sh
# (14/10/2026) DUNG ANH THU KHONG CAN GITHUB ACTIONS: build TypeScript tren may dev, chep dist/ + public/ + package*.json
# sang HASS, chong len anh addon DA PHAT HANH cua phien ban dang cai, gan lai dung tag do roi khoi dong lai addon.
# Chi dung khi KHONG doi thu vien npm (node_modules lay tu anh goc). Quay ve ban phat hanh:
#   docker pull ghcr.io/minhquanghp86/ha-darboard-server:<phien ban> && ha apps restart 5e50eaa0_remote_webview_server
# Dung: scripts/anh-thu-cuc-bo.sh   (bien moi truong tuy chon: HASS=root@192.168.1.2 KEY=~/.ssh/...)
set -eu
HASS=${HASS:-root@192.168.1.2}
KEY=${KEY:-$HOME/.ssh/hass_key}
IMG=ghcr.io/minhquanghp86/ha-darboard-server
SLUG=5e50eaa0_remote_webview_server
cd "$(dirname "$0")/.."
npm run build >/dev/null
TGZ=$(mktemp /tmp/rwv-anh-thu.XXXXXX)
tar czf "$TGZ" dist public package.json package-lock.json
scp -q -i "$KEY" "$TGZ" "$HASS:/tmp/rwv-anh-thu.tgz"
rm -f "$TGZ"
ssh -i "$KEY" "$HASS" "set -e
V=\$(ha apps info $SLUG --raw-json | python3 -c 'import json,sys;print(json.load(sys.stdin)[\"data\"][\"version\"])')
docker pull -q $IMG:\$V >/dev/null
rm -rf /tmp/rwv-anh-thu && mkdir -p /tmp/rwv-anh-thu && tar xzf /tmp/rwv-anh-thu.tgz -C /tmp/rwv-anh-thu && rm -f /tmp/rwv-anh-thu.tgz
printf 'FROM $IMG:%s\nCOPY . /app/\n' \$V > /tmp/rwv-anh-thu/Dockerfile
docker build -q -t $IMG:\$V /tmp/rwv-anh-thu >/dev/null
rm -rf /tmp/rwv-anh-thu
ha apps restart $SLUG >/dev/null
echo \"anh thu da cai vao addon (chong len ban \$V)\""
