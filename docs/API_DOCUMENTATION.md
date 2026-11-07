# API

`POST /api/aichat` nhận `message` (bắt buộc), `history` (tối đa 10 lượt gần nhất, mỗi lượt có `role: "user" | "assistant" | "model"` và `text`), và `customer` tùy chọn gồm `destination`, `duration`, `budget`, `budget_basis` (`per_person` hoặc `total`), `party_size`, `travel_date`, `interests`. API trả `{ "success": true, "reply": "..." }`. Cần cấu hình `OPENROUTER_API_KEY` trong môi trường server; endpoint dùng router `openrouter/free` để chọn trong các model miễn phí có sẵn. Các model miễn phí vẫn có thể bị giới hạn lượt hoặc tạm thời không khả dụng. Lịch sử và ngữ cảnh khách hàng được giới hạn/làm sạch phía server.

Prompt tư vấn yêu cầu câu trả lời thông thường tối đa khoảng 80 từ, kết luận ngân sách trước, không tự giả định điểm xuất phát/ngày đi, không trình bày giá ước tính như giá đã xác minh và kết thúc bằng tối đa một gợi ý bước tiếp theo phù hợp. Yêu cầu lịch trình chi tiết được trả lời theo ngày và có thể dài hơn.

API nạp tour đang hoạt động từ `data/tours.json` vào ngữ cảnh AI. AI chỉ được giới thiệu tour trong catalog; giá là giá tham khảo, còn thiếu ngày khởi hành / nhóm khách phù hợp / dịch vụ không bao gồm thì phải nói là chưa có dữ liệu và cần xác nhận, không tự suy diễn. Các trường bổ sung tùy chọn cho mỗi tour: `departures` (mảng ngày/trạng thái), `suitable_for` (mảng), `excluded_services` (mảng).

Sau câu trả lời AI, nút **Yêu cầu tư vấn hành trình này** chuyển khách tới form và điền bản tóm tắt câu hỏi/đề xuất AI vào `note`, cùng điểm đến, ngày, số người, ngân sách và sở thích nhận diện được. Khách cần kiểm tra/bổ sung họ tên, email hoặc số điện thoại và đồng ý liên hệ. Nội dung AI được gửi cùng lead đến Supabase và webhook n8n trong trường `note`; đây là gợi ý tham khảo, không phải xác nhận tour.

`POST /api/leads` nhận các trường biểu mẫu lead, header `Idempotency-Key` (UUID), và các tham số marketing `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` khi có. Các trường `email`, `phone`, `zalo_phone`, `source`, `voucher_code`, `voucher_status`, `voucher_channel` được lưu nếu có. `consent_to_contact` bắt buộc là `true`; tour được xác thực lại trên server.

Nút **Đặt tour** từ tour đang hoạt động mở form yêu cầu đặt với email, ngày đi, số khách và tour bắt buộc. Gửi thành công lưu một lead có `lead_source = "booking_form"` và `lead_status = "NEW"`; API lấy tên tour, điểm đến, thời lượng và giá tham khảo từ catalog, không tin các giá trị này từ trình duyệt. Yêu cầu chưa giữ chỗ: Sales nhận thông báo ngay, còn email xác nhận đặt tour cho khách chỉ gửi khi Sales chuyển trạng thái sang `BOOKED`. Chạy `docs/supabase-schema.sql` để thêm trạng thái và số lần retry email booking. Xem luồng webhook tại [n8n-workflow.md](./n8n-workflow.md).

Frontend gửi `engagement.tour_views` và `engagement.return_visit` khi khách đồng ý theo dõi hành vi tùy chọn; server tự tính điểm lead (gửi form 35 điểm, chọn tour 20, mỗi lượt xem tối đa 3 lượt × 5, quay lại 10; HOT từ 70, WARM từ 45, còn lại COLD). Giá trị `lead_score` hoặc `lead_level` do client tự gửi không được tin cậy. Trường `lead_priority` là mức funnel riêng: form tư vấn = `HIGH`; không thay thế `lead_level` theo điểm (HOT/WARM/COLD). Phân loại nhu cầu theo sở thích, tour đã chọn và ngân sách thành các nhóm `family`, `budget`, `resort`, `explorer` (có thể có nhiều traits) hoặc `general`. Đây là heuristic minh bạch, không phải kết quả mô hình AI hay thay thế xác nhận của Sales.

## Visitor ẩn danh và UTM

Trang chủ và trang AI planner ghi nhận một phiên tab ẩn danh bằng UUID trong `sessionStorage`; gửi event `visit` khi mở trang và `ai_used` chỉ khi AI trả lời thành công. Không gửi IP, nội dung hội thoại hoặc dữ liệu liên hệ. UTM được giữ trong cùng phiên để nối nguồn vào lead. Các source quảng cáo `facebook`, `tiktok`, `instagram` được tách riêng; thiếu UTM là `direct`, source khác được nhóm `other`.

Quy tắc ưu tiên: chỉ xem web = `LOW`, đã dùng AI = `MEDIUM`, gửi form tư vấn = `HIGH`. Ưu tiên tăng dần và không bị hạ nếu event đến sai thứ tự. Lead lưu `visitor_id` nếu có. Chạy `docs/supabase-schema.sql` để tạo bảng `website_visitors`, cột priority, RPC ghi nhận và RPC tổng hợp server-side. `GET /api/kpi` tổng hợp traffic theo mức ưu tiên và UTM source.

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

1. Workflow tư vấn dùng Webhook `POST /webhook/travel-lead`; workflow booking dùng Webhook riêng `POST /webhook/vietjourney-booking`. Backend chọn workflow theo loại form sau khi lưu lead.
2. Cả hai workflow kiểm tra `X-Automation-Secret` và chuẩn hóa `$json.body ?? $json` trước khi đọc payload.
3. Workflow tư vấn dùng `lead_score`, `lead_level`, `customer_segment` đã tính ở server (không tính lại hoặc tin vào điểm từ browser); workflow booking gửi email riêng cho khách và Sales với `booking_price_per_person` từ catalog.
4. Workflow booking gửi email Sales ngay khi khách gửi yêu cầu. Khi Sales chuyển booking sang `BOOKED` qua `/api/lead-status`, backend gọi webhook lại với `booking_event: "sales_confirmed"` để gửi email khách. Hai nhánh xác nhận riêng bằng `sales_email_sent` và `customer_email_sent`.

Ví dụ JSON để n8n nhận:

```json
{
  "lead_id": "b1d8f26c-...",
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

## v2: vòng đời lead, retry và KPI

`POST /api/leads` giờ tự chống trùng: nếu cùng số liên hệ và cùng điểm đến đã có lead trong 24 giờ, API trả `200` với `duplicate: true` và lead_id cũ, không tạo bản ghi mới và không gửi lại thông báo cho Sales. Lead mới luôn bắt đầu ở `lead_status = NEW`; `lead_priority` là HIGH cho form tư vấn, trong khi `lead_level` vẫn là điểm HOT/WARM/COLD.

`POST /api/lead-status` dành cho Sales. Yêu cầu header `X-Sales-Secret` khớp với `SALES_UPDATE_SECRET`. Body: `{ "lead_id": "...", "lead_status": "CONTACTED", "sales_note": "tùy chọn" }`. Trạng thái hợp lệ: NEW, CONTACTED, QUOTED, BOOKED, LOST. Luồng cho phép: NEW→CONTACTED/LOST; CONTACTED→QUOTED/LOST; QUOTED→BOOKED/LOST/CONTACTED; LOST→CONTACTED; BOOKED là trạng thái cuối. Chuyển sai luật trả `409`. Cập nhật có điều kiện trên trạng thái đã đọc, nên hai người sửa cùng lúc sẽ không ghi đè nhau.

`GET /api/retry-notifications` được Vercel Cron gọi (cấu hình trong `vercel.json`, xác thực bằng `Authorization: Bearer CRON_SECRET`). Job lấy tối đa 20 lead có `notification_status` là PENDING hoặc FAILED, cũ hơn 2 phút và chưa vượt 5 lần thử. Mỗi lead được "nhận" bằng một lần cập nhật có điều kiện trên `notification_attempts` để các lần chạy chồng nhau không gửi trùng. Lưu ý: nếu n8n đã gửi thành công nhưng bước ghi trạng thái về Supabase thất bại, lead vẫn ở PENDING và có thể bị gửi lại. n8n nên dùng `lead_id` để bỏ qua thông báo trùng.

`GET /api/sales-bookings` yêu cầu header `X-Sales-Secret` khớp `SALES_UPDATE_SECRET`; chỉ trả tối đa 100 booking gần nhất và không cache. `POST /api/lead-status` dùng cùng header để cập nhật pipeline; chuyển booking sang `BOOKED` sẽ gửi email khách. Trạng thái xác nhận email lỗi được retry bởi cron.

`GET /api/kpi` trả số liệu tổng hợp ẩn danh của 180 ngày gần nhất: tổng visitor, visitor theo LOW/MEDIUM/HIGH và UTM source, cùng tổng lead theo trạng thái, điểm HOT/WARM/COLD, nguồn UTM và tháng. Không trả thông tin liên hệ. Dashboard dùng endpoint này để hiện dữ liệu khi có kết nối Supabase.

Biến môi trường mới: `N8N_BOOKING_WEBHOOK_URL` (URL production của workflow đặt tour), `SALES_UPDATE_SECRET` (cập nhật trạng thái), `CRON_SECRET` (job retry). Cấu hình riêng hai URL n8n và dùng chung secret server-side. Chạy lại `docs/supabase-schema.sql` để thêm `sales_note`, `notification_attempts`, `last_notification_at`, trạng thái retry email xác nhận booking và các ràng buộc liên quan.

Lưu ý về lịch Cron: gói Hobby của Vercel chỉ cho chạy cron tối đa một lần mỗi ngày, nên `vercel.json` đặt `0 3 * * *`. Nếu nâng lên gói Pro, có thể đổi thành `*/15 * * * *`.
