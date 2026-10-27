#!/bin/sh
# SPDX-License-Identifier: Apache-2.0
#
# Copyright (c) 2026 minhquanghp86
# Licensed under the Apache License, Version 2.0 (see LICENSE).
# (14/10/2026) DUNG ANH THU KHONG CAN GITHUB ACTIONS: build TypeScript tren may dev, chep dist/ + public/ + package*.json
# sang HASS, chong len anh addon DA PHAT HANH cua phien ban dang cai, gan lai dung tag do roi khoi dong lai addon.
# Chi dung khi KHONG doi thu vien npm (node_modules lay tu anh goc). Quay ve ban phat hanh:
#   docker pull ghcr.io/minhquanghp86/darboardos-server:<phien ban> && ha apps restart 5e50eaa0_remote_webview_server
# Dung: HASS=root@<IP may Home Assistant> KEY=<khoa SSH> scripts/anh-thu-cuc-bo.sh
set -eu
HASS=${HASS:?dat HASS=root@<IP may Home Assistant>}
KEY=${KEY:?dat KEY=<duong dan khoa SSH>}
IMG=ghcr.io/minhquanghp86/darboardos-server
cd "$(dirname "$0")/.."
npm run build >/dev/null
TGZ=$(mktemp /tmp/rwv-anh-thu.XXXXXX)
tar czf "$TGZ" dist public package.json package-lock.json
scp -q -i "$KEY" "$TGZ" "$HASS:/tmp/rwv-anh-thu.tgz"
rm -f "$TGZ"
ssh -i "$KEY" "$HASS" "set -e
# (14/10/2026) Ma addon phu thuoc URL kho (doi kho = doi ma) -> tu tim addon Dashboard dang chay.
SLUG=\$(ha apps --raw-json | python3 -c 'import json,sys;print([a[\"slug\"] for a in json.load(sys.stdin)[\"data\"][\"addons\"] if a[\"slug\"].endswith(\"_remote_webview_server\") and a.get(\"state\")==\"started\"][0])')
V=\$(ha apps info \$SLUG --raw-json | python3 -c 'import json,sys;print(json.load(sys.stdin)[\"data\"][\"version\"])')
docker pull -q $IMG:\$V >/dev/null
rm -rf /tmp/rwv-anh-thu && mkdir -p /tmp/rwv-anh-thu && tar xzf /tmp/rwv-anh-thu.tgz -C /tmp/rwv-anh-thu && rm -f /tmp/rwv-anh-thu.tgz
printf 'FROM $IMG:%s\nCOPY . /app/\n' \$V > /tmp/rwv-anh-thu/Dockerfile
docker build -q -t $IMG:\$V /tmp/rwv-anh-thu >/dev/null
rm -rf /tmp/rwv-anh-thu
ha apps restart \$SLUG >/dev/null
echo \"anh thu da cai vao addon (chong len ban \$V)\""
