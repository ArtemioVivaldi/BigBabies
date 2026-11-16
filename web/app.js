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
  $("clear").hidden = !$("q").value;  // хрестик видно, лише коли в полі є текст
  clearTimeout(searchTimer);  // чекаємо 250 мс після останньої літери
  searchTimer = setTimeout(runSearch, 250);
});

// Кнопка «×» (і клавіша Esc) очищає поле й підказки та повертає курсор у поле
function clearSearch() {
  clearTimeout(searchTimer);
  $("q").value = "";
  $("clear").hidden = true;
  $("suggestions").hidden = true;
  $("q").focus();
}
$("clear").addEventListener("click", clearSearch);
$("q").addEventListener("keydown", (e) => { if (e.key === "Escape") clearSearch(); });
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
      li.onclick = () => { $("q").value = capitalize(school.name); $("clear").hidden = false; list.hidden = true; loadSchool(school.edrpou, null, true); };
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

  for (const id of ["numbers-grid", "story-text", "chart-categories", "chart-months", "chart-heatmap", "top5-table", "compare-box", "sizes-box", "timeline-chart", "timeline-summary"]) $(id).innerHTML = "";
  if (s.facts) {
    $("numbers-grid").innerHTML =
      number("Витрачено за рік", money(s.total_amount), "завершені закупівлі") +
      number("Закупівель", s.tenders_count, "окремих покупок за рік") +
      number("Щодня", money(s.facts.per_day), "у середньому за 365 днів");
    $("story-text").innerHTML = markdown(data.story) + storySource(data.story_source);
    $("chart-categories").innerHTML = barChart(s.by_category);
    $("chart-months").innerHTML = lineChart(s.by_month, s.facts.busiest_month.month);
    $("chart-heatmap").innerHTML = heatmap(data.heatmap);
    $("top5-table").innerHTML = topTable(s.top_purchases);
    $("compare-box").innerHTML = compareBlock(data.analytics, s);
    $("sizes-box").innerHTML = sizesBlock(data.analytics);
    drawTimeline(data.timeline, s.year);
  }
  armReveal();
}

const number = (label, value, note) =>
  `<div class="num reveal"><div class="num-label">${label}</div><div class="num-value">${value}</div><div class="num-note">${note}</div></div>`;

// Підпис під історією: хто її написав
function storySource(source) {
  if (source === "ai") return '<p class="story-source">✦ Історію написав штучний інтелект на основі цифр Prozorro. Усі суми пораховані програмою.</p>';
  if (source === "template") return '<p class="story-source warn">Історію зібрано за шаблоном: штучний інтелект зараз недоступний.</p>';
  return "";
}

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

// ---------- Витрати за весь час: шари, плавна лінія і рамка вибору періоду ----------

const MONTH_LETTERS = ["С", "Л", "Б", "К", "Т", "Ч", "Л", "С", "В", "Ж", "Л", "Г"];

// Плавна лінія, що не «вилітає» за межі даних (монотонна кубічна інтерполяція)
function smoothPath(pts) {
  const n = pts.length;
  if (n < 2) return "";
  const dx = [], m = [], t = [];
  for (let i = 0; i < n - 1; i++) { dx[i] = pts[i + 1][0] - pts[i][0]; m[i] = (pts[i + 1][1] - pts[i][1]) / dx[i]; }
  t[0] = m[0]; t[n - 1] = m[n - 2];
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) { t[i] = t[i + 1] = 0; continue; }
    const a = t[i] / m[i], b = t[i + 1] / m[i], s2 = a * a + b * b;
    if (s2 > 9) { const k = 3 / Math.sqrt(s2); t[i] = k * a * m[i]; t[i + 1] = k * b * m[i]; }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    d += `C${pts[i][0] + dx[i] / 3},${pts[i][1] + (t[i] * dx[i]) / 3} ${pts[i + 1][0] - dx[i] / 3},${pts[i + 1][1] - (t[i + 1] * dx[i]) / 3} ${pts[i + 1][0]},${pts[i + 1][1]}`;
  }
  return d;
}

const short = (v) => (v >= 1e6 ? (v / 1e6).toFixed(1).replace(".0", "") + " млн" : v >= 1e3 ? Math.round(v / 1e3) + " тис." : Math.round(v));
const monthName = (mo) => `${MONTHS[mo.m - 1]} ${mo.y}`;

function drawTimeline(tl, year) {
  const box = $("timeline-chart");
  if (!tl || !tl.months.length) { box.innerHTML = '<p class="muted">Немає даних.</p>'; return; }
  const months = tl.months, n = months.length;
  const W = 1000, H = 430, L = 54, R = 120, T = 34, B = 70, cw = (W - L - R) / n;
  const maxV = Math.max(...months.map((m) => m.amount)) * 1.1 || 1;
  const x = (i) => L + (i + 0.5) * cw, y = (v) => T + (H - T - B) * (1 - v / maxV);
  const maxTender = Math.max(...months.flatMap((m) => m.tenders), 1);

  // Згладжена лінія: середнє за 3 місяці (сам місяць і сусідні) — так видно тренд, а не поодинокі стрибки
  const smooth = months.map((_, i) => {
    const win = months.slice(Math.max(0, i - 1), Math.min(n, i + 2));
    return win.reduce((a, m) => a + m.amount, 0) / win.length;
  });
  // 12-місячне ковзне середнє — пунктирна лінія «звичайного рівня»
  const avg = months.map((_, i) => {
    const win = months.slice(Math.max(0, i - 11), i + 1);
    return win.reduce((a, m) => a + m.amount, 0) / win.length;
  });

  let svg = `<svg id="tl-svg" viewBox="0 0 ${W} ${H}" style="touch-action:none;user-select:none">`;

  // Сітка й підписи осі Y
  for (let k = 0; k <= 5; k++) {
    const v = (maxV * k) / 5;
    svg += `<line x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}" stroke="currentColor" stroke-opacity=".08"/>` +
           `<text x="${L - 8}" y="${y(v) + 4}" text-anchor="end" font-size="11" fill-opacity=".6">${k === 0 ? 0 : short(v)}</text>`;
  }

  // Шари: кожна закупівля місяця — окремий напівпрозорий сегмент, що більше — то насиченіше
  months.forEach((mo, i) => {
    let acc = 0;
    for (const a of [...mo.tenders].reverse()) {  // від найменших знизу до найбільших угорі
      const ratio = Math.sqrt(a / maxTender);
      svg += `<rect x="${x(i) - cw * 0.46}" y="${y(acc + a)}" width="${cw * 0.92}" height="${Math.max(y(acc) - y(acc + a) - 0.6, 0.4)}" ` +
             `fill="${ratio > 0.5 ? "#f2a122" : "#e8c547"}" fill-opacity="${(0.25 + 0.7 * ratio).toFixed(2)}"/>`;
      acc += a;
    }
  });

  // Вісь X: роки, квартали (або літери місяців, якщо їх мало), вертикальні межі років
  const axisY = H - B;
  svg += `<line x1="${L}" x2="${W - R}" y1="${axisY}" y2="${axisY}" stroke="currentColor" stroke-opacity=".7"/>`;
  months.forEach((mo, i) => {
    const left = L + i * cw;
    if (mo.m === 1 && i > 0) svg += `<line x1="${left}" x2="${left}" y1="${T}" y2="${axisY + 40}" stroke="currentColor" stroke-opacity=".15"/>`;
    if (n <= 36) svg += `<text x="${x(i)}" y="${axisY + 16}" text-anchor="middle" font-size="11" fill-opacity=".75">${MONTH_LETTERS[mo.m - 1]}</text>`;
    if ((mo.m - 1) % 3 === 0 && n <= 60) svg += `<text x="${left + cw * 1.5}" y="${axisY + 34}" text-anchor="middle" font-size="10" fill-opacity=".45">Q${(mo.m - 1) / 3 + 1}</text>`;
  });
  const yearsSeen = [...new Set(months.map((m) => m.y))];
  for (const yr of yearsSeen) {
    const idx = months.map((m, i) => (m.y === yr ? i : -1)).filter((i) => i >= 0);
    const mid = (x(idx[0]) + x(idx[idx.length - 1])) / 2;
    svg += `<text x="${mid}" y="${axisY + 56}" text-anchor="middle" font-size="12" font-weight="600">${yr}</text>`;
  }

  // Лінії: пунктир — ковзне середнє, суцільна з точками — витрати за місяць
  svg += `<path d="${smoothPath(months.map((_, i) => [x(i), y(avg[i])]))}" fill="none" stroke="currentColor" stroke-opacity=".6" stroke-dasharray="5 5" stroke-width="1.5"/>`;
  svg += `<path d="${smoothPath(months.map((_, i) => [x(i), y(smooth[i])]))}" fill="none" stroke="currentColor" stroke-width="2.2"/>`;
  if (n <= 48) months.forEach((mo, i) => { svg += `<circle cx="${x(i)}" cy="${y(smooth[i])}" r="3" fill="currentColor"><title>${monthName(mo)}: ${money(mo.amount)} (на лінії — середнє за 3 міс.)</title></circle>`; });
  // Легенда зверху праворуч
  svg += `<line x1="${W - 330}" x2="${W - 308}" y1="${T - 18}" y2="${T - 18}" stroke="currentColor" stroke-width="2.2"/><text x="${W - 303}" y="${T - 14}" font-size="11">Тренд (3 міс.)</text>` +
         `<line x1="${W - 205}" x2="${W - 183}" y1="${T - 18}" y2="${T - 18}" stroke="currentColor" stroke-opacity=".6" stroke-dasharray="5 5" stroke-width="1.5"/><text x="${W - 178}" y="${T - 14}" font-size="11">Середнє за 12 міс.</text>`;
  svg += `<text x="${L}" y="${T - 14}" font-size="12" font-weight="600">Стовпці — окремі закупівлі за місяць</text>`;

  // Рамка вибору періоду (оновлюється під час перетягування)
  svg += `<g id="tl-sel"></g></svg>`;
  box.innerHTML = svg;

  const svgEl = $("tl-svg");
  const first = months.findIndex((m) => m.y === year), lastIdx = months.map((m) => m.y).lastIndexOf(year);
  let a = first >= 0 ? first : Math.max(0, n - 12), b = lastIdx >= 0 ? lastIdx : n - 1;  // за замовчуванням — обраний рік

  function renderSelection() {
    const x1 = L + a * cw, x2 = L + (b + 1) * cw, y1 = T - 6, y2 = axisY;
    const slice = months.slice(a, b + 1), hi = slice.reduce((p, c) => (c.amount > p.amount ? c : p)), lo = (slice.filter((m) => m.amount > 0).length ? slice.filter((m) => m.amount > 0) : slice).reduce((p, c) => (c.amount < p.amount ? c : p));
    const handle = (cx, cy, name) => `<rect data-h="${name}" x="${cx - 6}" y="${cy - 6}" width="12" height="12" fill="#f2a122" style="cursor:ew-resize"/>`;
    $("tl-sel").innerHTML =
      `<rect data-h="move" x="${x1}" y="${y1}" width="${x2 - x1}" height="${y2 - y1}" fill="#f2a122" fill-opacity=".1" stroke="#f2a122" stroke-width="2" style="cursor:grab"/>` +
      handle(x1, y1, "left") + handle(x2, y1, "right") + handle(x1, y2, "left") + handle(x2, y2, "right") +
      `<line x1="${x2}" x2="${x2 + 10}" y1="${y(hi.amount)}" y2="${y(hi.amount)}" stroke="currentColor" stroke-opacity=".5"/>` +
      `<text x="${x2 + 14}" y="${y(hi.amount) + 4}" font-size="11"><tspan fill-opacity=".55">max </tspan><tspan font-weight="600">${short(hi.amount)}</tspan></text>` +
      `<line x1="${x2}" x2="${x2 + 10}" y1="${y(lo.amount)}" y2="${y(lo.amount)}" stroke="currentColor" stroke-opacity=".5"/>` +
      `<text x="${x2 + 14}" y="${y(lo.amount) + 4}" font-size="11"><tspan fill-opacity=".55">min </tspan><tspan font-weight="600">${short(lo.amount)}</tspan></text>`;
    const total = slice.reduce((s, m) => s + m.amount, 0), count = slice.reduce((s, m) => s + m.tenders.length, 0);
    $("timeline-summary").innerHTML =
      `<div class="numbers tl-numbers">` +
      `<div class="num"><div class="num-label">Обраний період</div><div class="num-value tl-small">${monthName(months[a])} – ${monthName(months[b])}</div><div class="num-note">${slice.length} міс.</div></div>` +
      `<div class="num"><div class="num-label">Витрачено</div><div class="num-value tl-small">${money(total)}</div><div class="num-note">${count} закупівель, у середньому ${money(total / slice.length)} на місяць</div></div>` +
      `<div class="num"><div class="num-label">Найдорожчий / найдешевший місяць (з витратами)</div><div class="num-value tl-small">${short(hi.amount)} / ${short(lo.amount)}</div><div class="num-note">${monthName(hi)} / ${monthName(lo)}</div></div></div>`;
  }

  // Перетягування: рух рамки цілком або зміна лівого/правого краю; крок — один місяць
  let drag = null;
  const toIndex = (ev) => {
    const r = svgEl.getBoundingClientRect();
    return Math.min(n - 1, Math.max(0, Math.floor(((ev.clientX - r.left) / r.width * W - L) / cw)));
  };
  svgEl.addEventListener("pointerdown", (ev) => {
    const h = ev.target.dataset && ev.target.dataset.h;
    if (!h) return;
    drag = { h, start: toIndex(ev), a, b };
    svgEl.setPointerCapture(ev.pointerId);
    ev.preventDefault();
  });
  svgEl.addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const i = toIndex(ev), len = drag.b - drag.a;
    if (drag.h === "move") { a = Math.min(Math.max(0, drag.a + i - drag.start), n - 1 - len); b = a + len; }
    else if (drag.h === "left") { a = Math.min(i, drag.b); }
    else { b = Math.max(i, drag.a); }
    renderSelection();
  });
  const stop = () => { drag = null; };
  svgEl.addEventListener("pointerup", stop);
  svgEl.addEventListener("pointercancel", stop);
  renderSelection();
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
