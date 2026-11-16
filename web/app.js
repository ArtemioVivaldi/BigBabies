// Прототип фронтенду: звичайний JavaScript без бібліотек.
// Дані приходять з Python-бекенду (api.py) у форматі JSON.

const MONTHS = ["січ", "лют", "бер", "кві", "тра", "чер", "лип", "сер", "вер", "жов", "лис", "гру"];
const CATEGORIES = ["Харчування", "Комунальні послуги", "Ремонт і будівництво", "Техніка, зв'язок і програми",
  "Меблі, обладнання і товари", "Обслуговування і безпека", "Інше"];
const COLORS = ["#2F752C", "#C0B623", "#26728A", "#619206", "#050505", "#8A7B3C", "#B58A3C"];

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

async function runSearch() {
  const text = $("q").value.trim();
  const list = $("suggestions");
  if (text.length < 3) { list.hidden = true; return; }
  try {
    const schools = await getJson("/api/search?q=" + encodeURIComponent(text));
    list.innerHTML = "";
    if (!schools.length) {
      list.innerHTML = "<li>Нічого не знайдено</li>";
    }
    for (const school of schools) {
      const li = document.createElement("li");
      li.textContent = capitalize(school.name);
      li.onclick = () => { $("q").value = capitalize(school.name); list.hidden = true; loadSchool(school.edrpou); };
      list.appendChild(li);
    }
    list.hidden = false;
  } catch (error) {
    showMessage(error.message, true);
  }
}

// ---------- Завантаження й показ підсумків ----------

async function loadSchool(edrpou, year) {
  currentEdrpou = edrpou;
  showMessage("Завантажуємо закупівлі з Prozorro…");
  try {
    const url = "/api/summary?edrpou=" + edrpou + (year ? "&year=" + year : "");
    const data = await getJson(url);
    if (!data.years.length) { $("result").hidden = true; return showMessage("У цієї установи немає закупівель у Prozorro."); }
    if (!data.summary.facts) { render(data); return showMessage("За цей рік немає завершених закупівель. Спробуйте інший рік."); }
    showMessage("");
    render(data);
  } catch (error) {
    $("result").hidden = true;
    showMessage(error.message, true);
  }
}

function render(data) {
  const s = data.summary;
  $("result").hidden = false;
  $("school-name").textContent = capitalize(s.school.name);
  $("pills").innerHTML = `<span class="pill">${esc(s.school.city)}</span><span class="pill">${s.year} рік</span>`;

  // Кнопки років
  $("years").innerHTML = "";
  for (const y of data.years) {
    const b = document.createElement("button");
    b.className = "year-btn" + (y === s.year ? " active" : "");
    b.textContent = y;
    b.onclick = () => loadSchool(currentEdrpou, y);
    $("years").appendChild(b);
  }

  const has = !!s.facts;
  for (const id of ["numbers", "story", "chart-categories", "chart-months", "chart-heatmap", "top5"]) $(id).innerHTML = "";
  if (!has) return;

  $("numbers").innerHTML =
    number("Витрачено за рік", count(s.total_amount, " грн"), "завершені закупівлі") +
    number("Закупівель", count(s.tenders_count, ""), "окремих покупок за рік") +
    number("Щодня", count(s.facts.per_day, " грн"), "у середньому за 365 днів");
  $("story").innerHTML = markdown(data.story);
  $("chart-categories").innerHTML = barChart(s.by_category);
  $("chart-months").innerHTML = lineChart(s.by_month, s.facts.busiest_month.month);
  $("chart-heatmap").innerHTML = heatmap(data.heatmap);
  $("top5").innerHTML = topTable(s.top_purchases);
  armAnimations();
}

// Число, яке під час появи «набігає» від 0 (див. armAnimations)
const count = (value, suffix) => `<span class="count" data-to="${value}" data-suffix="${suffix}">0${suffix}</span>`;

const number = (label, value, note) =>
  `<div class="num"><div class="num-label">${label}</div><div class="num-value">${value}</div><div class="num-note">${note}</div></div>`;

// Дуже проста обробка Markdown: заголовки, жирний, курсив, абзаци
function markdown(text) {
  return esc(text).split(/\n\s*\n/).map((block) => {
    let html = block.replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/\*(.+?)\*/g, "<i>$1</i>");
    const heading = html.match(/^#{1,3}\s+(.*)$/);
    return heading ? `<h2>${heading[1]}</h2>` : `<p>${html.replace(/\n/g, " ")}</p>`;
  }).join("");
}

// ---------- Графіки (чистий SVG) ----------

function barChart(rows) {
  const W = 520, rowH = 38, left = 190, H = rows.length * rowH + 10, max = Math.max(...rows.map((r) => r.amount));
  let svg = `<svg viewBox="0 0 ${W} ${H}">`;
  rows.forEach((r, i) => {
    const y = i * rowH + 4, w = ((W - left - 70) * r.amount) / max;
    const color = COLORS[CATEGORIES.indexOf(r.category)] || COLORS[6];
    svg += `<text x="${left - 8}" y="${y + 19}" text-anchor="end" font-size="12">${esc(r.category)}</text>`;
    svg += `<rect class="bar" style="--d:${i * 120}ms" x="${left}" y="${y}" width="${w}" height="26" rx="3" fill="${color}"><title>${money(r.amount)}</title></rect>`;
    svg += `<text class="fade" style="--d:${600 + i * 120}ms" x="${left + w + 6}" y="${y + 18}" font-size="12">${Math.round(r.share * 100)}%</text>`;
  });
  return svg + "</svg>";
}

function lineChart(months, peak) {
  const W = 520, H = 300, l = 52, r = 10, t = 24, b = 30, max = Math.max(...months.map((m) => m.amount)) * 1.1 || 1;
  const x = (i) => l + ((W - l - r) * i) / 11, y = (v) => t + (H - t - b) * (1 - v / max);
  let svg = `<svg viewBox="0 0 ${W} ${H}">`;
  for (let k = 0; k <= 4; k++) {  // горизонтальні лінії сітки
    const v = (max * k) / 4;
    svg += `<line x1="${l}" x2="${W - r}" y1="${y(v)}" y2="${y(v)}" stroke="#00000022"/>` +
           `<text x="${l - 6}" y="${y(v) + 4}" text-anchor="end" font-size="11">${(v / 1e6).toFixed(1)} млн</text>`;
  }
  svg += `<rect class="fade" style="--d:1200ms" x="${x(peak - 1) - 14}" y="${t}" width="28" height="${H - t - b}" fill="#C0B623" opacity="0.35"/>`;  // смуга піку
  svg += `<polyline class="line" pathLength="1" fill="none" stroke="#2F752C" stroke-width="2" points="${months.map((m, i) => x(i) + "," + y(m.amount)).join(" ")}"/>`;
  months.forEach((m, i) => {
    svg += `<circle class="fade" style="--d:${400 + i * 110}ms" cx="${x(i)}" cy="${y(m.amount)}" r="3.5" fill="#2F752C"><title>${MONTHS[i]}: ${money(m.amount)}</title></circle>`;
    svg += `<text x="${x(i)}" y="${H - 10}" text-anchor="middle" font-size="11">${MONTHS[i]}</text>`;
  });
  const p = months[peak - 1];
  const left = peak <= 2;  // біля лівого краю підпис ставимо праворуч від точки, щоб не налазив на вісь
  svg += `<text class="fade" style="--d:1500ms" x="${x(peak - 1) + (left ? 12 : 0)}" y="${y(p.amount) + (left ? 4 : -10)}" text-anchor="${left ? "start" : "middle"}" font-size="12" font-weight="bold">${money(p.amount)}</text>`;
  return svg + "</svg>";
}

function heatmap(cells) {
  const W = 1000, left = 200, cw = (W - left) / 12, ch = 34, H = CATEGORIES.length * ch + 30;
  const max = Math.max(...cells.map((c) => c.amount), 1);
  const shades = ["#EDE3B8", "#C0B623", "#619206", "#2F752C"];
  const shade = (v) => shades[Math.min(3, Math.floor((v / max) * 3.999))];
  let svg = `<svg viewBox="0 0 ${W} ${H}">`;
  CATEGORIES.forEach((c, i) => { svg += `<text x="${left - 8}" y="${i * ch + 22}" text-anchor="end" font-size="13">${esc(c)}</text>`; });
  MONTHS.forEach((m, j) => { svg += `<text x="${left + j * cw + cw / 2}" y="${H - 8}" text-anchor="middle" font-size="12">${m}</text>`; });
  cells.forEach((c, n) => {
    const i = CATEGORIES.indexOf(c.category), j = c.month - 1;
    svg += `<rect class="cell" style="--d:${j * 60 + i * 40}ms" x="${left + j * cw + 1}" y="${i * ch + 2}" width="${cw - 2}" height="${ch - 4}" rx="3" fill="${shade(c.amount)}">` +
           `<title>${c.category}, ${MONTHS[j]}: ${money(c.amount)}</title></rect>`;
  });
  return svg + "</svg>";
}

function topTable(purchases) {
  const rows = purchases.map((p) => `<tr><td>${esc(p.title)}</td><td>${esc(p.category)}</td><td>${p.date}</td>` +
    `<td class="amount">${money(p.amount)}</td><td><a href="https://prozorro.gov.ua/tender/${p.tender_id}" target="_blank" rel="noopener">відкрити</a></td></tr>`);
  return `<table><tr><th>Що купували</th><th>Категорія</th><th>Дата</th><th>Сума</th><th>Prozorro</th></tr>${rows.join("")}</table>`;
}


// ---------- Поверхи: липнуть і накладаються одне на одне ----------

const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function floors() {
  return [...document.querySelectorAll(".floor")].filter((el) => el.offsetParent !== null || getComputedStyle(el).position === "sticky");
}

// Липка картка вища за екран прилипає не верхом, а низом — інакше її нижню частину не побачити
function placeFloors() {
  for (const el of document.querySelectorAll(".floor:not(.search-floor)")) {
    el.style.top = Math.min(16, window.innerHeight - el.offsetHeight - 16) + "px";
  }
  updateStack();
}

// Коли наступний поверх наїжджає на попередній, попередній трохи зменшується й темніє
function updateStack() {
  const list = floors();
  list.forEach((el, i) => {
    const next = list[i + 1];
    if (!next || reduceMotion || el.classList.contains("search-floor")) { el.style.transform = ""; el.style.filter = ""; return; }
    const nextTop = next.getBoundingClientRect().top;
    const covered = Math.min(1, Math.max(0, 1 - nextTop / window.innerHeight));
    const stuck = el.getBoundingClientRect().top <= parseFloat(el.style.top || 16) + 1;
    const p = stuck ? covered : 0;
    el.style.transform = p ? `scale(${1 - 0.05 * p})` : "";
    el.style.filter = p ? `brightness(${1 - 0.3 * p})` : "";
  });
}

window.addEventListener("scroll", updateStack, { passive: true });
window.addEventListener("resize", placeFloors);
new ResizeObserver(placeFloors).observe(document.body);  // розміри змінюються, коли з'являються дані
placeFloors();


// ---------- Анімації появи ----------

if (!reduceMotion) document.documentElement.classList.add("anim");
let appearObserver = null;

// Елементи, що з'являються по черзі (fade-up) всередині поверху
const REVEAL = ".num, .story > *, h3, #pills, .source, table, .header-row";

function armAnimations() {
  if (reduceMotion) return;
  appearObserver && appearObserver.disconnect();
  appearObserver = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue;
      entry.target.classList.add("in");
      runCounters(entry.target);
      appearObserver.unobserve(entry.target);
    }
  }, { threshold: 0.2 });

  for (const floor of document.querySelectorAll("#result .floor")) {
    floor.classList.remove("in");
    floor.querySelectorAll(REVEAL).forEach((el, i) => { el.dataset.reveal = ""; el.style.setProperty("--i", i); });
    appearObserver.observe(floor);
  }
}

function runCounters(root) {
  root.querySelectorAll(".count").forEach((el) => {
    const to = Number(el.dataset.to), suffix = el.dataset.suffix, start = performance.now(), dur = 1400;
    const tick = (now) => {
      const t = Math.min(1, (now - start) / dur), eased = 1 - Math.pow(1 - t, 3);
      el.textContent = Math.round(to * eased).toLocaleString("uk-UA").replace(/\u00a0/g, " ") + suffix;
      if (t < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}
