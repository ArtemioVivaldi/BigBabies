"""Частина 4 — інтерфейс Streamlit «Гроші моєї школи».

Запуск: streamlit run app.py
Дані: data_loader -> analysis -> ai_writer (див. CONTRACTS.md).
"""
import os
from pathlib import Path

import pandas as pd  # ставиться разом зі streamlit
import streamlit as st
from streamlit_searchbox import st_searchbox  # поле з підказками під час введення

from analysis import CATEGORIES, available_years, build_summary, categorize
from data_loader import get_tenders, search_schools

try:
    from ai_writer import write_story  # історія від ШІ (коли буде готова)
except ImportError:
    from ai_writer import template_story as write_story  # запасний варіант за шаблоном

# data_loader шукає кеш у папці data/ відносно поточної папки — тому стаємо в корінь проєкту
os.chdir(Path(__file__).parent)

# Кольори (палітра теми лежить у .streamlit/config.toml)
CREAM = "#F5E2C5"
INK = "#050505"
ACCENT = "#2F752C"  # зелений
CATEGORY_COLORS = ["#2F752C", "#C0B623", "#26728A", "#619206", "#050505", "#8A7B3C", "#B58A3C"]

MONTHS = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"]


# ---------- Дані (з кешем, щоб не повторювати запити при кожному кліку) ----------

@st.cache_data(show_spinner=False)
def cached_search(query: str) -> list[dict]:
    """Пошук установ за назвою."""
    return search_schools(query)


@st.cache_data(show_spinner=False)
def cached_tenders(edrpou: str) -> dict:
    """Усі закупівлі установи (з файлового кешу або з Prozorro)."""
    return get_tenders(edrpou)


@st.cache_data(show_spinner=False)
def cached_story(summary: dict) -> str:
    """Історія для підсумків року."""
    return write_story(summary)


# ---------- Допоміжні функції відображення ----------

def money(amount: float) -> str:
    """Форматує суму: 9491914 -> '9 491 914 грн'."""
    return f"{amount:,.0f}".replace(",", " ") + " грн"


def big_number(label: str, value: str, note: str) -> str:
    """HTML однієї «великої цифри»: підпис, число, пояснення."""
    return (
        f'<div class="big-number"><div class="bn-label">{label}</div>'
        f'<div class="bn-value">{value}</div><div class="bn-note">{note}</div></div>'
    )


def show_metrics(summary: dict) -> None:
    """Три великі цифри у стилі «Bonn in drei Zahlen»."""
    st.markdown(
        """<style>
        .big-number {border-top: 2px solid #050505; padding-top: 0.6rem;}
        .bn-label {font-size: 0.85rem; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.05em;}
        .bn-value {font-size: 2.6rem; font-weight: 800; line-height: 1.15;}
        .bn-note {font-size: 0.9rem; opacity: 0.7;}
        </style>""",
        unsafe_allow_html=True,
    )
    col1, col2, col3 = st.columns(3)
    col1.markdown(big_number("Витрачено за рік", money(summary["total_amount"]),
                             "завершені закупівлі"), unsafe_allow_html=True)
    col2.markdown(big_number("Закупівель", str(summary["tenders_count"]),
                             "окремих покупок за рік"), unsafe_allow_html=True)
    col3.markdown(big_number("Щодня", money(summary["facts"]["per_day"]),
                             "у середньому за 365 днів"), unsafe_allow_html=True)


def source_note(text: str = "") -> None:
    """Підпис джерела під блоком (як на was-kostet-bonn.de)."""
    st.caption(f"Джерело: [Prozorro](https://prozorro.gov.ua) · {text}".rstrip(" ·"))


def show_charts(summary: dict) -> None:
    """Графік за категоріями і графік по місяцях."""
    left, right = st.columns(2)

    with left:
        st.subheader("На що пішли гроші")
        categories = pd.DataFrame(summary["by_category"])
        # Горизонтальні стовпці: назви категорій читаються повністю, легенда не потрібна.
        # sort=None залишає порядок «від більшої суми до меншої»
        names = list(categories["category"])
        st.vega_lite_chart(categories, {
            "height": 280,
            "mark": "bar",
            "encoding": {
                "y": {"field": "category", "type": "nominal", "sort": None, "title": None,
                      "axis": {"labelLimit": 220}},
                "x": {"field": "amount", "type": "quantitative", "title": "Сума, грн"},
                "color": {"field": "category", "legend": None,
                          "scale": {"domain": names, "range": CATEGORY_COLORS[:len(names)]}},
            },
        })
        source_note("очікувана вартість завершених закупівель")

    with right:
        st.subheader("Скільки по місяцях")
        months = pd.DataFrame(summary["by_month"])
        months["Місяць"] = [MONTHS[m - 1] for m in months["month"]]
        # st.line_chart сортує підписи за алфавітом, тому малюємо через vega-lite
        # і прямо кажемо: сортувати за номером місяця
        peak = summary["facts"]["busiest_month"]["month"]  # місяць з найбільшою сумою
        x_month = {"field": "Місяць", "type": "ordinal", "title": "Місяць",
                   "sort": MONTHS, "scale": {"domain": MONTHS}, "axis": {"labelAngle": 0}}
        st.vega_lite_chart(months, {
            "height": 280,
            "layer": [
                # 1) світла смуга на місяці-піку (як «optimization range» у макеті)
                {"transform": [{"filter": f"datum.month == {peak}"}],
                 "mark": {"type": "bar", "color": "#C0B623", "opacity": 0.35},
                 "encoding": {"x": x_month, "y": {"value": 0}, "y2": {"value": "height"}}},
                # 2) сама лінія з точками
                {"mark": {"type": "line", "color": ACCENT, "point": {"color": ACCENT},
                          "interpolate": "linear"},
                 "encoding": {"x": x_month,
                              "y": {"field": "amount", "type": "quantitative", "title": "Сума, грн",
                                    "scale": {"domainMin": 0}}}},
                # 3) підпис суми над піком
                {"transform": [{"filter": f"datum.month == {peak}"}],
                 "mark": {"type": "text", "dy": -12, "fontWeight": "bold", "color": INK},
                 "encoding": {"x": x_month,
                              "y": {"field": "amount", "type": "quantitative"},
                              "text": {"field": "amount", "type": "quantitative", "format": ",.0f"}}},
            ],
        })
        source_note("сума закупівель за місяцями")


def show_heatmap(data: dict, year: int) -> None:
    """Теплова карта: скільки грошей пішло на кожну категорію в кожному місяці."""
    rows = []
    for tender in data["tenders"]:
        if tender["year"] == year and tender["status"] == "complete":
            rows.append({"category": categorize(tender), "month": tender["month"],
                         "amount": tender["amount"]})
    table = pd.DataFrame(rows).groupby(["category", "month"], as_index=False)["amount"].sum()
    table["Місяць"] = [MONTHS[m - 1] for m in table["month"]]

    st.subheader("Коли і на що йшли гроші")
    st.vega_lite_chart(table, {
        "height": 300,
        "mark": {"type": "rect", "stroke": CREAM, "strokeWidth": 2},
        "encoding": {
            "x": {"field": "Місяць", "type": "ordinal", "title": None,
                  "sort": MONTHS, "scale": {"domain": MONTHS}, "axis": {"labelAngle": 0}},
            "y": {"field": "category", "type": "nominal", "title": None,
                  "sort": CATEGORIES, "scale": {"domain": CATEGORIES}, "axis": {"labelLimit": 220}},
            "color": {"field": "amount", "type": "quantitative", "legend": None,
                      "scale": {"range": ["#EDE3B8", "#C0B623", "#619206", "#2F752C"]}},
            "tooltip": [{"field": "category", "title": "Категорія"},
                        {"field": "Місяць"},
                        {"field": "amount", "title": "Сума, грн", "format": ",.0f"}],
        },
    })
    source_note("чим темніший квадрат, тим більше грошей; порожньо — закупівель не було")


def show_top_purchases(summary: dict) -> None:
    """Таблиця «Топ-5 покупок» з посиланнями на Prozorro."""
    st.subheader("Топ-5 найбільших покупок")
    rows = []
    for p in summary["top_purchases"]:
        rows.append({
            "Що купували": p["title"],
            "Категорія": p["category"],
            "Дата": p["date"],
            "Сума": p["amount"],
            "Prozorro": f"https://prozorro.gov.ua/tender/{p['tender_id']}",
        })
    st.dataframe(
        pd.DataFrame(rows),
        hide_index=True,
        use_container_width=True,
        column_config={
            "Сума": st.column_config.NumberColumn(format="%.0f грн"),
            "Prozorro": st.column_config.LinkColumn(display_text="відкрити"),
        },
    )
    source_note("кожен рядок має посилання на оригінал")


# ---------- Сторінка ----------

st.set_page_config(page_title="Гроші моєї школи", page_icon="🎒", layout="wide")

# Загальні стилі: серифні заголовки, темний hero-блок (як у стилі Clarity)
st.markdown(
    """<style>
    h1, h2, h3, .hero-title, .bn-value {font-family: Georgia, "Times New Roman", serif !important;
        font-weight: 400 !important; letter-spacing: -0.01em;}
    .hero {background: #050505; color: #F5E2C5; border-radius: 14px; padding: 3rem 2.5rem;
        text-align: center; margin-bottom: 1.5rem;}
    .hero-title {font-size: 3rem; line-height: 1.1; margin: 1rem 0 0.8rem 0;}
    .hero-text {color: #DDD7A3; font-size: 1.05rem; max-width: 42rem; margin: 0 auto;}
    .pill.dark {border-color: #050505; color: #050505;}
    .pill {display: inline-block; border: 1px solid #DDD7A3; color: #DDD7A3; border-radius: 999px;
        padding: 0.15rem 0.8rem; font-size: 0.8rem;}
    </style>""",
    unsafe_allow_html=True,
)
st.markdown(
    # Увага: у HTML без відступів, інакше Markdown вважає рядки кодом
    '<div class="hero"><span class="pill">Відкриті дані Prozorro</span>'
    '<div class="hero-title">Куди пішли гроші<br>вашої установи</div>'
    '<div class="hero-text">Підсумки року для бюджету будь-якої установи — простою мовою, '
    'з графіками й історією, яку пише штучний інтелект.</div></div>',
    unsafe_allow_html=True,
)

# 1. Пошук установи: починаємо вводити назву — і список підказок оновлюється одразу
def suggest_schools(text: str) -> list[tuple[str, str]]:
    """Підказки для поля пошуку: пари (назва для показу, ЄДРПОУ)."""
    if len(text.strip()) < 3:
        return []
    return [(school["name"].capitalize(), school["edrpou"])
            for school in cached_search(text.strip())]


edrpou = st_searchbox(
    suggest_schools,
    label="Назва установи: школа, садочок, лікарня, міська рада…",
    placeholder="Почніть вводити назву, наприклад «школа радості» або «лікарня»",
    key="school_search",
)
if not edrpou:
    st.info("Введіть хоча б 3 літери назви й оберіть установу зі списку.")
    st.stop()

# 2. Завантаження закупівль і вибір року
try:
    with st.spinner("Завантажуємо закупівлі з Prozorro…"):
        data = cached_tenders(edrpou)
except ConnectionError as error:
    st.error(str(error))
    st.stop()

years = available_years(data["tenders"])
if not years:
    st.warning("У цієї установи немає закупівель у Prozorro.")
    st.stop()
year = st.selectbox("Рік", years)

# 3. Підсумки
summary = build_summary(data, year)
school = summary["school"]
st.header(school["name"].capitalize())
st.markdown(  # пілюлі-мітки: місто і рік (без відступів у HTML!)
    f'<span class="pill dark">{school["city"]}</span> <span class="pill dark">{year} рік</span>',
    unsafe_allow_html=True,
)

if summary["facts"] is None:
    st.info(f"За {year} рік немає завершених закупівель. Спробуйте інший рік.")
    st.stop()

show_metrics(summary)

st.divider()
st.markdown(cached_story(summary))

st.divider()
show_charts(summary)
show_heatmap(data, year)
show_top_purchases(summary)

st.divider()
st.markdown(
    "<style>.footer {background: #050505; color: #F5E2C5; border-radius: 14px; padding: 2rem 2.5rem 1rem;"
    " margin-top: 1rem;} .footer-note {color: #DDD7A3; font-size: 0.85rem; max-width: 46rem;}"
    " .footer-word {font-family: Georgia, serif; font-size: clamp(2.5rem, 9vw, 7rem); line-height: 1;"
    " margin-top: 1.5rem; white-space: nowrap; overflow: hidden;}</style>"
    '<div class="footer"><div class="footer-note">Джерело: '
    '<a href="https://prozorro.gov.ua" style="color:#C0B623">Prozorro</a>. Суми — очікувана вартість '
    "завершених закупівель; фактичні суми договорів можуть дещо відрізнятися.</div>"
    '<div class="footer-word">Гроші моєї школи</div></div>',
    unsafe_allow_html=True,
)
