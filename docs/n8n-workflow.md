# n8n Marketing Automation cho VietJourney

## Luồng tổng thể

`Website form → /api/leads → Supabase → chọn workflow n8n theo loại yêu cầu → phản hồi backend`

Backend lưu lead vào Supabase trước khi gọi n8n. Yêu cầu tư vấn gọi workflow Lead Capture; yêu cầu booking gọi workflow Booking Confirmation. Nếu webhook timeout hoặc lỗi, lead vẫn được lưu với `notification_status = PENDING`; cần theo dõi và xử lý lại các lead này. Webhook được gọi đồng bộ với timeout 15 giây nên giữ workflow nhẹ và phản hồi sớm.

## 1. Webhook và xác thực

1. Workflow tư vấn dùng Webhook `POST`, path `travel-lead`, response mode `Using Respond to Webhook`; đặt URL production trong biến server `N8N_WEBHOOK_URL`.
2. Workflow đặt tour dùng Webhook `POST`, path `vietjourney-booking`, response mode `Using Respond to Webhook`; đặt URL production trong `N8N_BOOKING_WEBHOOK_URL`.
3. Hai Webhook có thể dùng chung Header Auth credential `X-Automation-Secret`, khớp giá trị `N8N_WEBHOOK_SECRET`. Không đưa URL hoặc secret lên frontend.
4. Cả hai workflow nhận payload lead ở `body` (các cấu hình n8n có thể chuyển body thành root; kiểm tra output của Webhook node).

`/api/leads` gửi các thông tin liên hệ đã được khách đồng ý cung cấp, nhu cầu, tóm tắt tư vấn AI, UTM, tour quan tâm, `lead_score`, `lead_level`, `score_signals`, `customer_segment` và `customer_traits`. Yêu cầu từ form đặt tour có `booking_request: true`, `booking_status: "AWAITING_SALES_CONFIRMATION"`, `booking_price_per_person`, và `lead_source: "booking_form"`; backend định tuyến loại này sang `N8N_BOOKING_WEBHOOK_URL`, không gửi qua workflow tư vấn.

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
- Workflow Booking Confirmation gửi email nội bộ cho Sales khi nhận yêu cầu mới. Chỉ sau khi Sales chuyển lead sang `BOOKED`, backend gọi lại webhook với `booking_event: "sales_confirmed"` để gửi email xác nhận booking cho khách. `booking_price_per_person` là giá tham khảo từ catalog; nội dung email khách không được khẳng định các điều kiện Sales chưa xác nhận.
- Vì webhook có thể được retry, dùng khóa `lead_id:customer` và `lead_id:sales` trong kho bền vững; lưu trạng thái từng kênh trước/sau khi gửi để retry không gửi lại kênh đã thành công. Xem [N8N_SETUP.md](./N8N_SETUP.md) về xử lý trạng thái `PROCESSING`, chạy tuần tự và giới hạn exactly-once.
- Repository có Vercel Cron retry thông báo `PENDING`/`FAILED`, không có workflow nhắc Sales theo SLA. Nếu cần, tạo Schedule workflow riêng để kiểm tra lead chưa xử lý; chốt ngưỡng SLA và lưu trạng thái/lần nhắc để tránh gửi nhắc lặp.
- Dùng credential n8n cho Gmail, Google Sheets và kênh thông báo; không đặt credential trong Code node hoặc payload.

Payload booking có các trường trọng tâm sau (ngoài thông tin lead/UTM hiện tại):

```json
{
  "lead_id": "uuid",
  "booking_request": true,
  "booking_status": "AWAITING_SALES_CONFIRMATION",
  "booking_price_per_person": 7600000,
  "customer_email_confirmation_required": false,
  "sales_email_notification_required": true,
  "name": "Nguyễn Văn A",
  "email": "customer@example.com",
  "phone": "0909123456",
  "selected_tour_id": "da-nang-hoi-an",
  "selected_tour_name": "Đà Nẵng - Hội An Chill",
  "travel_date": "2027-01-14",
  "party_size": 2,
  "destination": "Đà Nẵng",
  "duration": 4,
  "lead_source": "booking_form"
}
```

Sau khi Sales chuyển lead sang `BOOKED`, backend gọi lại webhook booking với `booking_event: "sales_confirmed"`, `booking_status: "CONFIRMED"`, `customer_email_confirmation_required: true`, và `sales_email_notification_required: false`. Chỉ nhánh này mới gửi email cho khách.

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

Với lead thường, `notification_sent` phản ánh xác nhận thông báo (ví dụ Sales đã nhận); `email_sent` vẫn được hỗ trợ cho workflow cũ.

Khi nhận yêu cầu booking ban đầu, workflow `vietjourney-booking` trả `sales_email_sent: true` sau khi email Sales được gửi. Khi payload có `booking_event: "sales_confirmed"`, trả `customer_email_sent: true` sau khi email khách được gửi:

```json
{
  "customer_email_sent": true,
  "lead_id": "{{$json.lead_id}}",
  "status": "ok"
}
```

Backend theo dõi thông báo Sales qua `notification_status` và email khách qua `booking_confirmation_status` riêng. Cờ `false` tạo trạng thái `FAILED`, thiếu xác nhận giữ `PENDING` để retry.

## 6. Kiểm thử trước khi bật

1. Gửi lead thử qua form tư vấn và form đặt tour với dữ liệu liên hệ đã được đồng ý sử dụng.
2. Kiểm tra bản ghi Supabase trước: score/segment, UTM, `selected_tour_id`, `note`, `notification_status`.
3. Với booking, xác nhận email Sales chỉ gửi khi nhận yêu cầu; email khách chỉ gửi sau khi Sales chuyển trạng thái sang `BOOKED`.
4. Thử email không có và lỗi node; lead phải vẫn được lưu, không báo gửi thành công giả.
5. Theo dõi các lead `PENDING` và cấu hình quy trình retry có chống gửi trùng.
