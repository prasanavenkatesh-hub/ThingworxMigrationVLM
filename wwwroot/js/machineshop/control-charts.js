// Machine Shop > Online Control Charts (tab-ms-occ; prefix msOcc / ms-occ-). Port of the ThingWorx mashups
// RE_Crank_case_Dashboard_MU ("CELL LEVEL DASHBOARD") + RE_Crank_case_Loader_MU (one card per role).
// Machine tabs + view buttons (CELL / OPERATION / SPC LIVE / SPC MONTHLY - ThingWorx opened a separate mashup per
// button, RE_Crank_case_TH.ScreenMovement) + THIS SHIFT / TODAY / CUSTOM (CELL and OPERATION).
// CELL: GET /api/machineshop/controlcharts/cell -> Operator and Inspector cards: % of the required parameters read
// (CRITICAL / NON CRITICAL tab; NON CRITICAL only when Part Parameter Config "Non Critical" is Yes, otherwise the
// one tab is called GAUGE PARAMETER as in ThingWorx), the % bar and a line chart of the % per component.
// OPERATION (RE_CellLevel_Dashboard_MU / RE_cell_Loader_MU, "NOK Percentage"): GET .../operation -> per CELL 1..4 an
// OPERATOR and an INSPECTOR card: NOK % (circle, red fill) + up to 8 process-code chips with their share of the NOK
// readings. The ThingWorx bottom row (RE_Crank_case_graph_MU) was a static "Under Progress" picture - not drawn.
// SPC LIVE (QualityFunction_MU): GET .../spc/options, .../spc/processcodes, .../spc/live -> figures panel, chart of every
// reading of the day with UCL / LCL / CL / USL / LSL, readings strip (ThingWorx QualityTranspose grid).
// SPC MONTHLY (QualityFunctionMonthly_MU): GET .../spc/monthly -> figures, X-bar chart (red point = a Nelson rule failed)
// and Range chart; "n Readings" pop-up (RE_SPCMonthlyReadingPopup_MU) and Report pop-up (RE_SPCReportTable_MU,
// GET .../spc/report, Excel download). No "Past Data" button: sub-groups are picked on request (nothing to back-fill).

const MS_OCC_VIEWS = [
    { id: 'cell', label: 'CELL', title: 'CELL LEVEL DASHBOARD' },
    { id: 'operation', label: 'OPERATION', title: 'NOK PERCENTAGE' },
    { id: 'spclive', label: 'SPC LIVE', title: 'SPC LIVE' },
    { id: 'spcmonthly', label: 'SPC MONTHLY', title: 'SPC MONTHLY' }
];
const MS_OCC_RANGES = [
    { id: 'shift', label: 'THIS SHIFT' },
    { id: 'today', label: 'TODAY' },
    { id: 'custom', label: 'CUSTOM' }
];

let msOccOptions = null;   // { machines: [{ name, hasSource }], customDefaultDaysBack }
let msOccMachine = '';
let msOccView = 'cell';
let msOccRange = 'shift';
let msOccPicker = null;
let msOccSeq = 0;          // drops answers of an older request
let msOccData = null;      // last CELL answer (re-rendered on theme change / card tab click)
let msOccOpData = null;    // last OPERATION answer
let msOccCharts = [];
const msOccCardTab = {};   // card key -> 'critical' | 'noncritical'

// SPC LIVE / SPC MONTHLY state
const msOccSpcOptions = {};  // machine -> /spc/options answer
const msOccSpcSel = { cell: '', role: 'OPERATOR', code: '', opn: '' };
let msOccSpcProcessCodes = [];
let msOccSpcData = null;     // last live / monthly answer
let msOccSpcPickers = {};    // live, from, to
let msOccSpcCharts = [];

function msOccEsc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const MS_OCC_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// "2026-11-06T00:15:00" (server-local, no offset) -> Date in the browser's local time.
function msOccParse(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(s || '');
    return m ? new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0)) : null;
}

function msOccFmtDay(d) {
    return `${String(d.getDate()).padStart(2, '0')}-${MS_OCC_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

function msOccFmtTime(d) {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function msOccFmtPct(v) {
    return (Number(v) || 0).toFixed(2);
}

// SPC figures: 4 decimals (ThingWorx toFixed(4)); '-' when missing.
function msOccFmtNum(v, digits = 4) {
    return v == null || !isFinite(v) ? '-' : Number(v).toFixed(digits);
}

function msOccIsoDay(d) {
    const pad = v => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Today's production day (before the first shift start 00:15 it is still yesterday's) - core.js helper.
function msOccProductionDay() {
    return currentProductionDayRange().start;
}

async function msOccFetch(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
}

async function msOccShow() {
    if (!msOccOptions) {
        try {
            msOccOptions = await msOccFetch('/api/machineshop/controlcharts/options');
        } catch (e) {
            document.getElementById('msOccNote').textContent = `Could not load the machines (${e.message}).`;
            return;
        }
        msOccMachine = msOccOptions.machines.length ? msOccOptions.machines[0].name : '';
        msOccBuildControls();
    }
    msOccLoad();
}

function msOccBuildControls() {
    const tabs = document.getElementById('msOccTabs');
    tabs.innerHTML = msOccOptions.machines.map(m =>
        `<button type="button" class="ms-pdi-tab${m.hasSource ? '' : ' ms-occ-tab-empty'}" data-machine="${msOccEsc(m.name)}"
            title="${m.hasSource ? '' : 'No data source for this machine'}">${msOccEsc(m.name)}</button>`).join('');
    tabs.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.machine === msOccMachine) return;
        msOccMachine = b.dataset.machine;
        msOccSpcSel.code = '';
        msOccSpcSel.opn = '';
        msOccLoad();
    }));

    const views = document.getElementById('msOccViews');
    views.innerHTML = MS_OCC_VIEWS.map(v => `<button type="button" data-view="${v.id}">${v.label}</button>`).join('');
    views.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        msOccView = b.dataset.view;
        msOccLoad();
    }));

    const ranges = document.getElementById('msOccRanges');
    ranges.innerHTML = MS_OCC_RANGES.map(v => `<button type="button" data-range="${v.id}">${v.label}</button>`).join('');
    ranges.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        msOccRange = b.dataset.range;   // a click on the active button reloads it (refresh)
        msOccLoad();
    }));

    // CUSTOM: one production day; default today - CustomDefaultDaysBack (ThingWorx: 2 days back).
    const def = new Date();
    def.setDate(def.getDate() - (msOccOptions.customDefaultDaysBack || 0));
    msOccPicker = flatpickr('#msOccDate', {
        dateFormat: 'd-M-Y', defaultDate: def, maxDate: new Date(), disableMobile: true,
        onChange: () => { if (msOccRange === 'custom') msOccLoad(); }
    });

    msOccBuildSpcFilters();
    document.getElementById('msOccModalClose').addEventListener('click', msOccCloseModal);
    document.getElementById('msOccModal').addEventListener('click', e => { if (e.target.id === 'msOccModal') msOccCloseModal(); });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.getElementById('msOccModal').classList.contains('open')) msOccCloseModal();
    });
}

function msOccIsSpc() {
    return msOccView === 'spclive' || msOccView === 'spcmonthly';
}

function msOccSyncControls() {
    document.querySelectorAll('#msOccTabs button').forEach(b => b.classList.toggle('active', b.dataset.machine === msOccMachine));
    document.querySelectorAll('#msOccViews button').forEach(b => b.classList.toggle('active', b.dataset.view === msOccView));
    document.querySelectorAll('#msOccRanges button').forEach(b => b.classList.toggle('active', b.dataset.range === msOccRange));
    const view = MS_OCC_VIEWS.find(v => v.id === msOccView) || MS_OCC_VIEWS[0];
    document.getElementById('msOccTitle').textContent = view.title;
    document.getElementById('msOccRangeBox').hidden = msOccIsSpc();
    document.getElementById('msOccDateWrap').hidden = msOccRange !== 'custom';
    document.getElementById('msOccMachineName').textContent = msOccMachine;
    document.getElementById('msOccCards').hidden = msOccView !== 'cell';
    document.getElementById('msOccOperation').hidden = msOccView !== 'operation';
    document.getElementById('msOccSpc').hidden = !msOccIsSpc();
    const live = msOccView === 'spclive';
    document.querySelectorAll('#msOccSpcFilters [data-for]').forEach(el => {
        el.hidden = !el.dataset.for.split(' ').includes(live ? 'live' : 'monthly');
    });
    document.getElementById('msOccSpcChart2Box').hidden = live;
}

function msOccCustomDate() {
    const d = msOccPicker && msOccPicker.selectedDates[0];
    return d ? msOccIsoDay(d) : '';
}

function msOccDestroyCharts() {
    msOccCharts.forEach(c => c.destroy());
    msOccCharts = [];
}

async function msOccLoad() {
    if (!msOccOptions) return;
    msOccSyncControls();
    const placeholder = document.getElementById('msOccPlaceholder');
    placeholder.hidden = true;
    ++msOccSeq;
    if (msOccIsSpc()) {
        msOccDestroyCharts();
        msOccSpcLoadView();
        return;
    }
    msOccSpcDestroyCharts();
    if (msOccView === 'operation') { msOccLoadOperation(); return; }
    msOccLoadCell();
}

// Shared CELL / OPERATION request: range + custom date. Returns null when the custom date is missing.
function msOccRangeParams() {
    const params = new URLSearchParams({ machine: msOccMachine, range: msOccRange });
    if (msOccRange === 'custom') {
        const date = msOccCustomDate();
        if (!date) return null;
        params.set('date', date);
    }
    return params;
}

// ---------------------------------------------------------------- CELL

async function msOccLoadCell() {
    const note = document.getElementById('msOccNote');
    const cards = document.getElementById('msOccCards');
    const seq = msOccSeq;
    const params = msOccRangeParams();
    if (!params) { note.textContent = 'Pick a date.'; return; }
    note.textContent = 'Loading…';
    cards.classList.add('ms-occ-loading');
    try {
        const d = await msOccFetch(`/api/machineshop/controlcharts/cell?${params}`);
        if (seq !== msOccSeq) return;
        msOccData = d;
        note.textContent = d.hasSource ? '' : 'No data source for this machine (ThingWorx had none either).';
        msOccRenderCell();
    } catch (e) {
        if (seq !== msOccSeq) return;
        note.textContent = `Could not load the data (${e.message}).`;
    } finally {
        if (seq === msOccSeq) cards.classList.remove('ms-occ-loading');
    }
}

function msOccWindowText(d) {
    const from = msOccParse(d.from), to = msOccParse(d.to);
    if (!from || !to) return '';
    if (d.range === 'shift') {
        return d.shift ? `Shift ${d.shift} · ${msOccFmtDay(from)} ${msOccFmtTime(from)} – ${msOccFmtTime(to)}` : 'No shift running now';
    }
    if (d.range === 'today') return `Production day ${msOccFmtDay(from)} · ${msOccFmtTime(from)} – now (${msOccFmtTime(to)})`;
    return `Production day ${msOccFmtDay(from)} · ${msOccFmtTime(from)} – ${msOccFmtDay(to)} ${msOccFmtTime(to)}`;
}

function msOccRenderCell() {
    const d = msOccData;
    msOccDestroyCharts();
    const cards = document.getElementById('msOccCards');
    if (!d) { cards.innerHTML = ''; return; }
    document.getElementById('msOccWindow').textContent = msOccWindowText(d);
    if (!d.nonCriticalTab) Object.keys(msOccCardTab).forEach(k => { msOccCardTab[k] = 'critical'; });

    cards.innerHTML = d.cards.map((c, i) => {
        const tab = d.nonCriticalTab && msOccCardTab[c.name] === 'noncritical' ? 'noncritical' : 'critical';
        const s = tab === 'noncritical' ? c.nonCritical : c.critical;
        const pct = Math.max(0, Math.min(100, Number(s.percentage) || 0));
        const tabs = d.nonCriticalTab
            ? `<button type="button" data-card="${i}" data-tab="critical" class="${tab === 'critical' ? 'active' : ''}">CRITICAL</button>
               <button type="button" data-card="${i}" data-tab="noncritical" class="${tab === 'noncritical' ? 'active' : ''}">NON CRITICAL</button>`
            : `<button type="button" class="active" data-card="${i}" data-tab="critical">GAUGE PARAMETER</button>`;
        const facts = !d.hasSource ? '' : s.requiredParameters === 0
            ? 'No parameters configured for this role.'
            : `${c.components} component${c.components === 1 ? '' : 's'} · ${s.requiredParameters} parameter${s.requiredParameters === 1 ? '' : 's'} required · ${s.readParameters} read`;
        return `
            <div class="ms-occ-card">
                <div class="ms-occ-card-tabs">${tabs}</div>
                <div class="ms-occ-card-top">
                    <div class="ms-occ-gauge" style="--ms-occ-pct:${pct}%">
                        <div class="ms-occ-gauge-fill"></div>
                        <div class="ms-occ-gauge-text"><span class="ms-occ-gauge-value">${msOccFmtPct(s.percentage)}<small>%</small></span>
                            <span class="ms-occ-gauge-name">${msOccEsc(c.name)}</span></div>
                    </div>
                    <div class="ms-occ-summary">
                        <div class="ms-occ-row">
                            <span class="ms-occ-row-label">All cells</span>
                            <div class="ms-occ-track"><div class="ms-occ-track-fill" style="width:${pct}%"></div></div>
                            <span class="ms-occ-row-value">${msOccFmtPct(s.percentage)} %</span>
                        </div>
                        <div class="ms-occ-facts">${facts}</div>
                    </div>
                </div>
                <div class="ms-occ-chart-box">
                    ${s.points.length ? `<canvas id="msOccChart${i}"></canvas>` : `<div class="ms-occ-empty">${d.hasSource ? 'No components read in this range.' : 'No data.'}</div>`}
                </div>
            </div>`;
    }).join('');

    cards.querySelectorAll('.ms-occ-card-tabs button').forEach(b => b.addEventListener('click', () => {
        const card = d.cards[+b.dataset.card];
        if (!card || !d.nonCriticalTab) return;
        msOccCardTab[card.name] = b.dataset.tab;
        msOccRenderCell();
    }));

    d.cards.forEach((c, i) => {
        const canvas = document.getElementById(`msOccChart${i}`);
        if (!canvas) return;
        const tab = d.nonCriticalTab && msOccCardTab[c.name] === 'noncritical' ? 'noncritical' : 'critical';
        msOccCharts.push(msOccLineChart(canvas, tab === 'noncritical' ? c.nonCritical : c.critical, c.name));
    });
}

// Chart colours from the CSS tokens (re-read on every render, so a theme switch only needs a re-render).
function msOccColors() {
    const css = getComputedStyle(document.querySelector('.ms-occ'));
    const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    return {
        text: v('--ms-pdi-muted', '#9aa4b2'),
        grid: v('--ms-pdi-border', '#2c3441'),
        line: v('--ms-pdi-accent', '#3b82f6'),
        nok: v('--ms-pdi-nok', '#f87171'),
        ok: v('--ms-pdi-ok', '#34d399'),
        limit: v('--ms-occ-limit', '#f59e0b'),
        center: v('--ms-occ-center', '#94a3b8')
    };
}

// Line chart of the % per component in reading order (ThingWorx ptcs-chart-line: x = readingDate, y = readingPercentage).
function msOccLineChart(canvas, series, role) {
    const col = msOccColors();
    const points = series.points;
    const labels = points.map(p => {
        const t = msOccParse(p.readingDate);
        return t ? `${String(t.getDate()).padStart(2, '0')}-${MS_OCC_MONTHS[t.getMonth()]} ${msOccFmtTime(t)}` : '';
    });
    return new Chart(canvas, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: `${role} %`,
                data: points.map(p => p.readingPercentage),
                borderColor: col.line,
                backgroundColor: col.line,
                borderWidth: 1.5,
                pointRadius: points.length > 80 ? 1.5 : 3,
                pointHoverRadius: 5,
                tension: 0,
                spanGaps: true
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: items => points[items[0].dataIndex].component,
                        label: item => `${labels[item.dataIndex]} · ${item.raw == null ? '-' : Number(item.raw).toFixed(2) + ' %'}`
                    }
                }
            },
            scales: {
                x: {
                    title: { display: true, text: 'Reading Date Time', color: col.text, font: { size: 10 } },
                    ticks: { color: col.text, font: { size: 9 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 12 },
                    grid: { color: col.grid }
                },
                y: {
                    min: 0, max: 100,
                    title: { display: true, text: 'Reading Percentage', color: col.text, font: { size: 10 } },
                    ticks: { color: col.text, font: { size: 9 }, stepSize: 20 },
                    grid: { color: col.grid }
                }
            }
        }
    });
}

// ---------------------------------------------------------------- OPERATION

async function msOccLoadOperation() {
    const note = document.getElementById('msOccNote');
    const box = document.getElementById('msOccOperation');
    const seq = msOccSeq;
    const params = msOccRangeParams();
    if (!params) { note.textContent = 'Pick a date.'; return; }
    note.textContent = 'Loading…';
    box.classList.add('ms-occ-loading');
    try {
        const d = await msOccFetch(`/api/machineshop/controlcharts/operation?${params}`);
        if (seq !== msOccSeq) return;
        msOccOpData = d;
        note.textContent = !d.hasSource ? 'No data source for this machine (ThingWorx had none either).'
            : !d.hasCells ? 'No cell data for this machine: its readings carry no cell (LineName), so NOK % cannot be split by cell.'
            : '';
        msOccRenderOperation();
    } catch (e) {
        if (seq !== msOccSeq) return;
        note.textContent = `Could not load the data (${e.message}).`;
    } finally {
        if (seq === msOccSeq) box.classList.remove('ms-occ-loading');
    }
}

function msOccRenderOperation() {
    const d = msOccOpData;
    const box = document.getElementById('msOccOperation');
    if (!d) { box.innerHTML = ''; return; }
    document.getElementById('msOccWindow').textContent = msOccWindowText(d);
    if (!d.hasSource || !d.hasCells) { box.innerHTML = ''; return; }

    box.innerHTML = d.cells.map((cell, ci) => `
        <div class="ms-occ-op-col">
            <div class="ms-occ-op-cell">${msOccEsc(cell.name)}</div>
            ${cell.cards.map((c, i) => {
                const key = `op|${cell.name}|${c.name}`;
                const tab = d.nonCriticalTab && msOccCardTab[key] === 'noncritical' ? 'noncritical' : 'critical';
                const s = tab === 'noncritical' ? c.nonCritical : c.critical;
                const pct = Math.max(0, Math.min(100, Number(s.percentage) || 0));
                const tabs = d.nonCriticalTab
                    ? `<button type="button" data-key="${msOccEsc(key)}" data-tab="critical" class="${tab === 'critical' ? 'active' : ''}">CRITICAL</button>
                       <button type="button" data-key="${msOccEsc(key)}" data-tab="noncritical" class="${tab === 'noncritical' ? 'active' : ''}">NON CRITICAL</button>`
                    : `<button type="button" class="active" data-key="${msOccEsc(key)}" data-tab="critical">GAUGE PARAMETER</button>`;
                const chips = s.chips.length
                    ? s.chips.map(ch => `<div class="ms-occ-op-chip" title="${ch.nokReadings} NOK reading${ch.nokReadings === 1 ? '' : 's'}">
                            <span class="ms-occ-op-chip-value">${ch.share}%</span><span class="ms-occ-op-chip-code">${msOccEsc(ch.processCode)}</span></div>`).join('')
                    : `<div class="ms-occ-op-none">${c.readings ? 'No NOK readings' : 'No readings'}</div>`;
                return `
                <div class="ms-occ-card ms-occ-op-card">
                    <div class="ms-occ-card-tabs">${tabs}</div>
                    <div class="ms-occ-op-top">
                        <div class="ms-occ-gauge ms-occ-gauge-nok" style="--ms-occ-pct:${pct}%">
                            <div class="ms-occ-gauge-fill"></div>
                            <div class="ms-occ-gauge-text"><span class="ms-occ-gauge-value">${msOccFmtPct(s.percentage)}<small>%</small></span>
                                <span class="ms-occ-gauge-name">${msOccEsc(c.name)}</span></div>
                        </div>
                        <div class="ms-occ-op-chips">${chips}</div>
                    </div>
                    <div class="ms-occ-facts">${c.readings} reading${c.readings === 1 ? '' : 's'} · ${s.nokReadings} NOK</div>
                </div>`;
            }).join('')}
        </div>`).join('');

    box.querySelectorAll('.ms-occ-card-tabs button').forEach(b => b.addEventListener('click', () => {
        if (!d.nonCriticalTab) return;
        msOccCardTab[b.dataset.key] = b.dataset.tab;
        msOccRenderOperation();
    }));
}

// ---------------------------------------------------------------- SPC LIVE / SPC MONTHLY

function msOccBuildSpcFilters() {
    const box = document.getElementById('msOccSpcFilters');
    box.innerHTML = `
        <label class="ms-occ-field" data-for="live monthly"><span>Cell</span><select id="msOccSpcCell" class="ms-occ-select"></select></label>
        <label class="ms-occ-field" data-for="live monthly"><span>Op / Insp</span><select id="msOccSpcRole" class="ms-occ-select"></select></label>
        <label class="ms-occ-field ms-occ-field-wide" data-for="live monthly"><span>Part Para Code</span><select id="msOccSpcCode" class="ms-occ-select"></select></label>
        <label class="ms-occ-field" data-for="live monthly"><span>Process Code</span><select id="msOccSpcOpn" class="ms-occ-select"></select></label>
        <label class="ms-occ-field" data-for="live"><span>Date</span><input type="text" id="msOccSpcDate" class="ms-pdi-date" readonly></label>
        <label class="ms-occ-field" data-for="monthly"><span>From</span><input type="text" id="msOccSpcFrom" class="ms-pdi-date" readonly></label>
        <label class="ms-occ-field" data-for="monthly"><span>To</span><input type="text" id="msOccSpcTo" class="ms-pdi-date" readonly></label>
        <div class="ms-occ-spc-actions" data-for="monthly">
            <button type="button" class="ms-occ-btn" id="msOccSpcReadingsBtn" disabled>0 Readings</button>
            <button type="button" class="ms-occ-btn" id="msOccSpcReportBtn">Report</button>
        </div>`;

    const today = msOccProductionDay();
    const pick = (id, def, onChange) => flatpickr(id, {
        dateFormat: 'd-M-Y', defaultDate: def, maxDate: new Date(), disableMobile: true, onChange
    });
    msOccSpcPickers.live = pick('#msOccSpcDate', today, () => msOccSpcRefreshCodes());
    msOccSpcPickers.to = pick('#msOccSpcTo', today, () => msOccSpcRefreshCodes());
    msOccSpcPickers.from = pick('#msOccSpcFrom', today, () => msOccSpcRefreshCodes());   // default set when options arrive

    document.getElementById('msOccSpcCell').addEventListener('change', e => { msOccSpcSel.cell = e.target.value; msOccSpcRefreshCodes(); });
    document.getElementById('msOccSpcRole').addEventListener('change', e => { msOccSpcSel.role = e.target.value; msOccSpcRefreshCodes(); });
    document.getElementById('msOccSpcCode').addEventListener('change', e => { msOccSpcSel.code = e.target.value; msOccSpcRefreshCodes(); });
    document.getElementById('msOccSpcOpn').addEventListener('change', e => { msOccSpcSel.opn = e.target.value; msOccSpcLoadChart(); });
    document.getElementById('msOccSpcReadingsBtn').addEventListener('click', msOccOpenReadings);
    document.getElementById('msOccSpcReportBtn').addEventListener('click', msOccOpenReport);
}

function msOccSpcDestroyCharts() {
    msOccSpcCharts.forEach(c => c.destroy());
    msOccSpcCharts = [];
}

function msOccSpcClear(message) {
    msOccSpcDestroyCharts();
    msOccSpcData = null;
    document.getElementById('msOccSpcTitle').textContent = '';
    document.getElementById('msOccSpcStats').innerHTML = '';
    document.getElementById('msOccSpcStrip').innerHTML = '';
    document.querySelector('#msOccSpc .ms-occ-spc-body').hidden = true;
    document.getElementById('msOccWindow').textContent = '';
    const btn = document.getElementById('msOccSpcReadingsBtn');
    btn.textContent = '0 Readings';
    btn.disabled = true;
    document.getElementById('msOccNote').textContent = message || '';
}

function msOccFillSelect(id, values, selected, labels) {
    const el = document.getElementById(id);
    el.innerHTML = values.map((v, i) => `<option value="${msOccEsc(v)}">${msOccEsc(labels ? labels[i] : v)}</option>`).join('');
    el.value = values.includes(selected) ? selected : (values[0] ?? '');
    el.disabled = values.length === 0;
    return el.value;
}

// The window of the process-code list and the chart: SPC LIVE = one day, SPC MONTHLY = From .. To.
function msOccSpcDays() {
    if (msOccView === 'spclive') {
        const d = msOccSpcPickers.live.selectedDates[0];
        return d ? { from: msOccIsoDay(d), to: msOccIsoDay(d) } : null;
    }
    const f = msOccSpcPickers.from.selectedDates[0], t = msOccSpcPickers.to.selectedDates[0];
    return f && t ? { from: msOccIsoDay(f), to: msOccIsoDay(t), fromDate: f, toDate: t } : null;
}

async function msOccSpcLoadView() {
    const seq = msOccSeq;
    msOccSpcClear('Loading…');
    let o = msOccSpcOptions[msOccMachine];
    if (!o) {
        try {
            o = await msOccFetch(`/api/machineshop/controlcharts/spc/options?machine=${encodeURIComponent(msOccMachine)}`);
        } catch (e) {
            if (seq === msOccSeq) msOccSpcClear(`Could not load the parameters (${e.message}).`);
            return;
        }
        msOccSpcOptions[msOccMachine] = o;
        if (!msOccSpcPickers.fromSet) {
            const from = msOccProductionDay();
            from.setDate(from.getDate() - (o.monthlyDefaultDays || 30));
            msOccSpcPickers.from.setDate(from, false);
            msOccSpcPickers.fromSet = true;
        }
    }
    if (seq !== msOccSeq) return;
    const live = msOccView === 'spclive';
    // SPC LIVE: "All" cells first (ThingWorx ignored the cell there); SPC MONTHLY: one cell.
    const cells = live ? [''].concat(o.cells) : o.cells;
    msOccSpcSel.cell = msOccFillSelect('msOccSpcCell', cells, msOccSpcSel.cell, live ? ['All'].concat(o.cells) : null);
    msOccSpcSel.role = msOccFillSelect('msOccSpcRole', o.roles, msOccSpcSel.role);
    msOccSpcSel.code = msOccFillSelect('msOccSpcCode', o.parameters.map(p => p.code), msOccSpcSel.code,
        o.parameters.map(p => p.description ? `${p.code} - ${p.description}` : p.code));
    if (!o.hasSource) { msOccSpcClear('No data source for this machine (ThingWorx had none either).'); msOccFillSelect('msOccSpcOpn', [], ''); return; }
    if (!live && !o.hasCells) {
        msOccSpcClear('SPC MONTHLY needs cell data; this machine\'s readings carry no cell (ThingWorx built it for Cover LH only).');
        msOccFillSelect('msOccSpcOpn', [], '');
        return;
    }
    if (!o.parameters.length) { msOccSpcClear('No parameter is marked SPC in Part Parameter Config for this machine.'); msOccFillSelect('msOccSpcOpn', [], ''); return; }
    msOccSpcRefreshCodes();
}

function msOccSpcRangeError(days) {
    const o = msOccSpcOptions[msOccMachine];
    if (msOccView !== 'spcmonthly' || !days || !o) return '';
    if (days.toDate < days.fromDate) return 'From must not be after To.';
    const span = Math.round((days.toDate - days.fromDate) / 86400000);
    return span > o.maxRangeDays ? `Days selected exceeds ${o.maxRangeDays} days ! Please Choose a range between ${o.maxRangeDays} days.` : '';
}

// Process codes of the role read in the window (ThingWorx QualityLiveProcessCode / QualityFunctionTestingMonthlyProcessCode).
async function msOccSpcRefreshCodes() {
    if (!msOccIsSpc()) return;
    const seq = ++msOccSeq;
    const days = msOccSpcDays();
    const rangeError = msOccSpcRangeError(days);
    if (!days || !msOccSpcSel.code || rangeError) {
        msOccFillSelect('msOccSpcOpn', [], '');
        msOccSpcClear(rangeError || 'Please select Process Code and Part Para Code.');
        return;
    }
    msOccSpcClear('Loading process codes…');
    const params = new URLSearchParams({ machine: msOccMachine, role: msOccSpcSel.role, code: msOccSpcSel.code, from: days.from, to: days.to });
    if (msOccSpcSel.cell) params.set('cell', msOccSpcSel.cell);
    try {
        msOccSpcProcessCodes = await msOccFetch(`/api/machineshop/controlcharts/spc/processcodes?${params}`);
    } catch (e) {
        if (seq === msOccSeq) msOccSpcClear(`Could not load the process codes (${e.message}).`);
        return;
    }
    if (seq !== msOccSeq) return;
    msOccSpcSel.opn = msOccFillSelect('msOccSpcOpn', msOccSpcProcessCodes, msOccSpcSel.opn);
    if (!msOccSpcProcessCodes.length) {
        msOccSpcClear(`No ${msOccSpcSel.role.toLowerCase()} readings of ${msOccSpcSel.code} in this ${msOccView === 'spclive' ? 'day' : 'range'}.`);
        return;
    }
    msOccSpcLoadChart();
}

async function msOccSpcLoadChart() {
    if (!msOccIsSpc() || !msOccSpcSel.opn) return;
    const seq = ++msOccSeq;
    const days = msOccSpcDays();
    if (!days) return;
    const live = msOccView === 'spclive';
    const params = new URLSearchParams({ machine: msOccMachine, code: msOccSpcSel.code, processCode: msOccSpcSel.opn });
    if (live) {
        params.set('date', days.from);
        if (msOccSpcSel.cell) params.set('cell', msOccSpcSel.cell);
    } else {
        params.set('cell', msOccSpcSel.cell);
        params.set('role', msOccSpcSel.role);
        params.set('from', days.from);
        params.set('to', days.to);
    }
    document.getElementById('msOccNote').textContent = 'Loading…';
    document.getElementById('msOccSpc').classList.add('ms-occ-loading');
    try {
        const d = await msOccFetch(`/api/machineshop/controlcharts/spc/${live ? 'live' : 'monthly'}?${params}`);
        if (seq !== msOccSeq) return;
        msOccSpcData = d;
        msOccSpcRender();
    } catch (e) {
        if (seq === msOccSeq) msOccSpcClear(`Could not load the chart (${e.message}).`);
    } finally {
        if (seq === msOccSeq) document.getElementById('msOccSpc').classList.remove('ms-occ-loading');
    }
}

function msOccSpcWindowText(d) {
    const from = msOccParse(d.from), to = msOccParse(d.to);
    if (!from || !to) return '';
    return `${msOccFmtDay(from)} ${msOccFmtTime(from)} – ${msOccFmtDay(to)} ${msOccFmtTime(to)}`;
}

function msOccSpcRender() {
    const d = msOccSpcData;
    msOccSpcDestroyCharts();
    if (!d) return;
    const live = msOccView === 'spclive';
    const s = d.stats;
    document.getElementById('msOccWindow').textContent = (live ? 'Production day ' : '') + msOccSpcWindowText(d);
    document.getElementById('msOccSpcTitle').textContent = d.description ? `${d.code} - ${d.description}` : d.code;

    const rows = live
        ? [['USL', s.usl], ['LSL', s.lsl], ['X Double Bar', s.xDoubleBar], ['R Bar', s.rBar], ['Std. Dev.', s.stdDev],
           ['LCL', s.lcl], ['UCL', s.ucl], ['UCL R', s.uclr], ['Cp', s.cp], ['Cpk', s.cpk]]
        : [['LSL', s.lsl], ['USL', s.usl], ['Std. Dev.', s.stdDev], ['X Double Bar', s.xDoubleBar], ['LCL', s.lcl],
           ['UCL', s.ucl], ['R Bar', s.rBar], ['UCL R', s.uclr], ['Cp', s.cp], ['Cpk', s.cpk]];
    const count = live ? d.points.length : d.subgroups.length;
    const extra = live
        ? `<div class="ms-occ-spc-stat"><span>Readings</span><b>${d.points.length}</b></div>
           <div class="ms-occ-spc-stat"><span>Sample size</span><b>${s.sampleSize}</b></div>`
        : `<div class="ms-occ-spc-stat"><span>Sub-groups</span><b>${d.subgroups.length}</b></div>`;
    document.getElementById('msOccSpcStats').innerHTML = rows.map(([k, v]) =>
        `<div class="ms-occ-spc-stat${k === 'Cp' || k === 'Cpk' ? ' ms-occ-spc-cap' : ''}"><span>${k}</span><b>${msOccFmtNum(v)}</b></div>`).join('') + extra;

    const btn = document.getElementById('msOccSpcReadingsBtn');
    btn.textContent = `${live ? 0 : d.readings} Readings`;
    btn.disabled = live || !d.subgroups.length;

    const note = document.getElementById('msOccNote');
    document.querySelector('#msOccSpc .ms-occ-spc-body').hidden = !count;
    if (!count) {
        note.textContent = live ? 'No readings of this parameter and process code on this day.'
            : `No shift has ${s.sampleSize} readings for this selection, so there is no sub-group to chart (ThingWorx only made a sub-group from a shift with at least ${s.sampleSize} readings).`;
        document.getElementById('msOccSpcStrip').innerHTML = '';
        return;
    }
    note.textContent = '';
    if (live) {
        msOccSpcCharts.push(msOccLiveChart(document.getElementById('msOccSpcChart1'), d));
        msOccRenderStrip(d);
    } else {
        msOccSpcCharts.push(msOccXBarChart(document.getElementById('msOccSpcChart1'), d));
        msOccSpcCharts.push(msOccRangeChart(document.getElementById('msOccSpcChart2'), d));
        document.getElementById('msOccSpcStrip').innerHTML = '';
    }
}

// Readings strip under the SPC LIVE chart (ThingWorx QualityTranspose: one row, a column per reading time).
function msOccRenderStrip(d) {
    const cells = d.points.map(p => {
        const t = msOccParse(p.time);
        return `<th>${t ? msOccFmtTime(t) : ''}</th>`;
    }).join('');
    const values = d.points.map(p => {
        const out = (d.stats.usl != null && p.reading > d.stats.usl) || (d.stats.lsl != null && p.reading < d.stats.lsl);
        return `<td class="${out ? 'ms-occ-out' : ''}">${msOccFmtNum(p.reading)}</td>`;
    }).join('');
    document.getElementById('msOccSpcStrip').innerHTML =
        `<table class="ms-occ-table ms-occ-strip-table"><thead><tr><th class="ms-occ-strip-head">Time</th>${cells}</tr></thead>
         <tbody><tr><th class="ms-occ-strip-head">Reading</th>${values}</tr></tbody></table>`;
}

function msOccFlat(n, v) {
    return v == null ? null : new Array(n).fill(v);
}

function msOccLimitSet(col, n, lines) {
    return lines.filter(l => l.value != null).map(l => ({
        label: l.label, data: msOccFlat(n, l.value), borderColor: l.color, backgroundColor: l.color,
        borderWidth: l.width || 1.2, borderDash: l.dash || [], pointRadius: 0, pointHoverRadius: 0, tension: 0, fill: false
    }));
}

function msOccSpcScales(col, yTitle, min, max) {
    return {
        x: { ticks: { color: col.text, font: { size: 9 }, maxRotation: 45, autoSkip: true, maxTicksLimit: 16 }, grid: { color: col.grid } },
        y: {
            min, max,
            title: { display: true, text: yTitle, color: col.text, font: { size: 10 } },
            ticks: { color: col.text, font: { size: 9 }, callback: v => Number(v).toFixed(3) },
            grid: { color: col.grid }
        }
    };
}

function msOccSpcLegend(col) {
    return { display: true, position: 'bottom', labels: { color: col.text, boxWidth: 12, font: { size: 10 } } };
}

// SPC LIVE: every reading with UCL / LCL (amber), CL = median of the JobParameter limits (grey), USL / LSL (red).
function msOccLiveChart(canvas, d) {
    const col = msOccColors();
    const s = d.stats;
    const n = d.points.length;
    const labels = d.points.map(p => { const t = msOccParse(p.time); return t ? msOccFmtTime(t) : ''; });
    const datasets = [{
        label: 'Reading', data: d.points.map(p => p.reading), borderColor: col.line, backgroundColor: col.line,
        borderWidth: 1.5, pointRadius: n > 120 ? 1.5 : 3, tension: 0, order: 0
    }, {
        label: 'CL', data: d.points.map(p => p.cl), borderColor: col.center, backgroundColor: col.center,
        borderWidth: 1.2, borderDash: [4, 3], pointRadius: 0, pointHoverRadius: 0, tension: 0, spanGaps: true
    }].concat(msOccLimitSet(col, n, [
        { label: 'UCL', value: s.ucl, color: col.limit, dash: [6, 3] },
        { label: 'LCL', value: s.lcl, color: col.limit, dash: [6, 3] },
        { label: 'USL', value: s.usl, color: col.nok, width: 1.6 },
        { label: 'LSL', value: s.lsl, color: col.nok, width: 1.6 }
    ]));
    return new Chart(canvas, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: msOccSpcLegend(col),
                tooltip: { callbacks: { label: item => `${item.dataset.label}: ${msOccFmtNum(item.raw)}` } }
            },
            scales: msOccSpcScales(col, 'Reading')
        }
    });
}

function msOccSubgroupLabel(g) {
    const t = msOccParse(g.date);
    return t ? `${String(t.getDate()).padStart(2, '0')}-${MS_OCC_MONTHS[t.getMonth()]} ${g.shift.replace('Shift ', '')}` : '';
}

// SPC MONTHLY X-bar chart (ThingWorx calculateXBarChart): XBar per sub-group (red = a Nelson rule failed) with
// X-double-bar, UCL, LCL, USL, LSL; y from LSL - (USL - LSL) / 2 to USL + (USL - LSL) / 2 as ThingWorx.
function msOccXBarChart(canvas, d) {
    const col = msOccColors();
    const s = d.stats;
    const g = d.subgroups;
    const n = g.length;
    let min, max;
    if (s.usl != null && s.lsl != null && s.usl > s.lsl) {
        const half = (s.usl - s.lsl) / 2;
        min = s.lsl - half;
        max = s.usl + half;
        const lo = Math.min(...g.map(x => x.xBar)), hi = Math.max(...g.map(x => x.xBar));
        if (lo < min || hi > max) { min = undefined; max = undefined; }   // keep every point visible
    }
    const datasets = [{
        label: 'X Bar', data: g.map(x => x.xBar), borderColor: col.line, backgroundColor: col.line,
        pointBackgroundColor: g.map(x => x.rule ? col.nok : col.line),
        pointBorderColor: g.map(x => x.rule ? col.nok : col.line), pointRadius: g.map(x => x.rule ? 5 : 3),
        borderWidth: 1.5, tension: 0, order: 0
    }].concat(msOccLimitSet(col, n, [
        { label: 'X Double Bar', value: s.xDoubleBar, color: col.ok, dash: [2, 2] },
        { label: 'UCL', value: s.ucl, color: col.limit, dash: [6, 3] },
        { label: 'LCL', value: s.lcl, color: col.limit, dash: [6, 3] },
        { label: 'USL', value: s.usl, color: col.nok, width: 1.6 },
        { label: 'LSL', value: s.lsl, color: col.nok, width: 1.6 }
    ]));
    return new Chart(canvas, {
        type: 'line',
        data: { labels: g.map(msOccSubgroupLabel), datasets },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: msOccSpcLegend(col),
                title: { display: true, text: 'X Bar Chart', color: col.text, font: { size: 11, weight: '600' } },
                tooltip: {
                    callbacks: {
                        label: item => `${item.dataset.label}: ${msOccFmtNum(item.raw)}`,
                        afterBody: items => { const x = g[items[0].dataIndex]; return x ? [x.remarks] : []; }
                    }
                }
            },
            scales: msOccSpcScales(col, 'X Bar', min, max)
        }
    });
}

// SPC MONTHLY Range chart (ThingWorx calculateSPCRangeChart): Range per sub-group with R-bar, LCL R, UCL R.
function msOccRangeChart(canvas, d) {
    const col = msOccColors();
    const s = d.stats;
    const g = d.subgroups;
    const datasets = [{
        label: 'Range', data: g.map(x => x.range), borderColor: col.line, backgroundColor: col.line,
        borderWidth: 1.5, pointRadius: 3, tension: 0, order: 0
    }].concat(msOccLimitSet(col, g.length, [
        { label: 'R Bar', value: s.rBar, color: col.ok, dash: [2, 2] },
        { label: 'UCL R', value: s.uclr, color: col.limit, dash: [6, 3] },
        { label: 'LCL R', value: s.lclr, color: col.limit, dash: [6, 3] }
    ]));
    return new Chart(canvas, {
        type: 'line',
        data: { labels: g.map(msOccSubgroupLabel), datasets },
        options: {
            responsive: true, maintainAspectRatio: false, animation: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: msOccSpcLegend(col),
                title: { display: true, text: 'Range Chart', color: col.text, font: { size: 11, weight: '600' } },
                tooltip: { callbacks: { label: item => `${item.dataset.label}: ${msOccFmtNum(item.raw)}` } }
            },
            scales: msOccSpcScales(col, 'Range', 0)
        }
    });
}

// ---------------------------------------------------------------- pop-ups

function msOccOpenModal(title, sub) {
    document.getElementById('msOccModalTitle').textContent = title;
    document.getElementById('msOccModalSub').textContent = sub;
    document.getElementById('msOccModalTools').innerHTML = '';
    document.getElementById('msOccModalBody').innerHTML = '';
    document.getElementById('msOccModal').classList.add('open');
}

function msOccCloseModal() {
    document.getElementById('msOccModal').classList.remove('open');
}

function msOccSelectionText() {
    const days = msOccSpcDays();
    const f = days && days.fromDate ? msOccFmtDay(days.fromDate) : '';
    const t = days && days.toDate ? msOccFmtDay(days.toDate) : '';
    return `${msOccMachine} · ${msOccSpcSel.cell} · ${msOccSpcSel.role} · ${f} – ${t}`;
}

// "n Readings" (RE_SPCMonthlyReadingPopup_MU): the sub-groups behind the charts.
function msOccOpenReadings() {
    const d = msOccSpcData;
    if (!d || !d.subgroups || !d.subgroups.length) return;
    const size = d.stats.sampleSize;
    msOccOpenModal(`${d.readings} Readings`, `${d.code} · ${d.processCode} · ${msOccSelectionText()}`);
    const xs = Array.from({ length: size }, (_, i) => `<th>X${i + 1}</th>`).join('');
    const rows = d.subgroups.map(g => {
        const t = msOccParse(g.date);
        const date = t ? `${t.getFullYear()}/${String(t.getMonth() + 1).padStart(2, '0')}/${String(t.getDate()).padStart(2, '0')} ${msOccFmtTime(t)}` : '';
        return `<tr><td>${date}</td><td>${msOccEsc(g.shift)}</td>${g.x.map(v => `<td>${msOccFmtNum(v)}</td>`).join('')}
            <td>${msOccFmtNum(g.xBar)}</td><td>${msOccFmtNum(g.range)}</td><td class="${g.rule ? 'ms-occ-out' : ''} ms-occ-left">${msOccEsc(g.remarks)}</td></tr>`;
    }).join('');
    document.getElementById('msOccModalBody').innerHTML =
        `<table class="ms-occ-table"><thead><tr><th>Date</th><th>Shift</th>${xs}<th>X Bar</th><th>Range</th><th class="ms-occ-left">Remarks</th></tr></thead><tbody>${rows}</tbody></table>`;
}

let msOccReportData = null;

// Report (RE_SPCReportTable_MU): every SPC parameter x the ticked process codes, for the selected cell / role / range.
async function msOccOpenReport() {
    const days = msOccSpcDays();
    const rangeError = msOccSpcRangeError(days);
    msOccReportData = null;
    msOccOpenModal('SPC Report', msOccSelectionText());
    const tools = document.getElementById('msOccModalTools');
    const body = document.getElementById('msOccModalBody');
    if (!days || rangeError) { body.innerHTML = `<div class="ms-pdi-modal-empty">${msOccEsc(rangeError || 'Pick From and To.')}</div>`; return; }
    body.innerHTML = '<div class="ms-pdi-modal-empty">Loading process codes…</div>';
    const params = new URLSearchParams({ machine: msOccMachine, role: msOccSpcSel.role, cell: msOccSpcSel.cell, from: days.from, to: days.to });
    let codes;
    try {
        codes = await msOccFetch(`/api/machineshop/controlcharts/spc/processcodes?${params}`);
    } catch (e) {
        body.innerHTML = `<div class="ms-pdi-modal-empty">Could not load the process codes (${msOccEsc(e.message)}).</div>`;
        return;
    }
    if (!codes.length) { body.innerHTML = '<div class="ms-pdi-modal-empty">No readings of this cell and role in the range.</div>'; return; }
    tools.innerHTML = `
        <div class="ms-occ-checks">${codes.map(c => `<label><input type="checkbox" value="${msOccEsc(c)}" checked> ${msOccEsc(c)}</label>`).join('')}</div>
        <div class="ms-occ-modal-buttons">
            <button type="button" class="ms-pdi-submit" id="msOccReportGenerate">Generate</button>
            <button type="button" class="ms-pdi-modal-download" id="msOccReportDownload" disabled>Download</button>
        </div>`;
    body.innerHTML = '<div class="ms-pdi-modal-empty">Tick the process codes and press Generate.</div>';
    document.getElementById('msOccReportGenerate').addEventListener('click', () => msOccGenerateReport(days));
    document.getElementById('msOccReportDownload').addEventListener('click', msOccDownloadReport);
}

const MS_OCC_REPORT_COLUMNS = [
    ['slNo', 'Sl. No.', 0], ['parameter', 'Parameter', null], ['operationNo', 'Operation No.', null], ['lsl', 'LSL', 4],
    ['usl', 'USL', 4], ['cp', 'Cp', 2], ['cpk', 'Cpk', 2], ['lcl', 'LCL', 4], ['ucl', 'UCL', 4], ['xMax', 'X - Max', 4],
    ['xMin', 'X - Min', 4], ['xBar', 'X - Bar', 4], ['noOfReadings', 'No. of Readings', 0]
];

async function msOccGenerateReport(days) {
    const opns = [...document.querySelectorAll('#msOccModalTools .ms-occ-checks input:checked')].map(i => i.value);
    const body = document.getElementById('msOccModalBody');
    const download = document.getElementById('msOccReportDownload');
    download.disabled = true;
    msOccReportData = null;
    if (!opns.length) { body.innerHTML = '<div class="ms-pdi-modal-empty">Tick at least one process code.</div>'; return; }
    body.innerHTML = '<div class="ms-pdi-modal-empty">Generating…</div>';
    const params = new URLSearchParams({
        machine: msOccMachine, cell: msOccSpcSel.cell, role: msOccSpcSel.role, processCodes: opns.join(','), from: days.from, to: days.to
    });
    try {
        msOccReportData = await msOccFetch(`/api/machineshop/controlcharts/spc/report?${params}`);
    } catch (e) {
        body.innerHTML = `<div class="ms-pdi-modal-empty">Could not generate the report (${msOccEsc(e.message)}).</div>`;
        return;
    }
    const rows = msOccReportData.rows;
    if (!rows.length) { body.innerHTML = '<div class="ms-pdi-modal-empty">No shift with enough readings in this range.</div>'; return; }
    body.innerHTML = `<table class="ms-occ-table"><thead><tr>${MS_OCC_REPORT_COLUMNS.map(c => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>
        ${rows.map(r => `<tr>${MS_OCC_REPORT_COLUMNS.map(([k, , dg]) => {
            const v = r[k];
            const text = dg == null ? msOccEsc(v) : dg === 0 ? String(v ?? '') : msOccFmtNum(v, dg);
            return `<td class="${dg == null ? 'ms-occ-left' : ''}"${k === 'parameter' ? ` title="${msOccEsc(r.description)}"` : ''}>${text}</td>`;
        }).join('')}</tr>`).join('')}</tbody></table>`;
    download.disabled = false;
}

async function msOccDownloadReport() {
    const d = msOccReportData;
    if (!d || !d.rows.length) return;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('SPC Report');
    sheet.columns = MS_OCC_REPORT_COLUMNS.map(([k, title]) => ({ header: title, key: k, width: k === 'parameter' ? 16 : 13 }));
    d.rows.forEach(r => sheet.addRow(Object.fromEntries(MS_OCC_REPORT_COLUMNS.map(([k, , dg]) =>
        [k, dg == null || dg === 0 ? r[k] : (r[k] == null ? null : Number(Number(r[k]).toFixed(dg)))]))));
    sheet.getRow(1).font = { bold: true };
    const from = msOccParse(d.from), to = msOccParse(d.to);
    const name = `SPC_Report_${d.machine}_${d.cell}_${d.role}_${from ? msOccIsoDay(from) : ''}_${to ? msOccIsoDay(to) : ''}`.replace(/\s+/g, '');
    await downloadWorkbook(workbook, `${name}.xlsx`);
}

// Theme switch (index.html applyTheme): the chart colours come from the CSS tokens.
function msOccRetheme() {
    const tab = document.getElementById('tab-ms-occ');
    if (!tab || !tab.classList.contains('active')) return;
    if (msOccView === 'cell' && msOccData) msOccRenderCell();
    else if (msOccIsSpc() && msOccSpcData) msOccSpcRender();
}
