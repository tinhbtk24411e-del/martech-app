# API

`POST /api/aichat` nhận `message` (bắt buộc), `history` (tối đa 10 lượt gần nhất, mỗi lượt có `role: "user" | "model"` và `text`), và `customer` tùy chọn gồm `destination`, `duration`, `budget`, `party_size`, `travel_date`, `interests`. API trả `{ "success": true, "reply": "..." }`. Cần `GEMINI_API_KEY`; lịch sử và ngữ cảnh khách hàng được giới hạn/làm sạch phía server.

`POST /api/leads` nhận các trường biểu mẫu lead, header `Idempotency-Key` (UUID), và các tham số marketing `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` khi có. Bên cạnh đó, hỗ trợ các trường marketing/CRM mới: `email`, `phone`, `zalo_phone`, `source`, `lead_score`, `lead_level`, `voucher_code`, `voucher_status`, `voucher_channel`. `consent_to_contact` bắt buộc là `true`; tour được xác thực lại trên server. Response thành công: `lead_id` và `notification_status`.

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
  "lead_score": 80,
  "lead_level": "HOT",
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
- Ngoài UTM, hệ thống còn lưu `source`, `lead_score`, `lead_level`, `voucher_code`, `voucher_status`, `voucher_channel` để n8n và Google Sheets phân loại khách, gửi voucher và báo hiệu cho Sales.
- `source` thường là `facebook`, `tiktok`, `google`, `website`, `instagram` tùy kênh marketing.

## n8n workflow gợi ý

1. Webhook trigger nhận lead từ `/api/leads`.
2. Nếu `email` hoặc `phone` có giá trị, tạo thông tin voucher và lead score.
3. Gửi voucher qua Gmail / SMTP hoặc Zalo OA nếu có.
4. Append dòng vào Google Sheets.
5. Gửi thông báo cho Sales (Slack, Telegram, Email).
6. Trả về JSON: `{ "email_sent": true, "lead_id": "...", "status": "ok" }`.

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
  "lead_score": 80,
  "lead_level": "HOT",
  "voucher_code": "DNH-10P-2026",
  "voucher_channel": "email"
}
```
