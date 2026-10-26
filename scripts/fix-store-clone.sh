#!/bin/sh
# Sua clone store cua HA Supervisor bi DETACHED HEAD -> Supervisor khong reload duoc repo
# nen khong thay ban add-on moi ("No update available").
#
# Nguyen nhan: GitRepo.pull() trong supervisor/store/git.py goi repo.active_branch.name,
# nem TypeError khi HEAD detached -> JobException -> huy reload ca repo.
#
# Chay TREN MAY HA (root):
#   sh scripts/fix-store-clone.sh [repo-id] [addon-slug] [branch]
#   vd: sh scripts/fix-store-clone.sh b39feb53 remote_webview_server main
#
# Sau khi chay: ha apps update <repo-id>_<addon-slug>
set -e

REPO_ID=${1:-b39feb53}
ADDON=${2:-remote_webview_server}
BRANCH=${3:-main}
DIR="/data/apps/git/${REPO_ID}"

echo "== Truoc khi sua"
docker exec hassio_supervisor sh -c "cd ${DIR} && git status -sb | head -1 && git log --oneline -1"

echo "== Gan lai nhanh ${BRANCH} + cap nhat"
docker exec hassio_supervisor sh -c \
  "cd ${DIR} && git checkout -B ${BRANCH} origin/${BRANCH} && git pull --ff-only"

echo "== Sau khi sua"
docker exec hassio_supervisor sh -c "cd ${DIR} && git status -sb | head -1 && git log --oneline -1"

echo "== Reload store"
ha store reload

echo "== Phien ban moi nhat ma store thay"
ha apps info "${REPO_ID}_${ADDON}" 2>/dev/null | grep -E '^version|^version_latest' || \
  echo "Khong doc duoc thong tin app ${REPO_ID}_${ADDON} — kiem tra ten slug."
