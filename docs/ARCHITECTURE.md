# Kiến trúc dự án VietJourney Martech

## Cấu trúc thư mục

| Thư mục / file | Vai trò | Ghi chú |
|---|---|---|
| `index.html`, `app.js`, `styles.css` | Website khách hàng | Form đặt tour, catalog, chatbot |
| `planner.html`, `planner.js` | AI Travel Planner | Lập lịch trình từ nhu cầu khách |
| `dashboard.html`, `dashboard.js`, `dashboard.css` | Dashboard KPI | Đọc `/api/kpi` và giả định mô phỏng |
| `visitor-tracking.js`, `promo-offers.js` | Theo dõi hành vi và ưu đãi | Chạy trên trình duyệt, có consent |
| `api/` | Serverless endpoint (Vercel) | Chỉ chứa endpoint, không chứa logic dùng chung |
| `lib/` | Logic dùng chung cho API | Chấm điểm, phân loại, n8n, Supabase, planner |
| `data/` | Dữ liệu tĩnh | `tours.json` (catalog), `kpi-assumptions.json` (giả định KPI) |
| `automation/n8n/` | Workflow n8n | Lead capture và booking confirmation (JSON import được) |
| `automation/postman/` | Kiểm thử webhook | Collection gửi lead và booking |
| `tests/` | Test tự động | `npm test` chạy kiểm tra cú pháp và toàn bộ test |
| `docs/` | Tài liệu | Schema, API, kiến trúc, ánh xạ rubric, file Excel mô phỏng |

## Luồng dữ liệu

Website → `api/leads.js` → Supabase (`leads`) → `lib/_notify.js` → n8n webhook → Gmail (khách, sales) → n8n trả `notification_sent` → backend ghi `notification_status`.

Retry: `api/retry-notifications.js` gửi lại lead `PENDING`/`FAILED` (Vercel Cron).

Sales: `api/lead-status.js` chuyển NEW → CONTACTED → QUOTED → BOOKED/LOST, kiểm tra luật chuyển trạng thái.

Đo lường: `api/kpi.js` tổng hợp ẩn danh theo phễu, theo nguồn UTM, và theo nhóm ưu tiên (HOT / WARM / COLD) kèm tỷ lệ chốt (`funnel_by_tier`).

## Hai thang điểm, hai mục đích

- `lead_score` / `lead_level` (HOT/WARM/COLD theo điểm): đo mức **tương tác**. Xem `lib/_scoring.js: scoreLead()`.
- `care_priority` (HOT/WARM/COLD theo ý định): quyết định **thứ tự chăm sóc**. Xem `lib/_scoring.js: careTier()`.

Hai cột dùng cùng nhãn nhưng khác nghĩa. Khi trình bày, luôn nói rõ điều này.

## Vòng học từ kết quả bán hàng

`lib/_outcomes.js` tính tỷ lệ BOOKED theo từng nhóm ưu tiên. Đây là đầu vào để điều chỉnh quy tắc chấm điểm sau này, khi có đủ dữ liệu.

## Nguồn lead

- **Đặt tour** (website): `POST /api/leads` với `booking_request = true`. Phân loại HOT.
- **Lịch trình qua email** (AI Planner): `POST /api/itinerary-capture`. Phân loại COLD, đi vào chuỗi nuôi dưỡng. Đây là điểm thu lead không phải đặt tour, thay cho form tư vấn đã bỏ.

## Nuôi dưỡng lead (nurture)

Chỉ áp dụng cho lead WARM và COLD còn ở trạng thái NEW, có consent, và chưa hủy nhận email. HOT không nuôi dưỡng vì đã vào tay Sales.

- Quy tắc và lịch: `lib/_nurture.js` (`NURTURE_PLAN`, `nextNurtureStep`). COLD có 4 bước (ngày 1, 3, 7, 14). WARM có 2 bước (ngày 1, 5).
- Job: `api/nurture.js`, gọi theo lịch với `CRON_SECRET`. Claim bằng compare-and-set trên `nurture_step`, và lùi lại nếu email không được xác nhận.
- Hủy nhận: link trong mọi email, ký HMAC bằng `NURTURE_SECRET`, xử lý ở `api/optout.js`.
- Đặc tả workflow gửi email: `automation/n8n/README.md`.

## Chất lượng lead

`lib/_outcomes_quality.js` tính tỷ lệ lead đủ điều kiện (HOT + WARM), tỷ lệ đặt tour, tỷ lệ mất, và tỷ lệ còn NEW. Kết quả nằm trong `lead_quality` của `/api/kpi`.

## Giới hạn hiện tại (ghi rõ khi bảo vệ)

- Lead WARM hiện chưa có nguồn: form tư vấn đã bỏ, và đặt tour luôn là HOT. Chỉ lead COLD đến từ lịch trình qua email.
- Workflow n8n trong `automation/n8n/` vẫn rẽ nhánh theo `selected_tour_id`, chưa rẽ theo `care_priority`.
- Chưa có Google Sheets, Schedule nhắc SLA, chuỗi chăm sóc, và voucher.
