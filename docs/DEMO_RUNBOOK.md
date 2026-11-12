# Kịch bản demo & bằng chứng vận hành

Tài liệu này tách rõ **đã kiểm thử trong mã** và **chưa xác nhận trên dịch vụ thật**, để không trình bày nhầm số mô phỏng thành kết quả kinh doanh.

## Trạng thái có thể khẳng định

| Hạng mục | Trạng thái | Bằng chứng |
|---|---|---|
| Luật HOT/WARM/COLD, lead trùng, consent | Đã kiểm thử tự động | `npm test` |
| Consultation WARM ghi Supabase, gọi n8n sau consent, deduplicate 24h | Đã kiểm thử tự động | `tests/consultations.test.mjs` |
| COLD nhận lịch trình và chỉ tiếp tục khi n8n xác nhận | Đã kiểm thử tự động | `tests/itinerary-capture.test.mjs` |
| HOT chỉ gửi Sales; khách chỉ nhận xác nhận sau `BOOKED` | Đã kiểm thử tự động | `tests/lifecycle.test.mjs` |
| Chuỗi COLD ngày 1/3/7/14 và hủy nhận có chữ ký | Đã kiểm thử tự động | `tests/nurture*.test.mjs` |
| KPI chỉ là số tổng hợp; CAC/LTV là mô phỏng | Đã kiểm thử tự động | `tests/kpi*.test.mjs` |
| n8n/Gmail/Sheets production | Chưa xác nhận | Cần chạy checklist dưới đây |

## Thiết lập trước demo

1. Tạo Supabase project, chạy `docs/supabase-schema.sql`, rồi điền các biến trong `.env.example` vào Vercel.
2. Trong n8n, import cả ba JSON workflows. Thay credential, email Sales và Data Table ID mẫu bằng credential của nhóm.
3. Bật ba workflow sau khi test, đặt `N8N_BOOKING_WEBHOOK_URL`, `N8N_LEAD_WEBHOOK_URL` và `N8N_NURTURE_WEBHOOK_URL` bằng webhook **production**. Header Auth phải dùng `X-Automation-Secret` khớp `N8N_WEBHOOK_SECRET`.
4. Deploy Vercel. `CRON_SECRET` bảo vệ hai cron: nurture lúc 02:00 UTC và retry lúc 03:00 UTC.

## Kịch bản trình diễn 3 phút

1. Mở **AI Planner**, tạo lịch trình và nhập email có consent. Kết quả hợp lệ là một COLD lead; email chứa lịch trình tham khảo và link hủy nhận. Nếu n8n không trả `email_sent: true`, giao diện/API chỉ hiển thị trạng thái chờ — không được nói là gửi thành công.
2. Mở trang tour, chọn tour và gửi đặt tour. Kết quả hợp lệ: lead HOT, Sales nhận email; khách **chưa** nhận email xác nhận.
3. Gửi yêu cầu tư vấn với tour đã chọn nhưng bỏ ngày đi/số khách. Kết quả hợp lệ: WARM lead ở Supabase, CRM `NEW`, Sales/khách chỉ được báo email sau ack n8n.
4. Trên Dashboard KPI, mở khu vực Sales bằng `SALES_UPDATE_SECRET`, chuyển booking lần lượt `NEW → CONTACTED → QUOTED → BOOKED`. Chỉ tại bước `BOOKED`, khách mới nhận email xác nhận.
5. Mở Dashboard KPI: nêu rõ visitor/lead là số operational đã ghi nhận, còn CAC/LTV/LTV:CAC là mô phỏng theo `data/kpi-assumptions.json`.

## Checklist chụp bằng chứng

- [ ] Execution n8n thành công cho `itinerary_delivery`, có `email_sent: true`.
- [ ] Inbox nhận lịch trình, giá có nhãn mô phỏng và link hủy nhận hoạt động.
- [ ] Execution booking ban đầu chỉ có `sales_email_sent: true`.
- [ ] Sau `BOOKED`, execution booking có `customer_email_sent: true` và inbox nhận xác nhận.
- [ ] Nếu cần phân tích ngoài dashboard, export/synchronize dữ liệu từ Supabase theo quy trình reporting được cấu hình; Google Sheets không nhận lead trực tiếp từ n8n.
- [ ] Screenshot Dashboard KPI, kèm chú thích dữ liệu tài chính là mô phỏng.

Không đưa email, số điện thoại, URL webhook, secret hay screenshot PII vào slide/báo cáo công khai.
