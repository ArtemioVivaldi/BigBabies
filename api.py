"""Прототип: JSON-бекенд на стандартній бібліотеці Python (без нових залежностей).

Запуск: python api.py  ->  http://localhost:8000
  GET /api/search?q=<назва>               -> [{"name": ..., "edrpou": ...}]
  GET /api/summary?edrpou=<код>[&year=Р]  -> {"years", "summary", "story", "heatmap", "analytics"}
Решта запитів віддає файли з папки web/.
"""
import json
import os
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

from analysis import available_years, build_summary, categorize
from data_loader import get_tenders, search_schools

try:
    from ai_writer import write_story
except ImportError:
    from ai_writer import template_story as write_story

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


def api_summary(edrpou: str, year: str | None) -> dict:
    """Усе, що потрібно сторінці для однієї установи й року."""
    data = get_tenders(edrpou)
    years = available_years(data["tenders"])
    if not years:
        return {"years": [], "summary": None, "story": "", "heatmap": [], "analytics": None}
    chosen = int(year) if year else years[0]
    summary = build_summary(data, chosen)
    story = write_story(summary) if summary["facts"] else ""
    return {"years": years, "summary": summary, "story": story, "heatmap": make_heatmap(data, chosen),
            "analytics": make_analytics(data, chosen, summary)}


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=os.path.join(ROOT, "web"), **kwargs)

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
