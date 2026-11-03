# n8n Marketing Automation cho VietJourney

## Luồng tổng thể

`Website form → /api/leads → Supabase → n8n Webhook → Google Sheets + thông báo Sales + email tùy chọn → xác nhận backend`

Backend lưu lead vào Supabase trước khi gọi n8n. Nếu webhook timeout hoặc lỗi, lead vẫn được lưu với `notification_status = PENDING`; cần theo dõi và xử lý lại các lead này. Webhook được gọi đồng bộ với timeout 15 giây nên giữ workflow nhẹ và phản hồi sớm.

## 1. Webhook và xác thực

1. Tạo Webhook node, method `POST`, path `travel-lead`, response mode `Using Respond to Webhook`.
2. Cấu hình Header Auth credential với header `X-Automation-Secret`; tạo secret đủ ngẫu nhiên.
3. Đặt URL production của webhook vào biến server `N8N_WEBHOOK_URL` và cùng giá trị secret vào `N8N_WEBHOOK_SECRET`. Không đưa hai giá trị này lên frontend.
4. Webhook nhận payload lead ở `body` (các cấu hình n8n có thể chuyển body thành root; kiểm tra output của Webhook node).

`/api/leads` gửi các thông tin liên hệ đã được khách đồng ý cung cấp, nhu cầu, tóm tắt tư vấn AI, UTM, tour quan tâm, `lead_score`, `lead_level`, `score_signals`, `customer_segment` và `customer_traits`.

## 2. Phân loại nhu cầu và ưu tiên lead

API tính các trường này sau khi validate lead và tour. Đây là rule-based scoring có thể giải thích, không phải dự đoán mua hàng từ mô hình AI:

| Tín hiệu | Điểm |
|---|---:|
| Gửi yêu cầu tư vấn | 35 |
| Chọn tour cụ thể trong yêu cầu tư vấn | +20 |
| Mỗi lượt xem chi tiết tour, tối đa 3 lượt | +5 |
| Khách quay lại website | +10 |

- `HOT`: từ 70 điểm; `WARM`: từ 45 điểm; còn lại `COLD`.
- `family`: có sở thích Gia đình; `budget`: có sở thích Tiết kiệm hoặc ngân sách ≤ 3.000.000 VND/người.
- `resort`: có sở thích Nghỉ dưỡng; `explorer`: có sở thích Trekking, Khám phá hoặc Thiên nhiên.
- Một lead có thể có nhiều `customer_traits`; `customer_segment` là nhóm ưu tiên đầu tiên. Không đủ tín hiệu thì dùng `general`.
- Tín hiệu lượt xem/quay lại do trình duyệt cung cấp nên phù hợp cho demo/ưu tiên tham khảo, không dùng làm quyết định duy nhất.

Không ghi đè các trường scoring này bằng một phép tính khác trong n8n. Nếu cần mô hình AI, lưu kết quả thành trường enrichment riêng, giữ lại score rule-based để đối chiếu.

## 3. Ghi CRM / Google Sheets

Thêm Google Sheets node dạng Append Row và ánh xạ tối thiểu:

`lead_id`, `created_at` (thời điểm xử lý nếu payload chưa có), `name`, `email`, `phone`, `destination`, `travel_date`, `budget`, `party_size`, `selected_tour_name`, `interests`, `lead_score`, `lead_level`, `score_signals`, `customer_segment`, `customer_traits`, `source`, `utm_source`, `utm_medium`, `utm_campaign`, `note`, `consent_to_contact`.

Đặt tên sheet là `Leads` và chỉ cho người được phân quyền truy cập vì sheet có dữ liệu liên hệ cá nhân.

## 4. Thông báo Sales và follow-up

- Dùng IF node để phân tuyến: `HOT` thông báo ngay cho Sales; `WARM` vào hàng đợi follow-up; `COLD` gửi nội dung chăm sóc phù hợp.
- Gửi lead đến email/Slack/Telegram nội bộ. Chỉ gửi voucher marketing cho khách qua email khi có email và consent/chính sách phù hợp; form hiện đồng ý cho mục đích liên hệ tư vấn.
- Tạo workflow Schedule riêng để kiểm tra các lead `PENDING`/chưa được Sales xử lý trong Supabase/CRM, nhắc Sales theo SLA và đánh dấu bước follow-up. Tránh gửi lặp bằng cách ghi `last_follow_up_at` hoặc trạng thái xử lý.
- Dùng credential n8n cho Gmail, Google Sheets và kênh thông báo; không đặt credential trong Code node hoặc payload.

## 5. Phản hồi webhook

Sau khi bước thông báo đã được xác nhận, Respond to Webhook trả JSON:

```json
{
  "notification_sent": true,
  "email_sent": true,
  "lead_id": "{{$json.lead_id}}",
  "status": "ok"
}
```

`notification_sent` phản ánh xác nhận thông báo (ví dụ Sales đã nhận); nếu trường này không có, backend dùng `email_sent` để tương thích workflow cũ. Backend chuyển `notification_status` thành `SENT` khi trường được ưu tiên xác nhận `true`, `FAILED` khi trường được ưu tiên là `false`, và giữ `PENDING` nếu không có xác nhận. Không trả `true` trước khi workflow thực sự hoàn tất bước thông báo.

## 6. Kiểm thử trước khi bật

1. Gửi lead thử qua form với dữ liệu liên hệ đã được đồng ý sử dụng.
2. Kiểm tra bản ghi Supabase trước: score/segment, UTM, `selected_tour_id`, `note`, `notification_status`.
3. Kiểm tra Google Sheets và kênh Sales, sau đó xác nhận webhook trả `notification_sent: true`.
4. Thử email không có và lỗi node; lead phải vẫn được lưu, không báo gửi thành công giả.
5. Theo dõi các lead `PENDING` và cấu hình quy trình retry có chống gửi trùng.
