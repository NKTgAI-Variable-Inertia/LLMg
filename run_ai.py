import os
import json
import traceback
import requests
from transformers import AutoModelForCausalLM, AutoTokenizer

MODEL_NAME = "NKTgAI/Qwen2.5-0.5B-Instruct-LLM"


def get_payload():
    payload_str = os.environ.get("EVENT_PAYLOAD", "{}")
    try:
        payload = json.loads(payload_str) or {}
    except Exception:
        payload = {}

    # repository_dispatch -> có prompt + request_id trong payload
    # workflow_dispatch (chạy tay) -> lấy từ WORKFLOW_PROMPT, không có request_id
    prompt = payload.get("prompt") or os.environ.get("WORKFLOW_PROMPT") or "Xin chào!"
    request_id = payload.get("request_id", "manual-run")
    return prompt, request_id


def send_webhook(webhook_url, webhook_secret, data):
    if not webhook_url:
        print("Không có WEBHOOK_URL, in kết quả ra log:")
        print(json.dumps(data, ensure_ascii=False, indent=2))
        return
    try:
        resp = requests.post(
            webhook_url,
            json=data,
            headers={"X-Webhook-Secret": webhook_secret or ""},
            timeout=15,
        )
        resp.raise_for_status()
        print(f"Đã gửi webhook thành công: {resp.status_code}")
    except Exception as e:
        print(f"Gửi webhook thất bại: {e}")


def main():
    prompt, request_id = get_payload()
    webhook_url = os.environ.get("WEBHOOK_URL")
    webhook_secret = os.environ.get("WEBHOOK_SECRET")

    try:
        print(f"Đang tải mô hình {MODEL_NAME}...")
        tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
        model = AutoModelForCausalLM.from_pretrained(
            MODEL_NAME,
            device_map="auto",
            torch_dtype="auto",
        )

        messages = [{"role": "user", "content": prompt}]
        text = tokenizer.apply_chat_template(
            messages, tokenize=False, add_generation_prompt=True
        )
        model_inputs = tokenizer([text], return_tensors="pt").to(model.device)

        generated_ids = model.generate(
            **model_inputs,
            max_new_tokens=512,
            do_sample=True,
            temperature=0.7,
        )
        generated_ids = [
            output_ids[len(input_ids):]
            for input_ids, output_ids in zip(model_inputs.input_ids, generated_ids)
        ]
        response_text = tokenizer.batch_decode(generated_ids, skip_special_tokens=True)[0]

        print(f"Kết quả AI: {response_text}")
        send_webhook(webhook_url, webhook_secret, {
            "request_id": request_id,
            "prompt": prompt,
            "result": response_text,
        })

    except Exception:
        err = traceback.format_exc()
        print(f"Lỗi khi chạy mô hình:\n{err}")
        send_webhook(webhook_url, webhook_secret, {
            "request_id": request_id,
            "prompt": prompt,
            "error": "model_run_failed",
        })
        raise


if __name__ == "__main__":
    main()
