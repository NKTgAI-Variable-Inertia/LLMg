// Nhúng file này vào web tĩnh của bạn.
// Đổi WORKER_URL thành domain Worker thật (vd: https://qwen-proxy.yourname.workers.dev)

const WORKER_URL = "https://qwen-proxy.yourname.workers.dev";

async function askAI(prompt, { pollIntervalMs = 4000, maxWaitMs = 240000 } = {}) {
  const triggerRes = await fetch(`${WORKER_URL}/trigger`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt }),
  });

  if (!triggerRes.ok) {
    const err = await triggerRes.json().catch(() => ({}));
    throw new Error(`Trigger thất bại: ${err.error || triggerRes.status}`);
  }

  const { request_id } = await triggerRes.json();
  const startedAt = Date.now();

  while (Date.now() - startedAt < maxWaitMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));

    const res = await fetch(`${WORKER_URL}/result?id=${request_id}`);
    if (res.status === 404) continue; // chưa kịp ghi KV, thử lại

    const data = await res.json();
    if (data.status === "done") return data.result;
    if (data.status === "error") throw new Error(data.error || "Model lỗi");
    // status === "pending" -> tiếp tục poll
  }

  throw new Error("Timeout: AI không phản hồi kịp thời gian chờ");
}

// Ví dụ dùng:
// document.getElementById("askBtn").addEventListener("click", async () => {
//   const out = document.getElementById("output");
//   out.textContent = "Đang xử lý (có thể mất 1-3 phút)...";
//   try {
//     const result = await askAI(document.getElementById("promptInput").value);
//     out.textContent = result;
//   } catch (e) {
//     out.textContent = "Lỗi: " + e.message;
//   }
// });
