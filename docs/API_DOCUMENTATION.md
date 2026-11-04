# API

`POST /api/aichat` nhận `message` (bắt buộc), `history` (tối đa 10 lượt gần nhất, mỗi lượt có `role: "user" | "assistant" | "model"` và `text`), và `customer` tùy chọn gồm `destination`, `duration`, `budget`, `budget_basis` (`per_person` hoặc `total`), `party_size`, `travel_date`, `interests`. API trả `{ "success": true, "reply": "..." }`. Cần cấu hình `OPENROUTER_API_KEY` trong môi trường server; endpoint dùng router `openrouter/free` để chọn trong các model miễn phí có sẵn. Các model miễn phí vẫn có thể bị giới hạn lượt hoặc tạm thời không khả dụng. Lịch sử và ngữ cảnh khách hàng được giới hạn/làm sạch phía server.

Prompt tư vấn yêu cầu câu trả lời thông thường tối đa khoảng 80 từ, kết luận ngân sách trước, không tự giả định điểm xuất phát/ngày đi, không trình bày giá ước tính như giá đã xác minh và kết thúc bằng tối đa một gợi ý bước tiếp theo phù hợp. Yêu cầu lịch trình chi tiết được trả lời theo ngày và có thể dài hơn.

API nạp tour đang hoạt động từ `data/tours.json` vào ngữ cảnh AI. AI chỉ được giới thiệu tour trong catalog; giá là giá tham khảo, còn thiếu ngày khởi hành / nhóm khách phù hợp / dịch vụ không bao gồm thì phải nói là chưa có dữ liệu và cần xác nhận, không tự suy diễn. Các trường bổ sung tùy chọn cho mỗi tour: `departures` (mảng ngày/trạng thái), `suitable_for` (mảng), `excluded_services` (mảng).

Sau câu trả lời AI, nút **Yêu cầu tư vấn hành trình này** chuyển khách tới form và điền bản tóm tắt câu hỏi/đề xuất AI vào `note`, cùng điểm đến, ngày, số người, ngân sách và sở thích nhận diện được. Khách cần kiểm tra/bổ sung họ tên, email hoặc số điện thoại và đồng ý liên hệ. Nội dung AI được gửi cùng lead đến Supabase và webhook n8n trong trường `note`; đây là gợi ý tham khảo, không phải xác nhận tour.

`POST /api/leads` nhận các trường biểu mẫu lead, header `Idempotency-Key` (UUID), và các tham số marketing `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` khi có. Các trường `email`, `phone`, `zalo_phone`, `source`, `voucher_code`, `voucher_status`, `voucher_channel` được lưu nếu có. `consent_to_contact` bắt buộc là `true`; tour được xác thực lại trên server.

Nút **Đặt tour** từ tour đang hoạt động mở form yêu cầu đặt với email, ngày đi, số khách và tour bắt buộc. Gửi thành công lưu một lead có `lead_source = "booking_form"` và `lead_status = "NEW"`; API lấy tên tour, điểm đến, thời lượng và giá tham khảo từ catalog, không tin các giá trị này từ trình duyệt. Yêu cầu không giữ chỗ và không được đánh dấu `BOOKED`: ngày khởi hành, giá cuối cùng và tình trạng chỗ vẫn cần Sales xác nhận. N8n phải gửi email xác nhận đã nhận yêu cầu cho khách và email booking cho Sales; xem payload/ack chi tiết tại [n8n-workflow.md](./n8n-workflow.md). Dashboard website không hiển thị thông tin booking cá nhân. Không cần thêm bảng hoặc cột Supabase cho luồng này.

Frontend gửi `engagement.tour_views` và `engagement.return_visit` khi khách đồng ý theo dõi hành vi tùy chọn; server tự tính điểm lead (gửi form 35 điểm, chọn tour 20, mỗi lượt xem tối đa 3 lượt × 5, quay lại 10; HOT từ 70, WARM từ 45, còn lại COLD). Giá trị `lead_score` hoặc `lead_level` do client tự gửi không được tin cậy. Phân loại nhu cầu theo sở thích, tour đã chọn và ngân sách thành các nhóm `family`, `budget`, `resort`, `explorer` (có thể có nhiều traits) hoặc `general`. Đây là heuristic minh bạch, không phải kết quả mô hình AI hay thay thế xác nhận của Sales.

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
4. Workflow tư vấn trả `{ "notification_sent": true, "lead_id": "..." }` chỉ sau khi Sales được thông báo (`email_sent` vẫn tương thích workflow cũ). Workflow booking trả `customer_email_sent` và `sales_email_sent` riêng; backend chỉ xác nhận thành công khi cả hai đều `true`. Lấy `lead_id` từ payload chuẩn hóa, không dựa vào output node cuối.

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

Dashboard tại [dashboard.html](../dashboard.html) gọi `GET /api/kpi` để hiển thị dữ liệu lead tổng hợp từ Supabase trong 180 ngày gần nhất: trạng thái Sales, mức ưu tiên, UTM source, lead theo tháng và số lead đã chọn tour. API chỉ trả số liệu tổng hợp, phân trang khi đọc Supabase và không trả thông tin liên hệ. Dashboard không hiển thị traffic, doanh thu hoặc chi phí quảng cáo vì các dữ liệu đó hiện chưa được thu thập; CSV tải xuống chỉ chứa các số liệu lead thực tế này.

## v2: vòng đời lead, retry và KPI

`POST /api/leads` giờ tự chống trùng: nếu cùng số liên hệ và cùng điểm đến đã có lead trong 24 giờ, API trả `200` với `duplicate: true` và lead_id cũ, không tạo bản ghi mới và không gửi lại thông báo cho Sales. Lead mới luôn bắt đầu ở `lead_status = NEW`; mức ưu tiên nằm ở `lead_level` (HOT/WARM/COLD).

`POST /api/lead-status` dành cho Sales. Yêu cầu header `X-Sales-Secret` khớp với `SALES_UPDATE_SECRET`. Body: `{ "lead_id": "...", "lead_status": "CONTACTED", "sales_note": "tùy chọn" }`. Trạng thái hợp lệ: NEW, CONTACTED, QUOTED, BOOKED, LOST. Luồng cho phép: NEW→CONTACTED/LOST; CONTACTED→QUOTED/LOST; QUOTED→BOOKED/LOST/CONTACTED; LOST→CONTACTED; BOOKED là trạng thái cuối. Chuyển sai luật trả `409`. Cập nhật có điều kiện trên trạng thái đã đọc, nên hai người sửa cùng lúc sẽ không ghi đè nhau.

`GET /api/retry-notifications` được Vercel Cron gọi (cấu hình trong `vercel.json`, xác thực bằng `Authorization: Bearer CRON_SECRET`). Job lấy tối đa 20 lead có `notification_status` là PENDING hoặc FAILED, cũ hơn 2 phút và chưa vượt 5 lần thử. Mỗi lead được "nhận" bằng một lần cập nhật có điều kiện trên `notification_attempts` để các lần chạy chồng nhau không gửi trùng. Lưu ý: nếu n8n đã gửi thành công nhưng bước ghi trạng thái về Supabase thất bại, lead vẫn ở PENDING và có thể bị gửi lại. n8n nên dùng `lead_id` để bỏ qua thông báo trùng.

`GET /api/kpi` trả số liệu tổng hợp ẩn danh của 180 ngày gần nhất: tổng lead, theo trạng thái, theo mức ưu tiên, theo nguồn UTM, theo tháng. Không trả thông tin liên hệ. Dashboard dùng endpoint này để hiện khối "Dữ liệu thật" khi có kết nối Supabase.

Biến môi trường mới: `N8N_BOOKING_WEBHOOK_URL` (URL production của workflow đặt tour), `SALES_UPDATE_SECRET` (cập nhật trạng thái), `CRON_SECRET` (job retry). Cấu hình riêng hai URL n8n và dùng chung secret server-side. Chạy lại `docs/supabase-schema.sql` để thêm `sales_note`, `notification_attempts`, `last_notification_at` và ràng buộc trạng thái.

Lưu ý về lịch Cron: gói Hobby của Vercel chỉ cho chạy cron tối đa một lần mỗi ngày, nên `vercel.json` đặt `0 3 * * *`. Nếu nâng lên gói Pro, có thể đổi thành `*/15 * * * *`.
