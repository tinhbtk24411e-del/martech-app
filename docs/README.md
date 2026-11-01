# VietJourney — AI Travel Planner

## Chạy local

1. `npm install`
2. Sao chép `.env.example` thành `.env.local`, điền biến môi trường.
3. Thêm dữ liệu tour chính thức vào `data/tours.json` (xem schema bên dưới).
4. `npm run dev`

Tour chỉ hiển thị khi `tour_status` là `active`. Không nhập giá/dịch vụ không được phê duyệt.

```json
[{"id":"official-id","name":"Tên tour chính thức","destination":"Điểm đến","duration":"3 ngày 2 đêm","price_per_person":5000000,"currency":"VND","tour_status":"active","image":"https://...","included_services":["..."],"highlights":["..."],"experience_type":["Thiên nhiên"]}]
```

## Deploy Vercel

Đẩy repository lên Git, import vào Vercel, đặt toàn bộ variables trong Project Settings → Environment Variables, rồi deploy. Dùng `APP_ORIGIN` là URL production. Chạy `docs/supabase-schema.sql` trước khi gửi lead.

## Giới hạn vận hành

Rate limit trong memory là biện pháp cơ bản và không chia sẻ giữa serverless instances. Production cần WAF/rate limiting tập trung, logging, monitoring, chính sách retention PII và cơ chế retry lead PENDING.
