# API

`POST /api/aichat` nhận `message` (bắt buộc), `history` (tối đa 10 lượt gần nhất, mỗi lượt có `role: "user" | "assistant" | "model"` và `text`), và `customer` tùy chọn gồm `destination`, `duration`, `budget`, `budget_basis` (`per_person` hoặc `total`), `party_size`, `travel_date`, `interests`. API trả `{ "success": true, "reply": "..." }`. Cần cấu hình `OPENROUTER_API_KEY` trong môi trường server; endpoint dùng router `openrouter/free` để chọn trong các model miễn phí có sẵn. Các model miễn phí vẫn có thể bị giới hạn lượt hoặc tạm thời không khả dụng. Lịch sử và ngữ cảnh khách hàng được giới hạn/làm sạch phía server.

Prompt tư vấn yêu cầu câu trả lời thông thường tối đa khoảng 80 từ, kết luận ngân sách trước, không tự giả định điểm xuất phát/ngày đi, không trình bày giá ước tính như giá đã xác minh và kết thúc bằng tối đa một gợi ý bước tiếp theo phù hợp. Yêu cầu lịch trình chi tiết được trả lời theo ngày và có thể dài hơn.

API nạp tour đang hoạt động từ `data/tours.json` vào ngữ cảnh AI. AI chỉ được giới thiệu tour trong catalog; giá là giá tham khảo, còn thiếu ngày khởi hành / nhóm khách phù hợp / dịch vụ không bao gồm thì phải nói là chưa có dữ liệu và cần xác nhận, không tự suy diễn. Các trường bổ sung tùy chọn cho mỗi tour: `departures` (mảng ngày/trạng thái), `suitable_for` (mảng), `excluded_services` (mảng).

Sau câu trả lời AI, khách có thể xem danh sách tour để chọn một hành trình phù hợp. Chatbot không gửi yêu cầu tư vấn hoặc điền form thay khách.

`POST /api/leads` chỉ nhận yêu cầu có `booking_request: true`, cùng header `Idempotency-Key` (UUID) và các tham số marketing `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` khi có. Yêu cầu phải có email, tour đang hoạt động, ngày đi hợp lệ trong tương lai, số khách và `consent_to_contact: true`; API xác thực lại tour và lấy giá/điểm đến/thời lượng từ catalog. Các trường `phone`, `zalo_phone`, `source`, `voucher_code`, `voucher_status`, `voucher_channel` được lưu nếu có. Payload không phải booking bị từ chối.

Nút **Đặt tour** từ tour đang hoạt động mở form yêu cầu đặt với email, ngày đi, số khách và tour bắt buộc. Gửi thành công lưu một lead có `lead_source = "booking_form"` và `lead_status = "NEW"`; API lấy tên tour, điểm đến, thời lượng và giá tham khảo từ catalog, không tin các giá trị này từ trình duyệt. Yêu cầu chưa giữ chỗ: Sales nhận thông báo ngay, còn email xác nhận đặt tour cho khách chỉ gửi khi Sales chuyển trạng thái sang `BOOKED`. Chạy `docs/supabase-schema.sql` để thêm trạng thái và số lần retry email booking. Xem luồng webhook tại [n8n-workflow.md](./n8n-workflow.md).

## Visitor ẩn danh và UTM

Trang chủ và trang AI planner ghi nhận lượt truy cập bằng UUID lưu trên trình duyệt, hết hạn sau 7 ngày không truy cập; gửi event `visit` khi mở trang và `ai_used` khi AI trả lời thành công. Không gửi IP, nội dung hội thoại hoặc dữ liệu liên hệ. UTM được giữ trong phiên tab để nối nguồn vào lead. Các event xem chi tiết tour, xem giá, lưu tour, click tư vấn, thời gian hoạt động trên 2 phút và quay lại chỉ được gửi khi khách chọn đồng ý theo dõi hành vi tùy chọn. Các source quảng cáo `facebook`, `tiktok`, `instagram` được tách riêng; thiếu UTM là `direct`, source khác được nhóm `other`.

Điểm visitor: tối đa 3 lượt xem tour × 5; xem giá +10; ở lại quá 2 phút +5; quay lại +10; lưu tour +10; mở khu vực đặt tour +15; dùng AI +15; phone +10; ngày đi trong 90 ngày +15; có ngân sách +10; chọn tour +10; nhóm nhiều hơn một khách +5. HOT từ 70, WARM từ 40 đến 69; dùng AI ít nhất một lần cũng được xếp WARM dù điểm thấp hơn 40; còn lại COLD. Booking đã gửi form có funnel priority `HIGH`, độc lập với nhiệt độ hành vi. Chạy `docs/supabase-schema.sql` để tạo bảng `website_visitors`, RPC ghi nhận và RPC tổng hợp. `GET /api/kpi` tổng hợp traffic theo funnel priority, nhiệt độ visitor và UTM source.

UTM landing links:

```text
https://martech-app.vercel.app/?utm_source=facebook&utm_medium=paid_social&utm_campaign=summer_sale
https://martech-app.vercel.app/?utm_source=tiktok&utm_medium=paid_social&utm_campaign=summer_sale
https://martech-app.vercel.app/?utm_source=instagram&utm_medium=paid_social&utm_campaign=summer_sale
```

Chạy migration ở `docs/supabase-schema.sql` để thêm `score_signals`, `customer_segment`, `customer_traits`. Response thành công gồm `lead_id` và `notification_status`.

Ví dụ payload lead hoàn chỉnh:

```json
{
  "booking_request": true,
  "selected_tour_id": "da-nang-hoi-an",
  "name": "Nguyễn Văn A",
  "email": "nguyenvana@gmail.com",
  "phone": "0909123456",
  "zalo_phone": "0909123456",
  "destination": "Đà Nẵng - Hội An",
  "duration": 3,
  "budget": 5000000,
  "party_size": 2,
  "travel_date": "2026-12-10",
  "interests": ["Ẩm thực", "Thiên nhiên"],
  "consent_to_contact": true,
  "utm_source": "facebook",
  "utm_medium": "organic_post",
  "utm_campaign": "danang_hoian",
  "source": "facebook",
  "voucher_code": "DNH-10P-2026",
  "voucher_status": "PENDING",
  "voucher_channel": "email"
}
```

Ví dụ local:

```bash
curl -X POST http://localhost:3000/api/aichat -H "Content-Type: application/json" -d "{\"message\":\"Mình muốn đi biển cuối tuần\",\"customer\":{\"destination\":\"Đà Nẵng\",\"party_size\":2,\"interests\":[\"Ẩm thực\"]}}"
```

Không gửi PII vào `/api/aichat`. API không bịa giá hoặc tình trạng tour; cần xác nhận với VietJourney nếu chưa có dữ liệu. Lỗi API trả thông báo an toàn, không có stack trace.

## UTM tracking và CRM

- Frontend đọc và giữ trạng thái UTM trong `sessionStorage` trong suốt quá trình đặt tour.
- Khi khách hàng gửi lead, payload bao gồm `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` nếu có.
- Máy chủ hợp lệ hóa và lưu chúng vào Supabase khi cột tồn tại; nếu không, hãy dùng migration trong `docs/supabase-schema.sql`.
- Ngoài UTM, hệ thống còn lưu `source`, `lead_score`, `lead_level`, `score_signals`, `customer_segment`, `customer_traits`, `voucher_code`, `voucher_status`, `voucher_channel` để n8n và Google Sheets phân loại khách, gửi voucher và báo hiệu cho Sales.
- `source` thường là `facebook`, `tiktok`, `google`, `website`, `instagram` tùy kênh marketing.

## n8n workflow gợi ý

1. Workflow booking dùng Webhook `POST /webhook/vietjourney-booking`; backend chỉ gửi form booking sau khi lưu yêu cầu.
2. Webhook kiểm tra `X-Automation-Secret` và chuẩn hóa `$json.body ?? $json` trước khi đọc payload.
3. Workflow dùng `lead_score`, `lead_level`, `customer_segment` đã tính ở server; email Sales dùng `booking_price_per_person` từ catalog.
4. Workflow gửi email Sales ngay khi khách gửi yêu cầu. Khi Sales chuyển booking sang `BOOKED` qua `/api/lead-status`, backend gọi webhook lại với `booking_event: "sales_confirmed"` để gửi email khách. Hai nhánh xác nhận riêng bằng `sales_email_sent` và `customer_email_sent`.

Ví dụ JSON để n8n nhận:

```json
{
  "lead_id": "b1d8f26c-...",
  "booking_request": true,
  "selected_tour_id": "da-nang-hoi-an",
  "name": "Nguyễn Văn A",
  "email": "nguyenvana@gmail.com",
  "phone": "0909123456",
  "destination": "Đà Nẵng - Hội An",
  "budget": 5000000,
  "utm_source": "facebook",
  "utm_medium": "organic_post",
  "utm_campaign": "danang_hoian",
  "customer_segment": "resort",
  "customer_traits": ["resort"],
  "lead_score": 55,
  "lead_level": "WARM",
  "voucher_code": "DNH-10P-2026",
  "voucher_channel": "email"
}
```

Dashboard tại [dashboard.html](../dashboard.html) gọi `GET /api/kpi` để hiển thị KPI traffic và lead tổng hợp; endpoint này không trả thông tin liên hệ. Khu **Xác nhận booking** yêu cầu mã Sales và hiển thị tối đa 100 yêu cầu gần nhất; `GET /api/sales-bookings` chỉ trả dữ liệu liên hệ khi `X-Sales-Secret` hợp lệ. Sales dùng nút chuyển trạng thái lần lượt NEW → CONTACTED → QUOTED → BOOKED; bước cuối gửi email cho khách. Mã Sales chỉ được giữ trong bộ nhớ của trang hiện tại, không lưu vào browser storage. Dashboard chưa hiển thị doanh thu hoặc chi phí quảng cáo; CSV chỉ chứa số liệu KPI tổng hợp.

## v2: vòng đời booking, retry và KPI

`POST /api/leads` giờ tự chống trùng booking: nếu cùng số liên hệ, điểm đến, tour và ngày đi đã có booking trong 24 giờ, API trả `200` với `duplicate: true` và lead_id cũ, không tạo bản ghi mới và không gửi lại thông báo cho Sales. Booking mới luôn bắt đầu ở `lead_status = NEW`; `lead_level` là điểm HOT/WARM/COLD.

`POST /api/lead-status` dành cho Sales. Yêu cầu header `X-Sales-Secret` khớp với `SALES_UPDATE_SECRET`. Body: `{ "lead_id": "...", "lead_status": "CONTACTED", "sales_note": "tùy chọn" }`. Trạng thái hợp lệ: NEW, CONTACTED, QUOTED, BOOKED, LOST. Luồng cho phép: NEW→CONTACTED/LOST; CONTACTED→QUOTED/LOST; QUOTED→BOOKED/LOST/CONTACTED; LOST→CONTACTED; BOOKED là trạng thái cuối. Chuyển sai luật trả `409`. Cập nhật có điều kiện trên trạng thái đã đọc, nên hai người sửa cùng lúc sẽ không ghi đè nhau.

`GET /api/retry-notifications` được Vercel Cron gọi theo lịch trong `vercel.json` và bảo vệ bằng `CRON_SECRET`. Job lấy tối đa 20 booking có `notification_status` là PENDING hoặc FAILED, cũ hơn 2 phút và chưa vượt 5 lần thử. Mỗi booking được nhận bằng một lần cập nhật có điều kiện trên `notification_attempts` để các lần chạy chồng nhau không gửi trùng. Nếu n8n đã gửi thành công nhưng bước ghi trạng thái về Supabase thất bại, booking vẫn ở PENDING và có thể bị gửi lại; n8n nên dùng `lead_id` để bỏ qua thông báo trùng.

`GET /api/sales-bookings` yêu cầu header `X-Sales-Secret` khớp `SALES_UPDATE_SECRET`; chỉ trả tối đa 100 booking gần nhất và không cache. `POST /api/lead-status` dùng cùng header để cập nhật pipeline; chuyển booking sang `BOOKED` sẽ gửi email khách. Trạng thái xác nhận email lỗi được retry bởi cron.

`GET /api/kpi` trả số liệu tổng hợp ẩn danh của 180 ngày gần nhất: tổng visitor, visitor theo funnel priority LOW/MEDIUM/HIGH, nhiệt độ COLD/WARM/HOT và UTM source, cùng tổng lead theo trạng thái, điểm HOT/WARM/COLD, nguồn UTM và tháng. Không trả thông tin liên hệ. Dashboard dùng endpoint này để hiện dữ liệu khi có kết nối Supabase.

Biến môi trường cần có: `N8N_BOOKING_WEBHOOK_URL` (URL production của workflow đặt tour), `N8N_WEBHOOK_SECRET` (xác thực webhook), `SALES_UPDATE_SECRET` (cập nhật trạng thái), `CRON_SECRET` (job retry). Chạy lại `docs/supabase-schema.sql` để thêm `sales_note`, `notification_attempts`, `last_notification_at`, trạng thái retry email xác nhận booking và các ràng buộc liên quan.

Lưu ý về lịch Cron: gói Hobby của Vercel chỉ cho chạy cron tối đa một lần mỗi ngày, nên `vercel.json` đặt `0 3 * * *`. Nếu nâng lên gói Pro, có thể đổi thành `*/15 * * * *`.
