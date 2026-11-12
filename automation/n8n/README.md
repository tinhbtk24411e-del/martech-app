# Workflow n8n (bản hiện tại)

| File | Webhook | Trạng thái | Vai trò |
|---|---|---|---|
| `2_booking_confirmation.json` | `POST /webhook/vietjourney-booking` | Chưa xác minh trên production | Đơn đặt tour mới: thông báo Sales (`sales_email_sent`). Khi Sales xác nhận (`booking_event = sales_confirmed`): gửi email cho khách (`customer_email_sent`). Chống gửi email trùng bằng Data Table. Supabase là nguồn dữ liệu lead/CRM duy nhất; workflow không ghi lead vào Google Sheets. |
| `3_nurture_email.json` | `POST /webhook/vietjourney-nurture` | Mới, chưa chạy thật | Gửi một email nuôi dưỡng theo `action`. Trả `email_sent`. Không gửi nếu thiếu email hoặc thiếu link hủy nhận. |
| `1_lead_capture.json` | `POST /webhook/vietjourney-lead` | Dormant trong export; cần bật trên instance sau khi map credential | Consultation form gửi WARM lead đã được backend lưu Supabase; workflow gửi Sales notification và xác nhận đã nhận yêu cầu cho khách. |

## Trước khi bật

1. **Tắt workflow cũ trùng path.** Nếu còn workflow cũ dùng `vietjourney-booking` hoặc `vietjourney-lead`, n8n sẽ xung đột.
2. **Chọn lại credential:** Header Auth (`X-Automation-Secret`), Gmail OAuth2 và Data Table cho workflow booking.
3. **Không thêm Google Sheets node vào luồng lead/booking.** Supabase giữ lead, UTM, CRM status và booking. Google Sheets chỉ phục vụ KPI/phân tích qua quy trình export hoặc synchronization riêng nếu có cấu hình được duyệt.
4. **Đổi email Sales.** Node `Send Email - Notify Sales` đang gửi tới địa chỉ cá nhân. Đổi sang email nội bộ của nhóm.
5. **Kiểm tra Data Table.** Workflow booking dùng Data Table `4LzpONfKZBVArGKg` của instance cũ. Nếu instance mới, tạo bảng có cột `key, status, sent_at` và cập nhật ID.

## Đầu vào và đầu ra

Booking (`vietjourney-booking`), request ban đầu: backend gửi `booking_request: true` và các trường lead. Đầu ra: `sales_email_sent`, và `customer_email_sent` là `false` vì khách chưa được xác nhận.

Booking, Sales xác nhận: backend gửi `booking_event: "sales_confirmed"` kèm toàn bộ lead, có `created_at` gốc để không bị ghi đè. Đầu ra: `customer_email_sent`.

Nurture (`vietjourney-nurture`): backend gửi `lead_id, step, action, care_priority, customer_segment, name, email, destination, selected_tour_name, opt_out_url`. Đầu ra: `email_sent`.

## Kiểm thử

- Postman: `automation/postman/VietJourney_n8n_Test_Simple.postman_collection.json` gửi lead và booking.
- Booking thật: gửi một đơn, kiểm tra Supabase lưu lead và Sales nhận email. Sau đó gọi `POST /api/lead-status` với `BOOKED`, kiểm tra khách chỉ nhận email xác nhận sau khi Sales chốt và `booking_confirmation_status = SENT`.
- Consultation: chọn tour nhưng để trống ngày đi/số khách, đồng ý cho liên hệ, gửi yêu cầu tư vấn. Kiểm tra Supabase có WARM/NEW, Sales và khách nhận đúng email, API chỉ báo SENT sau response xác nhận khớp `lead_id`.
- Nurture: gọi `GET /api/nurture` với `Authorization: Bearer <CRON_SECRET>` khi có lead COLD đã quá 1 ngày, kiểm tra email đến và `nurture_step` tăng 1.

## Chưa làm / chưa xác minh

- Workflow lead (`1_lead_capture.json`) phải được bật và credential/email Sales cập nhật trên instance để xử lý consultation WARM; export `active=false` không chứng minh trạng thái production.
- Export không có node Google Sheets theo chủ đích kiến trúc; không có đồng bộ Sheets tự động trong workflow này.
- Chưa có bằng chứng chạy thật trên n8n, Gmail, Google Sheets của nhóm hoặc trạng thái active trên instance production. Trường `active` trong JSON export không chứng minh workflow đang chạy trên instance của nhóm.

## Cập nhật: hành động `itinerary_delivery`

Workflow `3_nurture_email.json` xử lý thêm hành động `itinerary_delivery`, gửi lịch trình AI Planner ngay khi khách đăng ký (bước 0). Email kèm `plan_summary` và link hủy nhận. Các hành động `tour_suggestions`, `destination_guide`, `trip_checklist`, `intent_check`, `close_file` là bước 1–4 do job `/api/nurture` gọi theo ngày.

Workflow `1_lead_capture.json` xử lý consultation WARM; lịch trình COLD đi thẳng tới webhook nuôi dưỡng.
