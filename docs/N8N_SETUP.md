# Cấu hình n8n

Workflow n8n chưa được export vào repository; hãy cấu hình workflow trên instance n8n theo các bước dưới đây. Payload lead được lưu ở Supabase trước khi backend gọi webhook.

## Workflow nhận lead

1. Tạo **Webhook** nhận `POST`, path chính xác là `travel-lead`, response mode **Using Respond to Webhook**. URL production phải có dạng `https://<n8n-host>/webhook/travel-lead`; đặt URL này trong biến server `N8N_WEBHOOK_URL`.
2. Dùng Header Auth credential với header `X-Automation-Secret`, khớp giá trị `N8N_WEBHOOK_SECRET`. Không đưa URL hoặc secret vào frontend.
3. Ngay sau Webhook, chuẩn hóa body vì n8n thường đặt payload trong `$json.body`. Dùng Code node:

   ```js
   const lead = $json.body ?? $json;
   if (!lead.lead_id) throw new Error('Missing lead_id');
   return [{ json: lead }];
   ```

   Các node sau dùng output của node này làm dữ liệu lead. Khi phản hồi, lấy ID từ node chuẩn hóa (ví dụ `{{$node["Normalize Lead"].json.lead_id}}`), không giả định `$json.lead_id` còn tồn tại sau các node email/Google Sheets.
4. Ghi Google Sheets vào sheet `Leads` bằng **Lookup/Get Rows** theo `lead_id`, rồi chỉ **Append Row** nếu chưa có bản ghi. Lưu `lead_id` cùng các cột liên hệ, tour, `lead_score`, `lead_level`, UTM và consent cần thiết; giới hạn quyền truy cập sheet. Cách này tránh thêm dòng trùng khi webhook được retry.
5. Dùng IF/Switch theo `lead_level` đã tính ở backend: `HOT` báo Sales ngay, `WARM` vào hàng đợi follow-up, `COLD` đi luồng nurture phù hợp consent. Không tính lại điểm bằng dữ liệu từ trình duyệt.
6. Nếu `booking_request === true`, gửi email xác nhận đã nhận yêu cầu cho khách và email đầy đủ thông tin booking cho Sales. `booking_price_per_person` là giá tham khảo từ catalog; email khách phải nói rõ Sales còn cần xác nhận ngày khởi hành và chỗ, chưa phải xác nhận giữ chỗ.

## Chống gửi email trùng và phản hồi

- Lưu trạng thái riêng cho từng khóa `lead_id:customer` và `lead_id:sales` trong một kho bền vững. Đánh dấu `PROCESSING` trước khi gửi, chỉ chuyển thành `SENT` sau khi node email thành công; lần retry bỏ qua kênh `SENT` hoặc `PROCESSING`. Lead bị kẹt ở `PROCESSING` cần được đối soát thủ công trước khi gửi lại.
- Đảm bảo hai execution cùng một lead không chạy song song. Nếu cần bảo đảm chống trùng kể cả khi n8n dừng giữa lúc gửi và ghi trạng thái, dùng email service có hỗ trợ idempotency key hoặc một dịch vụ gửi/claim nguyên tử; các node Gmail thông thường không thể bảo đảm exactly-once trong cửa sổ lỗi đó.
- Với lead thường, chỉ trả `notification_sent: true` sau khi thông báo Sales thành công (`email_sent` chỉ để tương thích workflow cũ). Với booking, chỉ trả `customer_email_sent: true` / `sales_email_sent: true` khi từng email tương ứng đã thành công. Backend chỉ đánh dấu booking `SENT` khi cả hai cờ là `true`.
- Respond to Webhook phải phản hồi trong timeout 15 giây của backend. Nếu chưa thể xác nhận, không trả cờ `true`; lead sẽ ở `PENDING` để retry.

## Lịch retry và SLA

Repository đã có Vercel Cron gọi `GET /api/retry-notifications` mỗi ngày để retry thông báo `PENDING`/`FAILED`; đây không phải workflow nhắc Sales theo SLA. Nếu cần nhắc lead chưa xử lý, tạo một **Schedule Trigger workflow riêng** lọc lead `NEW` quá ngưỡng SLA, gửi nhắc Sales và lưu dấu lần nhắc/trạng thái xử lý để tránh nhắc lặp. Chốt ngưỡng SLA và kênh thông báo trước khi bật workflow này.

Chi tiết payload, mapping và kiểm thử: [n8n-workflow.md](./n8n-workflow.md). Dùng n8n credentials cho Google Sheets và email; không đặt credential trong Code node hoặc payload.
