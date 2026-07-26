# Telegram Work Bot (44h/week KPI)
backend : supabase
fe: dashboard.render.com


Telegram bot time-tracking cho check-in/check-out, theo KPI 44h/tuan, co burn-down, report theo ngay/tuan/thang, nhac quen checkout, va nhap gio thu cong.

Version: **1.6.2**

## Stack

- Node.js + TypeScript
- Telegraf + Express
- PostgreSQL (Supabase compatible) / Supabase JS SDK
- node-cron
- Docker + Fly.io / Render

## Features

- **Silent Visitor Tracking System**:
  - Tự động đếm lượt truy cập web (Hôm nay, Tháng này, Tổng số).
  - Định danh máy/thiết bị qua `visitor_id` (persistent `localStorage`).
  - Chống spam 30s/IP & phân biệt phiên qua `sessionStorage`.
  - Hỗ trợ cả 2 chế độ kết nối: PostgreSQL `DATABASE_URL` hoặc Supabase Client (`SUPABASE_URL` + `SUPABASE_ANON_KEY`).
- Reply keyboard:
  - `📋 Chấm công` (nut duy nhat)
    - Lan dau trong ngay = **Check-in** (tao session OPEN)
    - Lan 2 = **Check-out** (dong session → CLOSED)
    - Lan 3+ = **Cap nhat checkout** (ghi de `end_time`, tinh lai duration)
- 1 user chi co toi da 1 session `OPEN` (partial unique index trong DB).
- Check-out tinh thoi luong session, tong hom nay, tong tuan, con thieu KPI.
  - Tu dong tru 1h nghi trua khi ca > 4 tieng.
- Cross-day guard: neu session OPEN tu ngay hom truoc chua close (scheduler miss), lan cham cong hom nay se tu dong dong session cu tai 23:59 truoc khi tao session moi.
- Burn-down report luc `17:30` (Thu 2 -> Thu 6) + progress bar.
  - **Tinh luon session dang mo**: neu dang check-in ma chua check-out, thoi gian tu luc check-in den hien tai se duoc cong vao bao cao.
  - Daily minimum floor: luon hien thi toi thieu 8h/ngay bat ke tien do tuan.
- KPI warning moi 5 phut khi gan moc `43h50` (Tu Thu 2 -> Thu 7, khong gui Chu Nhat).
  - Tinh ca thoi gian session dang mo.
- **Target-met notification**: Khi dang check-in va tong gio tuan (bao gom session dang mo) dat du 44h, bot se tu dong gui thong bao chuc mung. Moi tuan chi gui 1 lan. Chay moi 5 phut (Thu 2 -> Thu 7).
- Nhac quen checkout luc `23:59` (Thu 2 -> Thu 7): tu dong close session tai 23:59, gui thong bao.
- Manual hours:
  - Nhap so gio truc tiep (vi du `8`, `8.5`) de dong session dang mo.
  - `/add` interactive flow: chon ngay T2-T7 → chon mode (nhap lien 2 moc gio hoac tach gio/phut) → nhap thoi gian.
  - `/add YYYY-MM-DD 830 1730` (shorthand).
  - Quick time presets: `08:00 17:00`, `08:30 17:30`, v.v.
- Xoa log theo ngay:
  - `/del` hoac `/delete` (chon T2-T7 roi xoa toan bo sessions cua ngay do).
- Bao cao nhanh:
  - `/today` — tong gio hom nay (bao gom session dang mo).
  - `/week` — bao cao tuan hien tai voi burndown strategy.
  - `/week YYYY-MM-DD` — bao cao tuan chua ngay chi dinh.
  - `/month` — bao cao thang voi average/ngay va breakdown theo tuan.
- Summary scheduler:
  - `Sun 21:00`: weekly summary
  - `21:05` ngay cuoi thang: monthly summary
- Admin reset data:
  - `/resetall CONFIRM` (chi user nam trong `ADMIN_TELEGRAM_IDS`)
- User self-stop:
  - `/stop` hoac `/stopme` — bot hoi Yes/No bang inline keyboard. Xac nhan se xoa toan bo sessions + state cua user va deactivate.

## Environment

Copy `.env.example` thanh `.env`:

```env
BOT_TOKEN=...
DATABASE_URL=... (Tuy chon nếu dùng Supabase SDK)
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_ANON_KEY=your-anon-key
TIMEZONE=Asia/Ho_Chi_Minh
PORT=3000
# WEBHOOK_URL=https://your-app.fly.dev
# KEEP_AWAKE_URL=https://your-app.fly.dev/health
LOG_LEVEL=info
NODE_ENV=production
```ODE_ENV=production
```

## Local Run

```bash
npm install
npm run db:init
npm run dev
```

- Neu co `WEBHOOK_URL`: bot dung webhook qua `POST /telegram/webhook`.
- Neu khong co `WEBHOOK_URL`: bot dung long polling.

## Build & Start

```bash
npm run typecheck
npm run build
npm run start
```

## Database Schema

Schema: [src/db/schema.sql](/d:/Development/Workspace/Python_Projects/telegram_ci_co/src/db/schema.sql)

Bang chinh:

- `users`
- `work_sessions`
- `user_state`

## Scheduler Cron

| Scheduler | Cron | Ngay chay |
|---|---|---|
| Burn-down | `30 17 * * 1-5` | Thu 2 -> Thu 6 |
| Forgot checkout | `59 23 * * 1-6` | Thu 2 -> Thu 7 |
| KPI warning | `*/5 * * * 1-6` | Thu 2 -> Thu 7 |
| Target-met | `*/5 * * * 1-6` | Thu 2 -> Thu 7 |
| Weekly summary | `0 21 * * 0` | Chu Nhat |
| Monthly summary | `5 21 * * *` | Ngay cuoi thang |
| Keep awake | `*/14 * * * *` | Moi ngay (optional) |

## Deploy Fly.io

```bash
fly launch
fly secrets set BOT_TOKEN=... DATABASE_URL=... TIMEZONE=Asia/Ho_Chi_Minh WEBHOOK_URL=https://<your-app>.fly.dev
fly deploy
```

Health check: `GET /health`

## REST API (Auto Check-in via MacroDroid)

Bot co REST API de trigger check-in/check-out tu ben ngoai (vi du: MacroDroid tren Android).

### Setup

1. Set `API_SECRET` trong env (bat buoc):
   ```env
   API_SECRET=your-random-secret-key
   ```

2. Cai **MacroDroid** (free, nhe nhat, ~15MB, khong ton pin):
   - Play Store: [MacroDroid](https://play.google.com/store/apps/details?id=com.arlosoft.macrodroid)

3. Tao Macro trong MacroDroid:
   - **Trigger**: Application Launched → chon app cham cong cong ty
   - **Action**: HTTP Request
     - Method: `POST`
     - URL: `https://your-bot-url/api/checkin`
     - Header: `x-api-key: YOUR_API_SECRET`
     - Body: `{"telegram_id": YOUR_TELEGRAM_ID}`
     - Content-Type: `application/json`

4. (Optional) Tao them macro check-out:
   - **Trigger**: Application Closed → chon app cham cong
   - **Action**: tuong tu nhung URL la `/api/checkout`

### API Endpoints

| Method | Endpoint | Mo ta |
|---|---|---|
| POST | `/api/checkin` | Check-in, gui xac nhan qua Telegram |
| POST | `/api/checkout` | Check-out, gui bao cao qua Telegram |
| POST | `/api/status` | Kiem tra trang thai (working/idle) |

Headers: `x-api-key: <API_SECRET>`, `Content-Type: application/json`
Body: `{ "telegram_id": 123456789 }`

### Test bang curl

```bash
curl -X POST https://your-bot/api/checkin \
  -H "Content-Type: application/json" \
  -H "x-api-key: YOUR_SECRET" \
  -d '{"telegram_id": YOUR_TELEGRAM_ID}'
```

## Web Dashboard

Truy cap `http://your-server/` (root URL) de mo dashboard cham cong tren web.

**Tinh nang:**
- Nhap gio check-in / check-out cho tung ngay (T2 → T7)
- Tu dong tru 1h nghi trua khi ca > 4 tieng
- Hien thi tong gio tuan, progress bar, burndown strategy
- Bao cao tuan: radial progress ring, heatmap, streak, insight card
- Luu du lieu bang localStorage (scope: 1 tuan, tu dong reset khi sang tuan moi)
- Dark mode, responsive, khong can dang nhap

**Luu y:** Dashboard hoat dong doc lap voi bot Telegram. Du lieu luu tren trinh duyet cua nguoi dung, khong dong bo voi database PostgreSQL.

## Changelog

### v1.6.1 — 2026-05-07

- **Bugfix**: `getWorkdaysLeft()` sai — Saturday (T7) bi tinh la 1 ngay con lai thay vi dem dung. Da fix: dem workdays (T2-T7) tu hom nay den cuoi tuan.
- **Report Redesign**: Thay bar chart cu bang premium analytics dashboard: SVG radial progress ring, heatmap-style day blocks (heat intensity theo gio lam), streak counter, quick stats grid, va insight card voi burndown strategy.

### v1.6.0 — 2026-05-06

- **Web Dashboard**: Them giao dien web cham cong tai root URL `/`. Tinh gio cong theo tuan (44h target), luu localStorage, bao cao tuong tu bot Telegram. Dark mode, responsive, glassmorphism UI.
- **Dockerfile**: Cap nhat de copy `public/` vao Docker image.

### v1.5.1 — 2026-04-25

- **Bugfix**: `addManualSessionForDate()` gio goi `deleteSessionsByDate()` truoc khi insert, tranh tao duplicate sessions cung `work_date` lam `findSessionByWorkDate()` lay sai session.
- **Docs**: Cap nhat README sync voi codebase hien tai (unified attendance button, /del, /stop flow, add flow modes, burndown strategy).

### v1.5.0 — 2026-04-15

- **Unified attendance**: Thay 2 nut Check-in / Check-out bang 1 nut "📋 Cham cong" duy nhat. Lan dau = open, cac lan sau = close/overwrite end_time.
- **Cross-day guard**: Tu dong close session cu o 23:59 neu scheduler miss.
- **Delete flow**: Them `/del` va `/delete` interactive flow (chon T2-T7 xoa sessions theo ngay).
- **Stop flow**: Them `/stop` voi inline keyboard Yes/No thay vi require `/stop CONFIRM`.
- **Add flow modes**: Them 2 mode nhap gio thu cong (nhap lien / tach gio-phut).
- **Daily minimum floor**: Burndown va weekly report luon enforce 8h/ngay toi thieu.

### 2026-03-25

- **REST API auto check-in/check-out**: Them endpoints `POST /api/checkin`, `POST /api/checkout`, `POST /api/status` cho phep trigger tu ben ngoai (MacroDroid). Xac thuc bang `API_SECRET` qua header `x-api-key`. Bot gui xac nhan qua Telegram voi prefix 🤖.

### 2026-03-12

- **Burn-down 17:30 tinh session dang mo**: Bao cao burn-down gio tinh luon thoi gian tu luc check-in den hien tai (tru 1h nghi trua) cho session chua check-out, thay vi chi tinh cac session da dong.
- **Target-met notification**: Them scheduler moi chay moi 5 phut (Thu 2 - Thu 7). Khi user dang check-in va tong gio tuan (da dong + dang mo) >= 44h, bot gui thong bao "Da du 44 tieng". Moi tuan chi gui 1 lan.
- **Khong gui thong bao ngay Chu Nhat**: Cac scheduler forgot-checkout va KPI warning gio chi chay Thu 2 - Thu 7 (cron `1-6`), khong con chay ngay Chu Nhat.
- **KPI warning tinh session dang mo**: Canh bao gan 43h50 gio cung tinh ca thoi gian cua session dang mo.
- DB: Them cot `last_target_met_week_start` vao bang `user_state`.

## Deploy Render (Free Tier) + Keep Awake

1. Deploy web service len Render.
2. Set env vars:
   - `NODE_ENV=production`
   - `BOT_TOKEN`
   - `DATABASE_URL`
   - `TIMEZONE=Asia/Ho_Chi_Minh`
   - `WEBHOOK_URL=https://<your-service>.onrender.com`
3. Ping endpoint:
   - `https://<your-service>.onrender.com/health`
4. Tao monitor tren UptimeRobot/Better Stack:
   - interval `14 minutes`
5. Optional keep-awake ping noi bo:
   - `KEEP_AWAKE_URL=https://<your-service>.onrender.com/health`
6. Set Telegram webhook:

```bash
curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<your-service>.onrender.com/telegram/webhook"
```
