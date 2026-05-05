const API = "/api/v1";
let currentPortfolio = [];
let allocationChart = null;

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
  document.getElementById("view-content-charts").classList.toggle("hidden", isList);

  // Toggle tab buttons
  const listBtn = document.getElementById("view-tab-list");
  const chartsBtn = document.getElementById("view-tab-charts");

  if (isList) {
    listBtn.classList.add("bg-white", "text-slate-900", "shadow-sm");
    listBtn.classList.remove("text-slate-500");
    chartsBtn.classList.remove("bg-white", "text-slate-900", "shadow-sm");
    chartsBtn.classList.add("text-slate-500");
  } else {
    chartsBtn.classList.add("bg-white", "text-slate-900", "shadow-sm");
    chartsBtn.classList.remove("text-slate-500");
    listBtn.classList.remove("bg-white", "text-slate-900", "shadow-sm");
    listBtn.classList.add("text-slate-500");

    // Refresh charts when switching to charts view
    if (currentPortfolio.length > 0) {
      setTimeout(() => {
        updateAllocationChart(currentPortfolio);
        updatePerformanceChart(currentPortfolio);
        updateReturnChart(currentPortfolio);
      }, 0);
    }
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
    const positions = await api("GET", "/portfolio");
    currentPortfolio = positions;
    renderPortfolio(positions);
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

  // Render Desktop Table
  renderDesktopTable(validPositions, tbody);

  // Render Mobile List
  renderMobileList(validPositions, mobileList);

  // Update Charts - Wrap in try-catch to prevent breaking list rendering
  try {
    updateAllocationChart(validPositions);
    updatePerformanceChart(validPositions);
    updateReturnChart(validPositions);
  } catch (e) {
    console.error("Chart Rendering Error:", e);
  }
}

let performanceChart = null;

function updatePerformanceChart(positions) {
  const canvas = document.getElementById('performanceChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (performanceChart) {
    performanceChart.destroy();
  }

  if (positions.length === 0) return;

  const data = {
    labels: positions.map(p => p.ticker),
    datasets: [{
      label: 'Gains/Losses ($)',
      data: positions.map(p => p.gain_loss),
      backgroundColor: positions.map(p => (p.gain_loss >= 0 ? '#10b981' : '#f43f5e')),
      borderRadius: 6,
    }]
  };

  performanceChart = new Chart(ctx, {
    type: 'bar',
    data: data,
    options: {
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => ` P&L: ${item.raw >= 0 ? '+' : ''}$${fmt(item.raw)}`
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { callback: (val) => (val >= 0 ? '+' : '') + '$' + val }
        },
        y: {
          grid: { display: false }
        }
      },
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

let returnChart = null;

function updateReturnChart(positions) {
  const canvas = document.getElementById('returnChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  if (returnChart) {
    returnChart.destroy();
  }

  if (positions.length === 0) return;

  // Use gain_loss_pct from backend
  const sorted = [...positions].sort((a, b) => (b.gain_loss_pct || 0) - (a.gain_loss_pct || 0));

  const data = {
    labels: sorted.map(p => p.ticker),
    datasets: [{
      label: 'Return (%)',
      data: sorted.map(p => p.gain_loss_pct || 0),
      backgroundColor: sorted.map(p => ((p.gain_loss_pct || 0) >= 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(244, 63, 94, 0.2)')),
      borderColor: sorted.map(p => ((p.gain_loss_pct || 0) >= 0 ? '#10b981' : '#f43f5e')),
      borderWidth: 2,
      borderRadius: 4,
    }]
  };

  returnChart = new Chart(ctx, {
    type: 'bar',
    data: data,
    options: {
      indexAxis: 'y',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => ` Return: ${item.raw >= 0 ? '+' : ''}${item.raw.toFixed(2)}%`
          }
        }
      },
      scales: {
        x: {
          grid: { color: '#f1f5f9' },
          ticks: { callback: (val) => val + '%' }
        },
        y: {
          grid: { display: false }
        }
      },
      responsive: true,
      maintainAspectRatio: false
    }
  });
}

function updateAllocationChart(positions) {
  const canvas = document.getElementById('allocationChart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const legendContainer = document.getElementById('chart-legend');

  if (allocationChart) {
    allocationChart.destroy();
  }

  if (positions.length === 0) {
    legendContainer.innerHTML = "";
    return;
  }

  // Predefined colors
  const colors = [
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6',
    '#6366f1', '#8b5cf6', '#ec4899', '#f43f5e', '#f59e0b', '#10b981', '#06b6d4', '#3b82f6'
  ];

  const data = {
    labels: positions.map(p => p.ticker),
    datasets: [{
      data: positions.map(p => p.current_value),
      backgroundColor: colors.slice(0, positions.length),
      borderWidth: 0,
      hoverOffset: 4
    }]
  };

  // Generate legend HTML
  legendContainer.innerHTML = positions.map((p, i) => `
    <div class="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-slate-50 border border-slate-100">
      <span class="w-2 h-2 rounded-full" style="background-color: ${colors[i % colors.length]}"></span>
      <span class="text-[9px] font-bold text-slate-600 uppercase tracking-tighter">${p.ticker}</span>
    </div>
  `).join("");

  allocationChart = new Chart(ctx, {
    type: 'doughnut',
    data: data,
    options: {
      cutout: '70%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (item) => ` ${item.label}: $${fmt(item.raw)}`
          }
        }
      },
      maintainAspectRatio: false
    }
  });
}

function renderDesktopTable(positions, tbody) {
  tbody.innerHTML = positions.map(p => {
    const isGain = (p.gain_loss || 0) >= 0;
    const glBg = isGain ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700";
    const glColor = isGain ? "text-green-600" : "text-red-500";

    return `<tr class="border-t border-slate-50 hover:bg-slate-50/50 transition-colors group">
      <td class="px-5 py-4">
        <div class="flex flex-col">
          <span class="font-bold text-slate-900 tracking-tight">${p.ticker}</span>
          ${p.notes ? `<span class="text-[10px] text-slate-400 font-medium mt-0.5 max-w-[150px] truncate">${p.notes}</span>` : ""}
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

    return `
      <div class="card p-4 border border-slate-100 shadow-sm active:shadow-md transition-all sm:hover:border-brand-200" onclick="toggleDetails(${p.id})">
        <div class="flex items-center justify-between mb-1">
          <div class="flex items-center gap-2">
            <span class="font-bold text-slate-900 text-lg group-hover:text-brand-600 transition-colors">${p.ticker}</span>
            <span class="text-[10px] bg-slate-100 text-slate-500 font-bold px-1.5 py-0.5 rounded tracking-tighter">${fmt(p.quantity)} Shares</span>
          </div>
          <div class="flex flex-col items-end">
            <span class="font-bold text-slate-900">$${fmt(p.current_price)}</span>
            <div class="mt-1 px-2 py-0.5 rounded text-[10px] font-bold border ${glBadge}">
              ${isGain ? "▲" : "▼"} ${fmtPct(p.gain_loss_pct)}
            </div>
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
          <div class="flex gap-2 pt-2">
            <button onclick="event.stopPropagation(); openEdit(${p.id}, ${p.quantity}, ${p.entry_price}, '${(p.notes || "").replace(/'/g, "\\'")}')"
              class="flex-1 btn-secondary py-2 text-xs">Edit</button>
            <button onclick="event.stopPropagation(); deletePosition(${p.id})"
              class="flex-1 border border-red-100 text-red-500 font-bold rounded-lg text-xs hover:bg-red-50 transition-colors">Delete</button>
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
          <p class="text-xs text-slate-400 mt-0.5">${recIcon[a.recommendation] || "⚪"} ${a.recommendation.replace(/_/g, " ").toUpperCase()}</p>
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
            <span class="font-semibold ${(a.volume_ratio || 1) > 1.2 ? 'text-brand-500' : 'text-slate-500'}">${a.volume_ratio != null ? a.volume_ratio + "×" : "—"}</span>
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
