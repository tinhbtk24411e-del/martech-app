import { clean, list, method, number, publicTour, send, tours } from './_shared.js';

export const config = { api: { bodyParser: { sizeLimit: '16kb' } } };

function parseGeminiJson(payload) {
  const text = payload?.candidates?.[0]?.content?.parts
    ?.map((part) => part?.text)
    .filter(Boolean)
    .join('')
    .trim();

  if (!text) return null;

  const trimmed = text.replace(/^```json\s*/i, '').replace(/```$/i, '').trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export default async function handler(req, res) {
  if (!method(req, res)) return;

  const b = req.body || {};
  const destination = clean(b.destination, 100);
  const duration = number(b.duration, 1, 60);
  const budget = number(b.budget, 0, 1_000_000_000);
  const partySize = number(b.party_size, 1, 30);
  const interests = list(b.interests);

  if (!destination || !duration || budget === null || !partySize) {
    return send(res, 400, { error: 'Vui lòng nhập điểm đến, thời lượng, ngân sách và số người hợp lệ.' });
  }

  if (!process.env.GEMINI_API_KEY) {
    return send(res, 503, { error: 'AI Planner chưa được cấu hình. Vui lòng thử lại sau.' });
  }

  try {
    const activeTours = await tours();
    const facts = activeTours.map(publicTour);

    if (!activeTours.length) {
      return send(res, 200, {
        itinerary: [{
          day: 'Ngày 1',
          title: 'Khởi đầu với trải nghiệm phù hợp',
          activities: ['Chọn mức ngân sách và sở thích phù hợp để VietJourney tư vấn hành trình cụ thể.']
        }],
        matchedTours: [],
        advice: ['Chưa có tour cố định, liên hệ để báo giá riêng.']
      });
    }

    const prompt = `Bạn là trợ lý lập kế hoạch du lịch VietJourney Tours. Trả lời bằng tiếng Việt thân thiện, ngắn gọn và trả về JSON HỢP LỆ, không markdown, đúng schema: {"itinerary":[{"day":"Ngày 1","title":"...","activities":["..."]}],"matchedTours":[{"id":"id từ dữ liệu","reason":"..."}],"advice":["..."]}.
Quy tắc bắt buộc: chỉ dùng giá, dịch vụ, lịch khởi hành và thông tin tour trong DỮ LIỆU TOUR; chỉ chọn active; không khẳng định còn/hết chỗ; phân biệt lịch trình tham khảo với tour có sẵn; không có tour thì matchedTours=[] và lời khuyên phải nói “Chưa có tour cố định, liên hệ để báo giá riêng”; ngân sách thấp hơn giá tour thì nêu mức chênh; không bịa dữ kiện tour.
Yêu cầu khách (không có PII): điểm đến ${destination}; ${duration} ngày; ngân sách/người ${budget} VND; ${partySize} người; thời gian ${clean(b.travel_date, 30) || 'chưa xác định'}; sở thích ${interests.join(', ') || 'chưa nêu'}.
DỮ LIỆU TOUR: ${JSON.stringify(facts)}`;

    const model = clean(process.env.GEMINI_MODEL || 'gemini-2.5-flash', 80);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 18_000);

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: 'application/json', temperature: 0.25, maxOutputTokens: 1800 },
        }),
      }
    );

    clearTimeout(timer);
    if (!response.ok) throw new Error('Gemini unavailable');

    const result = parseGeminiJson(await response.json());
    if (!result || typeof result !== 'object') {
      throw new Error('Invalid Gemini response');
    }

    const byId = new Map(activeTours.map((t) => [String(t.id), publicTour(t)]));
    const matchedTours = Array.isArray(result.matchedTours)
      ? result.matchedTours
          .filter((x) => byId.has(String(x.id)))
          .slice(0, 6)
          .map((x) => ({ ...byId.get(String(x.id)), reason: clean(x.reason, 240) }))
      : [];

    return send(res, 200, {
      itinerary: Array.isArray(result.itinerary) ? result.itinerary.slice(0, 14) : [],
      matchedTours,
      advice: Array.isArray(result.advice)
        ? result.advice.slice(0, 6).map((x) => clean(x, 300))
        : [],
    });
  } catch {
    return send(res, 502, { error: 'Không thể tạo lịch trình lúc này. Vui lòng thử lại sau.' });
  }
}
