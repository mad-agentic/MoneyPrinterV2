# PLAN: Tích hợp ProxyAPI.MAD vào MoneyPrinterV2

## Mục Tiêu

Dùng **ProxyAPI.MAD** (proxy server Go của bạn, chạy tại `http://localhost:8317`) thay cho các API key trả phí, cho phép MoneyPrinterV2 gọi **Gemini / ChatGPT / Claude** miễn phí qua OAuth login.

---

## Kiến Trúc

```
MoneyPrinterV2 (Python)
     │
     │  OpenAI-compatible format
     │  Bearer: <api-key từ ProxyAPI.MAD config.yaml>
     ▼
ProxyAPI.MAD  (localhost:8317/v1)
     │
     ├──► Gemini 2.5 Pro  (via gemini CLI login, FREE)
     ├──► ChatGPT GPT-4   (via openai-device-login, FREE)
     └──► Claude Sonnet   (via claude-login, FREE)
```

> **ProxyAPI.MAD đã là OpenAI-compatible** → MoneyPrinterV2 chỉ cần đổi `base_url` + `api_key`

---

## Phân Tích Hiện Trạng

| File | Hiện Tại | Sau Khi Tích Hợp |
|---|---|---|
| `src/llm_provider.py` | Chỉ hỗ trợ Ollama | + Hỗ trợ `provider=proxyapi` |
| `src/config.py` | Có `get_ollama_*()` | + Thêm `get_proxyapi_*()` |
| `config.example.json` | Có `ollama_base_url` | + Thêm `proxyapi_base_url`, `proxyapi_api_key`, `proxyapi_model` |
| `.env` | `GEMINI_API_KEY`, `HF_TOKEN` | + `PROXYAPI_KEY` |

---

## Giai Đoạn Triển Khai (5 Phases)

### Phase 1 — Cập nhật Config

#### [MODIFY] `config.example.json`
Thêm 3 fields mới:
```json
"llm_provider": "proxyapi",
"proxyapi_base_url": "http://localhost:8317/v1",
"proxyapi_api_key": "",
"proxyapi_model": "gemini-2.5-pro"
```

#### [MODIFY] `.env`
Thêm:
```
PROXYAPI_KEY=my-personal-key
```
> Key này là key mà bạn tự đặt trong `config.yaml` của ProxyAPI.MAD

---

### Phase 2 — Thêm Getters vào `src/config.py`

#### [MODIFY] `src/config.py`
Thêm 4 hàm getter mới (theo pattern hiện tại):

```python
def get_llm_provider() -> str:
    # Returns "ollama" | "proxyapi"
    # Default: "ollama" để backward compatible

def get_proxyapi_base_url() -> str:
    # Default: "http://localhost:8317/v1"

def get_proxyapi_api_key() -> str:
    # Đọc từ config.json, fallback env PROXYAPI_KEY

def get_proxyapi_model() -> str:
    # Default: "gemini-2.5-pro"
```

---

### Phase 3 — Cập nhật `src/llm_provider.py`

#### [MODIFY] `src/llm_provider.py`
Dispatch logic dựa trên `llm_provider` trong config:

```
generate_text(prompt)
    │
    ├── if provider == "ollama"  → ollama.Client (giữ nguyên như cũ)
    └── if provider == "proxyapi" → openai.OpenAI(
                                        base_url=get_proxyapi_base_url(),
                                        api_key=get_proxyapi_api_key()
                                    ).chat.completions.create(...)
```

- Import `openai` package (đã có sẵn hoặc thêm vào requirements)
- Dùng `openai.OpenAI` SDK với custom `base_url` — đây là pattern chuẩn cho mọi OpenAI-compatible proxy
- Hàm `list_models()` cho ProxyAPI: gọi `GET /v1/models` hoặc trả fallback list
- Hàm `generate_text()` vẫn giữ signature cũ → backward compatible

---

### Phase 4 — Thêm Script Tiện Ích

#### [NEW] `scripts/check_proxyapi.py`
Script kiểm tra ProxyAPI.MAD có đang chạy không:
- Gọi `GET http://localhost:8317/v1/models` với API key
- In ra danh sách model available
- Dùng khi debug hoặc setup lần đầu

#### [MODIFY] `scripts/preflight_local.py` (nếu tồn tại)
Thêm check: nếu `llm_provider == "proxyapi"`, verify ProxyAPI.MAD đang chạy

---

### Phase 5 — Tài Liệu

#### [NEW] `docs/ProxyAPI.md`
Hướng dẫn:
1. Clone + chạy ProxyAPI.MAD
2. Login các provider (Gemini / GPT / Claude)
3. Lấy API key từ `config.yaml` của ProxyAPI.MAD
4. Cấu hình `config.json` trong MoneyPrinterV2
5. Chọn model muốn dùng

---

## Các File Thay Đổi

| File | Loại | Mô tả |
|---|---|---|
| `config.example.json` | MODIFY | Thêm `llm_provider`, `proxyapi_*` fields |
| `.env` | MODIFY | Thêm `PROXYAPI_KEY` |
| `src/config.py` | MODIFY | Thêm 4 getters mới |
| `src/llm_provider.py` | MODIFY | Hỗ trợ provider=proxyapi |
| `requirements.txt` | MODIFY | Đảm bảo `openai` package có mặt |
| `scripts/check_proxyapi.py` | NEW | Script kiểm tra proxy sẵn sàng |
| `docs/ProxyAPI.md` | NEW | Tài liệu hướng dẫn |

---

## Kế Hoạch Kiểm Thử

### 1. Unit Tests (mới — `tests/test_llm_provider.py`)

Viết với `unittest.mock` để mock `openai.OpenAI`:
```python
# Test dispatch đúng provider
# Test proxyapi path gọi đúng base_url
# Test fallback khi provider không xác định
```

```bash
# Chạy test:
.venv\Scripts\python.exe -m pytest tests/test_llm_provider.py -v
```

### 2. Script Check (thủ công)

Sau khi ProxyAPI.MAD đang chạy:
```bash
# Kiểm tra proxy sẵn sàng
.venv\Scripts\python.exe scripts/check_proxyapi.py
```

### 3. Smoke Test qua `src/main.py`

```bash
# 1. Đảm bảo ProxyAPI.MAD đang chạy (port 8317)
# 2. Đặt trong config.json: "llm_provider": "proxyapi"
# 3. Đặt PROXYAPI_KEY hoặc "proxyapi_api_key" trong config
# 4. Chạy:
.venv\Scripts\python.exe src/main.py
# → Thử một action có generate text để xác nhận
```

---

## Ghi Chú Quan Trọng

> [!IMPORTANT]
> `openai` Python package phải có trong `requirements.txt`. Đây là package chính thức của OpenAI nhưng dùng được với **mọi** OpenAI-compatible API (bao gồm ProxyAPI.MAD).

> [!NOTE]
> **Backward compatible hoàn toàn**: Nếu `llm_provider` không set hoặc = `"ollama"`, hành vi cũ không thay đổi. Chỉ khi `"proxyapi"` mới dùng proxy.

> [!WARNING]
> ProxyAPI.MAD phải **đang chạy** trước khi dùng MoneyPrinterV2 với provider này. Nên thêm check vào preflight script.
