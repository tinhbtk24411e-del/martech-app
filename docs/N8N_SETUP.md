# Cấu hình n8n

1. Tạo workflow có **Webhook** nhận `POST`; đặt URL vào `N8N_WEBHOOK_URL` và tạo secret ngẫu nhiên giống `N8N_WEBHOOK_SECRET`.
2. Ở node đầu tiên, kiểm tra header `x-automation-secret`. Sai secret thì dừng workflow.
3. Dùng dữ liệu lead để gửi Gmail. Chỉ sau node gửi mail thành công, Respond to Webhook với JSON `{"email_sent":true}`. Nếu chưa gửi được, trả `{"email_sent":false}` hoặc lỗi.
4. Backend chỉ đánh dấu `SENT` khi nhận `email_sent:true`; mọi timeout/lỗi giữ `PENDING`, vì lead đã được lưu trước đó. Tạo workflow định kỳ trong n8n hoặc tác vụ server để xử lý lại lead PENDING theo chính sách vận hành của bạn.

Không gửi URL webhook hoặc secret vào frontend. Nên dùng credential Gmail của n8n, hạn chế quyền và kiểm tra log workflow khi vận hành.
