# Cấu hình n8n

1. Tạo workflow có **Webhook** nhận `POST`; đặt URL vào `N8N_WEBHOOK_URL` và tạo secret ngẫu nhiên giống `N8N_WEBHOOK_SECRET`.
2. Ở node đầu tiên, kiểm tra header `x-automation-secret`. Sai secret thì dừng workflow.
3. Gửi thông báo cho Sales và dùng `notification_sent:true` trong Respond to Webhook chỉ khi đã xác nhận gửi thông báo. Có thể trả thêm `email_sent:true` khi email đã gửi thành công. Nếu chưa gửi được, trả `notification_sent:false` hoặc lỗi.
4. Backend đánh dấu `SENT` khi `notification_sent:true`; nếu thiếu trường này thì `email_sent:true` vẫn được dùng cho workflow cũ. Lỗi/timeout giữ `PENDING`, vì lead đã được lưu trước đó. Tạo workflow định kỳ trong n8n hoặc tác vụ server để xử lý lại lead PENDING theo chính sách vận hành của bạn.

Không gửi URL webhook hoặc secret vào frontend. Nên dùng credential Gmail của n8n, hạn chế quyền và kiểm tra log workflow khi vận hành.
