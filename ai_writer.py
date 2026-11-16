import json
import os

import requests
from dotenv import load_dotenv

# Крок 1. Читаємо налаштування з файлу .env (ключ лежить тільки там, не в коді)
load_dotenv()
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "gemini")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "")

MONTHS = ["січень", "лютий", "березень", "квітень", "травень", "червень",
          "липень", "серпень", "вересень", "жовтень", "листопад", "грудень"]

# Копія списку з CONTRACTS.md (потрібна для classify_titles; analysis.py не імпортуємо)
CATEGORIES = [
    "Харчування",
    "Комунальні послуги",
    "Ремонт і будівництво",
    "Техніка, зв'язок і програми",
    "Меблі, обладнання і товари",
    "Обслуговування і безпека",
    "Інше",
]


def _money(amount: float) -> str:
    """Округлює суму по-людськи: 2826250 -> '2,83 млн грн', 26005 -> '26 тис. грн'."""
    if amount >= 1_000_000:
        return f"{amount / 1_000_000:.2f}".replace(".", ",") + " млн грн"
    if amount >= 10_000:
        return f"{round(amount / 1000)} тис. грн"
    return f"{round(amount):,}".replace(",", " ") + " грн"


def template_story(summary: dict) -> str:
    """Запасна історія без ШІ: збирається з тих самих цифр за шаблоном."""
    if summary["facts"] is None:
        return f"За {summary['year']} рік завершених закупівель немає."

    name = summary["school"]["name"].title()
    facts = summary["facts"]
    top = summary["by_category"][0]  # категорія з найбільшою сумою
    month = MONTHS[facts["busiest_month"]["month"] - 1]

    return (
        f"## 🎒 {summary['year']} рік: {name}\n\n"
        f"За {summary['year']} рік установа здійснила закупівель: **{summary['tenders_count']}** "
        f"на загальну суму **{_money(summary['total_amount'])}**. "
        f"Це приблизно **{_money(facts['per_day'])} щодня**.\n\n"
        f"Найбільше грошей ({round(top['share'] * 100)}%) пішло на категорію "
        f"**«{top['category']}»** — {_money(top['amount'])}.\n\n"
        f"Найбільша закупівля року — на {_money(facts['biggest']['amount'])}. "
        f"Найдорожчим місяцем став **{month}** — {_money(facts['busiest_month']['amount'])}.\n\n"
        f"А найменша покупка — на {_money(facts['smallest']['amount'])}.\n\n"
        f"*За даними оголошених закупівель у системі Prozorro.*"
    )


def _ask_llm(prompt: str) -> str:
    """Робить один запит до ШІ (Gemini або Groq) і повертає текст відповіді.

    Якщо щось пішло не так (немає ключа, ліміт, мережа) — кидає помилку.
    Її ловить write_story і підставляє шаблонну історію.
    """
    if not LLM_API_KEY:
        raise ValueError("Немає LLM_API_KEY у .env")

    if LLM_PROVIDER == "groq":
        r = requests.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {LLM_API_KEY}"},
            json={"model": LLM_MODEL,
                  "messages": [{"role": "user", "content": prompt}]},
            timeout=30,
        )
        r.raise_for_status()  # помилка HTTP (401, 429...) -> виняток
        return r.json()["choices"][0]["message"]["content"]

    # За замовчуванням — Gemini
    url = ("https://generativelanguage.googleapis.com/v1beta/models/"
           f"{LLM_MODEL}:generateContent")

    config = {"maxOutputTokens": 2048}
    if "2.5" in LLM_MODEL:
        # Лише моделі 2.5 приймають thinkingBudget (0 вимикає «роздуми»).
        # Нові моделі 3.x відповідають на цей параметр помилкою 400, тому їм його не шлемо.
        config["thinkingConfig"] = {"thinkingBudget": 0}

    r = requests.post(
        url,
        params={"key": LLM_API_KEY},
        json={"contents": [{"parts": [{"text": prompt}]}], "generationConfig": config},
        timeout=30,
    )

    r.raise_for_status()
    return r.json()["candidates"][0]["content"]["parts"][0]["text"]


def build_prompt(summary: dict) -> str:
    """Збирає промпт: готові цифри + правила, як писати історію."""
    facts = summary["facts"]
    month = MONTHS[facts["busiest_month"]["month"] - 1]

    # Категорії одним рядком кожна: «Харчування — 5,06 млн грн (53%)»
    categories = "\n".join(
        f"- {c['category']} — {_money(c['amount'])} ({round(c['share'] * 100)}%)"
        for c in summary["by_category"]
    )
    # Топ-5 покупок: «2,83 млн грн, січень: назва»
    top = "\n".join(
        f"- {_money(p['amount'])}, {MONTHS[int(p['date'][5:7]) - 1]}: {p['title']}"
        for p in summary["top_purchases"]
    )

    return f"""Ти пишеш «підсумки року» про витрати школи для батьків, у стилі Spotify Wrapped.

ЦИФРИ (єдине джерело, інших не існує):
Установа: {summary['school']['name']}
Рік: {summary['year']}
Закупівель: {summary['tenders_count']}
Загальна сума: {_money(summary['total_amount'])}
Приблизно щодня: {_money(facts['per_day'])}
Витрати за категоріями:
{categories}
Топ-5 найбільших закупівель:
{top}
Найдорожчий місяць: {month} — {_money(facts['busiest_month']['amount'])}
Найменша покупка: {_money(facts['smallest']['amount'])} — {facts['smallest']['title']}

ВИМОГИ:
- Українська мова, 120–200 слів, формат Markdown.
- Почни із заголовка другого рівня (##) з емодзі, далі 3–5 коротких абзаців.
- Пиши для батьків простими словами, без бюрократизмів
  («послуги їдалень» -> «обіди для дітей», «теплопостачання» -> «опалення»).
- Використовуй ЛИШЕ надані цифри. Нічого не вигадуй і не оцінюй:
  не пиши «переплатили», «дорого», «корупція», «схема» тощо.
- Не вигадуй наслідків і почуттів: описуй лише, на що й скільки витрачено.
- Суми округлюй по-людськи, як у наданих цифрах (наприклад, «2,83 млн грн»).
- Пиши про школу в третій особі, не використовуй «ми» і «наш».
- Не пояснюй, навіщо зроблена покупка, якщо цього немає в цифрах.
- Останнім рядком напиши курсивом: *За даними оголошених закупівель у системі Prozorro.*
"""


def write_story(summary: dict) -> str:
    """Повертає історію для батьків. Ніколи не кидає помилку.

    Рік без закупівель -> коротке повідомлення.
    ШІ недоступний (немає ключа, ліміт, інтернету) -> шаблонна історія.
    """
    if summary["facts"] is None:
        return f"За {summary['year']} рік завершених закупівель немає."

    for _ in range(2):  # дві спроби
        try:
            text = _ask_llm(build_prompt(summary)).strip()
            if len(text) >= 50:
                return text
        except Exception:
            pass
    return template_story(summary)


def classify_titles(titles: list[str]) -> dict[str, str]:
    """Просить ШІ віднести назви закупівель до категорій. При помилці повертає {}."""
    if not titles:
        return {}

    numbered = "\n".join(f"{i + 1}. {t}" for i, t in enumerate(titles))
    prompt = f"""Віднеси кожну закупівлю шкільної установи до однієї категорії зі списку:
{", ".join(CATEGORIES)}

Закупівлі:
{numbered}

Відповідай ЛИШЕ JSON-масивом без пояснень і без markdown, де i-й елемент —
категорія для i-ї закупівлі, наприклад: ["Харчування", "Інше"].
Категорія має точно збігатися з одним зі значень списку."""

    try:
        answer = _ask_llm(prompt).strip()
        # Деякі моделі обгортають JSON у ```json ... ``` — прибираємо
        answer = answer.removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        categories = json.loads(answer)
        if len(categories) != len(titles):
            return {}
        # Залишаємо лише коректні категорії
        return {t: c for t, c in zip(titles, categories) if c in CATEGORIES}
    except Exception:
        return {}


if __name__ == "__main__":
    # Самоперевірка на прикладі з data/samples/
    path = os.path.join(os.path.dirname(__file__), "data", "samples", "summary_2025.json")
    with open(path, encoding="utf-8") as f:
        example = json.load(f)

    print("=== Шаблонна історія ===")
    print(template_story(example))

    print("\n=== Промпт ===")
    print(build_prompt(example))

    print("\n=== write_story (ШІ або шаблон, якщо немає ключа) ===")
    print(write_story(example))

    print("\n=== Рік без закупівель ===")
    empty = dict(example, year=2030, facts=None, total_amount=0, tenders_count=0)
    print(write_story(empty))

    print("\n=== classify_titles ===")
    print(classify_titles(["Ремонт даху", "Обіди для дітей"]))
