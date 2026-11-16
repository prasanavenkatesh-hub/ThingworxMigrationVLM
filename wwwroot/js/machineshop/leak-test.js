// Machine Shop > Leak Test (#tab-ms-leak-test). Prefix: mlt.
// Port of the ThingWorx mashup RE_MS_LT_CoverLH_MU (Thing RE_MS_LeakTest_TH), one copy per component tab.
// live: true = backed by GET /api/machineshop/leaktest/{id}/data (+ /yeartrend), LeakTestService, which
// reads MachineShop:LeakTest:Components:{id} (stations + cells). All six components are live.
// Widget -> ThingWorx service (Cover LH names; the other components call the generic services
// get_ShiftA/B/C_Count, get_TotalValues, getLeakValueChart, getOKNOKSummary, get_OK/NOK_TrendForWeek/Year
// with MachineDesc = CYLINDER HEAD / CYLINDER BARREL / CRANKSHAFT / CRANKCASE):
//   Shift A/B/C grids         get_CoverLH_ShiftA/B/C_Count(startDate, endDate)
//   Totals grid               get_TotalValuesCoverLH(shiftAData, shiftBData, shiftCData)
//   TOTAL / SHIFT pies        getPercentPieChart(data)   (OK % / NOK %)
//   TOTAL QTY pie             get_OKvsNOKQtyCoverLH(data) (OK Qty / NOK Qty)
//   Leak value chart          getLeakValueChart(startDate, endDate)   (LeakValue / Count)
//   OK vs NOK pop-up          get_OK/NOK_TrendForWeek_CoverLH(startDate, selDate), get_OK/NOK_TrendForYear_CoverLH()
//   Summary pop-up            getOKNOKSummary_CoverLH(startDate, endDate)

// cells: number of CELL n columns in the grids, from each mashup's visible grid columns (must match
// MachineShop:LeakTest:Components:{id}:Cells): Cover LH 2 (RE_MS_LT_CoverLH_MU), Cover RH 3
// (RE_MS_LT_CoverRH_MU, Cell_4..6 hidden), Cylinder Head 6 (RE_MS_CylinderHead_MU, none hidden),
// Cylinder Barrel 3 (Cell_4..6 hidden), Crankcase 6 (RE_MS_Crankcase_MU, none hidden). Crankshaft 4:
// RE_MS_Crankshaft_MU hides Cell_4..6, but station 41 logs cells 1-4 and the ThingWorx Total included
// cell 4, so the hidden column made the row not add up - shown here.
const MLT_TABS = [
    { id: 'cover-lh', label: 'Cover LH', title: 'COVER LH Leak Test', cells: 2, live: true },
    { id: 'cover-rh', label: 'Cover RH', title: 'COVER RH Leak Test', cells: 3, live: true },
    { id: 'cylinder-head', label: 'Cylinder Head', title: 'CYLINDER HEAD Leak Test', cells: 6, live: true },
    { id: 'cylinder-barrel', label: 'Cylinder Barrel', title: 'CYLINDER BARREL Leak Test', cells: 3, live: true },
    { id: 'crankshaft', label: 'Crankshaft', title: 'CRANKSHAFT Leak Test', cells: 4, live: true },
    { id: 'crankcase', label: 'Crankcase', title: 'CRANKCASE Leak Test', cells: 6, live: true }
];

// MS_PDI_SD state colours used by every pie in the mashup.
const MLT_OK_COLOR = 'rgba(128,72,189,1)';
const MLT_NOK_COLOR = 'rgba(23,186,227,1)';
const MLT_SHIFTS = ['A', 'B', 'C'];

let mltActiveTab = MLT_TABS[0].id;
const mltCharts = {};       // tabId -> { pieTotal, pieA, pieB, pieC, pieQty, leak }
const mltData = {};         // tabId -> last /data response (null = none / not loaded)
const mltYearTrend = {};    // tabId -> /yeartrend response (loaded once, as in ThingWorx)
const mltPickers = {};      // tabId -> flatpickr instance
const mltLoadSeq = {};      // tabId -> request counter (a newer range wins over a slower older one)

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
        <tbody>${mltEmptyRow(cols.length, tab.live ? 'No data' : 'No data source yet')}</tbody>
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

function mltEmptyRow(colspan, text) {
    return `<tr class="mlt-grid-empty"><td colspan="${colspan}">${text}</td></tr>`;
}

function mltIsoDate(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Single data hook: the date range drives every widget (ThingWorx RangeChanged reloads them all).
async function mltLoad(id) {
    const tab = mltTab(id);
    mltData[id] = null;
    if (!tab.live) {
        mltRenderGrids(id, 'No data source yet');
        mltRenderCharts(id);
        return;
    }
    const picker = mltPickers[id];
    const sel = picker && picker.selectedDates.length ? picker.selectedDates : [new Date(), new Date()];
    const from = mltIsoDate(sel[0]);
    const to = mltIsoDate(sel[sel.length - 1]);
    const seq = mltLoadSeq[id] = (mltLoadSeq[id] || 0) + 1;

    mltRenderGrids(id, 'Loading...');
    mltRenderCharts(id);
    try {
        const res = await fetch(`/api/machineshop/leaktest/${id}/data?from=${from}&to=${to}`);
        if (!res.ok) throw new Error((await res.text()) || `HTTP ${res.status}`);
        const data = await res.json();
        if (seq !== mltLoadSeq[id]) return;
        mltData[id] = data;
        mltRenderGrids(id);
        mltFetchYearTrend(id);
    } catch (err) {
        if (seq !== mltLoadSeq[id]) return;
        console.error('Leak test load failed', err);
        mltRenderGrids(id, 'Failed to load data: ' + String(err.message || err).slice(0, 200).replace(/</g, '&lt;'));
    }
    mltRenderCharts(id);
}

// Shift grids show counts; the Totals grid shows counts and OK % / NOK % with 2 decimals (ptcsgrid-59).
function mltRenderGrids(id, message) {
    const tab = mltTab(id);
    const data = mltData[id];
    const colspan = tab.cells + 3;
    const fmt = (v, pct) => v == null ? '--' : (pct ? Number(v).toFixed(2) : Math.round(v));
    const rowsHtml = rows => rows.map(r => {
        const pct = r.description.endsWith('%');
        const cells = [];
        for (let i = 0; i < tab.cells; i++) cells.push(`<td>${fmt(r.cells[i], pct)}</td>`);
        return `<tr><td class="mlt-grid-shift">${r.shift || ''}</td><td>${r.description}</td>${cells.join('')}<td>${fmt(r.total, pct)}</td></tr>`;
    }).join('');

    const grids = { shiftA: data && data.shifts.A, shiftB: data && data.shifts.B, shiftC: data && data.shifts.C, total: data && data.totals };
    Object.entries(grids).forEach(([key, rows]) => {
        const body = document.querySelector(`#mlt-${id}-${key} tbody`);
        if (body) body.innerHTML = rows && rows.length ? rowsHtml(rows) : mltEmptyRow(colspan, message || 'No data');
    });
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
    const data = mltData[id];   // /data response: pies { total, A, B, C (OK % / NOK %), qty (counts) }, leak[]
    const charts = {};
    const pieValues = key => data && data.pies[key] ? [data.pies[key].ok, data.pies[key].nok] : null;

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
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        enabled: !empty,
                        callbacks: { label: c => `${c.label}: ${labels[0].endsWith('%') ? Number(c.raw).toFixed(1) : c.raw}` }
                    }
                }
            },
            plugins: [mltNoDataPlugin]
        });
    };

    charts.pieTotal = pie('pieTotal', pieValues('total'), ['OK %', 'NOK %']);
    MLT_SHIFTS.forEach(s => { charts['pie' + s] = pie('pie' + s, pieValues(s), ['OK %', 'NOK %']); });
    charts.pieQty = pie('pieQty', pieValues('qty'), ['OK Qty', 'NOK Qty']);

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
                        <div class="mlt-card mlt-trend-card">
                            <div class="mlt-card-title">${k.startsWith('week') ? 'Daily' : 'Monthly'} ${k.endsWith('NOK') ? 'NOK' : 'OK'}</div>
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
                    <div class="mlt-summary-actions"><button class="btn-primary mlt-btn" onclick="mltDownloadSummary()">Download</button></div>
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

// OK vs NOK pop-up (RE_MS_LT_OkvsNok_MU): 2x2 line charts - Daily OK / Daily NOK on top, Monthly OK /
// Monthly NOK below (ptcschartline-71 / -10 / -5 / -11), OK green rgba(102,204,51), NOK red rgba(191,48,48),
// circle markers with the value above each point, X axis DD/MM (daily) and MM/YYYY (monthly), tooltip with
// the quantity (LineChartLTQtyTooltip). Data: RE_MS_LT_PercentageTrend_DS (Date, Percentage, Qty).
// Week = the selected date range, per day (get_OK/NOK_TrendForWeek_CoverLH); Year = the current
// financial year per month (get_OK/NOK_TrendForYear_CoverLH), fetched once per tab.
async function mltOpenOkNok(id) {
    mltModalTab = id;
    document.getElementById('mltOkNokTitle').textContent = `OK vs NOK - ${mltTab(id).label}`;
    document.getElementById('mltOkNokModal').classList.add('active');
    mltRenderOkNokCharts(id);
    if (!mltYearTrend[id] && await mltFetchYearTrend(id) && mltModalTab === id) mltRenderOkNokCharts(id);
}

// Year trend, fetched once per tab: prefetched in the background after the tab's first /data load so
// the pop-up opens instantly; a click during the prefetch waits on the same request.
const mltYearTrendReq = {};
function mltFetchYearTrend(id) {
    if (!mltTab(id).live) return Promise.resolve(false);
    if (!mltYearTrendReq[id]) {
        mltYearTrendReq[id] = fetch(`/api/machineshop/leaktest/${id}/yeartrend`)
            .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
            .then(trend => { mltYearTrend[id] = trend; return true; })
            .catch(err => { console.error('Leak test year trend failed', err); delete mltYearTrendReq[id]; return false; });
    }
    return mltYearTrendReq[id];
}

const MLT_TREND_OK_COLOR = 'rgba(102,204,51,1)';
const MLT_TREND_NOK_COLOR = 'rgba(191,48,48,1)';

// Value label above every point (ThingWorx ValuesPosition: above).
const mltPointValuePlugin = {
    id: 'mltPointValue',
    afterDatasetsDraw(chart) {
        const { ctx } = chart;
        ctx.save();
        ctx.fillStyle = mltThemeColors().text;
        ctx.font = '11px Inter, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        // Long ranges put many points close together: label only every n-th point so the labels never
        // overlap (the tooltip still shows every value).
        const pts = chart.getDatasetMeta(0).data;
        const gap = pts.length > 1 ? Math.abs(pts[1].x - pts[0].x) : Infinity;
        const every = Math.max(1, Math.ceil(24 / gap));
        pts.forEach((pt, i) => {
            const v = chart.data.datasets[0].data[i];
            if (v != null && i % every === 0) ctx.fillText(v, pt.x, pt.y - 7);
        });
        ctx.restore();
    }
};

function mltRenderOkNokCharts(id) {
    mltModalCharts.forEach(c => c.destroy());
    mltModalCharts = [];
    const colors = mltThemeColors();
    const week = mltData[id] && mltData[id].week;
    const year = mltYearTrend[id];
    const trends = {
        weekOK: week && week.ok, weekNOK: week && week.nok,
        yearOK: year && year.ok, yearNOK: year && year.nok
    };
    const dayLabel = d => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
    const monthLabel = d => `${d.slice(5, 7)}/${d.slice(0, 4)}`;
    ['weekOK', 'weekNOK', 'yearOK', 'yearNOK'].forEach(k => {
        const el = document.getElementById(`mltTrend-${k}`);
        const rows = trends[k] || [];
        const label = k.startsWith('week') ? dayLabel : monthLabel;
        const color = k.endsWith('NOK') ? MLT_TREND_NOK_COLOR : MLT_TREND_OK_COLOR;
        mltModalCharts.push(new Chart(el, {
            type: 'line',
            data: {
                labels: rows.map(r => label(r.date)),
                datasets: [{
                    data: rows.map(r => r.percentage),
                    borderColor: color,
                    backgroundColor: color,
                    borderWidth: 2,
                    pointRadius: 4,
                    pointHoverRadius: 6,
                    tension: 0
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: false,
                layout: { padding: { top: 16, right: 12 } },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: c => `${c.raw}%  (Qty ${rows[c.dataIndex].qty})` } }
                },
                scales: {
                    x: { ticks: { color: colors.text }, grid: { color: colors.grid } },
                    y: { beginAtZero: true, ...(Math.max(0, ...rows.map(r => r.percentage)) > 80 ? { max: 100 } : { grace: '15%' }), ticks: { color: colors.text, precision: 0 }, grid: { color: colors.grid } }
                }
            },
            plugins: [mltNoDataPlugin, mltPointValuePlugin]
        }));
    });
}

// Summary pop-up: RE_MS_LT_SummaryTable_MU (RE_MS_LeakTest_SummaryTable_DS:
// Date, ProducedQty, OKQty, OKPercent, NOKQty, NOKPercent) - Download button above the grid
// (ThingWorx Data Export), dates DD-MM-YYYY, percentages 2 decimals.
const mltSummaryDate = d => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;

function mltOpenSummary(id) {
    mltModalTab = id;
    document.getElementById('mltSummaryTitle').textContent = `SUMMARY - ${mltTab(id).label}`;
    const rows = (mltData[id] && mltData[id].summary) || [];
    document.getElementById('mltSummaryBody').innerHTML = rows.length
        ? rows.map(r => `<tr><td>${mltSummaryDate(r.date)}</td><td>${r.producedQty}</td><td>${r.okQty}</td><td>${r.okPercent.toFixed(2)}</td><td>${r.nokQty}</td><td>${r.nokPercent.toFixed(2)}</td></tr>`).join('')
        : '<tr class="mlt-grid-empty"><td colspan="6">No data</td></tr>';
    document.getElementById('mltSummaryModal').classList.add('active');
}

async function mltDownloadSummary() {
    const id = mltModalTab;
    const rows = (id && mltData[id] && mltData[id].summary) || [];
    if (!rows.length || typeof ExcelJS === 'undefined') return;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Summary');
    sheet.addRow(['Date', 'Produced Qty', 'OK Qty', 'OK %', 'NOK Qty', 'NOK %']).font = { bold: true };
    rows.forEach(r => sheet.addRow([mltSummaryDate(r.date), r.producedQty, r.okQty, Number(r.okPercent.toFixed(2)), r.nokQty, Number(r.nokPercent.toFixed(2))]));
    sheet.columns.forEach(c => { c.width = 16; });
    await downloadWorkbook(workbook, `LeakTest_Summary_${mltTab(id).label.replace(/\s+/g, '')}_${new Date().getTime()}.xlsx`);
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
