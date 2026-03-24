# MoneyPrinterV2 — Hướng Dẫn Setup & Sử Dụng Chi Tiết (Tiếng Việt)

> **Tóm tắt:** MPV2 là công cụ CLI (giao diện dòng lệnh) bằng Python 3.12, tự động hóa 4 quy trình: tạo & upload YouTube Shorts, đăng tweet Twitter/X, tiếp thị liên kết Amazon, và gửi email tiếp cận doanh nghiệp địa phương. Không có giao diện web.

---

## Mục Lục

1. [Yêu Cầu Hệ Thống](#1-yêu-cầu-hệ-thống)
2. [Cài Đặt Lần Đầu](#2-cài-đặt-lần-đầu)
3. [Cấu Hình config.json](#3-cấu-hình-configjson)
4. [Thiết Lập Firefox Profile (Bắt Buộc)](#4-thiết-lập-firefox-profile-bắt-buộc)
5. [Cài Đặt Ollama (LLM)](#5-cài-đặt-ollama-llm)
6. [Kiểm Tra Hệ Thống (Preflight)](#6-kiểm-tra-hệ-thống-preflight)
7. [Chạy Ứng Dụng](#7-chạy-ứng-dụng)
8. [Hướng Dẫn Từng Tính Năng](#8-hướng-dẫn-từng-tính-năng)
   - [8.1 YouTube Shorts Automater](#81-youtube-shorts-automater)
   - [8.2 Twitter Bot](#82-twitter-bot)
   - [8.3 Affiliate Marketing](#83-affiliate-marketing)
   - [8.4 Outreach (Tiếp Cận Doanh Nghiệp)](#84-outreach-tiếp-cận-doanh-nghiệp)
9. [Lên Lịch Tự Động (CRON)](#9-lên-lịch-tự-động-cron)
10. [Cấu Trúc Thư Mục & File](#10-cấu-trúc-thư-mục--file)
11. [Giải Quyết Sự Cố](#11-giải-quyết-sự-cố)

---

## 1. Yêu Cầu Hệ Thống

| Thành phần | Phiên bản tối thiểu | Ghi chú |
|---|---|---|
| Python | 3.12 | Bắt buộc. 3.11 trở xuống không tương thích. |
| Ollama | Mới nhất | Dùng cho LLM tạo script/text. Cần cài sẵn model. |
| Firefox | Mới nhất | Dùng cho automation (Selenium). |
| ImageMagick | Mới nhất | Cần cho MoviePy render phụ đề. |
| Go | Khuyến nghị | Chỉ cần nếu dùng tính năng Outreach. |
| Git | Mới nhất | Để clone project. |

---

## 2. Cài Đặt Lần Đầu

### 2.1 Clone Project

```bash
git clone https://github.com/FujiwaraChoki/MoneyPrinterV2.git
cd MoneyPrinterV2
```

### 2.2 Tạo Virtual Environment

```bash
# Windows
python -m venv venv
.\venv\Scripts\activate

# macOS / Linux
python3 -m venv venv
source venv/bin/activate
```

### 2.3 Cài Dependencies

```bash
pip install -r requirements.txt
```

### 2.4 Tạo File Cấu Hình

```bash
cp config.example.json config.json
```

### 2.5 Script Setup Tự Động (macOS/Linux)

Nếu dùng macOS hoặc Linux, chạy script tự động setup:

```bash
bash scripts/setup_local.sh
```

Script này sẽ:
- Tạo virtual environment nếu chưa có.
- Cài requirements.
- Tự động phát hiện ImageMagick, Firefox profile, và Ollama model.
- Cập nhật `config.json` với giá trị mặc định hợp lý.

---

## 3. Cấu Hình config.json

Mở file `config.json` và điền các giá trị cần thiết. Dưới đây là các trường quan trọng nhất:

### 3.1 Các Trường Bắt Buộc

```json
{
  "verbose": true,
  "firefox_profile": "/đường/dẫn/đến/firefox/profile",
  "ollama_base_url": "http://127.0.0.1:11434",
  "ollama_model": "llama3.2:3b",
  "nanobanana2_api_key": "YOUR_GEMINI_API_KEY",
  "imagemagick_path": "C:\\Program Files\\ImageMagick-7.x.x\\magick.exe",
  "twitter_language": "English",
  "tts_voice": "Jasper",
  "script_sentence_length": 4
}
```

### 3.2 Giải Thích Từng Trường Quan Trọng

| Trường | Ý nghĩa |
|---|---|
| `verbose` | `true` để in log chi tiết khi chạy |
| `firefox_profile` | Đường dẫn đến Firefox profile đã login sẵn (xem mục 4) |
| `ollama_model` | Model LLM dùng để tạo script, tweet. VD: `llama3.2:3b`, `qwen3:14b` |
| `nanobanana2_api_key` | API key Gemini cho tạo ảnh. Lấy tại [ai.google.dev](https://ai.google.dev) |
| `imagemagick_path` | Đường dẫn đến file `magick.exe` (Windows) hoặc `/usr/bin/convert` (Linux/Mac) |
| `tts_voice` | Giọng đọc TTS: `Jasper`, `Bella`, `Luna`, `Bruno`, `Rosie`, `Hugo`, `Kiki`, `Leo` |
| `script_sentence_length` | Số câu trong script video YouTube (mặc định: 4) |

### 3.3 Cấu Hình Email (cho Outreach)

```json
"email": {
  "smtp_server": "smtp.gmail.com",
  "smtp_port": 587,
  "username": "your-email@gmail.com",
  "password": "your-app-password"
}
```

> **Lưu ý:** Với Gmail, cần tạo [App Password](https://support.google.com/accounts/answer/185833) thay vì dùng mật khẩu thường.

### 3.4 Cấu Hình STT (Phụ Đề)

```json
"stt_provider": "local_whisper",
"whisper_model": "base",
"whisper_device": "auto",
"whisper_compute_type": "int8"
```

Hoặc dùng AssemblyAI:

```json
"stt_provider": "third_party_assemblyai",
"assembly_ai_api_key": "YOUR_ASSEMBLYAI_KEY"
```

### 3.5 Biến Môi Trường

Nếu `nanobanana2_api_key` để trống, app sẽ tự động đọc từ biến môi trường:

```bash
# Linux/macOS
export GEMINI_API_KEY="your_api_key"

# Windows (CMD)
set GEMINI_API_KEY=your_api_key

# Windows (PowerShell)
$env:GEMINI_API_KEY="your_api_key"
```

---

## 4. Thiết Lập Firefox Profile (Bắt Buộc)

Đây là bước **quan trọng nhất** — MPV2 dùng Selenium điều khiển trình duyệt Firefox đã đăng nhập sẵn để tự động hóa YouTube và Twitter.

### 4.1 Tìm Firefox Profile Path

1. Mở Firefox → gõ `about:profiles` trên thanh URL.
2. Tìm profile đang dùng (thường là `default-release`).
3. Copy đường dẫn của profile đó.
4. Điền vào `config.json` → `"firefox_profile"`.

### 4.2 Đảm Bảo Đã Đăng Nhập

- Mở Firefox với profile đó.
- Đăng nhập vào YouTube (kênh của bạn) và Twitter/X.
- Đóng trình duyệt hoàn toàn trước khi chạy MPV2.

### 4.3 Ví Dụ Đường Dẫn

| Hệ điều hành | Ví dụ đường dẫn |
|---|---|
| Windows | `C:\Users\admin\AppData\Roaming\Mozilla\Firefox\Profiles\abcd1234.default-release` |
| macOS | `/Users/admin/Library/Application Support/Firefox/Profiles/abcd1234.default-release` |
| Linux | `/home/admin/.mozilla/firefox/abcd1234.default` |

---

## 5. Cài Đặt Ollama (LLM)

Ollama chạy model LLM **cục bộ** trên máy bạn.

### 5.1 Cài Ollama

```bash
# macOS / Linux
curl -fsSL https://ollama.com/install.sh | sh

# Windows: tải installer tại https://ollama.com/download
```

### 5.2 Pull Model

```bash
# Model phổ biến (nhẹ, chạy được trên hầu hết máy)
ollama pull llama3.2:3b

# Model mạnh hơn (cần nhiều RAM hơn)
ollama pull qwen3:14b

# Model flash nhanh
ollama pull glm-4.7-flash:latest
```

### 5.3 Khởi Động Ollama Server

```bash
ollama serve
```

Ollama chạy tại `http://127.0.0.1:11434`. Kiểm tra:

```bash
ollama list
```

---

## 6. Kiểm Tra Hệ Thống (Preflight)

Sau khi cài xong mọi thứ, chạy script kiểm tra:

```bash
python scripts/preflight_local.py
```

Script này kiểm tra:
- File `config.json` có tồn tại
- Ollama có kết nối được không
- Model Ollama có sẵn không
- `nanobanana2_api_key` (Gemini API) có được đặt không
- Firefox profile có tồn tại không
- ImageMagick có được cấu hình đúng không
- `faster-whisper` có import được không

Nếu script trả về **"Preflight passed"** — bạn đã sẵn sàng.

---

## 7. Chạy Ứng Dụng

```bash
python src/main.py
```

Khi chạy lần đầu:
1. App hiển thị banner ASCII.
2. Hỏi chọn model Ollama (nếu `ollama_model` trong `config.json` để trống).
3. Hiển thị menu chính với 5 lựa chọn.

### Menu Chính

```
1. YouTube Shorts Automater
2. Twitter Bot
3. Affiliate Marketing (Amazon)
4. Outreach (Local Business)
5. Exit
```

---

## 8. Hướng Dẫn Từng Tính Năng

### 8.1 YouTube Shorts Automater

**Chức năng:** Tạo video YouTube Shorts hoàn chỉnh từ A→Z:
- Tạo chủ đề (topic) dựa trên niche
- Viết script bằng LLM
- Tạo metadata (title, description)
- Tạo prompt ảnh → sinh ảnh bằng Gemini
- Chuyển script thành giọng nói (KittenTTS)
- Ghép ảnh + audio + phụ đề thành video (MoviePy)
- Upload lên YouTube qua Selenium

**Cách sử dụng:**

1. Chọn **menu chính → 1. YouTube Shorts Automater**.
2. Nếu chưa có tài khoản nào → nhập thông tin:
   - Nickname cho tài khoản
   - Đường dẫn Firefox profile
   - Niche (lĩnh vực kênh): ví dụ `"công nghệ"`, `"nấu ăn"`, `"tài chính"`
   - Ngôn ngữ: `"Vietnamese"`, `"English"`, v.v.
3. Sau đó hiển thị sub-menu:
   ```
   1. Generate & Upload Video
   2. View Generated Videos
   3. Set Up CRON Job
   4. Back
   ```

**Quy trình tạo video chi tiết:**

1. **Chọn niche** → LLM tạo 1 chủ đề cụ thể dựa trên niche.
2. **Tạo script** → LLM viết script gồm N câu (theo `script_sentence_length`).
3. **Tạo metadata** → LLM tạo title và description.
4. **Tạo ảnh** → Gemini tạo ảnh cho mỗi phần của script.
5. **TTS** → KittenTTS chuyển script thành file WAV.
6. **Phụ đề** → Dùng faster-whisper hoặc AssemblyAI tạo SRT.
7. **Ghép video** → MoviePy ghép ảnh + audio + phụ đề thành MP4.
8. **Upload** → Selenium điều khiển YouTube Studio để upload.

**Cấu hình cần thiết:**

```json
{
  "firefox_profile": "/path/to/firefox/profile",
  "nanobanana2_api_key": "GEMINI_KEY",
  "tts_voice": "Jasper",
  "is_for_kids": false,
  "script_sentence_length": 4
}
```

---

### 8.2 Twitter Bot

**Chức năng:** Tạo và đăng tweet tự động dựa trên chủ đề (topic).

**Cách sử dụng:**

1. Chọn **menu chính → 2. Twitter Bot**.
2. Thêm tài khoản (nếu chưa có):
   - Nickname tài khoản
   - Firefox profile path
   - Topic: ví dụ `"AI news"`, `"cooking tips"`
3. Sub-menu:
   ```
   1. Post a Tweet
   2. View Posts
   3. Set Up CRON Job
   4. Back
   ```

**Quy trình đăng tweet:**
- LLM tạo tweet 2 câu về topic đã chọn
- Selenium điền nội dung và nhấn Post trên x.com

**Cấu hình cần thiết:**

```json
{
  "firefox_profile": "/path/to/firefox/profile",
  "twitter_language": "English"
}
```

---

### 8.3 Affiliate Marketing

**Chức năng:** Scrape thông tin sản phẩm Amazon → LLM tạo pitch tiếp thị → đăng lên Twitter.

**Cách sử dụng:**

1. Chọn **menu chính → 3. Affiliate Marketing**.
2. Nhập:
   - Affiliate link Amazon
   - Twitter Account UUID (lấy từ menu Twitter)
3. App sẽ:
   - Mở Amazon bằng Selenium
   - Scrape tên sản phẩm + features
   - LLM tạo pitch
   - Đăng pitch lên Twitter qua class Twitter

**Cấu hình cần thiết:**

```json
{
  "firefox_profile": "/path/to/firefox/profile"
}
```

> **Lưu ý:** Cần có tài khoản Twitter đã cấu hình trước đó để chọn UUID.

---

### 8.4 Outreach (Tiếp Cận Doanh Nghiệp)

**Chức năng:** Tìm doanh nghiệp trên Google Maps → thu thập email → gửi email tiếp cận hàng loạt.

**Yêu cầu:**
- Go phải được cài đặt (để build Google Maps scraper)
- Cấu hình email SMTP trong `config.json`

**Cách sử dụng:**

1. Chọn **menu chính → 4. Outreach**.
2. Điền thông tin trong `config.json`:
   ```json
   {
     "google_maps_scraper_niche": "nhà hàng ở TP.HCM",
     "outreach_message_subject": "Hợp tác kinh doanh",
     "outreach_message_body_file": "outreach_message.html",
     "scraper_timeout": 300
   }
   ```
3. Tạo file `outreach_message.html` tại thư mục gốc project:
   ```html
   <p>Xin chào {{COMPANY_NAME}},</p>
   <p>Tôi muốn đề xuất một cơ hội hợp tác...</p>
   ```
4. App sẽ:
   - Tải & build Google Maps scraper (Go)
   - Scrape danh sách doanh nghiệp
   - Trích xuất email từ website
   - Gửi email qua SMTP (yagmail)

---

## 9. Lên Lịch Tự Động (CRON)

### 9.1 CRON Trong App (Menu)

Khi đang ở sub-menu của YouTube hoặc Twitter, chọn **"Set Up CRON Job"**:

- **YouTube:** Tải video mỗi ngày (1 lần) hoặc 2 lần/ngày (10:00 và 16:00).
- **Twitter:** Đăng tweet 1 lần/ngày, 2 lần/ngày, hoặc 3 lần/ngày (08:00, 12:00, 18:00).

### 9.2 CRON Từ Bên Ngoài

Chạy trực tiếp bằng command line:

```bash
# Twitter
python src/cron.py twitter <account_uuid> <ollama_model>

# YouTube
python src/cron.py youtube <account_uuid> <ollama_model>
```

Ví dụ:

```bash
python src/cron.py twitter abc123-def456-789 llama3.2:3b
```

Lên lịch bằng crontab (Linux/macOS):

```bash
# Đăng tweet lúc 9h sáng mỗi ngày
0 9 * * * cd /path/to/MoneyPrinterV2 && /path/to/venv/bin/python src/cron.py twitter abc123-def456-789 llama3.2:3b >> /tmp/mpv2.log 2>&1
```

### 9.3 Script Tiện Ích

```bash
# Upload video với chọn account tương tác
bash scripts/upload_video.sh
```

---

## 10. Cấu Trúc Thư Mục & File

```
MoneyPrinterV2/
├── config.json                  # Cấu hình chính (không commit lên git)
├── config.example.json          # Template cấu hình
├── requirements.txt             # Python dependencies
├── .mp/                        # Thư mục cache & file tạm
│   ├── youtube.json             # Cache tài khoản + video YouTube
│   ├── twitter.json             # Cache tài khoản + tweet
│   ├── afm.json                # Cache sản phẩm affiliate
│   └── scraper_results.csv     # Kết quả scrape Outreach
├── Songs/                       # Nhạc nền cho video (auto-download)
├── fonts/                       # Font cho phụ đề video
├── src/
│   ├── main.py                  # Entry point chính (menu tương tác)
│   ├── cron.py                  # Entry point cho headless/CRON
│   ├── config.py                # Hàm đọc config từ JSON (re-read mỗi lần)
│   ├── cache.py                 # Đọc/ghi file cache JSON
│   ├── llm_provider.py         # Wrapper Ollama (list/select/generate)
│   ├── utils.py                 # Tiện ích (fetch_songs, rem_temp_files...)
│   ├── constants.py             # Menu strings, Selenium selectors
│   ├── art.py                   # Banner ASCII
│   ├── status.py                # Hàm in log (info, success, error...)
│   └── classes/
│       ├── YouTube.py           # Pipeline YouTube Shorts
│       ├── Twitter.py           # Selenium Twitter automation
│       ├── AFM.py               # Amazon scraping + pitch
│       ├── Outreach.py          # Google Maps scraper + SMTP
│       └── Tts.py               # KittenTTS wrapper
├── scripts/
│   ├── setup_local.sh           # Script setup tự động (macOS/Linux)
│   ├── preflight_local.py       # Kiểm tra dependencies
│   └── upload_video.sh          # Upload video tương tác
└── docs/
    ├── doc_vn.md                # (file này)
    ├── Configuration.md
    ├── YouTube.md
    ├── TwitterBot.md
    ├── AffiliateMarketing.md
    └── Roadmap.md
```

**Quy tắc quan trọng:** Luôn chạy từ thư mục gốc của project (`python src/main.py`), vì `ROOT_DIR` được tính từ `sys.path[0]` và import sử dụng bare module names (`from config import *`).

---

## 11. Giải Quyết Sự Cố

### Lỗi "Firefox profile does not exist"

- Kiểm tra đường dẫn trong `config.json`.
- Đảm bảo đường dẫn không có dấu `~` (thay bằng `/home/user` hoặc `C:\Users\user`).

### Lỗi "Could not connect to Ollama"

- Đảm bảo Ollama đang chạy: `ollama serve`
- Kiểm tra `ollama_base_url` trong `config.json` (mặc định: `http://127.0.0.1:11434`)

### Lỗi "No models found on Ollama"

```bash
ollama pull llama3.2:3b
ollama list
```

### Lỗi MoviePy / ImageMagick

- Cài ImageMagick từ https://imagemagick.org
- Đặt đúng đường dẫn trong `imagemagick_path`
- Trên Windows: đường dẫn đến `magick.exe`, ví dụ: `C:\Program Files\ImageMagick-7.1.0-Q16\magick.exe`

### Lỗi "Permission denied" khi gửi email

- Với Gmail: cần tạo App Password tại https://myaccount.google.com/apppasswords
- Dùng App Password thay vì mật khẩu thường trong `config.json`

### Lỗi Selenium / WebDriver

```bash
# Cài lại GeckoDriver
pip install --upgrade webdriver-manager
```

### File .mp/ không được tạo

- Chạy `python src/main.py` từ thư mục gốc của project.
- Kiểm tra quyền ghi trong thư mục project.

### Preflight thất bại

- Đọc kỹ output của `python scripts/preflight_local.py`.
- Mỗi mục thất bại hiển thị lý do cụ thể.
- Sửa lỗi → chạy preflight lại → đến khi pass.

---

## Tóm Tắt Nhanh

| Bước | Lệnh |
|---|---|
| Setup lần đầu | `cp config.example.json config.json` → điền config |
| Cài Ollama | `ollama pull llama3.2:3b` |
| Kiểm tra | `python scripts/preflight_local.py` |
| Chạy app | `python src/main.py` |
| CRON ngoài | `python src/cron.py twitter <uuid> <model>` |
