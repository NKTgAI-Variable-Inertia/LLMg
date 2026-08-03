# Setup

## 1. GitHub repo
- Copy `.github/workflows/run-qwen.yml` và `run_ai.py` vào repo chứa mô hình.
- Repo Secrets (Settings > Secrets and variables > Actions):
  - `RESULT_WEBHOOK_URL` = `https://<worker-domain>/webhook`
  - `WEBHOOK_SECRET` = chuỗi bí mật tự đặt (dùng lại ở bước Worker)
- Tạo GitHub PAT (fine-grained, quyền "Contents: read" + "Actions: write" trên repo này) để dùng ở Worker.

## 2. Cloudflare Worker
- Tạo Worker mới, dán nội dung `worker.js`.
- Tạo KV namespace (vd: `RESULTS_KV`), bind vào Worker với tên `RESULTS_KV`.
- Set biến/secret trong Worker:
  - Secret: `GITHUB_TOKEN` = PAT ở bước 1
  - Var: `GITHUB_OWNER`, `GITHUB_REPO`
  - Var: `ALLOWED_ORIGIN` = domain web tĩnh (vd: `https://yourname.github.io`)
  - Secret: `WEBHOOK_SECRET` = khớp với secret đã đặt trong GitHub repo
- Deploy Worker, ghi lại URL (vd: `https://qwen-proxy.yourname.workers.dev`).

## 3. Web tĩnh
- Nhúng `client.js`, sửa `WORKER_URL` thành URL Worker vừa deploy.
- Gọi `askAI("câu hỏi của bạn")` khi cần.

## Test nhanh
1. Gọi `POST /trigger` với `{ "prompt": "test" }` → nhận `request_id`.
2. Vào tab Actions trên GitHub, xem workflow `run_qwen_task` có chạy không.
3. Sau khi Actions chạy xong, `GET /result?id=<request_id>` phải trả `status: done`.

## Lưu ý thực tế
- Thời gian chờ thực tế: ~1-3 phút/lần (cài torch CPU + tải model, có cache nên các lần sau nhanh hơn lần đầu).
- Nếu traffic cao, các request sẽ xếp hàng theo giới hạn concurrent jobs của GitHub Actions (mặc định 20 job free tier) — không phù hợp cho nhiều người dùng cùng lúc.
