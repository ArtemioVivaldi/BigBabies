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

  for (const id of ["numbers-grid", "story-text", "chart-categories", "chart-months", "chart-heatmap", "top5-table", "compare-box", "sizes-box"]) $(id).innerHTML = "";
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
    $("compare-box").innerHTML = compareBlock(data.analytics, s);
    $("sizes-box").innerHTML = sizesBlock(data.analytics);
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

// ---------- Додаткова аналітика ----------

const pct = (now, before) => before ? Math.round(((now - before) / before) * 100) : null;
const signed = (p) => (p > 0 ? "+" : "") + p + "%";

// Порівняння з минулим роком за ті самі місяці + крива накопичення
function compareBlock(a, s) {
  const c = a && a.comparison;
  if (!c) return `<p class="muted reveal">За минулий рік немає завершених закупівель для порівняння.</p>`;
  const period = c.through_month === 12 ? `${c.year} рік` : `${MONTHS[0]}–${MONTHS[c.through_month - 1]} ${c.year}`;
  const delta = (label, now, before, fmt) => {
    const p = pct(now, before);
    return `<div class="num reveal"><div class="num-label">${label}</div><div class="num-value">${p === null ? "—" : signed(p)}</div>` +
           `<div class="num-note">${fmt(now)} проти ${fmt(before)} (${period})</div></div>`;
  };
  const avg = (total, n) => (n ? total / n : 0);
  const numbers = `<div class="numbers">` +
    delta("Витрати", s.total_amount, c.total, money) +
    delta("Кількість закупівель", s.tenders_count, c.count, (n) => n) +
    delta("Середня закупівля", avg(s.total_amount, s.tenders_count), avg(c.total, c.count), money) + `</div>`;
  return numbers + `<div class="grid compare-grid"><div class="reveal"><h4>По категоріях: цього року й ${c.year}</h4>${pairedBars(c)}</div>` +
         `<div class="reveal"><h4>Скільки витрачено з початку року</h4>${cumulativeChart(a.cumulative, c.year, s.year)}</div></div>` +
         `<p class="source reveal">Порівнюємо однакові місяці, щоб неповний рік не здавався меншим.</p>`;
}

function pairedBars(c) {
  const rows = c.categories, W = 520, rowH = 54, left = 190, H = rows.length * rowH + 10;
  const max = Math.max(...rows.map((r) => Math.max(r.amount, r.prev_amount))) || 1, bw = (v) => ((W - left - 20) * v) / max;
  let svg = `<svg viewBox="0 0 ${W} ${H}">`;
  rows.forEach((r, i) => {
    const y = i * rowH + 4;
    svg += `<text x="${left - 8}" y="${y + 24}" text-anchor="end" font-size="12">${esc(r.category)}</text>`;
    svg += `<rect x="${left}" y="${y}" width="${bw(r.amount)}" height="18" rx="9" fill="#f2a122"><title>Цього року: ${money(r.amount)}</title></rect>`;
    svg += `<rect x="${left}" y="${y + 22}" width="${bw(r.prev_amount)}" height="18" rx="9" fill="currentColor" fill-opacity=".3"><title>${c.year}: ${money(r.prev_amount)}</title></rect>`;
  });
  return svg + `</svg><p class="legend"><i style="background:#f2a122"></i> цього року <i style="background:currentColor;opacity:.3"></i> ${c.year}</p>`;
}

function cumulativeChart(cum, prevYear, year) {
  const W = 520, H = 300, l = 52, r = 10, t = 20, b = 30;
  const all = [...cum.current, ...(cum.previous || [])], max = Math.max(...all) * 1.08 || 1;
  const x = (i) => l + ((W - l - r) * i) / 11, y = (v) => t + (H - t - b) * (1 - v / max);
  const line = (vals, attrs) => `<polyline fill="none" stroke-width="2.5" stroke-linejoin="round" ${attrs} points="${vals.map((v, i) => x(i) + "," + y(v)).join(" ")}"/>`;
  let svg = `<svg viewBox="0 0 ${W} ${H}">`;
  for (let k = 0; k <= 4; k++) {
    const v = (max * k) / 4;
    svg += `<line x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" stroke-opacity=".12"/>` +
           `<text x="${l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill-opacity=".7">${(v / 1e6).toFixed(0)} млн</text>`;
  }
  MONTHS.forEach((m, i) => { svg += `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" font-size="11">${m}</text>`; });
  if (cum.previous) svg += line(cum.previous, `stroke="currentColor" stroke-opacity=".35" stroke-dasharray="5 5"`);
  svg += line(cum.current, `stroke="#f2a122"`);
  const last = cum.current.length - 1;
  svg += `<circle cx="${x(last)}" cy="${y(cum.current[last])}" r="4" fill="#f2a122"/>`;
  return svg + `</svg><p class="legend"><i style="background:#f2a122"></i> ${year} <i style="background:currentColor;opacity:.35"></i> ${prevYear}</p>`;
}

// Дрібні й великі: частка кількості закупівель проти частки грошей
function sizesBlock(a) {
  if (!a) return "";
  const totalCount = a.sizes.reduce((n, g) => n + g.count, 0) || 1, totalAmount = a.sizes.reduce((n, g) => n + g.amount, 0) || 1;
  const opacities = [0.25, 0.5, 0.75, 1], W = 1000, H = 150;
  const stacked = (key, total, y, title) => {
    let x = 0, out = `<text x="0" y="${y - 10}" font-size="15" font-weight="600">${title}</text>`;
    a.sizes.forEach((g, i) => {
      const w = (W * g[key]) / total;
      if (!w) return;
      out += `<rect x="${x}" y="${y}" width="${Math.max(w - 3, 1)}" height="44" rx="10" fill="#f2a122" fill-opacity="${opacities[i]}"><title>${g.label}: ${g.count} закупівель, ${money(g.amount)}</title></rect>`;
      if (w > 60) out += `<text x="${x + w / 2}" y="${y + 27}" text-anchor="middle" font-size="14" font-weight="600" ${i < 2 ? "" : 'style="fill:#1b1200"'}>${Math.round((g[key] / total) * 100)}%</text>`;
      x += w;
    });
    return out;
  };
  const legend = a.sizes.map((g, i) => `<span><i style="background:#f2a122;opacity:${opacities[i]}"></i> ${g.label} <b>(${g.count})</b></span>`).join("");
  const done = a.statuses.map((s) => `<span class="pill">${s.status}: ${s.count}</span>`).join("");
  return `<svg class="reveal" viewBox="0 0 ${W} ${H}">${stacked("count", totalCount, 28, "Скільки покупок")}${stacked("amount", totalAmount, 108, "Скільки грошей")}</svg>` +
    `<p class="legend legend-wrap reveal">${legend}</p>` +
    `<p class="insight reveal">П'ять найбільших закупівель — це <b>${Math.round(a.top5_share * 100)}%</b> усіх грошей року. ` +
    `Типова (медіанна) закупівля коштує <b>${money(a.median)}</b>.</p>` +
    `<p class="muted reveal">Чим закінчились закупівлі цього року: ${done}</p>`;
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
