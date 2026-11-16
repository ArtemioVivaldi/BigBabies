import json
import os

from dotenv import load_dotenv

# Крок 1. Читаємо налаштування з файлу .env (ключ лежить тільки там, не в коді)
load_dotenv()
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "gemini")
LLM_API_KEY = os.getenv("LLM_API_KEY", "")
LLM_MODEL = os.getenv("LLM_MODEL", "")

MONTHS = ["січень", "лютий", "березень", "квітень", "травень", "червень",
          "липень", "серпень", "вересень", "жовтень", "листопад", "грудень"]


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
        f"За {summary['year']} рік установа провела **{summary['tenders_count']} закупівель** "
        f"на загальну суму **{_money(summary['total_amount'])}**. "
        f"Це приблизно **{_money(facts['per_day'])} щодня**.\n\n"
        f"Найбільше грошей ({round(top['share'] * 100)}%) пішло на категорію "
        f"**«{top['category']}»** — {_money(top['amount'])}.\n\n"
        f"Найбільша закупівля року — на {_money(facts['biggest']['amount'])}. "
        f"Найдорожчим місяцем став **{month}** — {_money(facts['busiest_month']['amount'])}.\n\n"
        f"А найменша покупка — на {_money(facts['smallest']['amount'])}.\n\n"
        f"*За даними оголошених закупівель у системі Prozorro.*"
    )


if __name__ == "__main__":
    # Самоперевірка на прикладі з data/samples/
    path = os.path.join(os.path.dirname(__file__), "data", "samples", "summary_2025.json")
    with open(path, encoding="utf-8") as f:
        example = json.load(f)
    print(template_story(example))
