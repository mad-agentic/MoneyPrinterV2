# MoneyPrinterV2 — Web Hub Frontend

Giao diện web dashboard cho MoneyPrinterV2, kết nối tới FastAPI backend để điều khiển các pipeline tự động (YouTube Shorts, Twitter, Affiliate, Outreach) từ trình duyệt.

## Tech Stack

| Layer        | Technology                                          |
| ------------ | --------------------------------------------------- |
| Framework    | React 19 + TypeScript 5.9                           |
| Build Tool   | Vite 8                                              |
| Styling      | Tailwind CSS 4 (plugin `@tailwindcss/vite`)         |
| Icons        | Lucide React                                        |
| Lint         | ESLint 9 + typescript-eslint + react-hooks/refresh   |
| Target       | ES2023, modern browsers                             |

## Cấu trúc thư mục

```
frontend/
├── index.html              # HTML entry — mount #root
├── vite.config.ts           # Vite + React + Tailwind plugins
├── tsconfig.json            # References app & node tsconfigs
├── tsconfig.app.json        # Strict TS config cho src/
├── tsconfig.node.json       # TS config cho vite.config.ts
├── eslint.config.js         # Flat ESLint config
├── package.json
├── public/                  # Static assets (favicon, etc.)
└── src/
    ├── main.tsx             # React root render (StrictMode)
    ├── App.tsx              # Single-file app component (toàn bộ UI)
    ├── App.css              # Legacy CSS (hero layout, counter)
    └── index.css            # Tailwind imports + design tokens + glass components
```

## Kiến trúc UI

Toàn bộ giao diện nằm trong `src/App.tsx` dạng single-file, bao gồm:

### Layout chính

| Vùng               | Mô tả                                                                 |
| ------------------- | ---------------------------------------------------------------------- |
| **Sidebar** (trái)  | Logo, navigation tabs (YouTube / Twitter / Affiliate / Outreach), session selector, connection status |
| **Left Pane** (giữa) | Workspace area — hiện tại chỉ YouTube workspace active, các tab khác hiển thị placeholder |
| **Right Pane** (phải) | Media Engine (gallery preview 9:16) + Live Console (SSE log stream)   |

### Components nội bộ

| Component            | Chức năng                                                  |
| -------------------- | ---------------------------------------------------------- |
| `App`                | Root — quản lý state, SSE log stream, gallery polling      |
| `YouTubeWorkspace`   | Form cấu hình video (subject, script), chọn channel, trigger generate |
| `SessionItem`        | Sidebar item cho session — click chọn, inline rename       |
| `NavItem`            | Sidebar navigation button với color theming                |
| `PremiumCard`        | Glass-morphism card wrapper                                |
| `NeonButton`         | CTA button với gradient hover effect                       |

### Design System

- **Theme**: Dark space (`#020617` / `#050508`) với cyan/purple accent
- **Glass-morphism**: `backdrop-blur-xl`, semi-transparent borders
- **CSS Variables**: Định nghĩa trong `index.css` (`--brand-cyan`, `--brand-purple`, `--bg-glass`, v.v.)
- **Component classes**: `.glass-panel`, `.nav-item`, `.btn-premium`, `.premium-card`
- **Animations**: `animate-fade-in-up`, pulse indicators, spin loader

## Kết nối Backend

Frontend giao tiếp với FastAPI backend qua:

| Endpoint                              | Method  | Mô tả                              |
| ------------------------------------- | ------- | ----------------------------------- |
| `GET /system/status`                  | Fetch   | Trạng thái hệ thống, options        |
| `GET /system/logs/stream`             | SSE     | Real-time log stream                |
| `GET /system/gallery?session_id=`     | Polling | Danh sách media files (1.5s interval)|
| `GET /system/sessions`                | Polling | Danh sách sessions                  |
| `PATCH /system/sessions/:id/rename`   | Fetch   | Đổi tên session                     |
| `GET /accounts/youtube`               | Fetch   | Danh sách YouTube accounts          |
| `POST /youtube/:id/generate`          | Fetch   | Trigger video generation pipeline   |

**API Base URL**: `http://127.0.0.1:15001` (hardcoded trong `App.tsx`)

## Quick Start

### Yêu cầu

- Node.js >= 18
- Backend API đang chạy trên port `15001`

### Cài đặt & chạy riêng lẻ

```bash
cd frontend
npm install
npm run dev          # → http://localhost:5174
```

### Chạy cùng Backend (khuyến nghị)

Từ thư mục gốc project, chạy:

```bat
start_hub.bat
```

Script này tự động khởi động cả Backend (port 15001) và Frontend (port 5174).

## Scripts

| Command            | Mô tả                                              |
| ------------------ | --------------------------------------------------- |
| `npm run dev`      | Khởi động dev server với HMR                        |
| `npm run build`    | Type-check (`tsc -b`) + build production bundle      |
| `npm run lint`     | Chạy ESLint trên toàn bộ source                     |
| `npm run preview`  | Preview production build locally                     |

## Ghi chú phát triển

- **Single-file architecture**: Hiện tại toàn bộ UI nằm trong `App.tsx`. Khi mở rộng, nên tách components ra `src/components/`, tách API calls ra `src/api/`, và tách types ra `src/types/`.
- **No routing**: App là SPA đơn trang, chuyển tab bằng state (`activeTab`). Nếu cần deep linking, thêm `react-router-dom`.
- **No state management library**: Dùng `useState` / `useEffect` trực tiếp. Khi phức tạp hơn, cân nhắc Zustand hoặc React Context.
- **API URL hardcoded**: Nên chuyển sang biến môi trường `VITE_API_URL` cho production.
- **Polling interval**: Gallery + sessions polling mỗi 1.5s. Cân nhắc chuyển sang WebSocket nếu cần real-time hơn.
- **CORS**: Backend cho phép `allow_origins=["*"]` — chỉ phù hợp cho development.
