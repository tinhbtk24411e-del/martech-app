# API

`POST /api/aichat` nhận `message` (bắt buộc), `history` (tối đa 10 lượt gần nhất, mỗi lượt có `role: "user" | "assistant" | "model"` và `text`), và `customer` tùy chọn gồm `destination`, `duration`, `budget`, `budget_basis` (`per_person` hoặc `total`), `party_size`, `travel_date`, `interests`. API trả `{ "success": true, "reply": "..." }`. Cần cấu hình `OPENROUTER_API_KEY` trong môi trường server; endpoint dùng router `openrouter/free` để chọn trong các model miễn phí có sẵn. Các model miễn phí vẫn có thể bị giới hạn lượt hoặc tạm thời không khả dụng. Lịch sử và ngữ cảnh khách hàng được giới hạn/làm sạch phía server.

Prompt tư vấn yêu cầu câu trả lời thông thường tối đa khoảng 80 từ, kết luận ngân sách trước, không tự giả định điểm xuất phát/ngày đi, không trình bày giá ước tính như giá đã xác minh và kết thúc bằng tối đa một gợi ý bước tiếp theo phù hợp. Yêu cầu lịch trình chi tiết được trả lời theo ngày và có thể dài hơn.

API nạp tour đang hoạt động từ `data/tours.json` vào ngữ cảnh AI. AI chỉ được giới thiệu tour trong catalog; giá là giá tham khảo, còn thiếu ngày khởi hành / nhóm khách phù hợp / dịch vụ không bao gồm thì phải nói là chưa có dữ liệu và cần xác nhận, không tự suy diễn. Các trường bổ sung tùy chọn cho mỗi tour: `departures` (mảng ngày/trạng thái), `suitable_for` (mảng), `excluded_services` (mảng).

Sau câu trả lời AI, nút **Yêu cầu tư vấn hành trình này** chuyển khách tới form và điền bản tóm tắt câu hỏi/đề xuất AI vào `note`, cùng điểm đến, ngày, số người, ngân sách và sở thích nhận diện được. Khách cần kiểm tra/bổ sung họ tên, email hoặc số điện thoại và đồng ý liên hệ. Nội dung AI được gửi cùng lead đến Supabase và webhook n8n trong trường `note`; đây là gợi ý tham khảo, không phải xác nhận tour.

`POST /api/leads` nhận các trường biểu mẫu lead, header `Idempotency-Key` (UUID), và các tham số marketing `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` khi có. Các trường `email`, `phone`, `zalo_phone`, `source`, `voucher_code`, `voucher_status`, `voucher_channel` được lưu nếu có. `consent_to_contact` bắt buộc là `true`; tour được xác thực lại trên server.

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

1. Webhook trigger nhận lead đã lưu từ `/api/leads`; kiểm tra `X-Automation-Secret`.
2. Dùng `lead_score`, `lead_level`, `customer_segment` đã tính ở server (không tính lại hoặc tin vào điểm từ browser).
3. Nếu có email thì gửi xác nhận/voucher qua Gmail/SMTP; ghi lead vào Google Sheets và báo Sales qua Slack/Telegram/Email.
4. Trả về `{ "notification_sent": true, "lead_id": "..." }` khi workflow xác nhận đã thông báo. `email_sent` vẫn được hỗ trợ cho workflow cũ.

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

Dashboard hiện tại là demo tĩnh, không đọc dữ liệu thật từ Supabase. CSV tải từ [dashboard.html](../dashboard.html) chỉ chứa số liệu giả lập và có ghi rõ các giả định.
