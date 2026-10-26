# Sửa lỗi "không thấy bản cập nhật add-on" (store clone bị detached HEAD)

## Triệu chứng
- Đã push version mới lên `main`, CI build image thành công, `config.yaml` trên GitHub đã là version mới.
- `ha apps info <addon>` vẫn báo `version_latest: <version cũ>`; `ha apps update` trả
  **"No update available"**; `ha store reload` / `ha supervisor reload` không thay đổi gì.

## Nguyên nhân (đọc từ log + code Supervisor)
`docker logs hassio_supervisor`:
```
ERROR (MainThread) [supervisor.store] Could not reload repository b39feb53 due to JobException()
TypeError: HEAD is a detached symbolic reference as it points to '1dccd2015d8a...'
```
Trong `/usr/src/supervisor/supervisor/store/git.py` → `GitRepo.pull()`:
```python
branch = repo.active_branch.name      # <-- ném TypeError khi HEAD detached
```
→ toàn bộ lần reload repo đó bị hủy, Supervisor giữ metadata cũ trong RAM/đĩa.
Clone vẫn nằm ở commit cũ nên không bao giờ thấy version mới.

Clone bị detached do **lệnh `git checkout <ref>` chạy tay trong `/data/apps/git/<repo-id>`**
(xem `git reflog`: `checkout: moving from main to origin/main`). Supervisor **không** tự detach —
nó chỉ `fetch` + `reset --hard origin/main`, nên chỉ cần clone đang ở một nhánh là đủ.

## Sửa (1 lệnh, chạy trên máy HA)
```bash
sh scripts/fix-store-clone.sh b39feb53 remote_webview_server
```
Script sẽ: `git checkout -B main origin/main` → `git pull --ff-only` → `ha store reload` →
in ra `version_latest`. Sau đó `ha apps update <slug>` mới thấy bản mới.

Kiểm tra tay:
```bash
docker exec hassio_supervisor sh -c \
  'cd /data/apps/git/b39feb53 && git status -sb | head -1 && git log --oneline -1'
# phải là: ## main...origin/main  (KHÔNG phải "HEAD detached at ...")
```

## Phòng tái diễn (quan trọng)
- **KHÔNG BAO GIỜ** chạy `git checkout`, `git checkout -b`, `git switch`, `git reset` trong
  `/data/apps/git/*` của Supervisor. Cần xem nội dung commit khác thì dùng
  `git show <ref>:<path>` (không đổi HEAD).
- Sau mỗi lần phát hành, kiểm tra đúng 2 bước: `ha store reload` rồi
  `ha apps info <slug> | grep version_latest`. Nếu vẫn là version cũ → chạy script trên.
- Nếu clone hỏng nặng (không chỉ detached): gỡ rồi thêm lại repo trong Settings → Add-ons →
  Repositories (slug add-on giữ nguyên vì băm theo URL repo, cài đặt add-on không mất).
