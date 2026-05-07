const API = "/api/v1";
let currentPortfolio = [];
function toggleAddForm() {
  const container = document.getElementById("add-form-container");
  const icon = document.getElementById("toggle-icon");
  const text = document.getElementById("toggle-text");

  if (container.classList.contains("hidden")) {
    container.classList.remove("hidden");
    icon.textContent = "✕";
    text.textContent = "Close";
  } else {
    container.classList.add("hidden");
    icon.textContent = "＋";
    text.textContent = "Add Position";
  }
}

// ── Tab navigation ──────────────────────────────────────────────────────────

function showTab(name) {
  ["portfolio", "analysis", "advisor"].forEach((t) => {
    document.getElementById(`tab-content-${t}`).classList.add("hidden");
    const btn = document.getElementById(`tab-${t}`);
    btn.classList.remove("bg-brand-50", "text-brand-600", "shadow-sm", "shadow-brand-500/10", "ring-1", "ring-brand-500/10");
    btn.classList.add("text-slate-500", "hover:bg-slate-50", "hover:text-slate-700");
  });
  document.getElementById(`tab-content-${name}`).classList.remove("hidden");
  const active = document.getElementById(`tab-${name}`);
  active.classList.add("bg-brand-50", "text-brand-600", "shadow-sm", "shadow-brand-500/10", "ring-1", "ring-brand-500/10");
  active.classList.remove("text-slate-500", "hover:bg-slate-50", "hover:text-slate-700");

  if (name === "portfolio") loadPortfolio();
  if (name === "analysis") loadAnalysisHistory();

  // Auto-close sidebar on mobile after selection
  if (window.innerWidth < 768) {
    toggleSidebar(false);
  }
}

function switchPortfolioView(view) {
  const isList = view === 'list';
  document.getElementById("view-content-list").classList.toggle("hidden", !isList);
  document.getElementById("view-content-analytics").classList.toggle("hidden", isList);

  const listBtn = document.getElementById("view-tab-list");
  const analyticsBtn = document.getElementById("view-tab-charts");

  if (isList) {
    listBtn.classList.add("bg-white", "text-slate-900", "shadow-sm");
    listBtn.classList.remove("text-slate-500");
    analyticsBtn.classList.remove("bg-white", "text-slate-900", "shadow-sm");
    analyticsBtn.classList.add("text-slate-500");
  } else {
    analyticsBtn.classList.add("bg-white", "text-slate-900", "shadow-sm");
    analyticsBtn.classList.remove("text-slate-500");
    listBtn.classList.remove("bg-white", "text-slate-900", "shadow-sm");
    listBtn.classList.add("text-slate-500");
    renderAnalyticsView(currentPortfolio);
  }
}

const CHART_COLORS = [
  '#6366f1','#8b5cf6','#ec4899','#f43f5e','#f59e0b',
  '#10b981','#06b6d4','#3b82f6','#84cc16','#f97316',
];
let _charts = {};

function _destroyChart(id) {
  if (_charts[id]) { _charts[id].destroy(); delete _charts[id]; }
}

function renderAnalyticsView(positions) {
  if (!positions || positions.length === 0) {
    ['chart-allocation','chart-cost-value','chart-returns'].forEach(id => _destroyChart(id));
    return;
  }

  const tickers = positions.map(p => p.ticker);
  const colors  = tickers.map((_, i) => CHART_COLORS[i % CHART_COLORS.length]);

  // ── 1. Allocation donut ───────────────────────────────────────────────────
  _destroyChart('chart-allocation');
  const allocCtx = document.getElementById('chart-allocation')?.getContext('2d');
  if (allocCtx) {
    const totalValue = positions.reduce((s, p) => s + (p.current_value || 0), 0);
    _charts['chart-allocation'] = new Chart(allocCtx, {
      type: 'doughnut',
      data: {
        labels: tickers,
        datasets: [{ data: positions.map(p => p.current_value || 0),
          backgroundColor: colors, borderWidth: 0, hoverOffset: 6 }]
      },
      options: {
        cutout: '65%', maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            label: (item) => ` ${item.label}: $${fmt(item.raw)} (${(item.raw/totalValue*100).toFixed(1)}%)`
          }}
        }
      }
    });
    // Legend
    const legend = document.getElementById('chart-allocation-legend');
    if (legend) legend.innerHTML = tickers.map((t, i) => `
      <div class="flex items-center gap-1 text-[10px] font-bold text-slate-600">
        <span class="w-2 h-2 rounded-full shrink-0" style="background:${colors[i]}"></span>${t}
      </div>`).join('');
  }

  // ── 2. Cost vs Current Value grouped bar ─────────────────────────────────
  _destroyChart('chart-cost-value');
  const cvCtx = document.getElementById('chart-cost-value')?.getContext('2d');
  if (cvCtx) {
    _charts['chart-cost-value'] = new Chart(cvCtx, {
      type: 'bar',
      data: {
        labels: tickers,
        datasets: [
          { label: 'Cost Basis', data: positions.map(p => p.cost_basis || 0),
            backgroundColor: 'rgba(148,163,184,0.5)', borderRadius: 4 },
          { label: 'Current Value', data: positions.map(p => p.current_value || 0),
            backgroundColor: colors, borderRadius: 4 },
        ]
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { labels: { font: { size: 10 }, boxWidth: 10 } },
          tooltip: { callbacks: { label: (i) => ` ${i.dataset.label}: $${fmt(i.raw)}` }}},
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 10 } } },
          y: { grid: { color: '#f1f5f9' }, ticks: { callback: v => '$'+fmt(v), font: { size: 9 } } }
        }
      }
    });
  }

  // ── 3. Return % bar (sorted best → worst) ────────────────────────────────
  _destroyChart('chart-returns');
  const retCtx = document.getElementById('chart-returns')?.getContext('2d');
  if (retCtx) {
    const sorted = [...positions].sort((a, b) => (b.gain_loss_pct||0) - (a.gain_loss_pct||0));
    _charts['chart-returns'] = new Chart(retCtx, {
      type: 'bar',
      data: {
        labels: sorted.map(p => p.ticker),
        datasets: [{
          label: 'Return %',
          data: sorted.map(p => p.gain_loss_pct || 0),
          backgroundColor: sorted.map(p => (p.gain_loss_pct||0) >= 0
            ? 'rgba(16,185,129,0.75)' : 'rgba(244,63,94,0.75)'),
          borderRadius: 4,
        }]
      },
      options: {
        maintainAspectRatio: false,
        plugins: { legend: { display: false },
          tooltip: { callbacks: { label: (i) => ` ${i.raw >= 0 ? '+' : ''}${i.raw.toFixed(2)}%` }}},
        scales: {
          x: { grid: { display: false }, ticks: { font: { size: 11, weight: 'bold' } } },
          y: { grid: { color: '#f1f5f9' },
            ticks: { callback: v => v + '%', font: { size: 9 } } }
        }
      }
    });
  }
}

// ── Mobile Sidebar ──────────────────────────────────────────────────────────

function toggleSidebar(force) {
  const sidebar = document.getElementById("sidebar");
  const overlay = document.getElementById("sidebar-overlay");
  const isOpen = sidebar.classList.contains("translate-x-0");
  const nextOpen = force !== undefined ? force : !isOpen;

  if (nextOpen) {
    sidebar.classList.remove("-translate-x-full");
    sidebar.classList.add("translate-x-0");
    overlay.classList.remove("hidden");
    setTimeout(() => overlay.classList.remove("opacity-0"), 10);
  } else {
    sidebar.classList.add("-translate-x-full");
    sidebar.classList.remove("translate-x-0");
    overlay.classList.add("opacity-0");
    setTimeout(() => overlay.classList.add("hidden"), 300);
  }
}

// ── PORTFOLIO ────────────────────────────────────────────────────────────────

async function loadPortfolio() {
  const tbody = document.getElementById("portfolio-tbody");
  tbody.innerHTML = `<tr><td colspan="8" class="px-5 py-10 text-center"><div class="skeleton h-4 rounded w-64 mx-auto"></div></td></tr>`;
  try {
    const [positions, levels] = await Promise.all([
      api("GET", "/portfolio"),
      api("GET", "/analysis/latest-levels").catch(() => ({})),
    ]);
    // Merge analysis levels into each position
    const enriched = positions.map(p => ({ ...p, _levels: levels[p.ticker] || null }));
    currentPortfolio = enriched;
    renderPortfolio(enriched);
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="8" class="px-5 py-10 text-center text-red-400 text-sm">${e.message}</td></tr>`;
  }
}

function renderPortfolio(positions) {
  console.log("renderPortfolio started with", positions?.length, "positions");
  const tbody = document.getElementById("portfolio-tbody");
  const summary = document.getElementById("portfolio-summary");
  if (!tbody || !summary) {
    console.error("Critical UI elements missing: tbody or summary");
    return;
  }

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

  try {
    summary.innerHTML = `
      <div class="col-span-2 card p-4 border border-brand-100 bg-brand-50/5">
        <p class="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-1 text-center">Portfolio Total Value</p>
        <p class="text-3xl font-black text-slate-900 text-center tracking-tight">$${fmt(totalValue)}</p>
      </div>
      <div class="card p-3 flex flex-col items-center justify-center border-slate-100 shadow-sm">
        <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Total P&L</p>
        <p class="text-lg font-bold ${glColor}">${totalGL >= 0 ? "+" : ""}$${fmt(Math.abs(totalGL))}</p>
      </div>
      <div class="card p-3 flex flex-col items-center justify-center border-slate-100 shadow-sm">
        <p class="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-0.5">Total Return</p>
        <p class="text-lg font-bold ${glColor}">${fmtPct(totalGLPct)}</p>
      </div>`;
  } catch (e) {
    console.error("Summary Render Error:", e);
  }

  const mobileList = document.getElementById("portfolio-mobile-list");
  console.log("Rendering portfolio. Positions:", positions.length, "Mobile element:", !!mobileList);

  // Filter out any positions without a ticker (rare)
  const validPositions = positions.filter(p => p.ticker);
  console.log("Valid positions for display:", validPositions.length);

  try { renderDesktopTable(validPositions, tbody); } catch(e) {
    console.error("Desktop table error:", e);
    tbody.innerHTML = `<tr><td colspan="8" class="px-5 py-4 text-red-400 text-sm">Render error: ${e.message}</td></tr>`;
  }
  try { renderMobileList(validPositions, mobileList); } catch(e) {
    console.error("Mobile list error:", e);
    if (mobileList) mobileList.innerHTML = `<div class="p-4 text-red-400 text-sm">Render error: ${e.message}</div>`;
  }

}

function _recBadge(rec) {
  if (!rec) return "";
  const map = { buy_more: ["bg-green-100 text-green-700", "Buy More"],
                 hold:     ["bg-yellow-100 text-yellow-700", "Hold"],
                 sell:     ["bg-red-100 text-red-600", "Sell"] };
  const [cls, label] = map[rec] || ["bg-slate-100 text-slate-500", rec];
  return `<span class="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold ${cls}">${label}</span>`;
}

function _levelsBadges(levels) {
  if (!levels) return "";
  const parts = [];
  if (levels.support != null)    parts.push(`<span class="text-[9px] text-slate-400">S <span class="font-semibold text-slate-600">$${fmt(levels.support)}</span></span>`);
  if (levels.resistance != null) parts.push(`<span class="text-[9px] text-slate-400">R <span class="font-semibold text-slate-600">$${fmt(levels.resistance)}</span></span>`);
  if (levels.stop_loss != null)  parts.push(`<span class="text-[9px] text-red-400">SL <span class="font-semibold text-red-500">$${fmt(levels.stop_loss)}</span></span>`);
  return parts.length ? `<div class="flex gap-2 mt-0.5">${parts.join("")}</div>` : "";
}

function renderDesktopTable(positions, tbody) {
  tbody.innerHTML = positions.map(p => {
    const isGain = (p.gain_loss || 0) >= 0;
    const glBg = isGain ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700";
    const glColor = isGain ? "text-green-600" : "text-red-500";
    const lvl = p._levels;
    const buySug = lvl?.buy_suggestion ? `<span class="text-[9px] text-brand-500 font-semibold">→ ${lvl.buy_suggestion}</span>` : "";

    return `<tr class="border-t border-slate-50 hover:bg-slate-50/50 transition-colors group">
      <td class="px-5 py-4">
        <div class="flex flex-col gap-0.5">
          <div class="flex items-center gap-1.5">
            <span class="font-bold text-slate-900 tracking-tight">${p.ticker}</span>
            ${_recBadge(lvl?.recommendation)}${buySug}
          </div>
          ${p.notes ? `<span class="text-[10px] text-slate-400 font-medium max-w-[150px] truncate">${p.notes}</span>` : ""}
          ${_levelsBadges(lvl)}
        </div>
      </td>
      <td class="px-4 py-4 text-right text-slate-600 font-medium">${fmt(p.quantity)}</td>
      <td class="px-4 py-4 text-right text-slate-400 font-medium">$${fmt(p.entry_price)}</td>
      <td class="px-4 py-4 text-right font-semibold text-slate-800">$${fmt(p.current_price)}</td>
      <td class="px-4 py-4 text-right font-bold text-slate-900">$${fmt(p.current_value)}</td>
      <td class="px-4 py-4 text-right">
        <span class="inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-bold shadow-sm ${glBg}">
          ${isGain ? "+" : ""}$${fmt(Math.abs(p.gain_loss || 0))}
        </span>
      </td>
      <td class="px-4 py-4 text-right">
        <span class="font-bold cursor-default ${glColor}" title="Return Percentage">${fmtPct(p.gain_loss_pct)}</span>
      </td>
      <td class="px-4 py-4 text-right">
        <div class="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <button onclick="openSell(${p.id}, '${p.ticker}', ${p.quantity}, ${p.current_price})"\
            class="px-2.5 py-1 text-xs font-bold bg-red-50 hover:bg-red-100 text-red-600 rounded-lg transition-colors" title="Sell">Sell</button>
          <button onclick="openEdit(${p.id}, ${p.quantity}, ${p.entry_price}, '${(p.notes || "").replace(/'/g, "\\'")}')"\
            class="p-1.5 hover:bg-brand-50 text-brand-500 rounded-lg transition-colors" title="Edit">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>
          </button>
          <button onclick="deletePosition(${p.id})"\
            class="p-1.5 hover:bg-red-50 text-red-400 rounded-lg transition-colors" title="Remove">
            <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
          </button>
        </div>
      </td>
    </tr>`;
  }).join("");
}

function renderMobileList(positions, container) {
  if (positions.length === 0) {
    container.innerHTML = '<div class="p-6 text-center text-slate-400 italic">No positions yet</div>';
    return;
  }

  container.innerHTML = positions.map(p => {
    const isGain = (p.gain_loss || 0) >= 0;
    const glBadge = isGain ? "bg-green-50 text-green-600 border-green-100" : "bg-red-50 text-red-500 border-red-100";
    const glColor = isGain ? "text-green-600" : "text-red-500";
    const lvl = p._levels;
    const buySug = lvl?.buy_suggestion ? `<div class="mt-1 text-[10px] text-brand-500 font-semibold">Rotate → ${lvl.buy_suggestion}</div>` : "";

    // "X% to resistance" quick reference
    let toResistance = "";
    if (lvl?.resistance != null && p.current_price) {
      const gap = lvl.resistance - p.current_price;
      const gapPct = (gap / p.current_price * 100);
      if (gap > 0) {
        toResistance = `<span class="text-[9px] text-slate-400 font-medium">+${gapPct.toFixed(1)}% to R</span>`;
      } else {
        toResistance = `<span class="text-[9px] text-orange-400 font-semibold">Above R</span>`;
      }
    }

    const levelsSection = lvl && (lvl.support != null || lvl.resistance != null || lvl.stop_loss != null) ? `
      <div>
        <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-1">Key Levels</p>
        <div class="flex gap-3">
          ${lvl.support    != null ? `<div><span class="text-[9px] text-slate-400">Support</span><p class="text-xs font-semibold text-slate-700">$${fmt(lvl.support)}</p></div>` : ""}
          ${lvl.resistance != null ? `<div><span class="text-[9px] text-slate-400">Resistance</span><p class="text-xs font-semibold text-slate-700">$${fmt(lvl.resistance)}</p></div>` : ""}
          ${lvl.stop_loss  != null ? `<div><span class="text-[9px] text-slate-400">Stop Loss</span><p class="text-xs font-semibold text-red-500">$${fmt(lvl.stop_loss)}</p></div>` : ""}
        </div>
        ${buySug}
      </div>` : "";

    return `
      <div class="card p-4 border border-slate-100 shadow-sm active:shadow-md transition-all sm:hover:border-brand-200" onclick="toggleDetails(${p.id})">
        <div class="flex items-center justify-between mb-1">
          <div class="flex items-center gap-2">
            <span class="font-bold text-slate-900 text-lg group-hover:text-brand-600 transition-colors">${p.ticker}</span>
            <span class="text-[10px] bg-slate-100 text-slate-500 font-bold px-1.5 py-0.5 rounded tracking-tighter">${fmt(p.quantity)} Shares</span>
            ${_recBadge(lvl?.recommendation)}
          </div>
          <div class="flex flex-col items-end">
            <span class="font-bold text-slate-900">$${fmt(p.current_price)}</span>
            <div class="mt-1 px-2 py-0.5 rounded text-[10px] font-bold border ${glBadge}">
              ${isGain ? "▲" : "▼"} ${fmtPct(p.gain_loss_pct)}
            </div>
            ${toResistance ? `<div class="mt-0.5">${toResistance}</div>` : ""}
          </div>
        </div>

        <!-- Expandable details -->
        <div id="details-${p.id}" class="hidden mt-4 pt-4 border-t border-slate-50 space-y-3">
          <div class="grid grid-cols-2 gap-4">
            <div>
              <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Average Cost</p>
              <p class="font-semibold text-slate-700">$${fmt(p.entry_price)}</p>
            </div>
            <div>
              <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Total Value</p>
              <p class="font-semibold text-slate-700">$${fmt(p.current_value)}</p>
            </div>
            <div>
              <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Total P&L</p>
              <p class="font-bold ${glColor}">${(p.gain_loss || 0) >= 0 ? "+" : "-"}$${fmt(Math.abs(p.gain_loss || 0))}</p>
            </div>
            <div>
              <p class="text-[10px] text-slate-400 font-bold uppercase tracking-wider mb-0.5">Notes</p>
              <p class="text-xs text-slate-500">${p.notes || "—"}</p>
            </div>
          </div>
          ${levelsSection}
          <div class="flex gap-2 pt-2">
            <button onclick="event.stopPropagation(); openSell(${p.id}, '${p.ticker}', ${p.quantity}, ${p.current_price})"
              class="flex-1 py-2 bg-red-50 border border-red-100 text-red-600 font-bold rounded-lg text-xs hover:bg-red-100 transition-colors">Sell</button>
            <button onclick="event.stopPropagation(); openEdit(${p.id}, ${p.quantity}, ${p.entry_price}, '${(p.notes || "").replace(/'/g, "\\'")}')"
              class="flex-1 btn-secondary py-2 text-xs">Edit</button>
            <button onclick="event.stopPropagation(); deletePosition(${p.id})"
              class="flex-1 border border-slate-100 text-slate-400 font-bold rounded-lg text-xs hover:bg-slate-50 transition-colors">Delete</button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function toggleDetails(id) {
  const el = document.getElementById(`details-${id}`);
  if (el) {
    el.classList.toggle("hidden");
  }
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

// ── SELL ─────────────────────────────────────────────────────────────────────

let _sellPosition = {};

function openSell(id, ticker, qty, price) {
  _sellPosition = { id, ticker, qty, price };
  document.getElementById("sell-id").value = id;
  document.getElementById("sell-qty").value = "";
  document.getElementById("sell-modal-subtitle").textContent =
    `${ticker} · You hold ${fmt(qty)} shares @ $${fmt(price)}`;
  document.getElementById("sell-preview").classList.add("hidden");
  document.getElementById("sell-modal").classList.remove("hidden");

  // Live preview as user types
  const input = document.getElementById("sell-qty");
  input.oninput = () => {
    const sell = parseFloat(input.value) || 0;
    const preview = document.getElementById("sell-preview");
    if (sell <= 0) { preview.classList.add("hidden"); return; }
    const proceeds = sell * price;
    const remaining = qty - sell;
    preview.classList.remove("hidden");
    if (sell >= qty) {
      preview.innerHTML = `Selling all shares · Proceeds ≈ <strong>$${fmt(proceeds)}</strong> · Position closed`;
    } else {
      preview.innerHTML = `Proceeds ≈ <strong>$${fmt(proceeds)}</strong> · ${fmt(remaining)} shares remain`;
    }
  };
  setTimeout(() => input.focus(), 50);
}

function closeSellModal() {
  document.getElementById("sell-modal").classList.add("hidden");
}

async function confirmSell() {
  const qty = parseFloat(document.getElementById("sell-qty").value);
  if (!qty || qty <= 0) return toast("Enter shares to sell.", true);
  const { id, ticker } = _sellPosition;
  try {
    const res = await api("POST", `/portfolio/${id}/sell`, { quantity: qty });
    closeSellModal();
    toast(res.deleted ? `${ticker} position closed.` : `Sold ${fmt(qty)} shares of ${ticker}.`);
    loadPortfolio();
  } catch (e) {
    toast(e.message, true);
  }
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
  content.innerHTML = `<div class="space-y-4">${[1, 2, 3].map(() => `<div class="card p-5"><div class="skeleton h-4 rounded w-32 mb-3"></div><div class="skeleton h-3 rounded w-full mb-2"></div><div class="skeleton h-3 rounded w-3/4"></div></div>`).join("")}</div>`;
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
    const hasLevels = a.support != null || a.resistance != null || a.stop_loss != null;
    // Use structured fields if available, fall back to legacy rationale
    const hasStructured = a.signal || a.news || a.earnings || a.verdict;
    return `
    <div class="card p-5">
      <div class="flex items-start justify-between mb-3">
        <div>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-lg font-bold text-slate-900">${a.ticker}</span>
            ${pill(a.recommendation)}
            ${pill(a.confidence)}
          </div>
        </div>
        <div class="text-right">
          <p class="text-xl font-bold text-slate-900">$${fmt(a.current_price)}</p>
        </div>
      </div>
      ${hasStructured ? `
      <div class="space-y-2 mb-3">
        ${a.signal   ? `<div class="flex gap-2 text-sm"><span class="shrink-0">📊</span><span class="text-slate-600">${a.signal}</span></div>` : ""}
        ${a.news     ? `<div class="flex gap-2 text-sm"><span class="shrink-0">📰</span><span class="text-slate-600">${a.news}</span></div>` : ""}
        ${a.earnings ? `<div class="flex gap-2 text-sm"><span class="shrink-0">📅</span><span class="text-amber-700 font-medium">${a.earnings}</span></div>` : ""}
        ${a.verdict  ? `<div class="flex gap-2 text-sm"><span class="shrink-0">💬</span><span class="text-slate-700 font-medium">${a.verdict}</span></div>` : ""}
      </div>` : `
      <p class="text-sm text-slate-600 leading-relaxed border-l-2 border-brand-100 pl-3 mb-3">${a.rationale}</p>`}
      ${hasLevels ? `
      <div class="flex gap-2 flex-wrap pt-3 border-t border-slate-50">
        ${a.support != null ? `
        <div class="flex items-center gap-1.5 bg-green-50 rounded-lg px-3 py-1.5">
          <span class="w-2 h-2 rounded-full bg-green-400"></span>
          <span class="text-xs text-slate-500">Support</span>
          <span class="text-xs font-bold text-green-700">$${fmt(a.support)}</span>
        </div>` : ""}
        ${a.resistance != null ? `
        <div class="flex items-center gap-1.5 bg-red-50 rounded-lg px-3 py-1.5">
          <span class="w-2 h-2 rounded-full bg-red-400"></span>
          <span class="text-xs text-slate-500">Resistance</span>
          <span class="text-xs font-bold text-red-600">$${fmt(a.resistance)}</span>
        </div>` : ""}
        ${a.stop_loss != null ? `
        <div class="flex items-center gap-1.5 bg-orange-50 rounded-lg px-3 py-1.5">
          <span class="w-2 h-2 rounded-full bg-orange-400"></span>
          <span class="text-xs text-slate-500">Stop Loss</span>
          <span class="text-xs font-bold text-orange-600">$${fmt(a.stop_loss)}</span>
        </div>` : ""}
      </div>` : ""}
      ${a.recommendation === "sell" && a.buy_suggestion ? `
      <div class="mt-3 flex items-center gap-2 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">
        <span class="text-xs text-slate-500">Consider rotating into</span>
        <span class="text-sm font-bold text-brand-600">${a.buy_suggestion}</span>
      </div>` : ""}
    </div>`;
  }).join("");

  const generatedAt = report.generated_at
    ? new Date(report.generated_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Bangkok" }) + " (BKK)"
    : null;

  const hasRealAnalysis = (report.analyses || []).some(a => a.rationale && a.rationale !== "No analysis available.");
  const analysisStatus = hasRealAnalysis
    ? `<span class="inline-flex items-center gap-1 text-xs font-semibold text-green-600 bg-green-50 border border-green-100 px-2 py-0.5 rounded-full">✓ AI analysis complete</span>`
    : `<span class="inline-flex items-center gap-1 text-xs font-semibold text-orange-600 bg-orange-50 border border-orange-100 px-2 py-0.5 rounded-full">⚠ AI data unavailable — run again</span>`;

  content.innerHTML = `
    <div class="mb-4">
      <div class="flex flex-wrap items-center gap-2 mb-1">
        <h2 class="text-base font-semibold text-slate-700">${report.report_date}</h2>
        ${analysisStatus}
      </div>
      ${generatedAt ? `<p class="text-xs text-slate-400">Generated ${generatedAt}</p>` : ""}
    </div>
    <div class="grid grid-cols-1 md:grid-cols-3 gap-4 mb-5">
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
  const btn = document.querySelector('[onclick="triggerAnalysis()"]');
  try {
    await api("POST", "/analysis/trigger");
    showAnalysisProgress(btn);
  } catch (e) {
    toast(e.message, true);
  }
}

let _analysisEventSource = null;

function showAnalysisProgress(btn) {
  // Close any existing SSE connection
  if (_analysisEventSource) { _analysisEventSource.close(); _analysisEventSource = null; }

  let bar = document.getElementById("analysis-status-bar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "analysis-status-bar";
    bar.className = "flex items-center gap-3 px-4 py-3 mb-4 rounded-xl bg-brand-50 border border-brand-200 text-brand-700 text-sm font-medium";
    const content = document.getElementById("analysis-content");
    content.parentElement.insertBefore(bar, content);
  }

  function updateBar(s) {
    bar.className = "px-4 py-3 mb-4 rounded-xl bg-brand-50 border border-brand-200 text-brand-700 text-sm";
    const tickers = s.tickers || [];
    const done = new Set(s.done || []);
    const tickerGrid = tickers.length > 0
      ? `<div class="flex flex-wrap gap-1.5 mt-2">
          ${tickers.map(t => done.has(t)
            ? `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-700 text-xs font-bold">✓ ${t}</span>`
            : `<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-white border border-brand-200 text-slate-400 text-xs font-bold">
                <svg class="animate-spin w-2.5 h-2.5" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path></svg>
                ${t}</span>`
          ).join('')}
        </div>` : "";
    bar.innerHTML = `
      <div class="flex items-center gap-2 font-medium">
        <svg class="animate-spin w-4 h-4 shrink-0 text-brand-500" fill="none" viewBox="0 0 24 24">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
          <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
        </svg>
        <span>${s.message || "Analysing…"}</span>
      </div>
      ${tickerGrid}`;
  }

  updateBar({ message: "Connecting…" });
  if (btn) { btn.disabled = true; btn.textContent = "Running…"; }

  const es = new EventSource(`${API}/analysis/stream`);
  _analysisEventSource = es;

  es.onmessage = (e) => {
    if (e.data.startsWith(":")) return; // keepalive
    try {
      const s = JSON.parse(e.data);
      if (s.running) {
        updateBar(s);
      } else {
        es.close();
        _analysisEventSource = null;
        if (btn) { btn.disabled = false; btn.innerHTML = "▶ Run Now"; }
        const isError = s.message?.startsWith("error");
        bar.className = `flex items-center gap-3 px-4 py-3 mb-4 rounded-xl text-sm font-medium ${
          isError ? "bg-red-50 border border-red-200 text-red-700"
                  : "bg-green-50 border border-green-200 text-green-700"}`;
        bar.innerHTML = isError
          ? `<span>⚠ ${s.message}</span>`
          : `<span>✓ Analysis complete — loading results…</span>`;
        if (!isError) loadAnalysisHistory();
        setTimeout(() => bar.remove(), 4000);
      }
    } catch (_) {}
  };

  es.onerror = () => {
    es.close();
    _analysisEventSource = null;
    if (bar) bar.remove();
    if (btn) { btn.disabled = false; btn.innerHTML = "▶ Run Now"; }
  };
}

// ── ADVISOR ──────────────────────────────────────────────────────────────────

async function getAdvice() {
  const budget = parseFloat(document.getElementById("advisor-budget").value);
  const risk = document.getElementById("advisor-risk").value;
  const sector = document.getElementById("advisor-sector").value.trim() || null;
  const notes = document.getElementById("advisor-notes").value.trim() || null;
  const interestsRaw = document.getElementById("advisor-interests").value.trim();
  const stocks_of_interest = interestsRaw
    ? interestsRaw.split(",").map(s => s.trim().toUpperCase()).filter(Boolean)
    : null;

  if (isNaN(budget) || budget <= 0) return toast("Enter a valid budget.", true);

  const result = document.getElementById("advisor-result");
  const output = document.getElementById("advisor-output");
  result.classList.remove("hidden");

  const thinkingMsgs = ["Searching market data…", "Fetching technicals and news…", "Analysing your portfolio…", "Crafting recommendations…"];
  let msgIdx = 0;
  output.innerHTML = `
    <div class="card p-5 flex items-center gap-3 text-slate-500 text-sm">
      <svg class="animate-spin w-4 h-4 shrink-0 text-brand-400" fill="none" viewBox="0 0 24 24">
        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"></path>
      </svg>
      <span id="advisor-thinking-text" class="animate-pulse">${thinkingMsgs[0]}</span>
    </div>`;
  const thinkingTimer = setInterval(() => {
    msgIdx = (msgIdx + 1) % thinkingMsgs.length;
    const el = document.getElementById("advisor-thinking-text");
    if (el) el.textContent = thinkingMsgs[msgIdx];
  }, 3000);

  try {
    const data = await api("POST", "/advisor", { budget_usd: budget, risk_level: risk, sector_preference: sector, notes, stocks_of_interest });
    clearInterval(thinkingTimer);
    renderAdvisorResult(output, data, budget);
  } catch (e) {
    clearInterval(thinkingTimer);
    output.innerHTML = `<div class="card p-5 text-red-500 text-sm">Error: ${e.message}</div>`;
  }
}

function renderAdvisorResult(output, data, budget) {
  if (data.error) {
    output.innerHTML = `<div class="card p-5 text-red-500 text-sm">${data.error}</div>`;
    return;
  }

  const riskLabel = { buy_more: "Buy More", hold: "Hold", sell: "Sell" };

  const cards = (data.suggestions || []).map(s => {
    const hasLevels = s.support != null || s.resistance != null || s.stop_loss != null;
    const pct = budget > 0 ? Math.round(s.allocate_usd / budget * 100) : 0;
    return `
    <div class="card p-4 border border-slate-100">
      <div class="flex items-start justify-between mb-2">
        <div>
          <span class="text-lg font-bold text-slate-900">${s.ticker}</span>
          ${s.current_price ? `<span class="ml-2 text-sm text-slate-400">$${fmt(s.current_price)}</span>` : ""}
        </div>
        <div class="text-right">
          <p class="text-lg font-bold text-brand-600">$${fmt(s.allocate_usd)}</p>
          <p class="text-[10px] text-slate-400">${pct}% of budget</p>
        </div>
      </div>
      <p class="text-sm text-slate-600 leading-relaxed border-l-2 border-brand-100 pl-3 mb-3">${s.rationale}</p>
      ${hasLevels ? `
      <div class="flex gap-2 flex-wrap">
        ${s.support    != null ? `<div class="flex items-center gap-1 bg-green-50 rounded-lg px-2.5 py-1"><span class="text-[10px] text-slate-400">Support</span><span class="text-xs font-bold text-green-700 ml-1">$${fmt(s.support)}</span></div>` : ""}
        ${s.resistance != null ? `<div class="flex items-center gap-1 bg-red-50 rounded-lg px-2.5 py-1"><span class="text-[10px] text-slate-400">Resistance</span><span class="text-xs font-bold text-red-600 ml-1">$${fmt(s.resistance)}</span></div>` : ""}
        ${s.stop_loss  != null ? `<div class="flex items-center gap-1 bg-orange-50 rounded-lg px-2.5 py-1"><span class="text-[10px] text-slate-400">Stop Loss</span><span class="text-xs font-bold text-orange-600 ml-1">$${fmt(s.stop_loss)}</span></div>` : ""}
      </div>` : ""}
    </div>`;
  }).join("");

  output.innerHTML = `
    <div class="space-y-3">
      ${data.snapshot ? `
      <div class="card p-4 bg-slate-50 border border-slate-100">
        <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">Portfolio Snapshot</p>
        <p class="text-sm text-slate-700">${data.snapshot}</p>
      </div>` : ""}
      ${cards}
      ${data.allocation_note ? `
      <div class="card p-4 border border-brand-100 bg-brand-50/30">
        <p class="text-xs font-bold text-slate-400 uppercase tracking-wider mb-1">After This Allocation</p>
        <p class="text-sm text-slate-600">${data.allocation_note}</p>
      </div>` : ""}
    </div>`;
}

// ── Utilities ────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n == null) return "0.00";
  return new Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtPct(n) {
  if (n == null) return "0.00%";
  return (n >= 0 ? "+" : "") + fmt(n) + "%";
}

function pill(text) {
  if (!text) return "";
  const colors = {
    buy_more: "bg-green-100 text-green-700",
    hold: "bg-yellow-100 text-yellow-700",
    sell: "bg-red-100 text-red-700",
    high: "bg-red-100 text-red-700",
    medium: "bg-yellow-100 text-yellow-700",
    low: "bg-green-100 text-green-700"
  };
  const cls = colors[text.toLowerCase()] || "bg-slate-100 text-slate-700";
  return `<span class="px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-tight ${cls}">${text.replace(/_/g, " ")}</span>`;
}

async function api(method, endpoint, body) {
  const res = await fetch(`${API}${endpoint}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : null
  });
  if (!res.ok) {
    const data = await res.json();
    throw new Error(data.detail || "API Error");
  }
  return res.json();
}

function toast(msg, isError = false) {
  const t = document.createElement("div");
  t.className = `fixed bottom-6 right-6 px-6 py-3 rounded-xl shadow-2xl z-50 transition-all duration-300 ${isError ? "bg-red-500 text-white" : "bg-slate-900 text-white"
    }`;
  t.innerHTML = `
    <div class="flex items-center gap-3">
      ${isError ? '<span>⚠️</span>' : '<span>✅</span>'}
      <span class="font-bold text-sm">${msg}</span>
    </div>
  `;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3000);
}

// ── Init ─────────────────────────────────────────────────────────────────────
showTab("portfolio");

// On load: check if analysis is running or just finished (survives page refresh)
(async () => {
  try {
    const status = await api("GET", "/analysis/status");
    if (status.running) {
      showTab("analysis");
      const btn = document.querySelector('[onclick="triggerAnalysis()"]');
      showAnalysisProgress(btn);
    } else if (status.message === "done") {
      // Analysis finished while user was away — show a brief toast
      toast("Analysis completed — results ready.");
    }
  } catch (_) {}
})();
