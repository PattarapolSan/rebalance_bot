const API = "/api/v1";

// ── Tab navigation ──────────────────────────────────────────────────────────

function showTab(name) {
  ["portfolio", "analysis", "advisor"].forEach((t) => {
    document.getElementById(`tab-content-${t}`).classList.add("hidden");
    const btn = document.getElementById(`tab-${t}`);
    btn.classList.remove("tab-active-sidebar", "bg-brand-50", "text-brand-600");
    btn.classList.add("text-slate-600");
  });
  document.getElementById(`tab-content-${name}`).classList.remove("hidden");
  const active = document.getElementById(`tab-${name}`);
  active.classList.add("bg-brand-50", "text-brand-600");
  active.classList.remove("text-slate-600");

  if (name === "portfolio") loadPortfolio();
  if (name === "analysis") loadAnalysisHistory();
}

// ── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n) => n == null ? "—" : new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
const fmtPct = (n) => n == null ? "—" : `${n >= 0 ? "+" : ""}${n.toFixed(2)}%`;
const glClass = (n) => n == null ? "" : (n >= 0 ? "gain font-semibold" : "loss font-semibold");

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error(err.detail || "Request failed");
  }
  return res.json();
}

function pill(val, type = "rec") {
  const key = val.toLowerCase().replace(/ /g, "_");
  const label = val.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
  return `<span class="pill pill-${key}">${label}</span>`;
}

function toast(msg, isError = false) {
  const container = document.getElementById("toast-container");
  const t = document.createElement("div");
  t.className = `flex items-center gap-2 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white ${isError ? "bg-red-500" : "bg-slate-800"} transition-all`;
  t.innerHTML = `<span>${isError ? "⚠️" : "✓"}</span><span>${msg}</span>`;
  container.appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 300); }, 3200);
}

// ── PORTFOLIO ────────────────────────────────────────────────────────────────

async function loadPortfolio() {
  const tbody = document.getElementById("portfolio-tbody");
  tbody.innerHTML = `<tr><td colspan="8" class="px-5 py-10 text-center"><div class="skeleton h-4 rounded w-64 mx-auto"></div></td></tr>`;
  try {
    const positions = await api("GET", "/portfolio");
    renderPortfolio(positions);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" class="px-5 py-10 text-center text-red-400 text-sm">${e.message}</td></tr>`;
  }
}

function renderPortfolio(positions) {
  const tbody = document.getElementById("portfolio-tbody");
  const summary = document.getElementById("portfolio-summary");

  if (positions.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" class="px-5 py-12 text-center">
      <p class="text-4xl mb-2">💼</p>
      <p class="text-slate-500 font-medium">No positions yet</p>
      <p class="text-slate-400 text-xs mt-1">Add your first stock above</p>
    </td></tr>`;
    summary.innerHTML = "";
    return;
  }

  const totalValue = positions.reduce((s, p) => s + (p.current_value || 0), 0);
  const totalCost = positions.reduce((s, p) => s + (p.cost_basis || 0), 0);
  const totalGL = totalValue - totalCost;
  const totalGLPct = totalCost ? (totalGL / totalCost * 100) : 0;
  const glColor = totalGL >= 0 ? "text-green-600" : "text-red-500";

  summary.innerHTML = `
    <div class="card p-5">
      <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Total Value</p>
      <p class="text-2xl font-bold text-slate-900">$${fmt(totalValue)}</p>
      <p class="text-xs text-slate-400 mt-1">${positions.length} position${positions.length !== 1 ? "s" : ""}</p>
    </div>
    <div class="card p-5">
      <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Total P&L</p>
      <p class="text-2xl font-bold ${glColor}">${totalGL >= 0 ? "+" : ""}$${fmt(Math.abs(totalGL))}</p>
      <p class="text-xs text-slate-400 mt-1">Cost basis: $${fmt(totalCost)}</p>
    </div>
    <div class="card p-5">
      <p class="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-1">Total Return</p>
      <p class="text-2xl font-bold ${glColor}">${fmtPct(totalGLPct)}</p>
      <p class="text-xs ${totalGL >= 0 ? 'text-green-500' : 'text-red-400'} mt-1">${totalGL >= 0 ? "▲ Profit" : "▼ Loss"}</p>
    </div>`;

  tbody.innerHTML = positions.map(p => {
    const glColor = (p.gain_loss || 0) >= 0 ? "gain" : "loss";
    return `<tr class="border-t border-slate-50 hover:bg-slate-50 transition-colors">
      <td class="px-5 py-3.5">
        <span class="font-bold text-slate-900">${p.ticker}</span>
        ${p.notes ? `<span class="block text-xs text-slate-400 mt-0.5">${p.notes}</span>` : ""}
      </td>
      <td class="px-4 py-3.5 text-right text-slate-600">${p.quantity}</td>
      <td class="px-4 py-3.5 text-right text-slate-500">$${fmt(p.entry_price)}</td>
      <td class="px-4 py-3.5 text-right font-medium text-slate-800">$${fmt(p.current_price)}</td>
      <td class="px-4 py-3.5 text-right font-semibold text-slate-800">$${fmt(p.current_value)}</td>
      <td class="px-4 py-3.5 text-right ${glColor}">${(p.gain_loss||0) >= 0 ? "+" : ""}$${fmt(Math.abs(p.gain_loss||0))}</td>
      <td class="px-4 py-3.5 text-right ${glColor}">${fmtPct(p.gain_loss_pct)}</td>
      <td class="px-4 py-3.5 text-right">
        <div class="flex justify-end gap-3">
          <button onclick="openEdit(${p.id}, ${p.quantity}, ${p.entry_price}, '${(p.notes||"").replace(/'/g,"\\'")}')"\
            class="text-brand-500 text-xs font-medium hover:text-brand-700">Edit</button>
          <button onclick="deletePosition(${p.id})"\
            class="text-red-400 text-xs font-medium hover:text-red-600">Remove</button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

async function addPosition() {
  const ticker = document.getElementById("add-ticker").value.trim().toUpperCase();
  const qty = parseFloat(document.getElementById("add-qty").value);
  const price = parseFloat(document.getElementById("add-price").value);
  const notes = document.getElementById("add-notes").value.trim();

  if (!ticker || isNaN(qty) || isNaN(price)) return toast("Fill in ticker, quantity, and entry price.", true);

  try {
    await api("POST", "/portfolio", { ticker, quantity: qty, entry_price: price, notes });
    ["add-ticker", "add-qty", "add-price", "add-notes"].forEach(id => document.getElementById(id).value = "");
    toast(`${ticker} added to portfolio`);
    loadPortfolio();
  } catch (e) {
    toast(e.message, true);
  }
}

async function deletePosition(id) {
  if (!confirm("Remove this position from your portfolio?")) return;
  await fetch(`${API}/portfolio/${id}`, { method: "DELETE" });
  loadPortfolio();
}

function openEdit(id, qty, price, notes) {
  document.getElementById("edit-id").value = id;
  document.getElementById("edit-qty").value = qty;
  document.getElementById("edit-price").value = price;
  document.getElementById("edit-notes").value = notes;
  document.getElementById("edit-modal").classList.remove("hidden");
}

function closeModal() {
  document.getElementById("edit-modal").classList.add("hidden");
}

async function saveEdit() {
  const id = document.getElementById("edit-id").value;
  const qty = parseFloat(document.getElementById("edit-qty").value);
  const price = parseFloat(document.getElementById("edit-price").value);
  const notes = document.getElementById("edit-notes").value;
  try {
    await api("PUT", `/portfolio/${id}`, { quantity: qty, entry_price: price, notes });
    closeModal();
    toast("Position updated");
    loadPortfolio();
  } catch (e) {
    toast(e.message, true);
  }
}

// ── ANALYSIS ─────────────────────────────────────────────────────────────────

async function loadAnalysisHistory() {
  try {
    const history = await api("GET", "/analysis/history");
    const sel = document.getElementById("report-date-select");
    sel.innerHTML = history.length === 0
      ? `<option value="">No reports yet</option>`
      : history.map(r => `<option value="${r.date}">${r.date}</option>`).join("");
    if (history.length > 0) loadReport(history[0].date);
  } catch (e) {
    console.error(e);
  }
}

async function loadReport(dateStr) {
  if (!dateStr) return;
  const content = document.getElementById("analysis-content");
  content.innerHTML = `<div class="space-y-4">${[1,2,3].map(() => `<div class="card p-5"><div class="skeleton h-4 rounded w-32 mb-3"></div><div class="skeleton h-3 rounded w-full mb-2"></div><div class="skeleton h-3 rounded w-3/4"></div></div>`).join("")}</div>`;
  try {
    const report = await api("GET", `/analysis/${dateStr}`);
    renderReport(report);
  } catch (e) {
    content.innerHTML = `<div class="card p-10 text-center text-red-400">${e.message}</div>`;
  }
}

function rsiColor(rsi) {
  if (rsi < 30) return "#22c55e";
  if (rsi > 70) return "#ef4444";
  return "#6366f1";
}

function renderReport(report) {
  const s = report.portfolio_summary || {};
  const gl = s.total_gain_loss || 0;
  const glColor = gl >= 0 ? "text-green-600" : "text-red-500";
  const content = document.getElementById("analysis-content");

  const recIcon = { buy_more: "🟢", hold: "🟡", sell: "🔴" };

  const analyses = (report.analyses || []).map(a => {
    const rsiPct = a.rsi_14 != null ? Math.min(100, Math.max(0, a.rsi_14)) : null;
    return `
    <div class="card p-5">
      <div class="flex items-start justify-between mb-3">
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-lg font-bold text-slate-900">${a.ticker}</span>
            ${pill(a.recommendation)}
            ${pill(a.confidence)}
          </div>
          <p class="text-xs text-slate-400 mt-0.5">${recIcon[a.recommendation] || "⚪"} ${a.recommendation.replace(/_/g," ").toUpperCase()}</p>
        </div>
        <div class="text-right">
          <p class="text-xl font-bold text-slate-900">$${fmt(a.current_price)}</p>
        </div>
      </div>

      <p class="text-sm text-slate-600 leading-relaxed mb-4 border-l-2 border-brand-100 pl-3">${a.rationale}</p>

      ${a.rsi_14 != null ? `
      <div class="grid grid-cols-2 gap-x-6 gap-y-3 text-xs mt-2">
        <div>
          <div class="flex justify-between mb-1">
            <span class="text-slate-400 font-medium">RSI (14)</span>
            <span class="font-bold" style="color:${rsiColor(a.rsi_14)}">${a.rsi_14}</span>
          </div>
          <div class="rsi-bar"><div class="rsi-fill" style="width:${rsiPct}%; background:${rsiColor(a.rsi_14)}"></div></div>
          <p class="text-slate-300 mt-0.5">${a.rsi_14 < 30 ? "Oversold" : a.rsi_14 > 70 ? "Overbought" : "Neutral"}</p>
        </div>
        <div class="space-y-1.5">
          <div class="flex justify-between">
            <span class="text-slate-400">Trend</span>
            <span class="font-semibold ${a.sma_cross === 'bullish' ? 'text-green-500' : 'text-red-400'}">${a.sma_cross === 'bullish' ? '▲ Bullish' : '▼ Bearish'}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-400">Volume</span>
            <span class="font-semibold ${(a.volume_ratio||1) > 1.2 ? 'text-brand-500' : 'text-slate-500'}">${a.volume_ratio != null ? a.volume_ratio + "×" : "—"}</span>
          </div>
          <div class="flex justify-between">
            <span class="text-slate-400">SMA 20</span>
            <span class="font-medium text-slate-600">$${fmt(a.sma_20)}</span>
          </div>
        </div>
      </div>` : ""}
    </div>`;
  }).join("");

  content.innerHTML = `
    <div class="grid grid-cols-3 gap-4 mb-5">
      <div class="card p-4 text-center">
        <p class="text-xs text-slate-400 mb-1">Portfolio Value</p>
        <p class="text-xl font-bold text-slate-900">$${fmt(s.total_value)}</p>
      </div>
      <div class="card p-4 text-center">
        <p class="text-xs text-slate-400 mb-1">Total P&L</p>
        <p class="text-xl font-bold ${glColor}">${gl >= 0 ? "+" : ""}$${fmt(Math.abs(gl))}</p>
      </div>
      <div class="card p-4 text-center">
        <p class="text-xs text-slate-400 mb-1">Return</p>
        <p class="text-xl font-bold ${glColor}">${fmtPct(s.total_gain_loss_pct)}</p>
      </div>
    </div>
    <div class="space-y-4">${analyses || '<div class="card p-10 text-center text-slate-400">No stock analyses in this report.</div>'}</div>`;
}

async function triggerAnalysis() {
  try {
    await api("POST", "/analysis/trigger");
    toast("Analysis running in background — check back in a minute");
  } catch (e) {
    toast(e.message, true);
  }
}

// ── ADVISOR ──────────────────────────────────────────────────────────────────

async function getAdvice() {
  const budget = parseFloat(document.getElementById("advisor-budget").value);
  const risk = document.getElementById("advisor-risk").value;
  const sector = document.getElementById("advisor-sector").value.trim() || null;
  const notes = document.getElementById("advisor-notes").value.trim() || null;

  if (isNaN(budget) || budget <= 0) return toast("Enter a valid budget.", true);

  const result = document.getElementById("advisor-result");
  const output = document.getElementById("advisor-output");
  result.classList.remove("hidden");
  output.innerHTML = `<span class="text-slate-400 animate-pulse">Searching market data and preparing suggestions…</span>`;

  try {
    const res = await fetch(`${API}/advisor`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ budget_usd: budget, risk_level: risk, sector_preference: sector, notes }),
    });

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let text = "";
    output.textContent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      for (const line of chunk.split("\n")) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6);
          if (data === "[DONE]") break;
          text += data;
          output.textContent = text;
        }
      }
    }
  } catch (e) {
    output.textContent = `Error: ${e.message}`;
  }
}

// ── Init ─────────────────────────────────────────────────────────────────────
showTab("portfolio");
