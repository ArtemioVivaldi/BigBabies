// Фронтенд-прототип: звичайний JavaScript без бібліотек.
// Дані приходять з Python-бекенду (api.py) у форматі JSON.

const MONTHS = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];
const CATEGORIES = ["Харчування", "Комунальні послуги", "Ремонт і будівництво", "Техніка, зв'язок і програми",
  "Меблі, обладнання і товари", "Обслуговування і безпека", "Інше"];
const COLORS = ["#f2a122", "#1f7a8c", "#5b8def", "#8c6bb1", "#6b7280", "#2f9e6f", "#c25b56"];

const $ = (id) => document.getElementById(id);
const money = (n) => Math.round(n).toLocaleString("uk-UA").replace(/ /g, " ") + " грн";
const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

let currentEdrpou = null;

// ---------- Запити до бекенду ----------

async function getJson(url) {
  const response = await fetch(url);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Помилка сервера");
  return data;
}

function showMessage(text, isError = false) {
  const box = $("message");
  box.textContent = text;
  box.className = "message" + (isError ? " error" : "");
  box.hidden = !text;
}

// ---------- Пошук з підказками ----------

let searchTimer = null;
$("q").addEventListener("input", () => {
  clearTimeout(searchTimer);  // чекаємо 250 мс після останньої літери
  searchTimer = setTimeout(runSearch, 250);
});
document.addEventListener("click", (e) => { if (!e.target.closest(".search")) $("suggestions").hidden = true; });
// Обидві кнопки «Знайти установу» переводять курсор у поле пошуку
for (const id of ["cta-hero", "cta-nav"]) $(id).addEventListener("click", () => setTimeout(() => $("q").focus({ preventScroll: true }), 600));

async function runSearch() {
  const text = $("q").value.trim();
  const list = $("suggestions");
  if (text.length < 3) { list.hidden = true; return; }
  try {
    const schools = await getJson("/api/search?q=" + encodeURIComponent(text));
    list.innerHTML = schools.length ? "" : "<li>Нічого не знайдено</li>";
    for (const school of schools) {
      const li = document.createElement("li");
      li.textContent = capitalize(school.name);
      li.onclick = () => { $("q").value = capitalize(school.name); list.hidden = true; loadSchool(school.edrpou, null, true); };
      list.appendChild(li);
    }
    list.hidden = false;
  } catch (error) {
    showMessage(error.message, true);
  }
}

// ---------- Завантаження й показ підсумків ----------

async function loadSchool(edrpou, year, scroll = false) {
  currentEdrpou = edrpou;
  showMessage("Завантажуємо закупівлі з Prozorro…");
  try {
    const url = "/api/summary?edrpou=" + edrpou + (year ? "&year=" + year : "");
    const data = await getJson(url);
    if (!data.years.length) { setResult(false); return showMessage("У цієї установи немає закупівель у Prozorro."); }
    render(data);
    showMessage(data.summary.facts ? "" : "За цей рік немає завершених закупівель. Спробуйте інший рік.");
    if (scroll) $("numbers").scrollIntoView({ behavior: "smooth" });
  } catch (error) {
    setResult(false);
    showMessage(error.message, true);
  }
}

// Показати/сховати блок результату й посилання на нього в шапці
function setResult(visible) {
  $("result").hidden = !visible;
  document.querySelectorAll(".nav-result").forEach((a) => { a.hidden = !visible; });
}

function render(data) {
  const s = data.summary;
  setResult(true);
  $("school-name").textContent = capitalize(s.school.name);
  $("pills").innerHTML = `<span class="pill">${esc(s.school.city)}</span><span class="pill">${s.year} рік</span>`;

  $("years").innerHTML = "";
  for (const y of data.years) {
    const b = document.createElement("button");
    b.className = "year-btn" + (y === s.year ? " active" : "");
    b.textContent = y;
    b.onclick = () => loadSchool(currentEdrpou, y);
    $("years").appendChild(b);
  }

  for (const id of ["numbers-grid", "story-text", "chart-categories", "chart-months", "chart-heatmap", "top5-table"]) $(id).innerHTML = "";
  if (s.facts) {
    $("numbers-grid").innerHTML =
      number("Витрачено за рік", money(s.total_amount), "завершені закупівлі") +
      number("Закупівель", s.tenders_count, "окремих покупок за рік") +
      number("Щодня", money(s.facts.per_day), "у середньому за 365 днів");
    $("story-text").innerHTML = markdown(data.story);
    $("chart-categories").innerHTML = barChart(s.by_category);
    $("chart-months").innerHTML = lineChart(s.by_month, s.facts.busiest_month.month);
    $("chart-heatmap").innerHTML = heatmap(data.heatmap);
    $("top5-table").innerHTML = topTable(s.top_purchases);
  }
  armReveal();
}

const number = (label, value, note) =>
  `<div class="num reveal"><div class="num-label">${label}</div><div class="num-value">${value}</div><div class="num-note">${note}</div></div>`;

// Дуже проста обробка Markdown: заголовки, жирний, курсив, абзаци
function markdown(text) {
  return esc(text).split(/\n\s*\n/).map((block) => {
    const html = block.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>");
    const heading = html.match(/^#{1,3}\s+(.*)$/);
    return heading ? `<h2>${heading[1]}</h2>` : `<p>${html.replace(/\n/g, " ")}</p>`;
  }).join("");
}

// ---------- Графіки (чистий SVG, без анімацій) ----------

function barChart(rows) {
  const W = 520, rowH = 40, left = 190, H = rows.length * rowH + 10, max = Math.max(...rows.map((r) => r.amount));
  let svg = `<svg viewBox="0 0 ${W} ${H}">`;
  rows.forEach((r, i) => {
    const y = i * rowH + 4, w = ((W - left - 70) * r.amount) / max;
    const color = COLORS[CATEGORIES.indexOf(r.category)] || COLORS[6];
    svg += `<text x="${left - 8}" y="${y + 19}" text-anchor="end" font-size="12">${esc(r.category)}</text>`;
    svg += `<rect x="${left}" y="${y}" width="${w}" height="26" rx="13" fill="${color}"><title>${money(r.amount)}</title></rect>`;
    svg += `<text x="${left + w + 8}" y="${y + 18}" font-size="12">${Math.round(r.share * 100)}%</text>`;
  });
  return svg + "</svg>";
}

function lineChart(months, peak) {
  const W = 520, H = 300, l = 52, r = 10, t = 24, b = 30, max = Math.max(...months.map((m) => m.amount)) * 1.1 || 1;
  const x = (i) => l + ((W - l - r) * i) / 11, y = (v) => t + (H - t - b) * (1 - v / max);
  let svg = `<svg viewBox="0 0 ${W} ${H}">`;
  for (let k = 0; k <= 4; k++) {  // горизонтальні лінії сітки
    const v = (max * k) / 4;
    svg += `<line x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" stroke-opacity=".12"/>` +
           `<text x="${l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill-opacity=".7">${(v / 1e6).toFixed(1)} млн</text>`;
  }
  svg += `<rect x="${x(peak - 1) - 14}" y="${t}" width="28" height="${H - t - b}" fill="#f2a122" opacity="0.18"/>`;  // смуга піку
  svg += `<polyline fill="none" stroke="#f2a122" stroke-width="2.5" stroke-linejoin="round" points="${months.map((m, i) => x(i) + "," + y(m.amount)).join(" ")}"/>`;
  months.forEach((m, i) => {
    svg += `<circle cx="${x(i)}" cy="${y(m.amount)}" r="3.5" fill="#f2a122"><title>${MONTHS[i]}: ${money(m.amount)}</title></circle>`;
    svg += `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" font-size="11">${MONTHS[i]}</text>`;
  });
  const p = months[peak - 1], leftSide = peak <= 2;  // біля лівого краю підпис праворуч від точки
  svg += `<text x="${x(peak - 1) + (leftSide ? 12 : 0)}" y="${y(p.amount) + (leftSide ? 4 : -10)}" text-anchor="${leftSide ? "start" : "middle"}" font-size="12" font-weight="bold">${money(p.amount)}</text>`;
  return svg + "</svg>";
}

function heatmap(cells) {
  const W = 1000, left = 200, cw = (W - left) / 12, ch = 34, H = CATEGORIES.length * ch + 30;
  const max = Math.max(...cells.map((c) => c.amount), 1);
  const opacity = (v) => [0.3, 0.55, 0.8, 1][Math.min(3, Math.floor((v / max) * 3.999))];
  let svg = `<svg viewBox="0 0 ${W} ${H}">`;
  CATEGORIES.forEach((c, i) => {
    svg += `<text x="${left - 8}" y="${i * ch + 22}" text-anchor="end" font-size="13">${esc(c)}</text>`;
    for (let j = 0; j < 12; j++) {  // порожні клітинки — ледь помітні, для орієнтиру
      svg += `<rect x="${left + j * cw + 1}" y="${i * ch + 2}" width="${cw - 2}" height="${ch - 4}" rx="6" fill="currentColor" fill-opacity=".06"/>`;
    }
  });
  MONTHS.forEach((m, j) => { svg += `<text x="${left + j * cw + cw / 2}" y="${H - 8}" text-anchor="middle" font-size="12">${m}</text>`; });
  for (const c of cells) {
    const i = CATEGORIES.indexOf(c.category), j = c.month - 1;
    svg += `<rect x="${left + j * cw + 1}" y="${i * ch + 2}" width="${cw - 2}" height="${ch - 4}" rx="6" fill="#f2a122" fill-opacity="${opacity(c.amount)}">` +
           `<title>${c.category}, ${MONTHS[j]}: ${money(c.amount)}</title></rect>`;
  }
  return svg + "</svg>";
}

function topTable(purchases) {
  const rows = purchases.map((p) => `<tr><td>${esc(p.title)}</td><td>${esc(p.category)}</td><td>${p.date}</td>` +
    `<td class="amount">${money(p.amount)}</td><td><a href="https://prozorro.gov.ua/tender/${p.tender_id}" target="_blank" rel="noopener">відкрити</a></td></tr>`);
  return `<div class="table-wrap"><table><tr><th>Що купували</th><th>Категорія</th><th>Дата</th><th>Сума</th><th>Prozorro</th></tr>${rows.join("")}</table></div>`;
}

// ---------- Світла / темна тема ----------

const root = document.documentElement;
try { const saved = localStorage.getItem("theme"); if (saved) root.dataset.theme = saved; } catch (e) { /* без збереження теж працює */ }
$("theme-toggle").addEventListener("click", () => {
  const dark = root.dataset.theme ? root.dataset.theme === "dark" : matchMedia("(prefers-color-scheme: dark)").matches;
  root.dataset.theme = dark ? "light" : "dark";
  try { localStorage.setItem("theme", root.dataset.theme); } catch (e) { /* ігноруємо */ }
});

// ---------- Поява елементів (як Reveal на сайті продажів) ----------
// Анімується, коли блок заходить в екран знизу (прокрутка вниз); при прокрутці вгору лишається видимим;
// скидається, коли блок пішов нижче нижнього краю — тоді наступна прокрутка вниз знову його покаже.

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const revealObserver = reduceMotion ? null : new IntersectionObserver((entries) => {
  for (const entry of entries) {
    if (entry.isIntersecting) entry.target.classList.add("in");
    else if (entry.boundingClientRect.top > 0) entry.target.classList.remove("in");
  }
}, { threshold: 0.12 });

function armReveal() {
  document.querySelectorAll(".reveal").forEach((el) => {
    if (reduceMotion) el.classList.add("in"); else revealObserver.observe(el);
  });
}
armReveal();
