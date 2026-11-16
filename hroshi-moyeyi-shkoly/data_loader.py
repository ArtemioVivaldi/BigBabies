# Частина 1 — Дані. Інструкція: tasks/1_data.md, контракт: CONTRACTS.md (розділ 1)
import re


def normalize_tender(raw: dict) -> dict:
    """
    Нормалізує сиру закупівлю з Prozorro у формат згідно з CONTRACTS.md.
    """
    tender_id = raw.get("tenderID", "")

    # Витягуємо дату, рік та місяць з tenderID (формат: UA-РРРР-ММ-ДД-...)
    parts = tender_id.split("-")
    date_str = ""
    year = None
    month = None

    if len(parts) >= 4 and parts[1].isdigit() and parts[2].isdigit() and parts[3].isdigit():
        year = int(parts[1])
        month = int(parts[2])
        day = int(parts[3])
        date_str = f"{year:04d}-{month:02d}-{day:02d}"

    # Очищення назви (переноси рядків і подвійні пробіли -> один пробіл)
    raw_title = raw.get("title", "")
    title = " ".join(raw_title.split())

    # Пошук CPV коду (регулярний вираз для форматів типу 55510000-8)
    cpv_match = re.search(r"(\d{8}-\d)", title)
    cpv = cpv_match.group(1) if cpv_match else None

    # Вартість та валюта
    value = raw.get("value", {})
    amount = float(value.get("amount", 0.0))
    currency = value.get("currency", "UAH")
    vat_included = value.get("valueAddedTaxIncluded", False)

    status = raw.get("status", "")

    return {
        "tender_id": tender_id,
        "title": title,
        "amount": amount,
        "currency": currency,
        "vat_included": vat_included,
        "status": status,
        "date": date_str,
        "year": year,
        "month": month,
        "cpv": cpv
    }