# Ánh xạ rubric A3.1 với mã nguồn và việc còn lại

Bảng này dùng để chuẩn bị thuyết trình: mỗi tiêu chí chỉ đến file cụ thể để bạn mở ra demo hoặc giải thích.

| Tiêu chí (tỷ trọng) | Bằng chứng trong repo | Việc còn lại (ngoài code) |
|---|---|---|
| Insight khách hàng (15%) | Persona và pain point trong báo cáo; `api/_scoring.js` phân nhóm khách (family, budget, resort, explorer) từ sở thích và ngân sách; theo dõi hành vi chỉ khi khách đồng ý (`behavior_tracking`). | Khảo sát hoặc phỏng vấn thật để chứng minh persona; hiện chỉ là giả định, phải nói rõ như vậy. |
| Journey & đa kênh (20%) | Bắt và lưu UTM (`utm_source`, `utm_medium`, `utm_campaign`) trong `api/leads.js`; chatbot gợi ý tour trong catalog để khách chọn gửi booking; dashboard có nhóm theo nguồn. | Kênh Retention (email/Zalo sau tour) mới là thiết kế, chưa triển khai. Nói rõ điều này khi thuyết trình. |
| Martech Stack & AI (20%) | `api/aichat.js` chỉ giới thiệu tour có trong `data/tours.json` và cấm bịa giá, lịch khởi hành, chỗ trống; `api/_scoring.js` chấm điểm lead theo luật, giải thích được; `kpi-model.js` là lớp đo lường. | Model hiện là `openrouter/free` nên có thể bị giới hạn lượt; ghi rõ đây là điểm rủi ro đã biết. |
| Tự động hóa & đồng bộ Sales (20%) | Chống trùng 24 giờ (`api/leads.js`); trạng thái NEW→CONTACTED→QUOTED→BOOKED/LOST có kiểm tra luật và cập nhật có điều kiện (`api/lead-status.js`); thông báo chỉ tính là SENT khi n8n xác nhận, còn lại PENDING và được job retry (`api/retry-notifications.js`). | (1) Export workflow n8n thật thành JSON và đưa vào `n8n/` làm bằng chứng. (2) Đặt `SALES_UPDATE_SECRET` và `CRON_SECRET` trên Vercel. (3) Chưa có giao diện Sales; hiện Sales dùng endpoint hoặc bảng Supabase. |
| Logic KPI & dữ liệu mô phỏng (15%) | Một nguồn giả định `data/kpi-assumptions.json` dùng chung cho dashboard, test và file Excel; `docs/VietJourney-KPI-Simulation.xlsx` có 113 công thức, 4 sheet, không có lỗi; `tests/kpi-model.test.mjs` kiểm tra số liệu base = 15 khách, CAC 1.333.333, LTV:CAC 5,47. | **Báo cáo và slide phải cập nhật theo bảng số dưới đây** (đang còn số cũ từ phiên trước). |
| Thuyết trình & phản biện (10%) | Demo theo kịch bản: nhập nhu cầu → AI → chọn tour → gửi form → lead NEW trong Supabase → email Sales → cập nhật trạng thái → dashboard. | Chạy thử toàn bộ kịch bản trên link production trước giờ thuyết trình; có ảnh backup. |

## Số liệu thống nhất (phải dùng giống nhau ở báo cáo, slide, Excel và dashboard)

| Chỉ số (tháng 1) | Cơ sở | Tốt | Kém |
|---|---|---|---|
| Lượt truy cập | 10.000 | 12.000 | 8.000 |
| Lead rate | 3% | 4% | 2% |
| MQL / Lead | 40% | 45% | 30% |
| SQL / MQL | 50% | 55% | 40% |
| Khách / SQL | 25% | 25% | 20% |
| Khách đặt tour | 15,0 | 29,7 | 3,8 |
| Giá trị tour TB | 5.835.000 | 5.835.000 | 5.835.000 |
| Doanh thu | 87,5 triệu | 173,3 triệu | 22,4 triệu |
| Chi phí marketing | 20 triệu | 20 triệu | 20 triệu |
| CAC | 1.333.333 | 673.401 | 5.208.333 |
| LTV (1,25 lượt mua) | 7.293.750 | 7.293.750 | 7.293.750 |
| LTV : CAC | 5,47x | 10,83x | 1,40x |

Các số cũ cần loại bỏ khỏi báo cáo: CAC 800.000 và 600.000, giá tour trung bình 3,5 triệu, tỷ lệ lead 5%, doanh thu 87,5 triệu với 25 khách.
