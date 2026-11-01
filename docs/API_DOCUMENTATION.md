# API

`POST /api/chat` nhận `destination`, `duration`, `budget`, `party_size`, `travel_date?`, `interests?`. API trả `itinerary`, `matchedTours`, `advice`. Cần `GEMINI_API_KEY`.

`POST /api/leads` nhận các trường biểu mẫu lead và header `Idempotency-Key` (UUID). `consent_to_contact` bắt buộc là `true`; tour được xác thực lại trên server. Response thành công: `lead_id` và `notification_status`.

Ví dụ local:

```bash
curl -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" -d "{\"destination\":\"Đà Nẵng\",\"duration\":3,\"budget\":5000000,\"party_size\":2,\"interests\":[\"Ẩm thực\"]}"
```

Không gửi PII vào `/api/chat`. Lỗi API trả thông báo an toàn, không có stack trace.
