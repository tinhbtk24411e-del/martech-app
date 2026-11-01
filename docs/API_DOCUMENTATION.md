# API

`POST /api/chat` nhận `destination`, `duration`, `budget`, `party_size`, `travel_date?`, `interests?`. API trả `itinerary`, `matchedTours`, `advice`. Cần `GEMINI_API_KEY`.

`POST /api/leads` nhận các trường biểu mẫu lead, header `Idempotency-Key` (UUID), và các tham số marketing `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` khi có. `consent_to_contact` bắt buộc là `true`; tour được xác thực lại trên server. Response thành công: `lead_id` và `notification_status`.

Ví dụ local:

```bash
curl -X POST http://localhost:3000/api/chat -H "Content-Type: application/json" -d "{\"destination\":\"Đà Nẵng\",\"duration\":3,\"budget\":5000000,\"party_size\":2,\"interests\":[\"Ẩm thực\"]}"
```

Không gửi PII vào `/api/chat`. Lỗi API trả thông báo an toàn, không có stack trace.

## UTM tracking

- Frontend đọc và giữ trạng thái UTM trong `sessionStorage` trong suốt quá trình đặt tour.
- Khi khách hàng gửi lead, payload bao gồm `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` nếu có.
- Máy chủ hợp lệ hóa và lưu chúng vào Supabase khi cột tồn tại; nếu không, hãy dùng migration trong `docs/supabase-schema.sql`.
