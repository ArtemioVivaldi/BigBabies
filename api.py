"""Прототип: JSON-бекенд на стандартній бібліотеці Python (без нових залежностей).

Запуск: python api.py  ->  http://localhost:8000
  GET /api/search?q=<назва>               -> [{"name": ..., "edrpou": ...}]
  GET /api/summary?edrpou=<код>[&year=Р]  -> {"years", "summary", "story", "heatmap", "analytics"}
Решта запитів віддає файли з папки web/.
"""
import json
import os
import time
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from analysis import available_years, build_summary, categorize
from data_loader import get_tenders, search_schools

import ai_writer
from ai_writer import template_story, write_story

ROOT = os.path.dirname(os.path.abspath(__file__))
os.chdir(ROOT)  # data_loader шукає кеш у data/ відносно поточної папки


def make_heatmap(data: dict, year: int) -> list[dict]:
    """Сума по парах (категорія, місяць) для теплової карти."""
    sums = {}
    for tender in data["tenders"]:
        if tender["year"] == year and tender["status"] == "complete":
            key = (categorize(tender), tender["month"])
            sums[key] = sums.get(key, 0.0) + tender["amount"]
    return [{"category": c, "month": m, "amount": round(a, 2)} for (c, m), a in sums.items()]


SIZE_BUCKETS = [("до 10 тис.", 0, 10_000), ("10–100 тис.", 10_000, 100_000),
                ("100 тис. – 1 млн", 100_000, 1_000_000), ("понад 1 млн", 1_000_000, float("inf"))]
STATUS_NAMES = {"complete": "Завершені", "cancelled": "Скасовані", "unsuccessful": "Не відбулися"}


def complete_in(data: dict, year: int) -> list[dict]:
    """Завершені закупівлі за рік."""
    return [t for t in data["tenders"] if t["year"] == year and t["status"] == "complete"]


def cumulative(tenders: list[dict], through_month: int) -> list[float]:
    """Наростаюча сума по місяцях 1..through_month."""
    result, total = [], 0.0
    for month in range(1, through_month + 1):
        total += sum(t["amount"] for t in tenders if t["month"] == month)
        result.append(round(total, 2))
    return result


def make_analytics(data: dict, year: int, summary: dict) -> dict | None:
    """Додаткова аналітика: порівняння з минулим роком, накопичення, розміри закупівель, статуси."""
    current = complete_in(data, year)
    if not current:
        return None
    last_month = max(t["month"] for t in current)  # до якого місяця є дані цього року

    # 1. Порівняння з минулим роком за ТІ САМІ місяці (щоб не порівнювати неповний рік з повним)
    previous = [t for t in complete_in(data, year - 1) if t["month"] <= last_month]
    comparison = None
    if previous:
        by_cat = {}
        for t in current:
            by_cat.setdefault(categorize(t), [0.0, 0.0])[0] += t["amount"]
        for t in previous:
            by_cat.setdefault(categorize(t), [0.0, 0.0])[1] += t["amount"]
        comparison = {
            "year": year - 1, "through_month": last_month,
            "total": round(sum(t["amount"] for t in previous), 2), "count": len(previous),
            "categories": [{"category": c, "amount": round(a, 2), "prev_amount": round(p, 2)}
                           for c, (a, p) in sorted(by_cat.items(), key=lambda kv: -kv[1][0])],
        }

    # 2. Накопичення: крива «скільки витрачено з початку року» цього й минулого року
    cum = {"through_month": last_month, "current": cumulative(current, last_month),
           "previous": cumulative(complete_in(data, year - 1), 12) if complete_in(data, year - 1) else None}

    # 3. Дрібні й великі: скільки закупівель і скільки грошей у кожному розмірі
    total = sum(t["amount"] for t in current) or 1.0
    sizes = []
    for label, low, high in SIZE_BUCKETS:
        group = [t for t in current if low <= t["amount"] < high]
        sizes.append({"label": label, "count": len(group), "amount": round(sum(t["amount"] for t in group), 2)})
    top5 = sum(sorted((t["amount"] for t in current), reverse=True)[:5])
    median = sorted(t["amount"] for t in current)[len(current) // 2]

    # 4. Чим закінчились закупівлі року (усі статуси, не лише завершені)
    statuses = {}
    for t in data["tenders"]:
        if t["year"] == year:
            name = STATUS_NAMES.get(t["status"], "Тривають")
            statuses[name] = statuses.get(name, 0) + 1

    return {"comparison": comparison, "cumulative": cum, "sizes": sizes,
            "top5_share": round(top5 / total, 4), "median": round(median, 2),
            "statuses": [{"status": k, "count": v} for k, v in statuses.items()]}


def make_timeline(data: dict) -> dict | None:
    """Витрати по місяцях за ВЕСЬ час: для кожного місяця — сума і суми окремих закупівель."""
    done = [t for t in data["tenders"] if t["status"] == "complete" and t["year"] and t["month"]]
    if not done:
        return None
    by_month = {}
    for t in done:
        by_month.setdefault((t["year"], t["month"]), []).append(round(t["amount"], 2))
    first, last = min(by_month), max(by_month)
    months, (y, m) = [], first
    while (y, m) <= last:  # без пропусків: місяці без закупівель мають 0
        amounts = sorted(by_month.get((y, m), []), reverse=True)
        months.append({"y": y, "m": m, "amount": round(sum(amounts), 2), "tenders": amounts})
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return {"months": months}


# Прототип: коли у назві закупівлі немає коду CPV, підбираємо категорію за ключовими словами.
# Для кожної категорії беремо «типовий» код CPV, який analysis.categorize вже вміє розпізнавати.
# Порядок важливий: перше слово, що збіглося, вирішує (ремонт перед харчуванням: «ремонт їдальні»).
KEYWORD_RULES = [
    ("45000000-7", ["ремонт", "будівельн", "реконструкц", "капітальн", "монтаж", "покрівл", "фасад", "утеплен",
                    "заміна вікон", "облаштуван", "технічн нагляд", "технічний нагляд", "авторський нагляд",
                    "проєктн", "проектн", "експертиз", "кошторис", "асфальт"]),
    ("09310000-5", ["електрична енергія", "електроенерг", "теплопостач", "теплов", "опален", "природн", "газ ",
                    "водопостач", "водовідвед", "водопровід", "каналізац", "вивезення", "твердих побутових", "сміття", "комунальн",
                    "електричної енергії", "бензин", "дизпаливо", "дизельн", "пальне", "олива", "заправк", "нафтопродукт", "кисень"]),
    ("55510000-8", ["харчуван", "харчов", "продукт", "хліб", "молоч", "м'яс", "м’яс", "овоч", "фрукт", "крупи", "яйця",
                    "їдальн", "обід", "риба", "олія", "цукор", "свіж", "сорту", "сорт ", "дсту", "капуст", "картопл", "яблук",
                    "цибул", "морк", "буряк", "огірк", "банан", "крупа", "яйце", "яйц", "куряч", "хек", "риб", "родзин",
                    "сушен", "макарон", "масло", "сметан", "сир ", "кефір", "горох", "квасол", "рис ", "борошно", "томат",
                    "гарбуз", "часник", "мандарин", "апельсин", "лимон", "чай", "какао", "печиво", "вермішел", "свинин",
                    "яловичин", "філе", "ковбас", "сосиск", "консерв"]),
    ("33600000-6", ["лікарськ", "медикамент", "ліки", "препарат", "реагент", "медичн", "вакцин", "шприц", "рукавич",
                    "перев'язувальн", "перев’язувальн", "імуноглобулін", "антибіотик", "розчин", "діагностичн", "реактив",
                    "хімреактив", "лаборатор", "фармацевтичн", "натрію", "калію", "кальцію", "кислота", "спирт", "перекис",
                    "новокаїн", "фурацилін", "йодид", "хлорид", "бромід", "антисепт", "біосепт", "рентген", "скальпел",
                    "голк", "електрод", "ін'єкц", "ін’єкц", "тест", "глюкометр", "катетер", "бинт", "вата", "марля", "гіпс"]),
    ("30200000-1", ["комп'ютер", "комп’ютер", "ноутбук", "принтер", "картридж", "інтернет", "зв'язок", "зв’язок",
                    "програмн", "сервер", "телефон", "проєктор", "проектор", "мультимедій", "антивірус", "ліцензі",
                    "хостинг", "домен", "моніторинг", "відеокамер", "роутер", "маршрутизатор"]),
    ("79000000-4", ["охорон", "сигналізац", "пожеж", "технічне обслуговування", "технічного обслуговування", "обслуговуван",
                    "дезінфекц", "дератизац", "прибиран", "страхуван", "ліфт", "відеоспостереж", "повірк", "поверк",
                    "послуги з", "послуг з", "тренінг", "навчання", "підвищення кваліфікац"]),
    ("39100000-3", ["меблі", "парт", "стілець", "стільці", "шаф", "канцеляр", "папір", "ліжк", "килим", "посуд", "іграш",
                    "підручник", "книг", "спортивн", "інвентар", "миюч", "господарськ", "одяг", "взуття", "лампа",
                    "освітлювальн", "сантехнік", "інструмент", "обладнання", "матеріал", "засоби", "дошка", "стіл", "диван",
                    "сидіння", "крісл", "тумб", "стелаж", "порошок", "хімічні", "вироби", "апарат", "автомобіл"]),
]


def guess_cpv(title: str) -> str | None:
    """Типовий код CPV за ключовими словами в назві (або None, якщо нічого не підійшло)."""
    text = title.lower() + " "
    for code, words in KEYWORD_RULES:
        if any(word in text for word in words):
            return code
    return None


def with_guessed_cpv(data: dict) -> dict:
    """Копія даних, де закупівлям без коду CPV підставлено код за назвою (оригінал не змінюємо)."""
    tenders = []
    for t in data["tenders"]:
        if not t.get("cpv"):
            code = guess_cpv(t["title"])
            if code:
                t = {**t, "cpv": code}
        tenders.append(t)
    return {**data, "tenders": tenders}


STORY_DIR = "data/stories"


def is_complete(story: str) -> bool:
    """Історія закінчена, якщо ШІ дописав останній рядок із джерелом (його вимагає промпт)."""
    lines = [line for line in story.strip().splitlines() if line.strip()]
    return bool(lines) and "Prozorro" in lines[-1]


def get_story(edrpou: str, year: int, summary: dict) -> tuple[str, str]:
    """Історія для установи й року: (текст, джерело). Джерело: «ai», «template» (ШІ не відповів), «nokey» (ШІ не налаштовано) або «none».

    Вдалу історію від ШІ зберігаємо у data/stories/<ЄДРПОУ>_<рік>.md і далі читаємо з файлу:
    демо стає швидким і не залежить від того, чи відповість ШІ саме зараз.
    Шаблонну історію (коли ШІ недоступний) у кеш НЕ пишемо — наступного разу спробуємо ШІ знову.
    """
    if not summary["facts"]:
        return "", "none"
    path = os.path.join(STORY_DIR, f"{edrpou}_{year}.md")
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            cached = f.read()
        if is_complete(cached):
            return cached, "ai"
    if not ai_writer.ai_available():
        return template_story(summary), "nokey"  # немає ні ключа в .env, ні посередника — ШІ не викликаємо
    # Google часто відповідає 503 («висока навантаженість») приблизно на кожен другий запит,
    # а модель іноді обриває текст. write_story при помилці тихо повертає шаблон, тому
    # тут пробуємо кілька разів із короткою паузою, і лише потім погоджуємось на шаблон.
    for attempt in range(4):
        story = write_story(summary)
        if story != template_story(summary) and is_complete(story):
            os.makedirs(STORY_DIR, exist_ok=True)
            with open(path, "w", encoding="utf-8") as f:
                f.write(story)
            return story, "ai"
        time.sleep(1.5)
    return template_story(summary), "template"


def api_summary(edrpou: str, year: str | None) -> dict:
    """Усе, що потрібно сторінці для однієї установи й року."""
    data = with_guessed_cpv(get_tenders(edrpou))
    years = available_years(data["tenders"])
    if not years:
        return {"years": [], "summary": None, "story": "", "story_source": "none", "heatmap": [], "analytics": None, "timeline": None}
    chosen = int(year) if year else years[0]
    summary = build_summary(data, chosen)
    story, story_source = get_story(edrpou, chosen, summary)
    return {"years": years, "summary": summary, "story": story, "story_source": story_source, "heatmap": make_heatmap(data, chosen),
            "analytics": make_analytics(data, chosen, summary), "timeline": make_timeline(data)}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.join(ROOT, "web"), **kwargs)

    def end_headers(self) -> None:
        # Браузер завжди перевіряє, чи змінились файли сайту (інакше після правок видно стару версію)
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def send_json(self, payload, status: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        url = urlparse(self.path)
        params = parse_qs(url.query)
        try:
            if url.path == "/api/search":
                self.send_json(search_schools(params.get("q", [""])[0].strip()))
            elif url.path == "/api/summary":
                self.send_json(api_summary(params["edrpou"][0], params.get("year", [None])[0]))
            else:
                super().do_GET()  # статичні файли з web/
        except ConnectionError as error:
            self.send_json({"error": str(error)}, 503)
        except KeyError:
            self.send_json({"error": "Не вистачає параметра запиту"}, 400)


if __name__ == "__main__":
    print("Відкрийте http://localhost:8000")
    ThreadingHTTPServer(("", 8000), Handler).serve_forever()
