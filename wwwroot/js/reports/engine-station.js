// --- ENGINE STATION REPORTS (prefix esr): Leak Station / PDI Station / Engine Test Bed (+ Bed Wise) ---
// Port of LeakStationReport.js, PDIStationReport.js, EngineTestBedReport.js and EngineBedWiseReport.js
// from the "ThingWorx Migration Quality Reports Merge" MVC app (jQuery + select2 + SheetJS). One file,
// three screens: every screen is built from its ESR_REPORTS entry into the empty
// <div class="esr" data-esr="leak|pdi|testbed"> pane in index.html (Test Bed also hosts the Bed Wise view).
// Backend (Modules/Reports/EngineStation/, read-only stored procs in FACTREPRDETL):
//   POST /api/reports/{report}/data            { line, mode, from, to, filters: { key: [values] } }
//   GET  /api/reports/{report}/filters         ?line&from&to -> { filters: { key: [values] }, beds?, notice? }
//   GET  /api/reports/{report}/engine-numbers  ?line&from&to -> { engineNumbers: [...] }
// Deliberate differences from the source: production-day default range (00:15 -> 00:15) instead of
// 00:00-23:59, API errors shown inline (the 503 DBA text) instead of HTTP-200 error rows, the two
// "Leak Value" filters renamed (Leak Pa / Leak 3 Value), "REWOEK" header typo fixed, Excel sheet names
// kept <= 31 characters, no setInterval loader.

const ESR_MODES = { OverAll: 'Overall', Distinct: 'Distinct Engine Numbers', Duplicates: 'Duplicate Engine Numbers' };
const ESR_PAGE_SIZES = [10, 25, 50, 100, 250, 500];
const ESR_MS_LIMIT = 500;   // max options drawn in one multi-select list (type to narrow)

// Per screen: filters in source order (free = free-typed / pasted values allowed, the source's select2
// tags:true) and table columns in source order with the source headers.
const ESR_REPORTS = {
    leak: {
        pane: 'leak', api: 'leak-station', title: 'Leak Station Report', fileStem: 'LeakStationReport', sheet: 'Leak Station',
        pie: { key: 'result', title: 'Leak Station Status', ok: 'OK', nok: 'REJECTED' },
        filters: [
            { key: 'modelCode', label: 'Model Code', free: true },
            { key: 'engineNumber', label: 'Engine Number', free: true },
            { key: 'defectWise', label: 'Defect Wise', free: true },
            { key: 'reworkDetails', label: 'Rework Details', free: true },
            { key: 'result', label: 'Result' },
            { key: 'leak1_Status', label: 'Leak1_Status', free: true },
            { key: 'leakValue1', label: 'Leak Pa', free: true },          // LEAK_PA (source label "Leak Value")
            { key: 'leakMachine', label: 'Leak Machine', free: true },    // Leak2
            { key: 'leakValue2', label: 'Leak 3 Value', free: true },     // Leak3 (source label "Leak Value")
            { key: 'modelShortCode', label: 'Model ShortCode', free: true },
            { key: 'station', label: 'Station', free: true },
            { key: 'shiftCode', label: 'Shift' }
        ],
        columns: [
            { key: 'date', label: 'Date', date: true },
            { key: 'shiftCode', label: 'SHIFT' },
            { key: 'engineNumber', label: 'Engine Number' },
            { key: 'modelShortCode', label: 'MODEL_SHORTCODE' },
            { key: 'modelCode', label: 'MODEL CODE' },
            { key: 'station', label: 'STATION' },
            { key: 'leakPa', label: 'LEAK PA' },
            { key: 'result', label: 'RESULT' },
            { key: 'leak1_Status', label: 'LEAK1_STATUS' },
            { key: 'reworkResult', label: 'REWORK RESULT' },
            { key: 'leakDescription', label: 'LEAK DESCRIPTION' },
            { key: 'rootCause', label: 'ROOT CAUSE' },
            { key: 'reworkDetails', label: 'REWORK DETAILS' },
            { key: 'leakReworkTorqueStatus', label: 'LEAK REWORK TORQUE_STATUS' },
            { key: 'partReplaceDetails', label: 'PART REPLACE DETAILS' },
            { key: 'throttleBody', label: 'THROTTLE BODY' },
            { key: 'category', label: 'CATEGORY' },
            { key: 'supplierGrouping', label: 'SUPPLIER (Grouping)' },
            { key: 'reworkOilFillingValue', label: 'REWORK OIL FILLING VALUE' },
            { key: 'reworkDate', label: 'REWORK DATE', date: true },
            { key: 'reworkShift', label: 'REWORK_SHIFT' },
            { key: 'retestLeakPa', label: 'RETEST_LEAK_PA' },
            { key: 'reworkedBy', label: 'REWORKED BY' },
            { key: 'verifiedBy', label: 'VERIFIED BY' }
        ]
    },
    pdi: {
        pane: 'pdi', api: 'pdi-station', title: 'PDI Station Report', fileStem: 'PDIStationReport', sheet: 'PDI Station',
        pie: { key: 'pdiResult', title: 'PDI Station Status', ok: 'OK', nok: 'NOK' },
        filters: [
            { key: 'modelCode', label: 'Model', free: true },
            { key: 'engineNumber', label: 'Engine Number', free: true },
            { key: 'pdiDefect', label: 'PDI Defect', free: true },
            { key: 'reworkDetails', label: 'Rework Details', free: true },
            { key: 'pdiResult', label: 'PDI Result' },
            { key: 'leakValuePA', label: 'Leak Value PA', free: true },
            { key: 'shiftCode', label: 'Shift' }
        ],
        columns: [
            { key: 'date', label: 'DATE', date: true },
            { key: 'shiftCode', label: 'SHIFT' },
            { key: 'engineNumber', label: 'ENGINE NUMBER' },
            { key: 'modelCode', label: 'MODEL CODE' },
            { key: 'pdiStation', label: 'PDI STATION' },
            { key: 'userId', label: 'USER ID' },
            { key: 'pdiResult', label: 'PDI RESULT' },
            { key: 'leakValuePA', label: 'LEAK VALUE PA' },
            { key: 'pdiDefect', label: 'PDI DEFECT' },
            { key: 'rootCause', label: 'ROOT CAUSE' },
            { key: 'reworkDetails', label: 'REWORK DETAILS' },
            { key: 'reworkTorqueStatus', label: 'REWORK TORQUE STATUS' },
            { key: 'partReplaceDetails', label: 'PART REPLACE DETAILS' },
            { key: 'reworkOilFillingValue', label: 'REWORK OIL FILLING VALUE' },
            { key: 'category', label: 'CATEGORY' },
            { key: 'supplier', label: 'SUPPLIER' },
            { key: 'reworkDate', label: 'REWORK DATE', date: true },
            { key: 'reworkUserId', label: 'REWORKED USER ID' },
            { key: 'verifiedQFUserId', label: 'VERIFIED QF USER ID' }
        ]
    },
    testbed: {
        pane: 'testbed', api: 'engine-testbed', title: 'Engine Test Bed Report', fileStem: 'EngineTestBedReport', sheet: 'Engine TestBed',
        pie: { key: 'testingResult', title: 'Result', ok: 'OK', nok: 'NOK' },
        filters: [
            { key: 'modelCode', label: 'Model', free: true },
            { key: 'engineNumber', label: 'Engine Number', free: true },
            { key: 'bedNo', label: 'Bed No', free: true },
            { key: 'noOfTimes', label: 'No Of Times', free: true },
            { key: 'defectDetails', label: 'Defect Details', free: true },
            { key: 'reworkDetails', label: 'Rework Details', free: true },
            { key: 'testingResult', label: 'Testing Result' },
            { key: 'lhDbValue', label: 'LH DB Value', free: true },
            { key: 'rhDbValue', label: 'RH DB Value', free: true },
            { key: 'shiftCode', label: 'Shift' }
        ],
        columns: [
            { key: 'date', label: 'DATE', date: true },
            { key: 'shiftCode', label: 'SHIFT' },
            { key: 'engineNumber', label: 'ENGINE NUMBER' },
            { key: 'modelCode', label: 'MODEL' },
            { key: 'bedNo', label: 'BED NO' },
            { key: 'lhDbValue', label: 'LH DB VALUE' },
            { key: 'rhDbValue', label: 'RH DB VALUE' },
            { key: 'noOfTimes', label: 'NO OF TIMES' },
            { key: 'userId', label: 'USER ID' },
            { key: 'testingResult', label: 'TESTING RESULT' },
            { key: 'notOkBedNo', label: 'NOT OK BED NO' },
            { key: 'defectDetails', label: 'DEFECT DETAILS' },
            { key: 'rootCause', label: 'ROOT CAUSE' },
            { key: 'reworkDetails', label: 'REWORK DETAILS' },
            { key: 'reworkTorqueStatus', label: 'REWORK TORQUE STATUS' },
            { key: 'partReplaceDetails', label: 'PART REPLACE DETAILS' },
            { key: 'reworkOilFillingValue', label: 'REWORK OIL FILLING VALUE' },
            { key: 'category', label: 'CATEGORY' },
            { key: 'supplier', label: 'SUPPLIER' },
            { key: 'reworkReloadBedNo', label: 'REWORK RELOAD BED NO' },   // source: "REWOEK"
            { key: 'reworkCount', label: 'REWORK COUNT' },
            { key: 'reworkUserId', label: 'REWORKED USER ID' },
            { key: 'verifiedQFUserId', label: 'VERIFIED QF USER ID' }
        ]
    },
    // Bed Wise = Test Bed OverAll data (EA02 only) pivoted defect x bed, as EngineBedWiseReport.js.
    bedwise: {
        pane: 'testbed', api: 'engine-testbed', title: 'Engine Bed Wise Report', fileStem: 'EngineBedWiseReport', sheet: 'BedWise Defect Report',
        pivot: true, lockLine: 'EA02', pageSize: 10,
        filters: [
            { key: 'modelCode', label: 'Model' },
            { key: 'engineNumber', label: 'Engine Number', free: true },
            { key: 'defectDetails', label: 'Defect Details' },
            { key: 'reworkDetails', label: 'Rework Details' },
            { key: 'testingResult', label: 'Testing Result' },
            { key: 'shiftCode', label: 'Shift' }
        ],
        columns: [
            { key: 'bedNo', label: 'BED NO' },
            { key: 'defectDetails', label: 'DEFECT DETAILS' }
        ]
    }
};

// Sidebar tab id -> the screen shown first in that pane.
const ESR_TABS = { 'leak-station': 'leak', 'pdi-station': 'pdi', 'engine-test-bed': 'testbed' };

function esrNewState(key) {
    const cfg = ESR_REPORTS[key];
    return {
        loaded: false, ran: false, line: cfg.lockLine || 'EA02', mode: 'OverAll',
        rows: [], search: '', page: 1, pageSize: cfg.pageSize || 25,
        options: {}, sel: {}, beds: null, notice: '', filterNotice: '', errors: {},
        loading: false, filtersLoading: false, durationMs: null, lookupKey: '',
        dataSeq: 0, filterSeq: 0, abort: null, chart: null, pickers: {}, dateTimer: null
    };
}

const ESR_STATE = {};
Object.keys(ESR_REPORTS).forEach(k => { ESR_STATE[k] = esrNewState(k); });
let esrDocListenerAdded = false;

// ---------- small helpers ----------
function esrEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Row / filter keys are matched without case or underscores, so userid / userId / USERID and
// leak1_Status / leak1Status all resolve.
function esrNormKey(key) {
    return String(key).toLowerCase().replace(/_/g, '');
}

function esrPad(n) { return String(n).padStart(2, '0'); }

// dd-MM-yyyy HH:mm:ss. Accepts ISO text (Test Bed DATE is NVARCHAR), ISO with offset, or the
// en-US "M/d/yyyy h:mm:ss AM" text a DateTime -> string mapping can produce.
function esrFormatDate(value) {
    if (value == null || value === '') return '';
    if (value instanceof Date) {
        return isNaN(value) ? '' : `${esrPad(value.getDate())}-${esrPad(value.getMonth() + 1)}-${value.getFullYear()} ${esrPad(value.getHours())}:${esrPad(value.getMinutes())}:${esrPad(value.getSeconds())}`;
    }
    const s = String(value).trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/);
    if (m && !m[7]) return `${m[3]}-${m[2]}-${m[1]} ${m[4] || '00'}:${m[5] || '00'}:${m[6] || '00'}`;
    m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AP]M)?)?$/i);
    if (m) {
        let month = +m[1], day = +m[2];
        if (month > 12) [month, day] = [day, month];
        let hour = +(m[4] || 0);
        if (m[7]) { const pm = m[7].toUpperCase() === 'PM'; if (pm && hour < 12) hour += 12; if (!pm && hour === 12) hour = 0; }
        return `${esrPad(day)}-${esrPad(month)}-${m[3]} ${esrPad(hour)}:${m[5] || '00'}:${m[6] || '00'}`;
    }
    const d = new Date(s);
    if (isNaN(d)) return s;
    return `${esrPad(d.getDate())}-${esrPad(d.getMonth() + 1)}-${d.getFullYear()} ${esrPad(d.getHours())}:${esrPad(d.getMinutes())}:${esrPad(d.getSeconds())}`;
}

// Excel sheet names: max 31 characters, none of : \ / ? * [ ] (the source's Duplicates export broke on this).
function esrSheetName(name) {
    const clean = String(name || 'Report').replace(/[:\\\/?*\[\]]/g, ' ').replace(/\s+/g, ' ').trim();
    return (clean || 'Report').slice(0, 31).trim();
}

function esrStamp(d = new Date()) {
    return `${d.getFullYear()}${esrPad(d.getMonth() + 1)}${esrPad(d.getDate())}_${esrPad(d.getHours())}${esrPad(d.getMinutes())}`;
}

function esrView(key) {
    return document.querySelector(`.esr-view[data-esr-view="${key}"]`);
}

function esrFilterDef(key, fk) {
    return ESR_REPORTS[key].filters.find(f => f.key === fk);
}

function esrRange(key) {
    const p = ESR_STATE[key].pickers;
    const from = p.from?.selectedDates?.[0];
    const to = p.to?.selectedDates?.[0];
    return from && to ? { from, to } : null;
}

async function esrFetchJson(url, options) {
    const res = await fetch(url, options);
    const text = await res.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    if (!res.ok) {
        let msg = body && (body.message || body.detail || body.title);
        if (body && body.errors && typeof body.errors === 'object') {
            const list = Object.values(body.errors).flat().filter(Boolean);
            if (list.length) msg = `${msg ? msg + ': ' : ''}${list.join('; ')}`;
        }
        const err = new Error(msg || (text || res.statusText || 'Request failed').slice(0, 300));
        err.status = res.status;
        throw err;
    }
    return body || {};
}

function esrErrorText(err) {
    if (err && err.status) {
        const hint = err.status === 504 ? ' - try a narrower date range' : '';
        return `${err.message}${hint} (HTTP ${err.status})`;
    }
    return `Error connecting to server${err && err.message ? ': ' + err.message : ''}`;
}

// ---------- entry points ----------
function loadEsrDefaultView(tabId) {
    const pane = ESR_REPORTS[ESR_TABS[tabId]]?.pane;
    if (!pane) return;
    const root = esrBuildPane(pane);
    if (!root) return;
    const visible = root.querySelector('.esr-view:not([hidden])');
    if (visible) esrEnsureLoaded(visible.dataset.esrView);
}

function esrEnsureLoaded(key) {
    const st = ESR_STATE[key];
    if (st.loaded) return;
    st.loaded = true;
    esrLoadLookups(key);
    esrRun(key, 'OverAll');
}

// Test Bed | Bed Wise toggle.
function esrShowView(pane, key) {
    const root = document.querySelector(`.esr[data-esr="${pane}"]`);
    if (!root) return;
    root.querySelectorAll('.esr-view').forEach(v => { v.hidden = v.dataset.esrView !== key; });
    esrEnsureLoaded(key);
    const st = ESR_STATE[key];
    if (st.chart) st.chart.resize();
}

// Charts follow the theme (slice border = panel colour); called from applyTheme() in index.html.
function esrApplyTheme() {
    const surface = esrSurfaceColor();
    Object.values(ESR_STATE).forEach(st => {
        if (!st.chart) return;
        st.chart.data.datasets[0].borderColor = surface;
        st.chart.update('none');
    });
}

function esrSurfaceColor() {
    return getComputedStyle(document.body).getPropertyValue('--white').trim() || '#121212';
}

// ---------- pane build ----------
function esrBuildPane(pane) {
    const root = document.querySelector(`.esr[data-esr="${pane}"]`);
    if (!root) return null;
    if (root.dataset.esrBuilt) return root;
    root.dataset.esrBuilt = '1';

    const keys = Object.keys(ESR_REPORTS).filter(k => ESR_REPORTS[k].pane === pane);
    root.innerHTML = keys.map((k, i) => esrViewHtml(k, i > 0)).join('');
    keys.forEach(k => esrInitPickers(k));
    keys.forEach(k => { esrRenderAllMs(k); esrRender(k); });

    root.addEventListener('click', esrOnClick);
    root.addEventListener('change', esrOnChange);
    root.addEventListener('input', esrOnInput);
    root.addEventListener('keydown', esrOnKeyDown);
    root.addEventListener('paste', esrOnPaste);

    if (!esrDocListenerAdded) {
        esrDocListenerAdded = true;
        document.addEventListener('mousedown', e => {
            document.querySelectorAll('.esr-ms.open').forEach(ms => { if (!ms.contains(e.target)) esrMsClose(ms); });
        });
    }
    return root;
}

function esrViewHtml(key, hidden) {
    const cfg = ESR_REPORTS[key];
    const st = ESR_STATE[key];
    const toggle = cfg.pane === 'testbed'
        ? `<div class="esr-toggle">
               <button type="button" class="${key === 'testbed' ? 'active' : ''}" data-esr-act="view" data-target="testbed">
                   <span class="material-symbols-outlined">speed</span>Test Bed</button>
               <button type="button" class="${key === 'bedwise' ? 'active' : ''}" data-esr-act="view" data-target="bedwise">
                   <span class="material-symbols-outlined">grid_on</span>Bed Wise</button>
           </div>`
        : '';
    const lines = ['EA01', 'EA02'].map(l => `<option value="${l}"${l === st.line ? ' selected' : ''}>${l}</option>`).join('');
    const modes = cfg.pivot
        ? `<button type="button" class="esr-mode-btn" data-esr-act="run" data-mode="OverAll">
               <span class="material-symbols-outlined">search</span>Search</button>`
        : Object.entries(ESR_MODES).map(([m, label]) =>
            `<button type="button" class="esr-mode-btn" data-esr-act="run" data-mode="${m}">${label}</button>`).join('');
    const pie = cfg.pie
        ? `<div class="esr-pie-card">
               <div class="esr-pie-title">${esrEsc(cfg.pie.title)}</div>
               <div class="esr-pie-box"><canvas class="esr-pie"></canvas><div class="esr-pie-empty" hidden>No Data Available</div></div>
               <div class="esr-pie-legend"></div>
           </div>`
        : '';
    const sizes = ESR_PAGE_SIZES.map(s => `<option value="${s}"${s === st.pageSize ? ' selected' : ''}>${s}</option>`).join('');

    return `
    <section class="esr-view" data-esr-view="${key}"${hidden ? ' hidden' : ''}>
        <div class="esr-header">
            <h2>${esrEsc(cfg.title)}</h2>
            ${toggle}
        </div>
        <div class="esr-top${cfg.pie ? '' : ' esr-top-nopie'}">
            <div class="esr-filters">
                <div class="esr-grid">
                    <div class="esr-field esr-field-line">
                        <label>Line</label>
                        <select class="select-royal esr-line" data-esr-act="line"${cfg.lockLine ? ' disabled title="Bed Wise is available for ' + cfg.lockLine + ' only"' : ''}>${lines}</select>
                    </div>
                    <div class="esr-field esr-field-date"><label>From</label><input type="text" class="esr-input" data-esr-date="from" placeholder="From date"></div>
                    <div class="esr-field esr-field-date"><label>To</label><input type="text" class="esr-input" data-esr-date="to" placeholder="To date"></div>
                    ${cfg.filters.map(f => esrMsHtml(f)).join('')}
                </div>
                <div class="esr-actions">
                    <div class="esr-modes">${modes}</div>
                    <div class="esr-actions-right">
                        <button type="button" class="esr-btn" data-esr-act="clear"><span class="material-symbols-outlined">filter_alt_off</span>Clear Filters</button>
                        <button type="button" class="esr-btn" data-esr-act="export"><span class="material-symbols-outlined">download</span>Export Excel</button>
                    </div>
                </div>
            </div>
            ${pie}
        </div>
        <div class="esr-alert" role="alert" hidden></div>
        <div class="esr-notice" hidden></div>
        <section class="esr-card">
            <div class="esr-bar">
                <div class="esr-bar-info"></div>
                <div class="esr-bar-tools">
                    <input type="search" class="esr-search" data-esr-act="search" placeholder="${cfg.pivot ? 'Search defect...' : 'Live search (Engine, Result, Station...)'}" autocomplete="off">
                    <label class="esr-size">Show <select class="esr-size-select" data-esr-act="pagesize">${sizes}</select></label>
                </div>
            </div>
            <div class="esr-table-wrap">
                <table class="esr-table${cfg.pivot ? ' esr-pivot' : ''}"></table>
                <div class="esr-empty" hidden><span class="material-symbols-outlined">search_off</span><span class="esr-empty-text"></span></div>
                <div class="esr-loading" hidden><span class="esr-spinner"></span><span>Loading ${esrEsc(cfg.title)}...</span></div>
            </div>
            <div class="esr-pager" hidden></div>
        </section>
    </section>`;
}

function esrMsHtml(f) {
    return `<div class="esr-field esr-ms" data-key="${f.key}">
        <label>${esrEsc(f.label)}</label>
        <button type="button" class="esr-ms-btn" data-esr-act="ms-toggle" aria-haspopup="listbox">
            <span class="esr-ms-text">ALL</span><span class="material-symbols-outlined">expand_more</span>
        </button>
        <div class="esr-ms-menu" hidden>
            <input type="text" class="esr-ms-search" data-esr-act="ms-search" autocomplete="off"
                placeholder="${f.free ? 'Search, type or paste values...' : 'Search...'}">
            <div class="esr-ms-actions">
                <button type="button" class="esr-ms-add" data-esr-act="ms-add" hidden></button>
                <span class="esr-ms-spacer"></span>
                <button type="button" data-esr-act="ms-all">Select shown</button>
                <button type="button" data-esr-act="ms-none">Clear</button>
            </div>
            <div class="esr-ms-list" role="listbox"></div>
        </div>
    </div>`;
}

function esrInitPickers(key) {
    const view = esrView(key);
    const st = ESR_STATE[key];
    if (!view || typeof flatpickr === 'undefined') return;
    const { start, end } = currentProductionDayRange();
    const config = {
        enableTime: true, dateFormat: 'Y-m-d\\TH:i', altInput: true, altFormat: 'd M Y, h:i K', time_24hr: false,
        onChange: () => esrDatesChanged(key)
    };
    st.pickers.from = flatpickr(view.querySelector('[data-esr-date="from"]'), { ...config, defaultDate: start });
    st.pickers.to = flatpickr(view.querySelector('[data-esr-date="to"]'), { ...config, defaultDate: end });
}

// ---------- events (delegated per pane) ----------
function esrEventCtx(e) {
    const el = e.target.closest('[data-esr-act]');
    if (!el) return null;
    const view = el.closest('[data-esr-view]');
    if (!view) return null;
    return { el, act: el.dataset.esrAct, key: view.dataset.esrView, ms: el.closest('.esr-ms') };
}

function esrOnClick(e) {
    const c = esrEventCtx(e);
    if (!c) return;
    switch (c.act) {
        case 'run': esrRun(c.key, c.el.dataset.mode); break;
        case 'clear': esrClear(c.key); break;
        case 'export': esrExport(c.key); break;
        case 'view': esrShowView(ESR_REPORTS[c.key].pane, c.el.dataset.target); break;
        case 'page': esrGoPage(c.key, c.el.dataset.page); break;
        case 'ms-toggle': esrMsToggle(c.key, c.ms); break;
        case 'ms-add': esrMsAddTyped(c.key, c.ms); break;
        case 'ms-all': esrMsSelectShown(c.key, c.ms); break;
        case 'ms-none': ESR_STATE[c.key].sel[c.ms.dataset.key] = []; esrMsRefresh(c.key, c.ms); break;
    }
}

function esrOnChange(e) {
    const c = esrEventCtx(e);
    if (!c) return;
    const st = ESR_STATE[c.key];
    if (c.act === 'line') {
        esrChangeLine(c.key, c.el.value);
    } else if (c.act === 'pagesize') {
        st.pageSize = parseInt(c.el.value, 10) || 25;
        st.page = 1;
        esrRenderTable(c.key);
    } else if (c.act === 'ms-check') {
        const fk = c.ms.dataset.key;
        const sel = st.sel[fk] || (st.sel[fk] = []);
        const v = c.el.value;
        const i = sel.indexOf(v);
        if (c.el.checked && i < 0) sel.push(v);
        if (!c.el.checked && i >= 0) sel.splice(i, 1);
        esrMsUpdateBtn(c.key, c.ms);
    }
}

function esrOnInput(e) {
    const c = esrEventCtx(e);
    if (!c) return;
    if (c.act === 'search') {
        const st = ESR_STATE[c.key];
        st.search = c.el.value;
        st.page = 1;
        esrRenderTable(c.key);
    } else if (c.act === 'ms-search') {
        esrMsRenderList(c.key, c.ms);
    }
}

function esrOnKeyDown(e) {
    const c = esrEventCtx(e);
    if (!c || c.act !== 'ms-search') return;
    if (e.key === 'Enter') {
        e.preventDefault();
        esrMsAddTyped(c.key, c.ms);
    } else if (e.key === 'Escape') {
        esrMsClose(c.ms);
        c.ms.querySelector('.esr-ms-btn')?.focus();
    }
}

// Pasting a list (newline / tab / comma / semicolon separated) into a multi-select search box adds
// every value at once (free filters), or selects the matching options (Shift / Result filters).
function esrOnPaste(e) {
    const c = esrEventCtx(e);
    if (!c || c.act !== 'ms-search') return;
    const text = (e.clipboardData || window.clipboardData)?.getData('text') || '';
    if (!/[\r\n\t,;]/.test(text.trim())) return;   // single value: normal paste into the search box
    e.preventDefault();
    esrMsAddValues(c.key, c.ms, text.split(/[\r\n\t,;]+/));
    c.el.value = '';
    esrMsRenderList(c.key, c.ms);
}

// ---------- multi-select ----------
function esrMsToggle(key, ms) {
    if (ms.classList.contains('open')) { esrMsClose(ms); return; }
    document.querySelectorAll('.esr-ms.open').forEach(o => esrMsClose(o));
    ms.classList.add('open');
    ms.querySelector('.esr-ms-menu').hidden = false;
    const search = ms.querySelector('.esr-ms-search');
    search.value = '';
    esrMsRenderList(key, ms);
    search.focus();
}

function esrMsClose(ms) {
    ms.classList.remove('open');
    const menu = ms.querySelector('.esr-ms-menu');
    if (menu) menu.hidden = true;
}

// Typed text (Enter / "Add" button): free filters add it (comma-separated -> several values);
// fixed filters select the single option matching the search.
function esrMsAddTyped(key, ms) {
    const input = ms.querySelector('.esr-ms-search');
    const term = input.value.trim();
    if (!term) return;
    const f = esrFilterDef(key, ms.dataset.key);
    if (!f.free) {
        const shown = esrMsShown(key, ms.dataset.key, term);
        if (shown.length !== 1) return;
        esrMsAddValues(key, ms, shown);
    } else {
        esrMsAddValues(key, ms, term.split(/[,;]+/));
    }
    input.value = '';
    esrMsRenderList(key, ms);
}

function esrMsAddValues(key, ms, values) {
    const st = ESR_STATE[key];
    const fk = ms.dataset.key;
    const f = esrFilterDef(key, fk);
    const opts = st.options[fk] || [];
    const byUpper = new Map(opts.map(o => [o.toUpperCase(), o]));
    const sel = st.sel[fk] || (st.sel[fk] = []);
    values.map(v => String(v).trim()).filter(Boolean).forEach(v => {
        const canonical = byUpper.get(v.toUpperCase()) || (f.free ? v : null);
        if (canonical && !sel.includes(canonical)) sel.push(canonical);
    });
    esrMsUpdateBtn(key, ms);
}

function esrMsSelectShown(key, ms) {
    const term = ms.querySelector('.esr-ms-search').value.trim();
    esrMsAddValues(key, ms, esrMsShown(key, ms.dataset.key, term).slice(0, ESR_MS_LIMIT));
    esrMsRenderList(key, ms);
}

// Manual (selected but not in the option list) values first, then the options; filtered by term.
function esrMsAll(key, fk) {
    const st = ESR_STATE[key];
    const opts = st.options[fk] || [];
    const optSet = new Set(opts);
    const manual = (st.sel[fk] || []).filter(v => !optSet.has(v));
    return { all: [...manual, ...opts], manual: new Set(manual) };
}

function esrMsShown(key, fk, term) {
    const { all } = esrMsAll(key, fk);
    const t = String(term || '').trim().toUpperCase();
    return t ? all.filter(v => v.toUpperCase().includes(t)) : all;
}

function esrMsRenderList(key, ms) {
    const st = ESR_STATE[key];
    const fk = ms.dataset.key;
    const f = esrFilterDef(key, fk);
    const term = ms.querySelector('.esr-ms-search').value.trim();
    const { all, manual } = esrMsAll(key, fk);
    const shown = esrMsShown(key, fk, term);
    const sel = new Set(st.sel[fk] || []);
    const draw = shown.slice(0, ESR_MS_LIMIT);

    const list = ms.querySelector('.esr-ms-list');
    let html = draw.map(v => `<label class="esr-ms-opt">
            <input type="checkbox" data-esr-act="ms-check" value="${esrEsc(v)}"${sel.has(v) ? ' checked' : ''}>
            <span>${esrEsc(v)}</span>${manual.has(v) ? '<em>manual</em>' : ''}</label>`).join('');
    if (!draw.length) {
        html = `<div class="esr-ms-empty">${st.filtersLoading ? 'Loading values...' : (term ? 'No match' : 'No values for this range')}${f.free && term ? ' - press Enter to add it' : ''}</div>`;
    } else if (shown.length > draw.length) {
        html += `<div class="esr-ms-empty">Showing ${draw.length} of ${shown.length} - type to narrow</div>`;
    }
    list.innerHTML = html;

    const add = ms.querySelector('.esr-ms-add');
    const exists = all.some(v => v.toUpperCase() === term.toUpperCase());
    add.hidden = !(f.free && term && !exists);
    if (!add.hidden) add.textContent = `+ Add "${term.length > 24 ? term.slice(0, 24) + '...' : term}"`;
}

function esrMsUpdateBtn(key, ms) {
    const sel = ESR_STATE[key].sel[ms.dataset.key] || [];
    const text = ms.querySelector('.esr-ms-text');
    text.textContent = !sel.length ? 'ALL' : sel.length === 1 ? sel[0] : `${sel[0]} +${sel.length - 1}`;
    ms.title = sel.length ? sel.join(', ').slice(0, 500) : '';
    ms.classList.toggle('is-filtered', sel.length > 0);
    ms.classList.toggle('is-loading', ESR_STATE[key].filtersLoading);
}

function esrMsRefresh(key, ms) {
    esrMsUpdateBtn(key, ms);
    if (ms.classList.contains('open')) esrMsRenderList(key, ms);
}

function esrRenderAllMs(key) {
    const view = esrView(key);
    if (!view) return;
    view.querySelectorAll('.esr-ms').forEach(ms => esrMsRefresh(key, ms));
}

// ---------- data loading ----------
function esrDatesChanged(key) {
    const st = ESR_STATE[key];
    clearTimeout(st.dateTimer);
    st.dateTimer = setTimeout(() => esrLoadLookups(key), 400);
}

function esrChangeLine(key, line) {
    const st = ESR_STATE[key];
    st.line = line;
    st.sel = {};          // as the source's RefreshFilters: clear the selections, reload, re-run Overall
    esrRenderAllMs(key);
    esrLoadLookups(key, true);
    esrRun(key, 'OverAll');
}

// Filter lists + engine numbers for the current line / date range.
async function esrLoadLookups(key, force) {
    const st = ESR_STATE[key];
    const cfg = ESR_REPORTS[key];
    const range = esrRange(key);
    if (!range || range.from >= range.to) return;
    const qs = new URLSearchParams({ line: st.line, from: range.from.toISOString(), to: range.to.toISOString() }).toString();
    if (!force && qs === st.lookupKey) return;
    st.lookupKey = qs;

    const seq = ++st.filterSeq;
    st.filtersLoading = true;
    st.errors.filters = '';
    st.errors.engines = '';
    esrRenderAllMs(key);

    const [filters, engines] = await Promise.allSettled([
        esrFetchJson(`/api/reports/${cfg.api}/filters?${qs}`),
        esrFetchJson(`/api/reports/${cfg.api}/engine-numbers?${qs}`)
    ]);
    if (seq !== st.filterSeq) return;

    const options = {};
    if (filters.status === 'fulfilled') {
        const src = filters.value.filters || {};
        const byNorm = {};
        Object.keys(src).forEach(k => { byNorm[esrNormKey(k)] = src[k]; });
        cfg.filters.forEach(f => {
            const values = byNorm[esrNormKey(f.key)];
            if (Array.isArray(values)) options[f.key] = esrCleanList(values);
        });
        if (filters.value.beds && typeof filters.value.beds === 'object') st.beds = filters.value.beds;
        st.filterNotice = filters.value.notice || '';
    } else {
        st.errors.filters = `Filter lists: ${esrErrorText(filters.reason)}`;
    }
    if (engines.status === 'fulfilled') {
        const list = (engines.value.engineNumbers || []).map(e => (e && typeof e === 'object') ? (e.engineNumber ?? e.EngineNumber ?? e.ENGINE_NUMBER) : e);
        options.engineNumber = esrEngineOrder(esrCleanList(list, true));
    } else {
        st.errors.engines = `Engine numbers: ${esrErrorText(engines.reason)}`;
        if (options.engineNumber) options.engineNumber = esrEngineOrder(options.engineNumber);
    }

    st.options = options;
    st.filtersLoading = false;
    esrRenderAllMs(key);
    esrRenderMessages(key);
    if (cfg.pivot && st.ran) esrRenderTable(key);   // bed map may have arrived after the data
}

function esrCleanList(values, keepOrder) {
    const out = [...new Set(values.filter(v => v != null).map(v => String(v).trim()).filter(Boolean))];
    return keepOrder ? out : out.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

// "EMPTY PALLET" first, then the engine numbers in the API's order (latest first).
function esrEngineOrder(list) {
    const empty = list.filter(v => v.toUpperCase() === 'EMPTY PALLET');
    return [...empty, ...list.filter(v => v.toUpperCase() !== 'EMPTY PALLET')];
}

async function esrRun(key, mode) {
    const st = ESR_STATE[key];
    const cfg = ESR_REPORTS[key];
    mode = ESR_MODES[mode] ? mode : 'OverAll';
    const range = esrRange(key);
    if (!range) { st.errors.data = 'Please select From and To date/time.'; esrRenderMessages(key); return; }
    if (range.from >= range.to) { st.errors.data = 'From must be before To.'; esrRenderMessages(key); return; }

    st.mode = mode;
    st.ran = true;
    const seq = ++st.dataSeq;
    if (st.abort) st.abort.abort();
    const abort = st.abort = (typeof AbortController !== 'undefined') ? new AbortController() : null;

    const filters = {};
    cfg.filters.forEach(f => {
        const values = st.sel[f.key] || [];
        if (values.length) filters[f.key] = [...values];
    });
    const body = { line: st.line, mode, from: range.from.toISOString(), to: range.to.toISOString(), filters };

    st.loading = true;
    st.errors.data = '';
    esrRenderModes(key);
    esrRenderMessages(key);
    esrRenderLoading(key);
    const started = performance.now();

    try {
        const data = await esrFetchJson(`/api/reports/${cfg.api}/data`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: abort ? abort.signal : undefined
        });
        if (seq !== st.dataSeq) return;
        st.rows = (data.rows || []).map(r => esrNormRow(cfg, r));
        st.notice = data.notice || '';
    } catch (err) {
        if (seq !== st.dataSeq || (err && err.name === 'AbortError')) return;
        console.error(`Error fetching ${cfg.title}`, err);
        st.rows = [];
        st.notice = '';
        st.errors.data = `${cfg.title}: ${esrErrorText(err)}`;
    }
    st.durationMs = performance.now() - started;
    st.loading = false;
    st.page = 1;
    esrRender(key);
}

// Lower-case / no-underscore key lookup + pre-formatted display cells (used by table, search, Excel).
function esrNormRow(cfg, raw) {
    const n = {};
    Object.keys(raw || {}).forEach(k => { n[esrNormKey(k)] = raw[k]; });
    const cells = cfg.columns.map(c => {
        const v = n[esrNormKey(c.key)];
        if (v == null || v === '') return '-';
        return c.date ? esrFormatDate(v) : String(v);
    });
    return { n, cells, text: cells.join('\u0001').toLowerCase() };
}

function esrGet(row, key) {
    const v = row.n[esrNormKey(key)];
    return v == null ? '' : String(v).trim();
}

// ---------- rendering ----------
function esrRender(key) {
    esrRenderModes(key);
    esrRenderMessages(key);
    esrRenderLoading(key);
    esrRenderPie(key);
    esrRenderTable(key);
}

function esrRenderModes(key) {
    const st = ESR_STATE[key];
    const view = esrView(key);
    if (!view) return;
    view.querySelectorAll('.esr-mode-btn').forEach(b => b.classList.toggle('active', st.ran && b.dataset.mode === st.mode));
}

function esrRenderLoading(key) {
    const view = esrView(key);
    if (!view) return;
    view.querySelector('.esr-loading').hidden = !ESR_STATE[key].loading;
    view.querySelector('.esr-card').classList.toggle('is-loading', ESR_STATE[key].loading);
}

function esrRenderMessages(key) {
    const st = ESR_STATE[key];
    const view = esrView(key);
    if (!view) return;
    const errors = [st.errors.data, st.errors.filters, st.errors.engines].filter(Boolean);
    const alert = view.querySelector('.esr-alert');
    alert.hidden = !errors.length;
    alert.innerHTML = errors.map(e => `<div><span class="material-symbols-outlined">error</span>${esrEsc(e)}</div>`).join('');

    const notice = st.notice || st.filterNotice;
    const box = view.querySelector('.esr-notice');
    box.hidden = !notice;
    box.innerHTML = notice ? `<span class="material-symbols-outlined">warning</span><b>NOTE:</b> ${esrEsc(notice)}` : '';
}

function esrRenderPie(key) {
    const cfg = ESR_REPORTS[key];
    const st = ESR_STATE[key];
    const view = esrView(key);
    if (!cfg.pie || !view) return;

    // As the source: only the OK and the NOK / REJECTED values are counted; others are ignored.
    let ok = 0, nok = 0;
    st.rows.forEach(r => {
        const v = esrGet(r, cfg.pie.key).toUpperCase();
        if (v === cfg.pie.ok) ok++;
        else if (v === cfg.pie.nok) nok++;
    });
    const total = ok + nok;
    const styles = getComputedStyle(view);
    const okColor = styles.getPropertyValue('--esr-ok').trim() || '#22c55e';
    const nokColor = styles.getPropertyValue('--esr-nok').trim() || '#ef4444';

    view.querySelector('.esr-pie-empty').hidden = total > 0;
    const canvas = view.querySelector('.esr-pie');
    if (typeof Chart !== 'undefined' && canvas) {
        const data = total ? [ok, nok] : [];
        if (!st.chart) {
            st.chart = new Chart(canvas, {
                type: 'pie',
                data: { labels: [cfg.pie.ok, cfg.pie.nok], datasets: [{ data, backgroundColor: [okColor, nokColor], borderColor: esrSurfaceColor(), borderWidth: 2 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, animation: { duration: 600 } }
            });
        } else {
            st.chart.data.datasets[0].data = data;
            st.chart.data.datasets[0].borderColor = esrSurfaceColor();
            st.chart.update();
        }
    }
    const pct = n => total ? Math.round(n / total * 100) : 0;
    view.querySelector('.esr-pie-legend').innerHTML =
        `<span class="esr-ok"><i></i>${esrEsc(cfg.pie.ok)}<b>${ok.toLocaleString('en-IN')} (${pct(ok)}%)</b></span>` +
        `<span class="esr-nok"><i></i>${esrEsc(cfg.pie.nok)}<b>${nok.toLocaleString('en-IN')} (${pct(nok)}%)</b></span>`;
}

function esrBarInfo(key, count, unit) {
    const cfg = ESR_REPORTS[key];
    const st = ESR_STATE[key];
    if (!st.ran) return `<span>No search run yet</span>`;
    const time = st.durationMs != null ? `Time taken ${(st.durationMs / 1000).toFixed(1)} s` : '';
    const label = cfg.pivot ? `Engine Bed Wise Defect Report ${st.line}` : `${cfg.title} ${st.line} - ${ESR_MODES[st.mode]}`;
    return `<b>Total: ${count.toLocaleString('en-IN')}</b> ${unit}<span class="esr-sep">|</span>` +
        `<span class="esr-chip">${esrEsc(label)}${time ? ' | ' + time : ''}</span>`;
}

function esrRenderTable(key) {
    if (ESR_REPORTS[key].pivot) { esrRenderPivot(key); return; }
    const cfg = ESR_REPORTS[key];
    const st = ESR_STATE[key];
    const view = esrView(key);
    if (!view) return;

    const term = st.search.trim().toLowerCase();
    const rows = term ? st.rows.filter(r => r.text.includes(term)) : st.rows;
    view.querySelector('.esr-bar-info').innerHTML = esrBarInfo(key, rows.length, 'records');

    const table = view.querySelector('.esr-table');
    const empty = view.querySelector('.esr-empty');
    if (!rows.length) {
        table.innerHTML = '';
        empty.hidden = st.loading;
        empty.querySelector('.esr-empty-text').textContent = !st.ran ? '' : st.errors.data ? 'No data - see the message above'
            : term ? 'No records match your search' : `No ${cfg.title.toLowerCase()} data for the selected filters`;
        esrRenderPager(key, 0, 0);
        return;
    }
    empty.hidden = true;
    const pages = Math.max(1, Math.ceil(rows.length / st.pageSize));
    st.page = Math.min(Math.max(st.page, 1), pages);
    const start = (st.page - 1) * st.pageSize;
    const pageRows = rows.slice(start, start + st.pageSize);

    table.innerHTML = `<thead><tr><th class="esr-num">S.NO</th>${cfg.columns.map(c => `<th>${esrEsc(c.label)}</th>`).join('')}</tr></thead><tbody>` +
        pageRows.map((r, i) => `<tr><td class="esr-num">${start + i + 1}</td>` +
            r.cells.map(v => `<td title="${esrEsc(v)}">${esrEsc(v)}</td>`).join('') + '</tr>').join('') +
        '</tbody>';
    esrRenderPager(key, rows.length, pages, start, start + pageRows.length);
}

// Bed map from /filters (M_1 -> TB-01 ...); without it the bed values found in the data are used as is.
function esrBedColumns(key) {
    const st = ESR_STATE[key];
    if (st.beds && Object.keys(st.beds).length) {
        return Object.entries(st.beds).map(([code, label]) => ({ code, label: String(label) }))
            .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
    }
    const codes = esrCleanList(st.rows.map(r => esrGet(r, 'bedNo')));
    return codes.map(code => ({ code, label: code }));
}

function esrPivot(key) {
    const st = ESR_STATE[key];
    const beds = esrBedColumns(key);
    const index = new Map(beds.map((b, i) => [b.code.toUpperCase(), i]));
    const counts = new Map();
    st.rows.forEach(r => {
        const bi = index.get(esrGet(r, 'bedNo').toUpperCase());
        if (bi === undefined) return;   // beds outside the map (e.g. M_8) are left out, as the source
        const defect = esrGet(r, 'defectDetails') || '(Blank)';
        if (!counts.has(defect)) counts.set(defect, new Array(beds.length).fill(0));
        counts.get(defect)[bi]++;
    });
    const defects = [...counts.keys()].sort((a, b) => a.localeCompare(b));
    const totals = beds.map((_, i) => defects.reduce((s, d) => s + counts.get(d)[i], 0));
    return { beds, defects, counts, totals };
}

function esrRenderPivot(key) {
    const st = ESR_STATE[key];
    const view = esrView(key);
    if (!view) return;
    const { beds, defects, counts, totals } = esrPivot(key);
    const term = st.search.trim().toLowerCase();
    const shown = term ? defects.filter(d => d.toLowerCase().includes(term)) : defects;
    view.querySelector('.esr-bar-info').innerHTML = esrBarInfo(key, shown.length, 'defect types');

    const table = view.querySelector('.esr-table');
    const empty = view.querySelector('.esr-empty');
    if (!shown.length) {
        table.innerHTML = '';
        empty.hidden = st.loading;
        empty.querySelector('.esr-empty-text').textContent = !st.ran ? '' : st.errors.data ? 'No data - see the message above'
            : term ? 'No defects match your search' : 'No Engine Test Bed data for the selected filters';
        esrRenderPager(key, 0, 0);
        return;
    }
    empty.hidden = true;
    const pages = Math.max(1, Math.ceil(shown.length / st.pageSize));
    st.page = Math.min(Math.max(st.page, 1), pages);
    const start = (st.page - 1) * st.pageSize;
    const pageDefects = shown.slice(start, start + st.pageSize);

    // The Total row covers every defect (not just this page / search) and shows on every page.
    table.innerHTML = `<thead><tr><th class="esr-pivot-first">DEFECT DETAILS</th>${beds.map(b => `<th class="esr-c">${esrEsc(b.label)}</th>`).join('')}</tr></thead><tbody>` +
        pageDefects.map(d => `<tr><td class="esr-pivot-first" title="${esrEsc(d)}">${esrEsc(d)}</td>` +
            counts.get(d).map(n => `<td class="esr-c${n ? '' : ' esr-zero'}">${n}</td>`).join('') + '</tr>').join('') +
        `<tr class="esr-total"><td class="esr-pivot-first">Total</td>${totals.map(n => `<td class="esr-c">${n}</td>`).join('')}</tr></tbody>`;
    esrRenderPager(key, shown.length, pages, start, start + pageDefects.length, 'defect types');
}

function esrRenderPager(key, total, pages, start = 0, end = 0, unit = 'records') {
    const st = ESR_STATE[key];
    const pager = esrView(key)?.querySelector('.esr-pager');
    if (!pager) return;
    pager.hidden = !total;
    if (!total) { pager.innerHTML = ''; return; }
    const first = st.page <= 1, last = st.page >= pages;
    pager.innerHTML = `
        <span class="esr-pager-info">Showing ${(start + 1).toLocaleString('en-IN')}-${end.toLocaleString('en-IN')} of <b>${total.toLocaleString('en-IN')}</b> ${unit}</span>
        <div class="esr-pager-btns">
            <button type="button" class="esr-btn" data-esr-act="page" data-page="first"${first ? ' disabled' : ''}>First</button>
            <button type="button" class="esr-btn" data-esr-act="page" data-page="prev"${first ? ' disabled' : ''}>Previous</button>
            <span>Page <b>${st.page}</b> of <b>${pages}</b></span>
            <button type="button" class="esr-btn" data-esr-act="page" data-page="next"${last ? ' disabled' : ''}>Next</button>
            <button type="button" class="esr-btn" data-esr-act="page" data-page="last"${last ? ' disabled' : ''}>Last</button>
        </div>`;
}

function esrGoPage(key, where) {
    const st = ESR_STATE[key];
    if (where === 'first') st.page = 1;
    else if (where === 'prev') st.page--;
    else if (where === 'next') st.page++;
    else if (where === 'last') st.page = Number.MAX_SAFE_INTEGER;   // clamped by the renderer
    esrRenderTable(key);
    const wrap = esrView(key)?.querySelector('.esr-table-wrap');
    if (wrap) wrap.scrollTop = 0;
}

// Clear Filters: drops every multi-select selection and the table search (as the source's clearFilters);
// the dates stay. Run a mode button afterwards.
function esrClear(key) {
    const st = ESR_STATE[key];
    st.sel = {};
    st.search = '';
    st.page = 1;
    const view = esrView(key);
    if (view) view.querySelector('.esr-search').value = '';
    esrRenderAllMs(key);
    esrRenderTable(key);
}

// ---------- Excel (ExcelJS, rejection-summary layout: title, filters, header on row 5) ----------
async function esrExport(key) {
    const cfg = ESR_REPORTS[key];
    const st = ESR_STATE[key];
    if (!st.rows.length) {
        st.errors.data = 'No data to export - run a search first.';
        esrRenderMessages(key);
        return;
    }
    if (typeof ExcelJS === 'undefined') { alert('Excel library not loaded'); return; }
    try {
        let headers, body, sheetName, widths;
        if (cfg.pivot) {
            const { beds, defects, counts, totals } = esrPivot(key);
            headers = ['DEFECT DETAILS', ...beds.map(b => b.label)];
            body = defects.map(d => [d, ...counts.get(d)]);
            body.push(['Total', ...totals]);
            sheetName = cfg.sheet;
            widths = [40, ...beds.map(() => 12)];
        } else {
            headers = ['S.NO', ...cfg.columns.map(c => c.label)];
            body = st.rows.map((r, i) => [i + 1, ...r.cells]);
            sheetName = `${cfg.sheet}_${st.mode}`;
            widths = [7, ...cfg.columns.map(c => c.date ? 20 : 18)];
        }

        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet(esrSheetName(sheetName));
        const lastCol = headers.length;
        const border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        const yellow = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0C300' } };

        sheet.mergeCells(1, 1, 1, lastCol);
        sheet.getCell(1, 1).value = `${st.line} ${cfg.title.toUpperCase()}${cfg.pivot ? '' : ' - ' + ESR_MODES[st.mode].toUpperCase()}`;
        sheet.getCell(1, 1).font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFD71920' } };

        const range = esrRange(key);
        const fmt = d => d ? esrFormatDate(d) : '';
        const filterText = cfg.filters.filter(f => (st.sel[f.key] || []).length).map(f => {
            const v = st.sel[f.key];
            return `${f.label}: ${v.slice(0, 20).join(', ')}${v.length > 20 ? ` (+${v.length - 20} more)` : ''}`;
        });
        sheet.mergeCells(2, 1, 2, lastCol);
        sheet.getCell(2, 1).value = [`From: ${fmt(range?.from)}`, `To: ${fmt(range?.to)}`, ...filterText].join('   |   ').slice(0, 30000);
        sheet.getCell(2, 1).font = { italic: true, size: 10 };
        sheet.getCell(3, 1).value = `Exported on: ${esrFormatDate(new Date())}`;

        const header = sheet.getRow(5);
        headers.forEach((h, i) => {
            const cell = header.getCell(i + 1);
            cell.value = h;
            cell.font = { bold: true };
            cell.fill = yellow;
            cell.border = border;
        });
        const withBorders = body.length <= 20000;   // per-cell styling is slow on very large exports
        body.forEach((values, ri) => {
            const row = sheet.getRow(6 + ri);
            values.forEach((v, ci) => {
                const cell = row.getCell(ci + 1);
                cell.value = v;
                if (withBorders) cell.border = border;
            });
        });
        if (cfg.pivot) {
            const totalRow = sheet.getRow(5 + body.length);
            for (let c = 1; c <= lastCol; c++) { totalRow.getCell(c).font = { bold: true }; totalRow.getCell(c).fill = yellow; }
        }
        widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
        sheet.views = [{ state: 'frozen', ySplit: 5, xSplit: cfg.pivot ? 1 : 0 }];
        sheet.autoFilter = { from: { row: 5, column: 1 }, to: { row: 5, column: lastCol } };

        const fileMode = cfg.pivot ? 'OverAll' : st.mode;
        await downloadWorkbook(workbook, `${cfg.fileStem}_${st.line}_${fileMode}_${esrStamp()}.xlsx`);
    } catch (err) {
        console.error('Error generating excel:', err);
        alert('Error generating Excel file');
    }
}
