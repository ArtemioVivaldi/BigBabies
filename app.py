"""Частина 4 — інтерфейс Streamlit «Гроші моєї школи».

Запуск: streamlit run app.py
Поки інші модулі не готові, дані беруться з приклада в data/samples/.
"""
import json
from pathlib import Path

import pandas as pd  # ставиться разом зі streamlit
import streamlit as st

# Папка з прикладами
SAMPLES = Path(__file__).parent / "data" / "samples"

# Кольори (палітра теми лежить у .streamlit/config.toml)
ACCENT = "#F4A97A"
CATEGORY_COLORS = ["#F4A97A", "#B7C9CC", "#5FB3A6", "#E8C468", "#E07A7A", "#9A8FC9", "#7FA6D6"]

MONTHS = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"]


# ---------- Два «перемикачі»: звідки беремо дані ----------

def load_summary() -> dict:
    """Підсумки року. Зараз — приклад із файлу."""
    # Після інтеграції замінити на:
    # return build_summary(get_tenders(edrpou), year)
    with open(SAMPLES / "summary_2025.json", encoding="utf-8") as f:
        return json.load(f)


def load_story(summary: dict) -> str:
    """Історія від ШІ. Зараз — приклад із файлу."""
    # Після інтеграції замінити на:
    # return write_story(summary)
    return (SAMPLES / "story_2025.md").read_text(encoding="utf-8")


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
        .big-number {border-top: 2px solid #F4A97A; padding-top: 0.6rem;}
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
        st.vega_lite_chart(months, {
            "height": 280,
            "mark": {"type": "line", "color": ACCENT, "point": True, "interpolate": "linear"},
            "encoding": {
                "x": {"field": "Місяць", "type": "ordinal", "title": "Місяць",
                      "sort": {"field": "month"}, "axis": {"labelAngle": 0}},
                "y": {"field": "amount", "type": "quantitative", "title": "Сума, грн",
                      "scale": {"domainMin": 0}},
            },
        })
        source_note("сума закупівель за місяцями")


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

st.title("🎒 Гроші моєї школи")
st.write("Підсумки року для бюджету школи — простою мовою, на відкритих даних Prozorro.")

# Пошук (поки заглушка — працюватиме після інтеграції)
st.text_input("Назва школи", value="школа радості", disabled=True)

summary = load_summary()
school = summary["school"]
st.header(f"{school['name'].capitalize()} · {summary['year']}")
st.caption(school["city"])

show_metrics(summary)

st.divider()
st.markdown(load_story(summary))

st.divider()
show_charts(summary)
show_top_purchases(summary)

st.divider()
st.caption("Джерело: Prozorro (prozorro.gov.ua). Суми — очікувана вартість завершених закупівель; "
           "фактичні суми договорів можуть дещо відрізнятися.")
