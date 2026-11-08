# Workflow n8n (bản hiện tại)

| File | Webhook | Trạng thái | Vai trò |
|---|---|---|---|
| `2_booking_confirmation.json` | `POST /webhook/vietjourney-booking` | Đã sửa, chưa chạy thật | Đơn đặt tour mới: lưu Google Sheets, thông báo Sales (`sales_email_sent`). Khi Sales xác nhận (`booking_event = sales_confirmed`): gửi email cho khách (`customer_email_sent`). Chống gửi trùng bằng Data Table. |
| `3_nurture_email.json` | `POST /webhook/vietjourney-nurture` | Mới, chưa chạy thật | Gửi một email nuôi dưỡng theo `action`. Trả `email_sent`. Không gửi nếu thiếu email hoặc thiếu link hủy nhận. |
| `1_lead_capture.json` | `POST /webhook/vietjourney-lead` | Dormant | Chỉ dùng cho lead không phải đặt tour. Website hiện chỉ gửi đặt tour nên workflow này chưa có đầu vào. |

## Trước khi bật

1. **Tắt workflow cũ trùng path.** Nếu còn workflow cũ dùng `vietjourney-booking` hoặc `vietjourney-lead`, n8n sẽ xung đột.
2. **Chọn lại credential:** Header Auth (`X-Automation-Secret`), Gmail OAuth2, Google Sheets OAuth2, Data Table.
3. **Thêm cột vào sheet `Leads`.** Các cột phải có đúng tên, theo thứ tự tùy ý:
   `lead_id, created_at, name, email, phone, destination, travel_date, budget, party_size, selected_tour_name, interests, lead_priority, lead_score, lead_level, customer_segment, customer_traits, source, utm_source, utm_medium, utm_campaign, note, consent_to_contact, booking_status, booking_event, requested_at, confirmed_at, updated_at, care_priority`.
4. **Đổi email Sales.** Node `Send Email - Notify Sales` đang gửi tới địa chỉ cá nhân. Đổi sang email nội bộ của nhóm.
5. **Kiểm tra Data Table.** Workflow booking dùng Data Table `4LzpONfKZBVArGKg` của instance cũ. Nếu instance mới, tạo bảng có cột `key, status, sent_at` và cập nhật ID.

## Đầu vào và đầu ra

Booking (`vietjourney-booking`), request ban đầu: backend gửi `booking_request: true` và các trường lead. Đầu ra: `sales_email_sent`, và `customer_email_sent` là `false` vì khách chưa được xác nhận.

Booking, Sales xác nhận: backend gửi `booking_event: "sales_confirmed"` kèm toàn bộ lead, có `created_at` gốc để không bị ghi đè. Đầu ra: `customer_email_sent`.

Nurture (`vietjourney-nurture`): backend gửi `lead_id, step, action, care_priority, customer_segment, name, email, destination, selected_tour_name, opt_out_url`. Đầu ra: `email_sent`.

## Kiểm thử

- Postman: `automation/postman/VietJourney_n8n_Test_Simple.postman_collection.json` gửi lead và booking.
- Booking thật: gửi một đơn, kiểm tra Sales nhận email và sheet có dòng mới. Sau đó gọi `PATCH /api/lead-status` với `BOOKED`, kiểm tra khách nhận email xác nhận và `booking_confirmation_status = SENT`.
- Nurture: gọi `GET /api/nurture` với `Authorization: Bearer <CRON_SECRET>` khi có lead COLD đã quá 1 ngày, kiểm tra email đến và `nurture_step` tăng 1.

## Chưa làm

- Workflow lead (`1_lead_capture.json`) chưa rẽ theo `care_priority`. Chỉ nên làm khi có luồng thu lead không phải đặt tour.
- Chưa có bằng chứng chạy thật trên n8n và Gmail của nhóm.

## Cập nhật: hành động `itinerary_delivery`

Workflow `3_nurture_email.json` xử lý thêm hành động `itinerary_delivery`, gửi lịch trình AI Planner ngay khi khách đăng ký (bước 0). Email kèm `plan_summary` và link hủy nhận. Các hành động `tour_suggestions`, `destination_guide`, `trip_checklist`, `intent_check`, `close_file` là bước 1–4 do job `/api/nurture` gọi theo ngày.

Workflow `1_lead_capture.json` không còn cần cho luồng lịch trình. Lịch trình đi thẳng tới webhook nuôi dưỡng.
