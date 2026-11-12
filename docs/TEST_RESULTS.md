# Kết quả kiểm thử mã nguồn

Ngày kiểm tra: 12/11/2026 (Asia/Ho_Chi_Minh)

Lệnh đã chạy:

```bash
npm test
```

Baseline trước sửa: **63/63 test passed**, 0 failed. Sau sửa: **70/70 test passed**, 0 failed.

Phạm vi gồm: AI Planner chỉ dùng tour catalog, attribution UTM/direct, tracking consent, consultation lead WARM, lead capture COLD, booking HOT, consent và chống lead trùng, trạng thái PENDING khi n8n chưa xác nhận, state machine Sales, email booking sau `BOOKED`, nurture COLD/WARM, HMAC opt-out, retry, KPI aggregate và validation event tracking.

Đây là kiểm thử đơn vị/tích hợp giả lập của backend; nó không chứng minh n8n, Gmail, Google Sheets, Supabase hay Vercel production đã hoạt động. Bằng chứng chạy thật phải được thu theo `docs/DEMO_RUNBOOK.md`.

Repository không khai báo `npm run build`. Đã thử Vercel CLI local build; CLI dừng trước bước build vì token phiên hiện tại không hợp lệ. Do đó build production chưa được xác nhận.
