# Cấu hình n8n

Hai workflow riêng bạn cung cấp là `1_lead_capture.json` (tư vấn) và `2_booking_confirmation.json` (đặt tour). Import và cấu hình từng workflow trên instance n8n theo các bước dưới đây. Payload lead được lưu ở Supabase trước khi backend gọi webhook.

## Hai webhook riêng

1. Workflow **Lead Capture** xử lý yêu cầu tư vấn qua `POST /webhook/travel-lead`; URL này cấu hình trong biến server `N8N_WEBHOOK_URL`.
2. Workflow **Booking Confirmation** xử lý yêu cầu đặt tour qua `POST /webhook/vietjourney-booking`; URL này cấu hình riêng trong `N8N_BOOKING_WEBHOOK_URL`.
3. Cả hai workflow dùng Header Auth credential với header `X-Automation-Secret`, khớp giá trị `N8N_WEBHOOK_SECRET`. Backend chọn URL theo loại yêu cầu; không dùng chung URL hoặc chuyển booking vào nhánh tư vấn.
4. Ngay sau mỗi Webhook, chuẩn hóa body vì n8n thường đặt payload trong `$json.body`. Dùng Code node:

   ```js
   const lead = $json.body ?? $json;
   if (!lead.lead_id) throw new Error('Missing lead_id');
   return [{ json: lead }];
   ```

   Các node sau dùng output của node này làm dữ liệu. Khi phản hồi, lấy ID từ node chuẩn hóa (ví dụ `{{$node["Normalize Lead"].json.lead_id}}`), không giả định `$json.lead_id` còn tồn tại sau các node email.
5. Chỉ workflow tư vấn phân tuyến theo `lead_level`: `HOT` báo Sales ngay, `WARM` vào hàng đợi follow-up, `COLD` đi luồng nurture phù hợp consent. Không tính lại điểm bằng dữ liệu từ trình duyệt.
6. Workflow booking gửi thông báo cho Sales ngay khi có yêu cầu. Chỉ khi Sales chuyển lead sang `BOOKED`, backend mới gọi lại webhook booking kèm `booking_event: "sales_confirmed"`; nhánh này mới gửi email xác nhận tới khách. Email dùng `booking_price_per_person` làm giá tham khảo, không khẳng định giữ chỗ ngoài những gì Sales đã xác nhận.

## Chống gửi email trùng và phản hồi

- Lưu trạng thái riêng cho từng khóa `lead_id:customer` và `lead_id:sales` trong một kho bền vững. Đánh dấu `PROCESSING` trước khi gửi, chỉ chuyển thành `SENT` sau khi node email thành công; lần retry bỏ qua kênh `SENT` hoặc `PROCESSING`. Lead bị kẹt ở `PROCESSING` cần được đối soát thủ công trước khi gửi lại.
- Đảm bảo hai execution cùng một lead không chạy song song. Nếu cần bảo đảm chống trùng kể cả khi n8n dừng giữa lúc gửi và ghi trạng thái, dùng email service có hỗ trợ idempotency key hoặc một dịch vụ gửi/claim nguyên tử; các node Gmail thông thường không thể bảo đảm exactly-once trong cửa sổ lỗi đó.
- Workflow tư vấn trả `notification_sent: true` sau khi thông báo Sales thành công. Nhánh booking thông thường chỉ trả `sales_email_sent: true`; nhánh có `booking_event: "sales_confirmed"` chỉ trả `customer_email_sent: true`. Mỗi cờ chỉ được trả sau khi node email tương ứng thành công.
- Respond to Webhook phải phản hồi trong timeout 15 giây của backend. Nếu chưa thể xác nhận, không trả cờ `true`; lead sẽ ở `PENDING` để retry.

## Lịch retry và SLA

Repository đã có Vercel Cron gọi `GET /api/retry-notifications` mỗi ngày để retry thông báo `PENDING`/`FAILED`; đây không phải workflow nhắc Sales theo SLA. Nếu cần nhắc lead chưa xử lý, tạo một **Schedule Trigger workflow riêng** lọc lead `NEW` quá ngưỡng SLA, gửi nhắc Sales và lưu dấu lần nhắc/trạng thái xử lý để tránh nhắc lặp. Chốt ngưỡng SLA và kênh thông báo trước khi bật workflow này.

Chi tiết payload, mapping và kiểm thử: [n8n-workflow.md](./n8n-workflow.md). Dùng n8n credentials cho Google Sheets và email; không đặt credential trong Code node hoặc payload.

Chạy lại `docs/supabase-schema.sql` để thêm các cột trạng thái retry email xác nhận booking. Cần cấu hình `SALES_UPDATE_SECRET` và `CRON_SECRET` ở môi trường server. Dashboard có khu vực **Xác nhận booking**: Sales nhập `SALES_UPDATE_SECRET` để mở danh sách tối đa 100 booking gần nhất. Sau đó bấm lần lượt **Đánh dấu đã liên hệ**, **Đánh dấu đã báo giá**, **Xác nhận booking & gửi email**. Backend chỉ gửi email khách ở lần chuyển đầu tiên sang `BOOKED`; nếu gửi lỗi, `booking_confirmation_status` được retry bởi cron. Mã Sales chỉ giữ trong bộ nhớ trang, không lưu vào browser storage.
