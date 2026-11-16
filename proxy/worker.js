// Посередник між сайтом і Google Gemini: ключ лежить ТУТ (секрет Cloudflare), а не в репозиторії.
// Сайт (ai_writer.py) надсилає сюди промпт, а відповідь отримує як {"text": "..."}.
//
// Захист від зловживань: приймаємо лише POST, лише промпт нашого формату й розумного розміру,
// модель і довжина відповіді зафіксовані тут, плюс простий ліміт запитів з однієї адреси.

const MARKER = "ЦИФРИ (єдине джерело";        // є в кожному промпті з build_prompt()
const MAX_PROMPT = 8000;                        // символів
const LIMIT_PER_MINUTE = 30;                    // запитів з однієї IP-адреси
const hits = new Map();                         // IP -> часові мітки (в пам'яті, приблизний ліміт)

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8" } });

function tooMany(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();           // щоб пам'ять не росла безкінечно
  return recent.length > LIMIT_PER_MINUTE;
}

export default {
  async fetch(request, env) {
    if (request.method !== "POST") return json({ error: "Лише POST" }, 405);
    if (tooMany(request.headers.get("CF-Connecting-IP") || "?")) return json({ error: "Забагато запитів, спробуйте за хвилину" }, 429);

    let body;
    try { body = await request.json(); } catch { return json({ error: "Очікується JSON" }, 400); }
    const prompt = String(body.prompt || "");
    if (prompt.length < 50 || prompt.length > MAX_PROMPT || !prompt.includes(MARKER)) return json({ error: "Невірний промпт" }, 400);
    if (!env.GEMINI_API_KEY) return json({ error: "На сервері не задано GEMINI_API_KEY" }, 500);

    const model = env.GEMINI_MODEL || "gemini-3.5-flash-lite";
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const upstream = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { maxOutputTokens: 2048 } }),
    });
    if (!upstream.ok) return json({ error: `Gemini відповів ${upstream.status}` }, upstream.status === 429 ? 429 : 502);

    const data = await upstream.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) return json({ error: "Порожня відповідь моделі" }, 502);
    return json({ text });
  },
};
