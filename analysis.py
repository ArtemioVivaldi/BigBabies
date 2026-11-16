# Частина 2 — Аналітика. Інструкція: tasks/2_analysis.md, контракт: CONTRACTS.md (розділ 2)

# Фіксований список категорій (порядок важливий для графіків)
CATEGORIES = [
    "Харчування",
    "Комунальні послуги",
    "Ремонт і будівництво",
    "Техніка, зв'язок і програми",
    "Меблі, обладнання і товари",
    "Обслуговування і безпека",
    "Інше",
]

# Правила: (початок коду CPV, категорія).
# Довгі префікси (3 цифри) стоять ПЕРЕД короткими (2 цифри),
# бо ми беремо першу, що підійшла.
CPV_RULES = [
    # 3-цифрові префікси
    ("904", "Комунальні послуги"),
    ("905", "Комунальні послуги"),
    ("906", "Обслуговування і безпека"),
    ("909", "Обслуговування і безпека"),
    # 2-цифрові префікси
    ("55", "Харчування"),
    ("15", "Харчування"),
    ("45", "Ремонт і будівництво"),
    ("44", "Ремонт і будівництво"),
    ("71", "Ремонт і будівництво"),
    ("09", "Комунальні послуги"),
    ("65", "Комунальні послуги"),
    ("30", "Техніка, зв'язок і програми"),
    ("32", "Техніка, зв'язок і програми"),
    ("38", "Техніка, зв'язок і програми"),
    ("48", "Техніка, зв'язок і програми"),
    ("64", "Техніка, зв'язок і програми"),
    ("72", "Техніка, зв'язок і програми"),
    ("16", "Меблі, обладнання і товари"),
    ("22", "Меблі, обладнання і товари"),
    ("24", "Меблі, обладнання і товари"),
    ("31", "Меблі, обладнання і товари"),
    ("33", "Меблі, обладнання і товари"),
    ("37", "Меблі, обладнання і товари"),
    ("39", "Меблі, обладнання і товари"),
    ("50", "Обслуговування і безпека"),
    ("75", "Обслуговування і безпека"),
    ("79", "Обслуговування і безпека"),
]


def categorize(tender: dict) -> str:
    """Повертає категорію закупівлі за початком коду CPV."""
    cpv = tender.get("cpv")
    if not cpv:  # коду немає (None або порожній рядок)
        return "Інше"
    for prefix, category in CPV_RULES:
        if cpv.startswith(prefix):
            return category
    return "Інше"


def available_years(tenders: list[dict]) -> list[int]:
    """Роки, за які є хоч одна закупівля, від нових до старих."""
    years = []
    for tender in tenders:
        if tender["year"] not in years:
            years.append(tender["year"])
    years.sort(reverse=True)
    return years


def make_record(tender: dict, category: str) -> dict:
    """Короткий опис закупівлі для top_purchases і facts."""
    return {
        "tender_id": tender["tender_id"],
        "title": tender["title"],
        "amount": round(tender["amount"], 2),
        "date": tender["date"],
        "category": category,
    }


def build_summary(data: dict, year: int) -> dict:
    """Рахує «підсумки року» за результатом get_tenders і роком."""
    # 1. Залишаємо лише завершені закупівлі потрібного року
    chosen = []
    for tender in data["tenders"]:
        if tender["year"] == year and tender["status"] == "complete":
            chosen.append(tender)

    # 2. Загальна сума, сума і кількість по категоріях, суми по місяцях
    total = 0.0
    sums = {}    # категорія -> сума
    counts = {}  # категорія -> кількість
    month_sums = {month: 0.0 for month in range(1, 13)}
    records = []  # закупівлі з категорією, для top_purchases і facts
    uncategorized = []
    for tender in chosen:
        category = categorize(tender)
        total += tender["amount"]
        sums[category] = sums.get(category, 0.0) + tender["amount"]
        counts[category] = counts.get(category, 0) + 1
        month_sums[tender["month"]] += tender["amount"]
        records.append(make_record(tender, category))
        if category == "Інше":
            uncategorized.append(tender["title"])

    # 3. Список категорій (лише ті, де є закупівлі), від більшої суми до меншої
    by_category = []
    for category in CATEGORIES:
        if category in counts:
            by_category.append({
                "category": category,
                "amount": round(sums[category], 2),
                "count": counts[category],
                "share": round(sums[category] / total, 4) if total > 0 else 0.0,
            })
    by_category.sort(key=lambda item: item["amount"], reverse=True)

    # 4. Завжди 12 місяців
    by_month = []
    for month in range(1, 13):
        by_month.append({"month": month, "amount": round(month_sums[month], 2)})

    # 5. Найдорожчі закупівлі та цікаві факти
    records.sort(key=lambda item: item["amount"], reverse=True)
    top_purchases = records[:5]

    if len(records) == 0:
        facts = None  # за рік немає закупівель
    else:
        busiest = by_month[0]
        for item in by_month:
            if item["amount"] > busiest["amount"]:
                busiest = item
        facts = {
            "biggest": records[0],
            "smallest": records[-1],
            "busiest_month": dict(busiest),
            "per_day": round(total / 365, 2),
        }

    return {
        "school": data["school"],
        "year": year,
        "total_amount": round(total, 2),
        "tenders_count": len(chosen),
        "by_category": by_category,
        "top_purchases": top_purchases,
        "by_month": by_month,
        "facts": facts,
        "uncategorized_titles": uncategorized,
    }
if __name__ == "__main__":
    # Самоперевірка: python analysis.py
    import json
    import os

    folder = os.path.dirname(os.path.abspath(__file__))
    with open(os.path.join(folder, "data", "22416862.json"), encoding="utf-8") as f:
        data = json.load(f)
    with open(os.path.join(folder, "data", "samples", "summary_2025.json"),
              encoding="utf-8") as f:
        expected = json.load(f)

    summary = build_summary(data, 2025)
    print("Сума:", summary["total_amount"], "| закупівель:", summary["tenders_count"])
    print("Збігається з еталоном:", summary == expected)
    print("Рік без закупівель (2030) працює:", build_summary(data, 2030)["facts"] is None)
