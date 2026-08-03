/**
 * Cloudflare Worker - trung gian giữa web tĩnh và GitHub Actions
 *
 * Cần cấu hình trong Worker (Settings > Variables):
 *  - Secret: GITHUB_TOKEN   (PAT có quyền "repo" hoặc fine-grained "Actions: write")
 *  - Var:    GITHUB_OWNER   (tên user/org GitHub)
 *  - Var:    GITHUB_REPO    (tên repository)
 *  - Var:    ALLOWED_ORIGIN (domain web tĩnh của bạn, vd: https://yourname.github.io)
 *  - KV binding: RESULTS_KV (tạo KV namespace và bind vào Worker)
 *
 * Routes:
 *  POST /trigger  { prompt }              -> trả về { request_id }
 *  POST /webhook  { request_id, result }  -> gọi bởi GitHub Actions, lưu kết quả
 *  GET  /result?id=xxx                    -> web tĩnh poll để lấy kết quả
 */

function corsHeaders(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(data, status, env) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...corsHeaders(env) },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(env) });
    }

    // --- 1. Trigger workflow ---
    if (url.pathname === "/trigger" && request.method === "POST") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "invalid_json" }, 400, env);
      }
      const prompt = (body.prompt || "").toString().slice(0, 2000);
      if (!prompt) return json({ error: "missing_prompt" }, 400, env);

      const requestId = crypto.randomUUID();

      // Đánh dấu pending trước để /result không báo "not_found" khi poll quá sớm
      await env.RESULTS_KV.put(
        requestId,
        JSON.stringify({ status: "pending" }),
        { expirationTtl: 900 }
      );

      const ghResp = await fetch(
        `https://api.github.com/repos/${env.GITHUB_OWNER}/${env.GITHUB_REPO}/dispatches`,
        {
          method: "POST",
          headers: {
            Accept: "application/vnd.github+json",
            Authorization: `Bearer ${env.GITHUB_TOKEN}`,
            "Content-Type": "application/json",
            "User-Agent": "cf-worker-qwen-trigger",
          },
          body: JSON.stringify({
            event_type: "run_qwen_task",
            client_payload: { prompt, request_id: requestId },
          }),
        }
      );

      if (!ghResp.ok) {
        const errText = await ghResp.text();
        return json(
          { error: "github_dispatch_failed", detail: errText },
          502,
          env
        );
      }

      return json({ request_id: requestId, status: "pending" }, 200, env);
    }

    // --- 2. Webhook nhận kết quả từ GitHub Actions ---
    if (url.pathname === "/webhook" && request.method === "POST") {
      // Bảo vệ endpoint bằng shared secret đơn giản (khớp với WEBHOOK_SECRET trong Actions)
      const auth = request.headers.get("X-Webhook-Secret");
      if (!env.WEBHOOK_SECRET || auth !== env.WEBHOOK_SECRET) {
        return json({ error: "unauthorized" }, 401, env);
      }

      let data;
      try {
        data = await request.json();
      } catch {
        return json({ error: "invalid_json" }, 400, env);
      }
      if (!data.request_id) return json({ error: "missing_request_id" }, 400, env);

      await env.RESULTS_KV.put(
        data.request_id,
        JSON.stringify({
          status: data.error ? "error" : "done",
          result: data.result || null,
          error: data.error || null,
          prompt: data.prompt || null,
        }),
        { expirationTtl: 600 }
      );

      return json({ ok: true }, 200, env);
    }

    // --- 3. Client poll kết quả ---
    if (url.pathname === "/result" && request.method === "GET") {
      const id = url.searchParams.get("id");
      if (!id) return json({ error: "missing_id" }, 400, env);

      const raw = await env.RESULTS_KV.get(id);
      if (!raw) return json({ status: "not_found" }, 404, env);

      return json(JSON.parse(raw), 200, env);
    }

    return json({ error: "not_found" }, 404, env);
  },
};
