export function qs(name) {
  return new URLSearchParams(window.location.search).get(name);
}

export function escapeHtml(s) {
  return String(s || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export async function apiGet(path) {
  const res = await fetch(path, { credentials: "include" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

export async function apiSend(path, method, bodyObj) {
  const res = await fetch(path, {
    method,
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(bodyObj || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed: ${res.status}`);
  return data;
}

export async function logout() {
  try {
    await apiSend("/api/auth/logout", "POST");

    // Clear legacy token (if still used anywhere)
    localStorage.removeItem("convad_token");

    // Redirect to login
    window.location.href = "/login.html";
  } catch (e) {
    console.error("Logout failed:", e);
    alert("Logout failed. Try again.");
  }
}

/* -----------------------------
   Theme
------------------------------ */
export function applyTheme(theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  localStorage.setItem("adminTheme", theme);
}

export function initThemeToggle(buttonId = "themeToggle") {
  const saved = localStorage.getItem("adminTheme");
  const prefersLight =
    window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches;
  const theme = saved || (prefersLight ? "light" : "dark");
  applyTheme(theme);

  const btn = document.getElementById(buttonId);
  if (!btn) return;

  const renderLabel = () => {
    const t = document.documentElement.getAttribute("data-theme") || "dark";
    btn.textContent = t === "light" ? "🌙 Dark" : "☀️ Light";
  };

  renderLabel();
  btn.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme") || "dark";
    applyTheme(cur === "dark" ? "light" : "dark");
    renderLabel();
  });
}

/* -----------------------------
   Formatting helpers
------------------------------ */
export function formatDayLabel(dayValue) {
  const d = dayValue instanceof Date ? dayValue : new Date(dayValue);
  if (Number.isNaN(d.getTime())) return String(dayValue || "");
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/**
 * Optional: if your API returns only days where events exist,
 * this fills missing dates so the x-axis is true time.
 * rows must include { day: 'YYYY-MM-DD', ... }
 */
export function fillMissingDays(rows, daysBack) {
  if (!Array.isArray(rows) || !rows.length) return rows || [];
  const map = new Map(rows.map(r => [String(r.day).slice(0, 10), r]));
  const out = [];

  // build from (today - daysBack + 1) ... today
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  start.setDate(end.getDate() - (Math.max(1, Number(daysBack || rows.length)) - 1));

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const key = d.toISOString().slice(0, 10);
    const existing = map.get(key);
    out.push(existing || { day: key, impressions: 0, clicks: 0, dismisses: 0 });
  }
  return out;
}

export function shouldUseBars(labels, seriesOrValues) {
  const n = Array.isArray(labels) ? labels.length : 0;
  if (n <= 4) return true;

  const flat = Array.isArray(seriesOrValues)
    ? (seriesOrValues.flat ? seriesOrValues.flat() : seriesOrValues)
    : [];
  const nonZero = flat.filter(v => Number(v) > 0).length;
  if (nonZero <= 3) return true;

  return false;
}

/* -----------------------------
   Charts (no libraries)
------------------------------ */
function getCssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function clearCanvas(ctx, w, h) {
  ctx.clearRect(0, 0, w, h);
}

function niceMax(v) {
  if (v <= 0) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  return Math.ceil(v / p) * p;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function measureText(ctx, text) {
  try { return ctx.measureText(text).width; } catch { return text.length * 7; }
}

function pickSkipByPixel(ctx, labels, availablePx, minGapPx) {
  // decide label skip based on label widths so they don't overlap
  if (!labels.length) return 1;
  const avgW = labels.reduce((acc, s) => acc + measureText(ctx, String(s)), 0) / labels.length;
  const want = avgW + minGapPx;
  const maxLabels = Math.max(1, Math.floor(availablePx / want));
  return Math.max(1, Math.ceil(labels.length / maxLabels));
}

function drawLegend(ctx, x, y, items, dpr) {
  if (!items?.length) return;
  const text = getCssVar("--muted") || "#a9b8da";
  ctx.font = `${11 * dpr}px system-ui`;
  ctx.fillStyle = text;

  let cx = x;
  const gap = 10 * dpr;
  const box = 10 * dpr;
  items.forEach(it => {
    // color box
    ctx.fillStyle = it.color;
    ctx.fillRect(cx, y - box + 2 * dpr, box, box);
    cx += box + 6 * dpr;

    // label
    ctx.fillStyle = text;
    ctx.fillText(it.label, cx, y);
    cx += measureText(ctx, it.label) + gap;
  });
}

export function drawLineChart(canvas, series, labels, opts = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;

  const w = (canvas.width = Math.floor(canvas.clientWidth * dpr));
  const h = (canvas.height = Math.floor(canvas.clientHeight * dpr));
  clearCanvas(ctx, w, h);

  const pad = 18 * dpr;
  const left = pad + 34 * dpr;
  const right = w - pad;
  const top = pad + 8 * dpr;
  const bottom = h - pad - 26 * dpr;

  const grid = getCssVar("--line") || "#23365f";
  const text = getCssVar("--muted") || "#a9b8da";
  const axis = grid;
  const stroke = getCssVar("--link") || "#8ab4ff";

  const colors = (opts.colors && opts.colors.length) ? opts.colors : [
    stroke,
    getCssVar("--good") || "#3ddc97",
    getCssVar("--warn") || "#ffd166",
    getCssVar("--bad") || "#ff5c7a",
  ];

  const names = (opts.names && opts.names.length)
    ? opts.names
    : series.map((_, i) => `Series ${i + 1}`);

  const flat = series.flat().filter(x => Number.isFinite(x));
  const maxV = niceMax(Math.max(0, ...flat));
  const minV = 0;

  const xCount = Math.max(2, labels.length);
  const xStep = (right - left) / (xCount - 1);
  const yScale = (bottom - top) / (maxV - minV || 1);

  // title
  if (opts.title) {
    ctx.fillStyle = text;
    ctx.font = `${12 * dpr}px system-ui`;
    ctx.fillText(opts.title, left, top - 10 * dpr);
  }

  // legend
  if (opts.legend !== false) {
    const items = names.map((n, i) => ({ label: n, color: colors[i % colors.length] }));
    drawLegend(ctx, left, top + 6 * dpr, items, dpr);
  }

  // grid lines + y labels
  const ticks = 4;
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1 * dpr;
  ctx.globalAlpha = 0.85;

  ctx.fillStyle = text;
  ctx.font = `${12 * dpr}px system-ui`;

  for (let i = 0; i <= ticks; i++) {
    const y = bottom - (i / ticks) * (bottom - top);

    // grid
    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();

    // y tick label
    const val = Math.round((i / ticks) * maxV);
    ctx.fillText(String(val), pad, y + 4 * dpr);
  }
  ctx.globalAlpha = 1;

  // axes baselines
  ctx.strokeStyle = axis;
  ctx.lineWidth = 1.2 * dpr;
  ctx.beginPath();
  ctx.moveTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.stroke();

  // plot each series + points
  series.forEach((arr, si) => {
    const c = colors[si % colors.length];
    ctx.strokeStyle = c;
    ctx.lineWidth = 2.2 * dpr;
    ctx.beginPath();

    arr.forEach((v, i) => {
      const x = left + i * xStep;
      const y = bottom - (clamp(Number(v) || 0, 0, maxV) - minV) * yScale;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();

    // points (helps sparse data make visual sense)
    ctx.fillStyle = c;
    arr.forEach((v, i) => {
      const x = left + i * xStep;
      const y = bottom - (clamp(Number(v) || 0, 0, maxV) - minV) * yScale;
      ctx.beginPath();
      ctx.arc(x, y, 2.2 * dpr, 0, Math.PI * 2);
      ctx.fill();
    });
  });

  // x labels (inside padding, centered)
  ctx.fillStyle = text;
  ctx.font = `${11 * dpr}px system-ui`;
  const skip = pickSkipByPixel(ctx, labels, right - left, 14 * dpr);

  labels.forEach((lab, i) => {
    if (i % skip !== 0 && i !== labels.length - 1) return;
    const x = left + i * xStep;
    const s = String(lab);
    const tw = measureText(ctx, s);
    ctx.fillText(s, x - tw / 2, h - pad);
  });
}

export function drawBarChart(canvas, values, labels, opts = {}) {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;

  const w = (canvas.width = Math.floor(canvas.clientWidth * dpr));
  const h = (canvas.height = Math.floor(canvas.clientHeight * dpr));
  clearCanvas(ctx, w, h);

  const pad = 18 * dpr;
  const left = pad + 34 * dpr;
  const right = w - pad;
  const top = pad + 8 * dpr;
  const bottom = h - pad - 26 * dpr;

  const grid = getCssVar("--line") || "#23365f";
  const text = getCssVar("--muted") || "#a9b8da";
  const fill = getCssVar("--link") || "#8ab4ff";

  const maxV = niceMax(Math.max(0, ...values.map(v => Number(v) || 0)));
  const yScale = (bottom - top) / (maxV || 1);

  // title
  if (opts.title) {
    ctx.fillStyle = text;
    ctx.font = `${12 * dpr}px system-ui`;
    ctx.fillText(opts.title, left, top - 10 * dpr);
  }

  // grid + y labels
  const ticks = 4;
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1 * dpr;
  ctx.globalAlpha = 0.85;

  ctx.fillStyle = text;
  ctx.font = `${12 * dpr}px system-ui`;

  for (let i = 0; i <= ticks; i++) {
    const y = bottom - (i / ticks) * (bottom - top);

    ctx.beginPath();
    ctx.moveTo(left, y);
    ctx.lineTo(right, y);
    ctx.stroke();

    const val = Math.round((i / ticks) * maxV);
    ctx.fillText(String(val), pad, y + 4 * dpr);
  }
  ctx.globalAlpha = 1;

  // x-axis baseline
  ctx.strokeStyle = grid;
  ctx.lineWidth = 1.2 * dpr;
  ctx.beginPath();
  ctx.moveTo(left, bottom);
  ctx.lineTo(right, bottom);
  ctx.stroke();

  // bars
  const n = Math.max(1, values.length);
  const barW = (right - left) / n;
  ctx.fillStyle = fill;

  values.forEach((v, i) => {
    const vv = clamp(Number(v) || 0, 0, maxV);
    const x = left + i * barW + barW * 0.18;
    const bw = barW * 0.64;
    const bh = vv * yScale;
    const y = bottom - bh;
    ctx.fillRect(x, y, bw, bh);
  });

  // x labels (centered, skipped)
  ctx.fillStyle = text;
  ctx.font = `${11 * dpr}px system-ui`;
  const skip = pickSkipByPixel(ctx, labels, right - left, 14 * dpr);

  labels.forEach((lab, i) => {
    if (i % skip !== 0 && i !== labels.length - 1) return;
    const x = left + i * barW + barW / 2;
    const s = String(lab);
    const tw = measureText(ctx, s);
    ctx.fillText(s, x - tw / 2, h - pad);
  });
}
