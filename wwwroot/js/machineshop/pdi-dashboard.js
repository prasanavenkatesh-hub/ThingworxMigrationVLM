// =============================================================================================
// Machine Shop > PDI Dashboard (#tab-ms-pdi). Layout of the ThingWorx "MS PDI" screens: one page
// with tabs across the top (Hourly Screen, Crankcase, Cover LH, Cover RH, Crankshaft, Cyl Head,
// Cyl Barrel, PDI Summary) and the shared Date / Shift filters + Submit on the right.
// Filters: default = the current production day and shift (ShiftConfiguration via
// GET /api/configuration/shifts). Hourly Screen (ThingWorx MS_PDI_HourlyData_MU) is live:
//   top grid     GET /api/machineshop/pdi/hourly -> rows    (ThingWorx get_HourlyData)
//   bottom grid  same response -> summary: Total / Pass / Fail (MS_PDI_SummaryPage_TH.MS_PDI_Overall_Count)
//   Machine Shop Rejection Details buttons -> pop-up with a pie + grid of the NOK reasons,
//                GET /api/machineshop/pdi/rejections (ThingWorx MS_PDI_<Part>_Rejection_Graph_MU)
// Data loads when the page first opens and on Submit (ThingWorx: Submit only); no polling. The
// pop-ups use the date / shift of the data on screen.
// Part tabs (tab.part set; ThingWorx MS_PDI_<Part>_MU, built so far: Crankcase, Cover LH, Cover RH, Crankshaft, Cyl Head, Cyl Barrel): one production day, no
// shift filter (the Shift dropdown is hidden there) - GET /api/machineshop/pdi/part. Pies of the OK / NOK %
// for the day and each shift on the left; Produced / OK / NOK per cell for each shift + day totals and
// OK / NOK % on the right; the rows of the shift running now are highlighted. Loads when the tab opens
// (for a new date) and when the date changes or Submit is pressed, as ThingWorx reloads on a date change.
// PDI Summary (tab.summary; ThingWorx MS_PDI_Summary_MU): one production day, no shift filter - GET
// /api/machineshop/pdi/summary. Day OK / NOK % pie per part on the left; Produced / OK / NOK per part for each
// shift on the right. Loads like the part tabs (tab opened for a new date, date change, Submit).
// Report button (part tabs in MachineShop:Pdi:Report:Parts - Cover LH; ThingWorx RE_MS_PDI_Report_MU): pop-up
// with a date range, Cell, Shift and Status filters, Generate (GET /api/machineshop/pdi/report) and Download .csv.
// switchTab() (core.js) calls msPdiShow() when the page opens and msPdiStop() on every tab change.
// All names are prefixed msPdi, CSS classes ms-pdi-.
// =============================================================================================

// Tabs in ThingWorx order. title = the heading under the bar (other tabs: set when they are built).
const MS_PDI_TABS = [
    { id: 'hourly', label: 'Hourly Screen', title: 'MS PDI HOURLY DATA' },
    { id: 'crankcase', label: 'Crankcase', part: 'crankcase' },
    { id: 'cover-lh', label: 'Cover LH', part: 'cover-lh' },
    { id: 'cover-rh', label: 'Cover RH', part: 'cover-rh' },
    { id: 'crankshaft', label: 'Crankshaft', part: 'crankshaft' },
    { id: 'cyl-head', label: 'Cyl Head', part: 'cyl-head' },
    { id: 'cyl-barrel', label: 'Cyl Barrel', part: 'cyl-barrel' },
    { id: 'pdi-summary', label: 'PDI Summary', summary: true }
];

// Pie colours of the rejection pop-up (one per reason, repeating).
const MS_PDI_PIE_COLORS = ['#3b82f6', '#f59e0b', '#ef4444', '#10b981', '#8b5cf6', '#06b6d4', '#ec4899', '#84cc16', '#f97316', '#64748b'];

let msPdiTimer = null;
let msPdiBuilt = false;
let msPdiTab = 'hourly';
let msPdiPicker = null;
let msPdiParts = [];          // GET /api/machineshop/pdi/parts (Rejection Details buttons)
let msPdiLoaded = null;       // { date, shift } of the data on screen
let msPdiSeq = 0;             // ignores a response that a newer Submit has replaced
let msPdiFiltersReady = null; // Promise of msPdiInitFilters()

function msPdiShow() {
    if (!msPdiBuilt) msPdiBuild();
    msPdiRenderTab();
}

function msPdiStop() {
    clearTimeout(msPdiTimer);
    msPdiTimer = null;
    msPdiCloseModal();
    msPdiCloseReport();
}

function msPdiEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function msPdiBuild() {
    msPdiBuilt = true;
    document.getElementById('msPdiTabs').innerHTML = MS_PDI_TABS.map(t =>
        `<button type="button" class="ms-pdi-tab" data-tab="${t.id}" onclick="msPdiSelectTab('${t.id}')">${t.label}</button>`).join('');
    msPdiEmptyGrid('msPdiHourlyTop');
    msPdiEmptyGrid('msPdiHourlyBottom');
    msPdiLoadParts();
    msPdiFiltersReady = msPdiInitFilters();
    msPdiFiltersReady.then(() => msPdiLoadHourly());
}

async function msPdiLoadParts() {
    const box = document.getElementById('msPdiRejButtons');
    try {
        const res = await fetch('/api/machineshop/pdi/parts');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        msPdiParts = await res.json();
        box.innerHTML = msPdiParts.map(p =>
            `<button type="button" class="ms-pdi-rej-btn" data-part="${msPdiEsc(p.id)}">${msPdiEsc(p.name)}</button>`).join('');
        box.querySelectorAll('.ms-pdi-rej-btn').forEach(b => b.addEventListener('click', () => msPdiRejectionDetails(b.dataset.part)));
    } catch (e) {
        box.innerHTML = `<div class="ms-pdi-rej-note">Could not load the parts: ${msPdiEsc(e.message)}</div>`;
    }
}

function msPdiSelectTab(id) {
    msPdiTab = id;
    msPdiRenderTab();
}

function msPdiCurrentTab() {
    return MS_PDI_TABS.find(t => t.id === msPdiTab) || MS_PDI_TABS[0];
}

function msPdiRenderTab() {
    const tab = msPdiCurrentTab();
    document.querySelectorAll('#msPdiTabs .ms-pdi-tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab.id));
    const hourly = tab.id === 'hourly';
    const part = !!tab.part;
    const summary = !!tab.summary;
    document.getElementById('msPdiViewHourly').hidden = !hourly;
    document.getElementById('msPdiViewPart').hidden = !part;
    document.getElementById('msPdiViewSummary').hidden = !summary;
    document.getElementById('msPdiViewOther').hidden = hourly || part || summary;
    document.getElementById('msPdiShift').hidden = part || summary;   // part / summary tabs show the whole production day
    document.getElementById('msPdiTitle').textContent = tab.title || tab.label.toUpperCase();
    document.getElementById('msPdiOtherTitle').textContent = tab.label;
    document.getElementById('msPdiNote').hidden = !hourly;
    document.getElementById('msPdiPartNote').hidden = !(part || summary);
    if (part) {
        const sel = msPdiSelection();
        if (!msPdiPartLoaded || msPdiPartLoaded.part !== tab.part || msPdiPartLoaded.date !== sel.date) msPdiLoadPart();
    }
    if (summary) {
        // The note line is shared with the part tabs: put the summary's own note back when not reloading.
        if (msPdiSummaryLoaded !== msPdiSelection().date) msPdiLoadSummary();
        else document.getElementById('msPdiPartNote').textContent = msPdiSummaryNote;
    }
}

// A grid with its (empty) header band and the "no data" row, as on the ThingWorx screen.
function msPdiEmptyGrid(id) {
    document.getElementById(id).innerHTML = `
        <div class="ms-pdi-grid-head"></div>
        <div class="ms-pdi-grid-empty"><span class="material-symbols-outlined">visibility_off</span>There is no data to display.</div>`;
}

// ---- Filters: Date (production day) + Shift ----
async function msPdiInitFilters() {
    const shiftSelect = document.getElementById('msPdiShift');
    let shifts = {};
    try {
        const res = await fetch('/api/configuration/shifts');
        if (res.ok) shifts = await res.json();
    } catch (e) {
        console.error('PDI Dashboard: could not load the shift times', e);
    }
    const names = Object.keys(shifts).length ? Object.keys(shifts) : ['A', 'B', 'C'];
    shiftSelect.innerHTML = names.map(n => `<option value="${n}">${n}</option>`).join('');
    const { shift, date } = msPdiCurrentShift(shifts, new Date());
    if (shift) shiftSelect.value = shift;
    if (typeof flatpickr !== 'undefined') {
        // A part tab reloads when the date changes (ThingWorx: datepicker Changed -> all services).
        msPdiPicker = flatpickr('#msPdiDate', {
            dateFormat: 'Y-F-d', defaultDate: date, disableMobile: true,
            onChange: () => { if (msPdiCurrentTab().part) msPdiLoadPart(); else if (msPdiCurrentTab().summary) msPdiLoadSummary(); }
        });
    } else {
        const pad = v => String(v).padStart(2, '0');
        document.getElementById('msPdiDate').value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }
}

// The shift running at `now` and its production day (a shift that wraps past midnight - C - belongs
// to the day it started on). Shift times "HH:mm:ss" from ShiftConfiguration.
function msPdiCurrentShift(shifts, now) {
    const sec = v => { const [h, m, s] = String(v || '0:0:0').split(':').map(Number); return h * 3600 + m * 60 + (s || 0); };
    const t = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    for (const [name, s] of Object.entries(shifts)) {
        const start = sec(s.start), end = sec(s.end);
        if (start <= end ? t >= start && t <= end : t >= start || t <= end) {
            const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            if (start > end && t <= end) date.setDate(date.getDate() - 1);
            return { shift: name, date };
        }
    }
    return { shift: null, date: new Date(now.getFullYear(), now.getMonth(), now.getDate()) };
}

function msPdiOpenCalendar() {
    if (msPdiPicker) msPdiPicker.open();
}

// Date (yyyy-MM-dd, local) + shift currently picked in the filters.
function msPdiSelection() {
    const pad = v => String(v).padStart(2, '0');
    const d = msPdiPicker && msPdiPicker.selectedDates[0];
    const date = d ? `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        : (document.getElementById('msPdiDate').value || '').slice(0, 10);
    return { date, shift: document.getElementById('msPdiShift').value };
}

function msPdiSubmit() {
    if (msPdiCurrentTab().part) msPdiLoadPart();
    else if (msPdiCurrentTab().summary) msPdiLoadSummary();
    else msPdiLoadHourly();
}

// ---- Part tabs (Crankcase ...): one production day, per cell ----
// OK / NOK pie colours: green / red, readable on both themes (ThingWorx MS_PDI_SD used purple / cyan).
const MS_PDI_OK_COLOR = '#10b981';
const MS_PDI_NOK_COLOR = '#ef4444';

// Slice border = panel colour, so the slices are separated by a gap in both themes (Chart.js default: white).
function msPdiPieBorder() {
    return getComputedStyle(document.body).getPropertyValue('--white').trim() || '#ffffff';
}

// Theme switch (applyTheme hook in index.html): repaint the slice borders of the part / summary pies.
function msPdiRethemePies() {
    const border = msPdiPieBorder();
    [...msPdiPartCharts, ...(typeof msPdiSummaryCharts !== 'undefined' ? msPdiSummaryCharts : [])].forEach(c => {
        c.data.datasets[0].borderColor = border;
        c.update('none');
    });
}
let msPdiPartLoaded = null;   // { part, date } of the data on screen
let msPdiPartSeq = 0;
let msPdiPartCharts = [];

async function msPdiLoadPart() {
    const tab = msPdiCurrentTab();
    if (!tab.part) return;
    if (msPdiFiltersReady) await msPdiFiltersReady;
    const sel = msPdiSelection();
    const note = document.getElementById('msPdiPartNote');
    if (!sel.date) { note.textContent = 'Pick a date.'; return; }
    const seq = ++msPdiPartSeq;
    note.textContent = `Loading ${msPdiDayText(sel.date)}...`;
    try {
        const res = await fetch(`/api/machineshop/pdi/part?part=${encodeURIComponent(tab.part)}&date=${encodeURIComponent(sel.date)}`);
        if (!res.ok) throw new Error(await msPdiErrorText(res));
        const d = await res.json();
        if (seq !== msPdiPartSeq || msPdiCurrentTab().part !== d.partId) return;
        msPdiPartLoaded = { part: d.partId, date: d.date };
        msPdiReportPart = { id: d.partId, title: d.title, cells: d.cells, date: d.date };
        document.getElementById('msPdiTitle').textContent = d.title;
        msPdiRenderPartGrid(d);
        msPdiRenderPies(d);
        note.textContent = `Production day ${msPdiDayText(d.date)} · updated ${new Date(d.updatedAt).toLocaleTimeString('en-GB')}`;
    } catch (e) {
        if (seq !== msPdiPartSeq) return;
        msPdiPartLoaded = null;
        msPdiDestroyPies();
        document.getElementById('msPdiPies').innerHTML = '';
        msPdiEmptyGrid('msPdiPartGrid');
        note.textContent = `Could not load data: ${e.message}`;
    }
}

// x * 100 / of with 2 decimals, 0 when nothing was produced (ThingWorx get_TotalProducedPerDay).
function msPdiPct(x, of) {
    return of ? (x * 100 / of).toFixed(2) : '0';
}

// Shift | Description | CELL 1..n | Total. Per shift: Produced / OK ("Shift-A") / NOK ("[12:15am - 07:14am]"),
// as the ThingWorx grids label them; then the day totals and OK / NOK % (peach rows).
// A part split into sides (Crankshaft) has CELL 1 LH, CELL 1 RH, ... and one Total per side (Total LH / RH),
// as MS_PDI_Crankshaft_MU's Cell_<n>_LH / _RH and Total_LH / Total_RH columns.
function msPdiRenderPartGrid(d) {
    const split = d.sides.length > 0;
    const totals = (c, key) => split ? c[`${key}BySide`] : [c[`${key}Total`]];
    const row = (shift, desc, cells, tots, cls = '') =>
        `<tr class="${cls}"><td class="ms-pdi-shift-col">${msPdiEsc(shift)}</td><td class="ms-pdi-part">${desc}</td>${cells.map(v => `<td>${v}</td>`).join('')}${tots.map(v => `<td class="ms-pdi-total">${v}</td>`).join('')}</tr>`;
    const shiftRows = d.shifts.map(s => {
        const c = s.counts, cls = s.current ? 'ms-pdi-current' : '';
        return `<tbody class="ms-pdi-shift-block" title="${s.current ? 'Shift running now' : ''}">
            ${row('', 'Produced', c.produced, totals(c, 'produced'), cls)}
            ${row(`Shift-${s.shift}`, 'OK', c.ok, totals(c, 'ok'), cls)}
            ${row(s.range, 'NOK', c.nok, totals(c, 'nok'), cls)}
        </tbody>`;
    }).join('');
    const t = d.total;
    const pct = (list, of) => list.map((v, i) => msPdiPct(v, of[i]));
    const totalHeads = split ? d.sides.map(s => `<th>Total ${msPdiEsc(s)}</th>`).join('') : '<th>Total</th>';
    document.getElementById('msPdiPartGrid').innerHTML = `
        <table class="ms-pdi-table ms-pdi-cell-table">
            <thead><tr><th>Shift</th><th>Description</th>${d.columns.map(c => `<th>${msPdiEsc(c)}</th>`).join('')}${totalHeads}</tr></thead>
            ${shiftRows}
            <tbody class="ms-pdi-totals">
                ${row('', 'Total Produced', t.produced, totals(t, 'produced'))}
                ${row('', 'Total OK', t.ok, totals(t, 'ok'))}
                ${row('', 'Total NOK', t.nok, totals(t, 'nok'))}
                ${row('', 'Total OK %', pct(t.ok, t.produced), pct(totals(t, 'ok'), totals(t, 'produced')))}
                ${row('', 'Total NOK %', pct(t.nok, t.produced), pct(totals(t, 'nok'), totals(t, 'produced')))}
            </tbody>
        </table>`;
}

function msPdiDestroyPies() {
    msPdiPartCharts.forEach(c => c.destroy());
    msPdiPartCharts = [];
}

// OK / NOK % pies: TOTAL (the day), then one per shift (ThingWorx get_Total_OK_NOK_Perday,
// Shift<X>_get_Total_OK_NOK_Perday -> Total_MS_PDI_PieChart).
function msPdiRenderPies(d) {
    msPdiDestroyPies();
    const pies = [{ id: 'total', label: 'TOTAL', c: d.total, big: true },
        ...d.shifts.map(s => ({ id: s.shift, label: `SHIFT ${s.shift}`, c: s.counts }))];
    const box = (p) => `
        <div class="ms-pdi-pie-box${p.big ? ' big' : ''}">
            <div class="ms-pdi-pie-canvas">${p.c.producedTotal
                ? `<canvas id="msPdiPie_${msPdiEsc(p.id)}"></canvas>`
                : '<div class="ms-pdi-pie-empty">No data</div>'}</div>
            <div class="ms-pdi-pie-label">${p.label}</div>
        </div>`;
    document.getElementById('msPdiPies').innerHTML = `
        <div class="ms-pdi-legend">
            <span><i style="background:${MS_PDI_OK_COLOR}"></i>OK</span>
            <span><i style="background:${MS_PDI_NOK_COLOR}"></i>NOK</span>
        </div>
        ${box(pies[0])}
        <div class="ms-pdi-pie-row">${pies.slice(1).map(box).join('')}</div>
        ${d.report ? `<button type="button" class="ms-pdi-report-btn" onclick="msPdiOpenReport()">Report</button>` : ''}`;
    if (typeof Chart === 'undefined') return;
    pies.forEach(p => {
        const canvas = document.getElementById(`msPdiPie_${p.id}`);
        if (!canvas) return;
        const ok = +msPdiPct(p.c.okTotal, p.c.producedTotal), nok = +msPdiPct(p.c.nokTotal, p.c.producedTotal);
        msPdiPartCharts.push(new Chart(canvas, {
            type: 'pie',
            data: { labels: ['OK', 'NOK'], datasets: [{ data: [ok, nok], backgroundColor: [MS_PDI_OK_COLOR, MS_PDI_NOK_COLOR], borderColor: msPdiPieBorder(), borderWidth: 2 }] },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed.toFixed(2)} % (${ctx.dataIndex === 0 ? p.c.okTotal : p.c.nokTotal} of ${p.c.producedTotal})` } }
                }
            }
        }));
    });
}

// ---- PDI Report pop-up (Cover LH; ThingWorx RE_MS_PDI_Report_MU / MS_PDI_CoverLH_TH.generateReport) ----
let msPdiReportPart = null;   // { id, title, cells, date } of the part tab on screen
let msPdiReportData = null;   // last generated report
let msPdiReportSeq = 0;

function msPdiReportModal() {
    let modal = document.getElementById('msPdiReportModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'msPdiReportModal';
    modal.className = 'ms-pdi-modal';
    modal.innerHTML = `
        <div class="ms-pdi-modal-box ms-pdi-report-box" role="dialog" aria-modal="true" aria-labelledby="msPdiReportTitle">
            <div class="ms-pdi-modal-head">
                <div>
                    <div class="ms-pdi-modal-title" id="msPdiReportTitle"></div>
                    <div class="ms-pdi-modal-sub" id="msPdiReportSub"></div>
                </div>
                <button class="ms-pdi-modal-close" type="button" title="Close" aria-label="Close">&times;</button>
            </div>
            <div class="ms-pdi-report-filters">
                <label>From <input type="date" id="msPdiRepFrom"></label>
                <label>To <input type="date" id="msPdiRepTo"></label>
                <label>Cell <select id="msPdiRepCell"></select></label>
                <fieldset><legend>Shift</legend><span id="msPdiRepShifts"></span></fieldset>
                <fieldset><legend>Status</legend><span id="msPdiRepStatus"></span></fieldset>
                <button type="button" class="ms-pdi-submit" id="msPdiRepGenerate">Generate</button>
                <button type="button" class="ms-pdi-modal-download" id="msPdiRepDownload" disabled title="Download the rows as .csv">Download .csv</button>
            </div>
            <div class="ms-pdi-modal-body" id="msPdiReportBody"></div>
        </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('.ms-pdi-modal-close')) msPdiCloseReport(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') msPdiCloseReport(); });
    document.getElementById('msPdiRepGenerate').addEventListener('click', msPdiGenerateReport);
    document.getElementById('msPdiRepDownload').addEventListener('click', msPdiDownloadReport);
    return modal;
}

// Opens with the date of the tab (ThingWorx: today), the first cell, all shifts and both statuses.
function msPdiOpenReport() {
    if (!msPdiReportPart) return;
    const modal = msPdiReportModal();
    const part = msPdiReportPart;
    document.getElementById('msPdiReportTitle').textContent = `${part.title} - PDI Report`;
    document.getElementById('msPdiReportSub').textContent = 'Pick the days, cell, shifts and status, then Generate.';
    document.getElementById('msPdiRepFrom').value = part.date;
    document.getElementById('msPdiRepTo').value = part.date;
    document.getElementById('msPdiRepCell').innerHTML = part.cells.map(c => `<option value="${msPdiEsc(c)}">CELL ${msPdiEsc(c)}</option>`).join('');
    const shifts = [...document.getElementById('msPdiShift').options].map(o => o.value);
    const box = (name, values, label) => values.map(v =>
        `<label class="ms-pdi-check"><input type="checkbox" name="${name}" value="${msPdiEsc(v)}" checked>${msPdiEsc(label(v))}</label>`).join('');
    document.getElementById('msPdiRepShifts').innerHTML = box('msPdiRepShift', shifts, v => `Shift ${v}`);
    document.getElementById('msPdiRepStatus').innerHTML = box('msPdiRepStatus', ['OK', 'NOK'], v => v);
    msPdiReportData = null;
    document.getElementById('msPdiRepDownload').disabled = true;
    document.getElementById('msPdiReportBody').innerHTML = '<div class="ms-pdi-modal-empty">No report generated yet.</div>';
    modal.classList.add('open');
}

function msPdiCloseReport() {
    const modal = document.getElementById('msPdiReportModal');
    if (!modal) return;
    modal.classList.remove('open');
    msPdiReportSeq++;
}

async function msPdiGenerateReport() {
    const part = msPdiReportPart;
    const checked = name => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(i => i.value);
    const from = document.getElementById('msPdiRepFrom').value, to = document.getElementById('msPdiRepTo').value;
    const cell = document.getElementById('msPdiRepCell').value;
    const shifts = checked('msPdiRepShift'), status = checked('msPdiRepStatus');
    const body = document.getElementById('msPdiReportBody'), sub = document.getElementById('msPdiReportSub');
    const download = document.getElementById('msPdiRepDownload');
    if (!from || !to) { sub.textContent = 'Pick the From and To days.'; return; }
    if (!shifts.length || !status.length) { sub.textContent = 'Pick at least one shift and one status.'; return; }
    const seq = ++msPdiReportSeq;
    msPdiReportData = null;
    download.disabled = true;
    sub.textContent = 'Loading...';
    body.innerHTML = '';
    try {
        const q = new URLSearchParams({ part: part.id, from, to, cell, shifts: shifts.join(','), status: status.join(',') });
        const res = await fetch(`/api/machineshop/pdi/report?${q}`);
        if (!res.ok) throw new Error(await msPdiErrorText(res));
        const d = await res.json();
        if (seq !== msPdiReportSeq) return;
        msPdiReportData = d;
        const days = d.from === d.to ? msPdiDayText(d.from) : `${msPdiDayText(d.from)} - ${msPdiDayText(d.to)}`;
        sub.textContent = `CELL ${d.cell} · ${days} (00:00 - 23:59) · Shift ${d.shifts.join(', ')} · ${d.statuses.join(', ')} · `
            + (d.truncated ? `first ${d.maxRows} rows shown - pick fewer days` : `${d.rows.length} row${d.rows.length === 1 ? '' : 's'}`);
        download.disabled = !d.rows.length;
        body.innerHTML = d.rows.length ? `
            <table class="ms-pdi-table ms-pdi-modal-table ms-pdi-report-table">
                <thead><tr><th>Timestamp</th><th>Barcode</th><th>Status</th><th>Remarks</th></tr></thead>
                <tbody>${d.rows.map(r => `<tr class="${r.status === 'NOK' ? 'ms-pdi-report-nok' : ''}"><td>${msPdiReportTime(r.timestamp)}</td><td>${msPdiEsc(r.barcode)}</td><td>${msPdiEsc(r.status)}</td><td class="ms-pdi-reason">${msPdiEsc(r.remarks)}</td></tr>`).join('')}</tbody>
            </table>` : '<div class="ms-pdi-modal-empty">There is no data to display.</div>';
    } catch (e) {
        if (seq !== msPdiReportSeq) return;
        sub.textContent = `Could not load the report: ${e.message}`;
    }
}

// "2026-10-26T01:50:30.49" -> "2026-10-26 01:50:30" (server-local time, as stored).
function msPdiReportTime(t) {
    return String(t || '').replace('T', ' ').slice(0, 19);
}

// CSV with the grid's columns (ThingWorx Data Export "PDIReport", no BOM).
function msPdiDownloadReport() {
    const d = msPdiReportData;
    if (!d || !d.rows.length) return;
    const cell = v => /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
    const lines = [['Timestamp', 'Barcode', 'Status', 'Remarks'],
        ...d.rows.map(r => [msPdiReportTime(r.timestamp), r.barcode, r.status, r.remarks])].map(r => r.map(v => cell(String(v ?? ''))).join(','));
    const url = URL.createObjectURL(new Blob([lines.join('\r\n')], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'PDIReport.csv';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- PDI Summary: one production day, per part ----
let msPdiSummaryLoaded = null;   // date of the data on screen
let msPdiSummarySeq = 0;
let msPdiSummaryNote = '';      // note text of the data on screen
let msPdiSummaryCharts = [];     // separate from msPdiPartCharts: a part tab must not destroy these

async function msPdiLoadSummary() {
    if (msPdiFiltersReady) await msPdiFiltersReady;
    const sel = msPdiSelection();
    const note = document.getElementById('msPdiPartNote');
    if (!sel.date) { note.textContent = 'Pick a date.'; return; }
    const seq = ++msPdiSummarySeq;
    note.textContent = `Loading ${msPdiDayText(sel.date)}...`;
    try {
        const res = await fetch(`/api/machineshop/pdi/summary?date=${encodeURIComponent(sel.date)}`);
        if (!res.ok) throw new Error(await msPdiErrorText(res));
        const d = await res.json();
        if (seq !== msPdiSummarySeq || !msPdiCurrentTab().summary) return;
        msPdiSummaryLoaded = d.date;
        document.getElementById('msPdiTitle').textContent = d.title;
        msPdiRenderSummaryGrid(d);
        msPdiRenderSummaryPies(d);
        note.textContent = msPdiSummaryNote = `Production day ${msPdiDayText(d.date)} · updated ${new Date(d.updatedAt).toLocaleTimeString('en-GB')}`;
    } catch (e) {
        if (seq !== msPdiSummarySeq) return;
        msPdiSummaryLoaded = null;
        msPdiSummaryCharts.forEach(c => c.destroy());
        msPdiSummaryCharts = [];
        document.getElementById('msPdiSumPies').innerHTML = '';
        msPdiEmptyGrid('msPdiSumGrid');
        note.textContent = `Could not load data: ${e.message}`;
    }
}

// Shift | Description | one column per part; per shift Produced / OK (shift letter, as MS_PDI_Summary_MU) / NOK.
// ThingWorx had no totals grid and no current-shift highlight on this page.
function msPdiRenderSummaryGrid(d) {
    const row = (shift, desc, values) =>
        `<tr><td class="ms-pdi-shift-col">${msPdiEsc(shift)}</td><td class="ms-pdi-part">${desc}</td>${values.map(v => `<td>${v}</td>`).join('')}</tr>`;
    document.getElementById('msPdiSumGrid').innerHTML = `
        <table class="ms-pdi-table ms-pdi-cell-table">
            <thead><tr><th>Shift</th><th>Description</th>${d.parts.map(p => `<th>${msPdiEsc(p.name)}</th>`).join('')}</tr></thead>
            ${d.shifts.map(s => `<tbody class="ms-pdi-shift-block">
                ${row('', 'Produced', s.counts.produced)}
                ${row(s.shift, 'OK', s.counts.ok)}
                ${row('', 'NOK', s.counts.nok)}
            </tbody>`).join('')}
        </table>`;
}

// Day OK / NOK % per part (ThingWorx <Part>_Chart), two columns of three as on the ThingWorx page.
function msPdiRenderSummaryPies(d) {
    msPdiSummaryCharts.forEach(c => c.destroy());
    msPdiSummaryCharts = [];
    const t = d.total;
    document.getElementById('msPdiSumPies').innerHTML = `
        <div class="ms-pdi-legend">
            <span><i style="background:${MS_PDI_OK_COLOR}"></i>OK</span>
            <span><i style="background:${MS_PDI_NOK_COLOR}"></i>NOK</span>
        </div>
        <div class="ms-pdi-sum-pies">${d.parts.map((p, i) => `
            <div class="ms-pdi-pie-box">
                <div class="ms-pdi-pie-label">${msPdiEsc(p.title)}</div>
                <div class="ms-pdi-pie-canvas">${t.produced[i]
                    ? `<canvas id="msPdiSumPie_${i}"></canvas>`
                    : '<div class="ms-pdi-pie-empty">No data</div>'}</div>
            </div>`).join('')}
        </div>`;
    if (typeof Chart === 'undefined') return;
    d.parts.forEach((p, i) => {
        const canvas = document.getElementById(`msPdiSumPie_${i}`);
        if (!canvas) return;
        const produced = t.produced[i], ok = t.ok[i], nok = t.nok[i];
        msPdiSummaryCharts.push(new Chart(canvas, {
            type: 'pie',
            data: { labels: ['OK', 'NOK'], datasets: [{ data: [+msPdiPct(ok, produced), +msPdiPct(nok, produced)], backgroundColor: [MS_PDI_OK_COLOR, MS_PDI_NOK_COLOR], borderColor: msPdiPieBorder(), borderWidth: 2 }] },
            options: {
                responsive: true, maintainAspectRatio: false, animation: false,
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed.toFixed(2)} % (${ctx.dataIndex === 0 ? ok : nok} of ${produced})` } }
                }
            }
        }));
    });
}

// ---- Hourly Screen: both grids from one request ----
async function msPdiLoadHourly() {
    if (msPdiFiltersReady) await msPdiFiltersReady;
    const sel = msPdiSelection();
    const note = document.getElementById('msPdiNote');
    if (!sel.date || !sel.shift) { note.textContent = 'Pick a date and a shift.'; return; }
    const seq = ++msPdiSeq;
    note.textContent = `Loading shift ${sel.shift} of ${msPdiDayText(sel.date)}...`;
    try {
        const res = await fetch(`/api/machineshop/pdi/hourly?date=${encodeURIComponent(sel.date)}&shift=${encodeURIComponent(sel.shift)}`);
        if (!res.ok) throw new Error(await msPdiErrorText(res));
        const d = await res.json();
        if (seq !== msPdiSeq) return;
        msPdiLoaded = sel;
        msPdiRenderHourly(d);
        msPdiRenderSummary(d);
        const t = v => new Date(v).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
        const lastSecond = new Date(new Date(d.end).getTime() - 1000);
        note.textContent = `Shift ${d.shift} · ${t(d.start)} - ${t(lastSecond)} · updated ${new Date(d.updatedAt).toLocaleTimeString('en-GB')}`;
    } catch (e) {
        if (seq !== msPdiSeq) return;
        msPdiLoaded = null;
        msPdiEmptyGrid('msPdiHourlyTop');
        msPdiEmptyGrid('msPdiHourlyBottom');
        note.textContent = `Could not load data: ${e.message}`;
    }
}

async function msPdiErrorText(res) {
    let text = '';
    try {
        text = await res.text();
        const j = JSON.parse(text);
        text = j.detail || j.title || text;
    } catch { /* plain-text body */ }
    return `HTTP ${res.status}${text ? ' - ' + String(text).slice(0, 200) : ''}`;
}

function msPdiDayText(date) {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Top grid: Machine Shop | Hour 1..8 | Total. The first row holds the hour ranges of the shift, as in
// ThingWorx; "-" = an hour column the shift does not have (shift A has 7 hours).
function msPdiRenderHourly(d) {
    const cell = v => v === null || v === undefined ? '-' : v;
    document.getElementById('msPdiHourlyTop').innerHTML = `
        <table class="ms-pdi-table">
            <thead><tr><th>Machine Shop</th>${d.hours.map((_, i) => `<th>Hour ${i + 1}</th>`).join('')}<th>Total</th></tr></thead>
            <tbody>
                <tr class="ms-pdi-hours-row"><td></td>${d.hours.map(h => `<td>${msPdiEsc(h)}</td>`).join('')}<td>-</td></tr>
                ${d.rows.map(r => `<tr><td class="ms-pdi-part">${msPdiEsc(r.name)}</td>${r.counts.map(c => `<td>${cell(c)}</td>`).join('')}<td class="ms-pdi-total">${r.total}</td></tr>`).join('')}
            </tbody>
        </table>`;
}

// Bottom grid: Machine Shop | Total Count | Pass Count | Fail Count. ThingWorx coloured the counts with
// the state definitions MS_PDI_Total_SD / MS_PDI_OK_SD / MS_PDI_NOK_SD; their style definitions (the
// colours) were not exported, so blue / green / red.
function msPdiRenderSummary(d) {
    document.getElementById('msPdiHourlyBottom').innerHTML = `
        <table class="ms-pdi-table">
            <thead><tr><th>Machine Shop</th><th>Total Count</th><th>Pass Count</th><th>Fail Count</th></tr></thead>
            <tbody>${d.summary.map(r => `
                <tr><td class="ms-pdi-part">${msPdiEsc(r.name)}</td>
                    <td><span class="ms-pdi-count total">${r.total}</span></td>
                    <td><span class="ms-pdi-count pass">${r.pass}</span></td>
                    <td><span class="ms-pdi-count fail">${r.fail}</span></td></tr>`).join('')}
            </tbody>
        </table>`;
}

// ---- Machine Shop Rejection Details pop-up: pie + grid of the NOK reasons ----
let msPdiModalData = null;
let msPdiPieChart = null;
let msPdiModalSeq = 0;

function msPdiModal() {
    let modal = document.getElementById('msPdiModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'msPdiModal';
    modal.className = 'ms-pdi-modal';
    modal.innerHTML = `
        <div class="ms-pdi-modal-box" role="dialog" aria-modal="true" aria-labelledby="msPdiModalTitle">
            <div class="ms-pdi-modal-head">
                <div>
                    <div class="ms-pdi-modal-title" id="msPdiModalTitle"></div>
                    <div class="ms-pdi-modal-sub" id="msPdiModalSub"></div>
                </div>
                <button class="ms-pdi-modal-close" type="button" title="Close" aria-label="Close">&times;</button>
            </div>
            <div class="ms-pdi-modal-tools" id="msPdiModalTools">
                <input class="ms-pdi-modal-search" id="msPdiModalSearch" type="search" placeholder="Search reason..." autocomplete="off">
                <span class="ms-pdi-modal-count" id="msPdiModalCount"></span>
                <button class="ms-pdi-modal-download" id="msPdiModalDownload" type="button" title="Download the rows shown as Excel">Download Excel</button>
            </div>
            <div class="ms-pdi-modal-body" id="msPdiModalBody"></div>
        </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('.ms-pdi-modal-close')) msPdiCloseModal(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') msPdiCloseModal(); });
    document.getElementById('msPdiModalSearch').addEventListener('input', msPdiFilterReasons);
    document.getElementById('msPdiModalDownload').addEventListener('click', msPdiDownloadReasons);
    return modal;
}

function msPdiCloseModal() {
    const modal = document.getElementById('msPdiModal');
    if (!modal) return;
    modal.classList.remove('open');
    msPdiModalSeq++;
    if (msPdiPieChart) { msPdiPieChart.destroy(); msPdiPieChart = null; }
}

async function msPdiRejectionDetails(partId) {
    const part = msPdiParts.find(p => p.id === partId) || { id: partId, name: partId };
    const sel = msPdiLoaded || msPdiSelection();
    const modal = msPdiModal();
    const seq = ++msPdiModalSeq;
    const body = document.getElementById('msPdiModalBody');
    document.getElementById('msPdiModalTitle').textContent = `${part.name} Rejection Details`;
    document.getElementById('msPdiModalSub').textContent = 'Loading...';
    document.getElementById('msPdiModalTools').classList.remove('show');
    document.getElementById('msPdiModalSearch').value = '';
    msPdiModalData = null;
    if (msPdiPieChart) { msPdiPieChart.destroy(); msPdiPieChart = null; }
    body.innerHTML = '';
    modal.classList.add('open');
    try {
        const res = await fetch(`/api/machineshop/pdi/rejections?part=${encodeURIComponent(part.id)}&date=${encodeURIComponent(sel.date)}&shift=${encodeURIComponent(sel.shift)}`);
        if (!res.ok) throw new Error(await msPdiErrorText(res));
        const d = await res.json();
        if (seq !== msPdiModalSeq) return;
        const total = d.reasons.reduce((a, r) => a + r.count, 0);
        msPdiModalData = { ...d, total, fileBase: `PDI_Rejections_${d.partId}_${d.date}_${d.shift}` };
        document.getElementById('msPdiModalSub').textContent =
            `Shift ${d.shift} · ${msPdiDayText(d.date)} · ${total} rejection${total === 1 ? '' : 's'}`;
        if (!d.reasons.length) { body.innerHTML = '<div class="ms-pdi-modal-empty">No rejections in this shift.</div>'; return; }
        body.innerHTML = `
            <div class="ms-pdi-pie"><canvas id="msPdiPieCanvas"></canvas></div>
            <table class="ms-pdi-table ms-pdi-modal-table">
                <thead><tr><th>Rejected Reason</th><th>Rejected Count</th></tr></thead>
                <tbody>${d.reasons.map((r, i) => `
                    <tr data-i="${i}">
                        <td class="ms-pdi-reason"><span class="ms-pdi-swatch" style="background:${MS_PDI_PIE_COLORS[i % MS_PDI_PIE_COLORS.length]}"></span>${msPdiEsc(r.reason)}</td>
                        <td>${r.count}</td>
                    </tr>`).join('')}
                </tbody>
            </table>`;
        document.getElementById('msPdiModalTools').classList.add('show');
        msPdiRenderPie();
        msPdiFilterReasons();
    } catch (e) {
        if (seq !== msPdiModalSeq) return;
        document.getElementById('msPdiModalSub').textContent = '';
        body.innerHTML = `<div class="ms-pdi-modal-empty">Could not load data: ${msPdiEsc(e.message)}</div>`;
    }
}

// Pie of the reasons (ThingWorx piechart-3). Re-drawn by applyTheme() for the legend text colour.
function msPdiRenderPie() {
    const canvas = document.getElementById('msPdiPieCanvas');
    if (!canvas || !msPdiModalData || typeof Chart === 'undefined') return;
    if (msPdiPieChart) msPdiPieChart.destroy();
    const text = getComputedStyle(document.body).getPropertyValue('--dark').trim() || '#888888';
    const reasons = msPdiModalData.reasons;
    msPdiPieChart = new Chart(canvas, {
        type: 'pie',
        data: {
            labels: reasons.map(r => r.reason),
            datasets: [{
                data: reasons.map(r => r.count),
                backgroundColor: reasons.map((_, i) => MS_PDI_PIE_COLORS[i % MS_PDI_PIE_COLORS.length]),
                borderColor: msPdiPieBorder(),
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: { legend: { position: 'right', labels: { color: text, boxWidth: 12, font: { size: 11 } } } }
        }
    });
}

function msPdiMatchingReasons() {
    if (!msPdiModalData) return [];
    const words = document.getElementById('msPdiModalSearch').value.toLowerCase().split(/\s+/).filter(Boolean);
    return msPdiModalData.reasons.map((r, i) => ({ r, i }))
        .filter(({ r }) => { const t = r.reason.toLowerCase(); return words.every(w => t.includes(w)); });
}

function msPdiFilterReasons() {
    if (!msPdiModalData) return;
    const shown = new Set(msPdiMatchingReasons().map(x => x.i));
    document.querySelectorAll('#msPdiModalBody tbody tr').forEach(tr => { tr.style.display = shown.has(+tr.dataset.i) ? '' : 'none'; });
    const total = msPdiModalData.reasons.length;
    document.getElementById('msPdiModalCount').textContent = shown.size === total ? `${total} reasons` : `${shown.size} of ${total} reasons`;
    document.getElementById('msPdiModalDownload').disabled = shown.size === 0;
}

// Excel of the reasons shown (after the search filter).
async function msPdiDownloadReasons() {
    if (!msPdiModalData || typeof ExcelJS === 'undefined') return;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Rejections');
    sheet.addRow([document.getElementById('msPdiModalTitle').textContent]).font = { bold: true, size: 13 };
    sheet.addRow([document.getElementById('msPdiModalSub').textContent]);
    const search = document.getElementById('msPdiModalSearch').value.trim();
    if (search) sheet.addRow([`Search: ${search}`]);
    sheet.addRow([]);
    const header = sheet.addRow(['Rejected Reason', 'Rejected Count']);
    header.font = { bold: true };
    header.eachCell(c => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDBE4F0' } }; });
    msPdiMatchingReasons().forEach(({ r }) => sheet.addRow([r.reason, r.count]));
    sheet.columns = [{ width: 60 }, { width: 16 }];
    await downloadWorkbook(workbook, `${msPdiModalData.fileBase}.xlsx`);
}
