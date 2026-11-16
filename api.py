"""Прототип: JSON-бекенд на стандартній бібліотеці Python (без нових залежностей).

Запуск: python api.py  ->  http://localhost:8000
  GET /api/search?q=<назва>               -> [{"name": ..., "edrpou": ...}]
  GET /api/summary?edrpou=<код>[&year=Р]  -> {"years": [...], "summary": {...}, "story": "...", "heatmap": [...]}
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


def api_summary(edrpou: str, year: str | None) -> dict:
    """Усе, що потрібно сторінці для однієї установи й року."""
    data = get_tenders(edrpou)
    years = available_years(data["tenders"])
    if not years:
        return {"years": [], "summary": None, "story": "", "heatmap": []}
    chosen = int(year) if year else years[0]
    summary = build_summary(data, chosen)
    story = write_story(summary) if summary["facts"] else ""
    return {"years": years, "summary": summary, "story": story, "heatmap": make_heatmap(data, chosen)}


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
