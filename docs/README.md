# VietJourney — AI Travel Planner

## Chạy local

1. `npm install`
2. Sao chép `.env.example` thành `.env.local`, điền biến môi trường.
3. Thêm dữ liệu tour chính thức vào `data/tours.json` (xem schema bên dưới).
4. `npm run dev`

Tour chỉ hiển thị khi `tour_status` là `active`. Catalog hiện có 10 tour mẫu đang hoạt động; các tour còn lại được giữ ở trạng thái `draft`. Giá, ngày khởi hành, nhóm khách phù hợp, dịch vụ và lịch trình trong catalog đều là dữ liệu minh họa, cần xác nhận với đơn vị vận hành trước khi dùng làm thông tin bán chính thức. Mỗi tour có `departures`, `suitable_for`, `included_services` và `excluded_services`. Giá trên website hiển thị theo dạng `2,000,000 đồng` mỗi người.

```json
[{"id":"official-id","name":"Tên tour chính thức","destination":"Điểm đến","duration":"3 ngày 2 đêm","price_per_person":5000000,"currency":"VND","tour_status":"active","image":"https://...","overview":"Mô tả hành trình","departures":[{"date":"2027-01-10","status":"Lịch mẫu - cần xác nhận"}],"suitable_for":["Nhóm khách phù hợp"],"included_services":["..."],"excluded_services":["..."],"highlights":["..."],"experience_type":["Thiên nhiên"],"itinerary":[{"day":"Ngày 1","title":"Tên ngày","activities":["Hoạt động tham khảo"]}]}]
```

## Dashboard KPI demo

Mở [Dashboard KPI](../dashboard.html) để xem funnel visitor/booking thực tế và KPI 6 tháng giả lập. Nút tải CSV tạo file có thể mở bằng Excel; giả định về conversion, CAC và LTV được ghi trực tiếp trên trang và trong file.

`automation/demo_leads_seed.sql` chỉ dành cho Supabase staging để trình diễn dữ liệu CRM giả lập. Không chạy trong production: các hàng này dùng chung bảng `leads` nhưng `/api/kpi` chủ động loại `request_id` có tiền tố `DEMO-` khỏi KPI operational. Chúng không được trộn với kịch bản conversion/CAC/LTV ở `data/kpi-assumptions.json`. Có thể xóa riêng batch demo theo `request_id like 'DEMO-20261108-%'` trong môi trường staging.

## Deploy Vercel

Đẩy repository lên Git, import vào Vercel, đặt toàn bộ variables trong Project Settings → Environment Variables, rồi deploy. Dùng `APP_ORIGIN` là URL production; API cũng chấp nhận domain của deployment hiện tại do Vercel cung cấp để các preview deployment hoạt động. Chạy `docs/supabase-schema.sql` để cập nhật schema visitor funnel trước khi dùng dashboard KPI.

## Giới hạn vận hành

Rate limit trong memory là biện pháp cơ bản và không chia sẻ giữa serverless instances. Production cần WAF/rate limiting tập trung, logging, monitoring, chính sách retention PII và cơ chế retry lead PENDING.
