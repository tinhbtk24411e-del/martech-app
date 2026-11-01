# n8n workflow mẫu cho lead + voucher + Google Sheets

Mục tiêu:
- nhận lead từ `/api/leads`
- tính lead score / lead level
- gửi voucher qua email hoặc Zalo OA
- lưu lead vào Google Sheets
- gửi báo cho Sales
- trả về thông tin confirm cho backend

## 1) Webhook trigger

- Trigger: Webhook
- Method: POST
- Path: `travel-lead`
- Authentication: custom header hoặc optional
- Header cần check: `X-Automation-Secret`

## 2) Node kiểm tra secret

Nếu dùng header secret:

```javascript
const authHeader = $json.headers['x-automation-secret'];
const expected = process.env.N8N_WEBHOOK_SECRET;

if (!authHeader || authHeader !== expected) {
  throw new Error('Unauthorized');
}

return $json;
```

## 3) Node tính lead score

Dùng Set node hoặc Code node:

```json
{
  "lead_score": 80,
  "lead_level": "HOT",
  "voucher_code": "DNH-10P-2026",
  "voucher_status": "PENDING",
  "voucher_channel": "email"
}
```

Mẫu logic đơn giản:
- có email + phone => +20
- có destination + budget => +20
- có chọn tour => +20
- có UTM source => +10
- budget >= 5 triệu => +20
- tổng >= 70 => HOT

## 4) Gmail / SMTP node

Gửi email với nội dung:

- Subject: "VietJourney – Voucher du lịch của bạn"
- To: `{{$json.email}}`
- Body: "Xin chào ... Bạn nhận được mã voucher DNH-10P-2026"

## 5) Google Sheets node

Columns cần có:

- lead_id
- name
- email
- phone
- destination
- budget
- source
- utm_source
- utm_medium
- utm_campaign
- lead_score
- lead_level
- voucher_code
- voucher_status
- created_at

## 6) Slack / Telegram / Email sales

Gửi thông báo cho sales:

```text
Lead HOT từ Facebook
Tên: Nguyễn Văn A
Email: nguyenvana@gmail.com
Tour: Đà Nẵng - Hội An
Voucher: DNH-10P-2026
```

## 7) Respond to Webhook

Trả JSON cho backend:

```json
{
  "email_sent": true,
  "lead_id": "{{$json.lead_id}}",
  "status": "ok"
}
```

Backend hiện tại sẽ nhận phản hồi này và cập nhật `notification_status = 'SENT'` nếu `email_sent` là `true`.

## 8) Nếu muốn thêm Zalo OA

- Chỉ dùng khi đã có Zalo Official Account
- Thêm node Zalo / HTTP Request gửi voucher nội dung theo template Zalo
- Nếu chưa có OA, ưu tiên email trước rồi manual follow-up bằng sales

## 9) Dữ liệu cần lưu theo nguồn marketing

- `utm_source=facebook`
- `utm_medium=organic_post`
- `utm_campaign=danang_hoian`
- `source=facebook`

Nhờ đó bạn sẽ thống kê được:
- total traffic
- total lead
- lead theo source
- voucher đã gửi
- lead HOT/WARM/COLD
- conversion rate theo kênh marketing
