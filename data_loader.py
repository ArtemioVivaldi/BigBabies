import os
import re
import json
import time
import requests

# Константи
BASE_URL = "https://prozorro.gov.ua/api/search"
HEADERS = {"User-Agent": "Mozilla/5.0"}
CACHE_DIR = "data"


def _ensure_cache_dir() -> None:
    """Створює папку для кешу, якщо її немає."""
    os.makedirs(CACHE_DIR, exist_ok=True)


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


def search_schools(query: str) -> list[dict]:
    """
    Шукає установи за назвою через API Prozorro.
    Повертає список словників у форматі [{"name": "...", "edrpou": "..."}].
    """
    url = f"{BASE_URL}/organizations"
    params = {"type": "buyer", "value": query}

    try:
        response = requests.post(url, params=params, headers=HEADERS, timeout=15)
        response.raise_for_status()
        data = response.json()

        result = []
        for org in data.get("data", []):
            result.append({
                "name": org.get("name", ""),
                "edrpou": org.get("id", "")
            })
        return result
    except requests.RequestException:
        return []


def get_tenders(edrpou: str, use_cache: bool = True) -> dict:
    """
    Отримує всі закупівлі установи за кодом ЄДРПОУ (з посторінковим завантаженням).
    Зберігає та читає результати з кешу у папці data/.
    """
    _ensure_cache_dir()
    cache_path = os.path.join(CACHE_DIR, f"{edrpou}.json")

    # 1. Перевірка кешу
    if use_cache and os.path.exists(cache_path):
        try:
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            pass
            #пошкоджений кеш ігноруємо і завантажуємо наново

    # 2. Завантаження з мережі
    url = f"{BASE_URL}/tenders"
    all_tenders = []
    school_info = {"name": "", "edrpou": edrpou, "city": ""}

    page = 1
    max_pages = 50

    try:
        while page <= max_pages:
            params = {"buyer[0]": edrpou, "page": page}
            response = requests.post(url, params=params, headers=HEADERS, timeout=15)

            # 429 Too Many Requests
            if response.status_code == 429:
                time.sleep(3)
                continue

            response.raise_for_status()

            payload = response.json()
            page_data = payload.get("data", [])

            if not page_data:
                break

            if page == 1 and page_data:
                proc_entity = page_data[0].get("procuringEntity", {})
                school_info["name"] = proc_entity.get("name", "")
                address = proc_entity.get("address", {})
                school_info["city"] = address.get("locality", "")

            for item in page_data:
                all_tenders.append(normalize_tender(item))

            if len(page_data) < 20:
                break

            page += 1
            time.sleep(0.5)  # Збільшена пауза між сторінками

    except requests.RequestException as e:
        # Якщо мережа впала і немає кешу — кидаємо помилку згідно з контрактом
        if os.path.exists(cache_path):
            with open(cache_path, "r", encoding="utf-8") as f:
                return json.load(f)
        raise ConnectionError("Не вдалося отримати дані з Prozorro. Перевірте інтернет.") from e

    result = {
        "school": school_info,
        "tenders": all_tenders
    }

    # Зберігаємо у кеш
    try:
        with open(cache_path, "w", encoding="utf-8") as f:
            json.dump(result, f, ensure_ascii=False, indent=2)
    except Exception:
        pass

    return result


if __name__ == "__main__":
    print("--- Генерація кешу для кількох шкіл ---")

    # Список запитів для пошуку кількох різних закладів (для демо)
    school_queries = [
        "школа радості",  # Львів (ЄДРПОУ 22416862)
        "кпі",  # Інститут
        "Охмадит", # Дитяча поліклініка
        "музей історії україни у другій світовій"  # Музей
    ]

    for query in school_queries:
        print(f"\nШукаємо за запитом: '{query}'...")
        schools = search_schools(query)

        if schools:
            # Беремо першу знайдену школу зі списку
            target_school = schools[0]
            edrpou = target_school["edrpou"]
            name = target_school["name"]

            print(f"Знайдено: {name} (ЄДРПОУ: {edrpou})")
            print(f"Завантажуємо та кешуємо закупівлі...")

            # Викликаємо get_tenders без кешу, щоб витягнути з мережі та зберегти у data/<ЄДРПОУ>.json
            data = get_tenders(edrpou, use_cache=False)
            print(f"Успішно! Завантажено закупівель: {len(data['tenders'])}. Файл збережено у data/{edrpou}.json")
        else:
            print(f"Нічого не знайдено за запитом '{query}'.")

    print("\nУсі кеші успішно згенеровано у папці data/!")
