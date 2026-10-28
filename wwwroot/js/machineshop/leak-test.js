// Machine Shop > Leak Test (#tab-ms-leak-test). Prefix: mlt.
// Port of the ThingWorx mashup RE_MS_LT_CoverLH_MU (Thing RE_MS_LeakTest_TH), one copy per component tab.
// Layout only for now: the Thing's service code is not exported yet, so every widget shows an empty state.
// Widget -> ThingWorx service (Cover LH names; the other components follow the same pattern):
//   Shift A/B/C grids         get_CoverLH_ShiftA/B/C_Count(startDate, endDate)
//   Totals grid               get_TotalValuesCoverLH(shiftAData, shiftBData, shiftCData)
//   TOTAL / SHIFT pies        getPercentPieChart(data)   (OK % / NOK %)
//   TOTAL QTY pie             get_OKvsNOKQtyCoverLH(data) (OK Qty / NOK Qty)
//   Leak value chart          getLeakValueChart(startDate, endDate)   (LeakValue / Count)
//   OK vs NOK pop-up          get_OK/NOK_TrendForWeek_CoverLH(startDate, selDate), get_OK/NOK_TrendForYear_CoverLH()
//   Summary pop-up            getOKNOKSummary_CoverLH(startDate, endDate)

// cells: number of CELL n columns in the grids. Cover LH = 2 (from the mashup, Cell_3..6 hidden);
// the other components are PROVISIONAL (2) until their mashups / RE_MS_LeakTest_TH confirm the count.
const MLT_TABS = [
    { id: 'cover-lh', label: 'Cover LH', title: 'COVER LH Leak Test', cells: 2 },
    { id: 'cover-rh', label: 'Cover RH', title: 'COVER RH Leak Test', cells: 2 },
    { id: 'cylinder-head', label: 'Cylinder Head', title: 'CYLINDER HEAD Leak Test', cells: 2 },
    { id: 'cylinder-barrel', label: 'Cylinder Barrel', title: 'CYLINDER BARREL Leak Test', cells: 2 },
    { id: 'crankshaft', label: 'Crankshaft', title: 'CRANKSHAFT Leak Test', cells: 2 },
    { id: 'crankcase', label: 'Crankcase', title: 'CRANKCASE Leak Test', cells: 2 }
];

// MS_PDI_SD state colours used by every pie in the mashup.
const MLT_OK_COLOR = 'rgba(128,72,189,1)';
const MLT_NOK_COLOR = 'rgba(23,186,227,1)';
const MLT_SHIFTS = ['A', 'B', 'C'];

let mltActiveTab = MLT_TABS[0].id;
const mltCharts = {};       // tabId -> { pieTotal, pieA, pieB, pieC, pieQty, leak }
const mltData = {};         // tabId -> last loaded data (null until the backend exists)
const mltPickers = {};      // tabId -> flatpickr instance

function mltTab(id) {
    return MLT_TABS.find(t => t.id === id);
}

function mltRender() {
    const bar = document.getElementById('mltTabs');
    const body = document.getElementById('mltBody');
    if (!bar || !body) return;

    bar.innerHTML = MLT_TABS.map(t =>
        `<button class="mlt-tab${t.id === mltActiveTab ? ' active' : ''}" data-mlttab="${t.id}" onclick="mltSelectTab('${t.id}')">${t.label}</button>`
    ).join('');

    body.innerHTML = MLT_TABS.map(t => `
        <div class="mlt-pane${t.id === mltActiveTab ? ' active' : ''}" id="mltPane-${t.id}">
            <div class="mlt-layout">
                <div class="mlt-left">
                    ${mltPieCard(t.id, 'pieTotal', 'TOTAL', true)}
                    <div class="mlt-legend">
                        <span><i style="background:${MLT_OK_COLOR}"></i>OK</span>
                        <span><i style="background:${MLT_NOK_COLOR}"></i>NOK</span>
                    </div>
                    ${MLT_SHIFTS.map(s => mltPieCard(t.id, 'pie' + s, 'SHIFT ' + s, false)).join('')}
                    ${mltPieCard(t.id, 'pieQty', 'TOTAL QTY', true)}
                </div>
                <div class="mlt-right">
                    <div class="mlt-head">
                        <div class="mlt-title">${t.title}</div>
                        <input type="text" class="mlt-date" id="mlt-${t.id}-date" placeholder="Select date range" readonly>
                        <button class="btn-primary mlt-btn" onclick="mltOpenOkNok('${t.id}')">OK vs NOK</button>
                        <button class="btn-primary mlt-btn" onclick="mltOpenSummary('${t.id}')">Summary</button>
                    </div>
                    <div class="mlt-grids">
                        ${MLT_SHIFTS.map((s, i) => mltGridHtml(t, 'shift' + s, i === 0, false)).join('')}
                        ${mltGridHtml(t, 'total', false, true)}
                    </div>
                    <div class="mlt-card mlt-leak">
                        <div class="mlt-card-title">Leak Value Distribution</div>
                        <div class="mlt-leak-canvas"><canvas id="mlt-${t.id}-leak"></canvas></div>
                    </div>
                </div>
            </div>
        </div>`
    ).join('');

    mltEnsureModals();
}

function mltPieCard(tabId, key, label, large) {
    return `<div class="mlt-pie${large ? ' mlt-pie-lg' : ''}">
        <div class="mlt-pie-canvas"><canvas id="mlt-${tabId}-${key}"></canvas></div>
        <div class="mlt-pie-label">${label}</div>
    </div>`;
}

// One grid: SHIFT | DESCRIPTION | CELL 1..n | TOTAL. Only the Shift A grid shows the header row
// (ptcsgrid-45); B, C and the Totals grid (ptcsgrid-59, orange rows, 2 decimals) hide it.
function mltGridHtml(tab, key, showHeader, isTotal) {
    const cols = ['SHIFT', 'DESCRIPTION'];
    for (let i = 1; i <= tab.cells; i++) cols.push('CELL ' + i);
    cols.push('TOTAL');
    return `<table class="mlt-grid${isTotal ? ' mlt-grid-total' : ''}" id="mlt-${tab.id}-${key}">
        ${showHeader ? `<thead><tr>${cols.map(c => `<th>${c}</th>`).join('')}</tr></thead>` : ''}
        <tbody><tr class="mlt-grid-empty"><td colspan="${cols.length}">No data</td></tr></tbody>
    </table>`;
}

function mltSelectTab(id) {
    mltActiveTab = id;
    document.querySelectorAll('#mltTabs .mlt-tab').forEach(btn =>
        btn.classList.toggle('active', btn.dataset.mlttab === id));
    document.querySelectorAll('#mltBody .mlt-pane').forEach(p =>
        p.classList.toggle('active', p.id === `mltPane-${id}`));
    mltInitTab(id);
}

// Charts and the date picker are created the first time a tab is shown (a hidden canvas has no size).
function mltInitTab(id) {
    if (!mltPickers[id] && typeof flatpickr === 'function') {
        const today = new Date();
        mltPickers[id] = flatpickr(`#mlt-${id}-date`, {
            mode: 'range',
            dateFormat: 'd/m/Y',
            defaultDate: [today, today],
            maxDate: today,
            onChange: sel => { if (sel.length === 2) mltLoad(id); }
        });
    }
    if (!mltCharts[id]) {
        mltRenderCharts(id);
        mltLoad(id);
    }
}

// Single data hook: the date range drives every widget (ThingWorx RangeChanged reloads them all).
// No backend yet - RE_MS_LeakTest_TH has not been exported - so this renders the empty states.
function mltLoad(id) {
    mltData[id] = null;
    mltRenderCharts(id);
}

function mltThemeColors() {
    const light = document.body.classList.contains('light-mode');
    return {
        text: light ? '#1d1d1f' : '#e5e7eb',
        muted: light ? '#86868b' : '#9ca3af',
        grid: light ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.08)',
        empty: light ? '#e5e5ea' : '#333333'
    };
}

// Draws "No data" in the middle of a chart whose datasets are empty / all zero.
const mltNoDataPlugin = {
    id: 'mltNoData',
    afterDraw(chart) {
        const hasData = chart.data.datasets.some(ds => (ds.data || []).some(v => Number(v) > 0) && !ds.mltPlaceholder);
        if (hasData) return;
        const { ctx, chartArea } = chart;
        if (!chartArea) return;
        ctx.save();
        ctx.fillStyle = mltThemeColors().muted;
        ctx.font = '12px Inter, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No data', (chartArea.left + chartArea.right) / 2, (chartArea.top + chartArea.bottom) / 2);
        ctx.restore();
    }
};

function mltRenderCharts(id) {
    if (typeof Chart === 'undefined') return;
    const old = mltCharts[id];
    if (old) Object.values(old).forEach(c => c && c.destroy());

    const colors = mltThemeColors();
    const data = mltData[id];   // later: { total, A, B, C } percentages, qty, leak[] from the API
    const charts = {};

    const pie = (key, values, labels) => {
        const el = document.getElementById(`mlt-${id}-${key}`);
        if (!el) return null;
        const empty = !values || values.every(v => !v);
        return new Chart(el, {
            type: 'pie',
            data: {
                labels: empty ? ['No data'] : labels,
                datasets: [{
                    data: empty ? [1] : values,
                    backgroundColor: empty ? [colors.empty] : [MLT_OK_COLOR, MLT_NOK_COLOR],
                    borderWidth: 0,
                    mltPlaceholder: empty
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: { legend: { display: false }, tooltip: { enabled: !empty } }
            },
            plugins: [mltNoDataPlugin]
        });
    };

    charts.pieTotal = pie('pieTotal', data && data.totalPct, ['OK %', 'NOK %']);
    MLT_SHIFTS.forEach(s => { charts['pie' + s] = pie('pie' + s, data && data['shift' + s + 'Pct'], ['OK %', 'NOK %']); });
    charts.pieQty = pie('pieQty', data && data.qty, ['OK Qty', 'NOK Qty']);

    const leakEl = document.getElementById(`mlt-${id}-leak`);
    if (leakEl) {
        const leak = (data && data.leak) || [];
        charts.leak = new Chart(leakEl, {
            type: 'bar',
            data: {
                labels: leak.map(r => r.leakValue),
                datasets: [{ label: 'Count', data: leak.map(r => r.count), backgroundColor: MLT_OK_COLOR }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { title: { display: true, text: 'Leak Value', color: colors.muted }, ticks: { color: colors.text }, grid: { color: colors.grid } },
                    y: { beginAtZero: true, title: { display: true, text: 'Count', color: colors.muted }, ticks: { color: colors.text, precision: 0 }, grid: { color: colors.grid } }
                }
            },
            plugins: [mltNoDataPlugin]
        });
    }
    mltCharts[id] = charts;
}

// Theme hook (called from applyTheme() in index.html): chart text/grid colours follow the theme.
function mltApplyTheme() {
    Object.keys(mltCharts).forEach(mltRenderCharts);
    if (mltModalCharts.length) mltRenderOkNokCharts(mltModalTab);
}

// ---- Pop-ups (ThingWorx navigation functions okNokNav / summaryNav) ----

let mltModalCharts = [];
let mltModalTab = null;

function mltEnsureModals() {
    if (document.getElementById('mltOkNokModal')) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = `
        <div id="mltOkNokModal" class="modal-overlay mlt-modal">
            <div class="modal-content mlt-modal-content mlt-modal-wide">
                <div class="modal-header">
                    <h2 id="mltOkNokTitle">OK vs NOK</h2>
                    <button class="close-modal" onclick="mltCloseModals()">&times;</button>
                </div>
                <div class="mlt-modal-body mlt-trend-grid">
                    ${['weekOK', 'weekNOK', 'yearOK', 'yearNOK'].map(k => `
                        <div class="mlt-card">
                            <div class="mlt-card-title">${k.startsWith('week') ? 'Week' : 'Year'} ${k.endsWith('NOK') ? 'NOK' : 'OK'} %</div>
                            <div class="mlt-trend-canvas"><canvas id="mltTrend-${k}"></canvas></div>
                        </div>`).join('')}
                </div>
            </div>
        </div>
        <div id="mltSummaryModal" class="modal-overlay mlt-modal" onclick="if (event.target === this) mltCloseModals()">
            <div class="modal-content mlt-modal-content">
                <div class="modal-header">
                    <h2 id="mltSummaryTitle">SUMMARY</h2>
                    <button class="close-modal" onclick="mltCloseModals()">&times;</button>
                </div>
                <div class="mlt-modal-body">
                    <table class="mlt-grid">
                        <thead><tr><th>DATE</th><th>PRODUCED QTY</th><th>OK QTY</th><th>OK %</th><th>NOK QTY</th><th>NOK %</th></tr></thead>
                        <tbody id="mltSummaryBody"><tr class="mlt-grid-empty"><td colspan="6">No data</td></tr></tbody>
                    </table>
                </div>
            </div>
        </div>`;
    while (wrap.firstElementChild) document.body.appendChild(wrap.firstElementChild);
    document.addEventListener('keydown', e => { if (e.key === 'Escape') mltCloseModals(); });
}

// OK vs NOK pop-up: RE_MS_LT_OkvsNok_MU takes weekOK/weekNOK/yearOK/yearNOK tables
// (RE_MS_LT_PercentageTrend_DS). Its own layout was not exported - 2x2 trend charts are PROVISIONAL.
function mltOpenOkNok(id) {
    mltModalTab = id;
    document.getElementById('mltOkNokTitle').textContent = `OK vs NOK - ${mltTab(id).label}`;
    document.getElementById('mltOkNokModal').classList.add('active');
    mltRenderOkNokCharts(id);
}

function mltRenderOkNokCharts(id) {
    mltModalCharts.forEach(c => c.destroy());
    mltModalCharts = [];
    const colors = mltThemeColors();
    const trends = (mltData[id] && mltData[id].trends) || {};
    ['weekOK', 'weekNOK', 'yearOK', 'yearNOK'].forEach(k => {
        const el = document.getElementById(`mltTrend-${k}`);
        const rows = trends[k] || [];
        mltModalCharts.push(new Chart(el, {
            type: 'bar',
            data: {
                labels: rows.map(r => r.label),
                datasets: [{ data: rows.map(r => r.value), backgroundColor: k.endsWith('NOK') ? MLT_NOK_COLOR : MLT_OK_COLOR }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
                    y: { beginAtZero: true, max: 100, ticks: { color: colors.text }, grid: { color: colors.grid } }
                }
            },
            plugins: [mltNoDataPlugin]
        }));
    });
}

// Summary pop-up: RE_MS_LT_SummaryTable_MU (RE_MS_LeakTest_SummaryTable_DS:
// Date, ProducedQty, OKQty, OKPercent, NOKQty, NOKPercent).
function mltOpenSummary(id) {
    document.getElementById('mltSummaryTitle').textContent = `SUMMARY - ${mltTab(id).label}`;
    const rows = (mltData[id] && mltData[id].summary) || [];
    document.getElementById('mltSummaryBody').innerHTML = rows.length
        ? rows.map(r => `<tr><td>${r.date}</td><td>${r.producedQty}</td><td>${r.okQty}</td><td>${r.okPercent}</td><td>${r.nokQty}</td><td>${r.nokPercent}</td></tr>`).join('')
        : '<tr class="mlt-grid-empty"><td colspan="6">No data</td></tr>';
    document.getElementById('mltSummaryModal').classList.add('active');
}

function mltCloseModals() {
    ['mltOkNokModal', 'mltSummaryModal'].forEach(m => {
        const el = document.getElementById(m);
        if (el) el.classList.remove('active');
    });
}

function loadMltDefaultView() {
    if (!document.querySelector('#mltTabs .mlt-tab')) mltRender();
    mltInitTab(mltActiveTab);
}
