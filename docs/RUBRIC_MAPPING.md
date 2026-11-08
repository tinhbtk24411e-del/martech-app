# Đối chiếu rubric với trạng thái thực tế

Chỉ ghi "có" khi đã có bằng chứng chạy thật. Các mục "có code" chưa được kiểm chứng trên n8n, Gmail và Supabase của nhóm.

| Tiêu chí | Trọng số | Có trong code | Đã chứng minh chạy thật | Còn thiếu |
|---|---|---|---|---|
| Insight khách hàng | 15% | Phân khúc theo luật, persona trong báo cáo | Không | Khảo sát 30–50 người |
| Journey & Omnichannel | 20% | Hai điểm thu lead (đặt tour, lịch trình email), UTM, visitor | Không | Sơ đồ journey map từ hệ thống thật |
| Martech Stack & AI | 20% | Chatbot, planner, chấm điểm, phân loại HOT/WARM/COLD, nuôi dưỡng | Không | Sơ đồ Martech Stack và Data Flow đã chốt |
| Automation & Sales | 20% | Backend đầy đủ: chống trùng, retry, trạng thái Sales, xác nhận booking, nuôi dưỡng có claim và rollback | Không | Ảnh email thật và lịch sử n8n |
| KPI & Data | 15% | Một nguồn giả định, Excel, dashboard, chất lượng lead, tỷ lệ chốt theo nhóm | Một phần (dữ liệu mô phỏng) | Cập nhật báo cáo và slide theo số mới |
| Thuyết trình | 10% | Tài liệu kiến trúc và giới hạn | Không | Kịch bản demo chạy hai lần, ảnh backup |

Số liệu thống nhất nằm trong `data/kpi-assumptions.json`. Không dùng số cũ 800k CAC và 3,5 triệu giá tour trung bình.
