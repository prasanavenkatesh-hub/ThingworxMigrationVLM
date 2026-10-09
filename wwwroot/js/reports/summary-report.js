// --- SUMMARY REPORT (EA01 / EA02 - Leak, PDI, Testing) ---
// Web port of the EA-1 / EA-2 Summary Report Power BI files. Data comes from
// dbo.usp_GetSummaryReportLeak / PDI / Testing (the line picks the connection) through
// GET /api/reports/summary/data. The procs return Power BI's grouped tables - every quantity is
// COUNT(DISTINCT engine) inside its group - and, like the DAX measures, this page sums groups.
// Total = OK + NOK only; Bypassed / NA / Empty appear only in the Leak status panel.
// Unlike the station-button reports, filters apply on change and are kept in the URL.

const SR_LINES = ['EA01', 'EA02'];
const SR_STAGES = ['Leak', 'PDI', 'Testing'];
const SR_SHIFTS = ['A', 'B', 'C'];
const SR_SHIFT_LABELS = { A: 'A (00:15 - 07:15)', B: 'B (07:15 - 15:45)', C: 'C (15:45 - 00:15)' };
const SR_STAGE_LABELS = {
    Leak: { EA01: 'Leak test · ML-47', EA02: 'Leak test · ML-47' },
    PDI: { EA01: 'Pre-delivery inspection', EA02: 'Pre-delivery inspection · ML-52' },
    Testing: { EA01: 'Engine testing · test beds', EA02: 'Engine testing · test beds' }
};
const SR_REFRESH_MS = 60 * 1000;
const SR_ROTATE_MS = 30 * 1000;
const SR_MAX_DAYS = 93;   // same limit as the API

// 27 hour buckets in production order. They split at the 00:15 day change and the 07:15 / 15:45
// shift changes exactly like the Power BI Hourwise SQL ('07:00' = 07:00-07:15, '24:00' = 00:00-00:15).
const SR_HOURS = (() => {
    const pad = h => String(h).padStart(2, '0');
    const keys = ['00:15'];
    for (let h = 1; h <= 7; h++) keys.push(`${pad(h)}:00`);
    keys.push('07:15');
    for (let h = 8; h <= 15; h++) keys.push(`${pad(h)}:00`);
    keys.push('15:45');
    for (let h = 16; h <= 24; h++) keys.push(`${pad(h)}:00`);
    const minutes = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
    return keys.map((key, i) => {
        const from = key === '24:00' ? '00:00' : key;
        const to = key === '24:00' ? '00:15' : keys[i + 1];
        return {
            key,
            label: `${from} - ${to}`,
            shift: i <= 7 ? 'A' : i <= 16 ? 'B' : 'C',
            minutes: minutes(to) - minutes(from)
        };
    });
})();

const srState = {
    line: 'EA01',            // 'EA01' | 'EA02' | 'BOTH'
    stage: 'Leak',
    start: '',               // production days, yyyy-mm-dd, inclusive
    end: '',
    shift: '',
    models: [],
    machine: '',
    basis: 'latest',         // PDI / Testing: 'latest' | 'all'
    trend: 'day',            // 'day' | 'shift' | 'hour'
    matrixMetric: 'count',   // 'count' | 'ppm' | 'pct'
    hourMetric: 'count'
};
// Filter controls edit srDraft; clicking Leak / PDI / Testing copies it into srState and loads
// (same flow as the Categorywise Rework report). View toggles (Day/Shift/Hour, metrics) apply at once.
const SR_FILTER_KEYS = ['line', 'start', 'end', 'shift', 'models', 'machine', 'basis'];
const srDraft = {};
const srCopyFilters = src => Object.fromEntries(SR_FILTER_KEYS.map(k => [k, Array.isArray(src[k]) ? [...src[k]] : src[k]]));
const srCache = new Map();  // `${source}|${line}|${stage}|${start}|${end}` -> { data, at }
let srSample = false;        // preview with generated data until the stored procedures exist
let srFetchSeq = 0;          // only the latest request may render (stage/line switch mid-load)
let srInitialised = false;
let srAutoRefresh = false;
let srRefreshTimer = null;
let srRotateTimer = null;
let srCharts = { trend: null, ppm: null, status: null, donuts: [] };
let srLastModels = [];       // last rendered per-line view models, reused by the Excel export

// ---- Dates ----
function srIso(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function srParse(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return new Date(y, m - 1, d);
}

function srAddDays(iso, n) {
    const d = srParse(iso);
    d.setDate(d.getDate() + n);
    return srIso(d);
}

// Production day now: anything up to 00:15 still belongs to yesterday.
function srProdToday() {
    const now = new Date();
    const cut = new Date(now);
    cut.setHours(0, 15, 0, 0);
    return srIso(now <= cut ? new Date(now.getTime() - 24 * 60 * 60 * 1000) : now);
}

function srDays(start = srState.start, end = srState.end) {
    const days = [];
    for (let d = start; d && d <= end && days.length <= SR_MAX_DAYS; d = srAddDays(d, 1)) days.push(d);
    return days;
}

function srDayLabel(iso) {
    return srParse(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

function srRangeLabel(start = srState.start, end = srState.end) {
    const fmt = iso => srParse(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
    return start === end ? fmt(start) : `${fmt(start)} - ${fmt(end)}`;
}

function srPresetRange(preset) {
    const today = srProdToday();
    const t = srParse(today);
    if (preset === 'today') return { start: today, end: today };
    if (preset === 'yesterday') { const y = srAddDays(today, -1); return { start: y, end: y }; }
    if (preset === 'lastMonth') {
        return { start: srIso(new Date(t.getFullYear(), t.getMonth() - 1, 1)), end: srIso(new Date(t.getFullYear(), t.getMonth(), 0)) };
    }
    return { start: srIso(new Date(t.getFullYear(), t.getMonth(), 1)), end: today };   // 'month'
}

// Same number of days, immediately before the selected range (for KPI deltas).
function srPrevRange() {
    const n = srDays().length;
    const end = srAddDays(srState.start, -1);
    return { start: srAddDays(end, -(n - 1)), end };
}

// ---- Numbers ----
const srFmt = n => Math.round(n || 0).toLocaleString('en-IN');
const srFmtPct = v => `${(v || 0).toFixed(2)}%`;
const srFmtPpm = v => Math.round(v || 0).toLocaleString('en-IN');

function srEmptySum() {
    return { ok: 0, nok: 0, byp: 0, na: 0, empty: 0, actual: 0, rework: 0 };
}

function srAdd(sum, r) {
    sum.ok += r.okQty || r.ok || 0;
    sum.nok += r.nokQty || r.nok || 0;
    sum.byp += r.bypassedQty || r.byp || 0;
    sum.na += r.naQty || r.na || 0;
    sum.empty += r.emptyQty || r.empty || 0;
    sum.actual += r.actualQty || r.actual || 0;
    sum.rework += r.reworkQty || r.rework || 0;
    return sum;
}

function srMerge(sums) {
    return sums.filter(Boolean).reduce((acc, s) => srAdd(acc, s), srEmptySum());
}

// KPI formulas (spec 2.7). Percentages are 0-100 for both lines (EA1's Power BI used 0-1).
function srM(sum) {
    const s = sum || srEmptySum();
    const total = s.ok + s.nok;
    return {
        ...s,
        total,
        ppm: total ? (s.nok / total) * 1e6 : 0,
        rej: total ? (s.nok / total) * 100 : 0,
        pass: total ? (s.ok / total) * 100 : 0
    };
}

function srGroup(rows, keyFn) {
    const groups = new Map();
    rows.forEach(r => {
        const key = keyFn(r);
        if (!groups.has(key)) groups.set(key, srEmptySum());
        srAdd(groups.get(key), r);
    });
    return groups;
}

const srDay = r => String(r.productionDate || '').slice(0, 10);

function srLines() {
    return srState.line === 'BOTH' ? SR_LINES : [srState.line];
}

function srColors() {
    const style = getComputedStyle(document.getElementById('tab-summary-report'));
    const v = name => style.getPropertyValue(name).trim();
    const light = document.body.classList.contains('light-mode');
    return {
        ok: v('--sr-ok'), nok: v('--sr-nok'), byp: v('--sr-byp'), na: v('--sr-na'), empty: v('--sr-empty'),
        lines: { EA01: v('--sr-line-1'), EA02: v('--sr-line-2') },
        surface: light ? '#ffffff' : '#121212',
        text: light ? '#1d1d1f' : '#e5e5e5',
        muted: light ? '#6b6b70' : '#9ca3af',
        grid: light ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)'
    };
}

function srLineTag(line) {
    return `<span class="sr-line-tag" style="background: var(${line === 'EA01' ? '--sr-line-1' : '--sr-line-2'});">${line}</span>`;
}

// ---- Data ----
function srCacheKey(line, stage, start, end) {
    return `${srSample ? 'sample' : 'live'}|${line}|${stage}|${start}|${end}`;
}

function srData(line, start = srState.start, end = srState.end) {
    return srCache.get(srCacheKey(line, srState.stage, start, end))?.data || null;
}

async function srFetch(line, stage, start, end, force) {
    const key = srCacheKey(line, stage, start, end);
    const hit = srCache.get(key);
    if (hit && !force && Date.now() - hit.at < SR_REFRESH_MS) return hit.data;

    let data;
    if (srSample) {
        data = srSampleData(line, stage, start, end);
    } else {
        const params = new URLSearchParams({ line, stage, startDate: start, endDate: end });
        const res = await fetch(`/api/reports/summary/data?${params.toString()}`);
        if (!res.ok) {
            const detail = res.status === 400 || res.status === 503 ? (await res.text()).slice(0, 200) : `server error ${res.status}`;
            throw new Error(`${line} ${stage}: ${detail}`);
        }
        data = await res.json();
    }
    ['daily', 'status', 'hourly', 'latest', 'range', 'rework'].forEach(k => { data[k] = data[k] || []; });
    // EA01 PDI has no model column; the model filter must not blank it out.
    data.hasModels = [...data.daily, ...data.range].some(r => r.modelCode);

    srCache.set(key, { data, at: Date.now() });
    srCache.forEach((v, k) => { if (Date.now() - v.at > 10 * SR_REFRESH_MS) srCache.delete(k); });
    return data;
}

function srPass(row, data, useMachine = true) {
    if (srState.shift && row.shift && row.shift !== srState.shift) return false;
    if (srState.models.length && data.hasModels && !srState.models.includes(row.modelCode || '')) return false;
    if (useMachine && srState.stage === 'Leak' && srState.machine && row.machine !== srState.machine) return false;
    return true;
}

// Everything one line contributes to the page, with the current filters applied.
function srBuild(line, data) {
    const stage = srState.stage;
    const daily = (stage === 'Leak' || srState.basis === 'all' ? data.daily : data.latest).filter(r => srPass(r, data));
    const hourly = data.hourly.filter(r => srPass(r, data));

    // KPI cards: Power BI used the Monthly tables (distinct engines over the period) for PDI /
    // Testing. Those have no shift, so with a shift selected fall back to the daily sums.
    let kpiRows = daily;
    let kpiBasis = stage === 'Leak' ? 'leak' : srState.basis === 'all' ? 'all' : 'daily';
    if (stage !== 'Leak' && srState.basis === 'latest' && !srState.shift && data.range.length) {
        kpiRows = data.range.filter(r => srPass(r, data));
        kpiBasis = 'range';
    }

    const model = {
        line,
        data,
        daily,
        hourly,
        kpi: srM(srMerge(kpiRows)),
        kpiBasis,
        all: srMerge(daily),
        byDay: srGroup(daily, srDay),
        byShift: srGroup(daily, r => r.shift),
        byDayShift: srGroup(daily, r => `${srDay(r)}|${r.shift}`),
        byHour: srGroup(hourly, r => r.hourBucket),
        byDayHour: srGroup(hourly, r => `${srDay(r)}|${r.hourBucket}`),
        statusByDay: srGroup(data.status.filter(r => srPass(r, data)), srDay)
    };

    if (stage === 'Leak') {
        // Rework total = Leak OK + Rework qty. Rework rows have no machine, so neither side uses it.
        const leakOk = srGroup(data.daily.filter(r => srPass(r, data, false)), srDay);
        const rework = srGroup(data.rework.filter(r => srPass(r, data, false)), srDay);
        model.reworkByDay = new Map();
        new Set([...leakOk.keys(), ...rework.keys()]).forEach(day => {
            model.reworkByDay.set(day, { ok: leakOk.get(day)?.ok || 0, rework: rework.get(day)?.rework || 0 });
        });
    }
    return model;
}

const SR_BASIS_NOTES = {
    leak: 'Sum of daily distinct engines',
    range: 'Distinct engines per month (Power BI monthly table)',
    daily: 'Sum of daily latest results',
    all: 'All attempts · a retested engine can count as OK and NOK'
};

// In "Both" mode the lines can differ (EA02 has no monthly table), so name each line's basis.
function srBasisNote(models) {
    const bases = [...new Set(models.map(m => m.kpiBasis))];
    return bases.length === 1 ? SR_BASIS_NOTES[bases[0]]
        : models.map(m => `${m.line}: ${SR_BASIS_NOTES[m.kpiBasis]}`).join(' · ');
}

// ---- Lifecycle ----
function loadSrDefaultView() {
    if (!srInitialised) initSr();
    srStartTimers();
    srWriteUrl();
    loadSr();
}

function leaveSrTab() {
    if (!srInitialised) return;
    if (document.body.classList.contains('sr-kiosk')) toggleSrKiosk(false);
    clearInterval(srRefreshTimer);
    srRefreshTimer = null;
    const url = new URL(window.location.href);
    if (url.searchParams.get('report') === 'summary') {
        history.replaceState(null, '', url.pathname);
    }
}

function initSr() {
    srInitialised = true;
    const range = srPresetRange('month');
    srState.start = range.start;
    srState.end = range.end;
    srReadUrl();
    Object.assign(srDraft, srCopyFilters(srState));
    try { srAutoRefresh = localStorage.getItem('srAutoRefresh') === '1'; } catch (e) { srAutoRefresh = false; }

    if (typeof flatpickr !== 'undefined') {
        const config = { dateFormat: 'Y-m-d', altInput: true, altFormat: 'd M Y', allowInput: false };
        flatpickr(document.getElementById('srStart'), {
            ...config, defaultDate: srDraft.start,
            onChange: (dates, str) => { if (str) srSetRange(str, srDraft.end < str ? str : srDraft.end); }
        });
        flatpickr(document.getElementById('srEnd'), {
            ...config, defaultDate: srDraft.end,
            onChange: (dates, str) => { if (str) srSetRange(srDraft.start > str ? str : srDraft.start, str); }
        });
    } else {
        // No date picker library: plain date inputs still work.
        ['srStart', 'srEnd'].forEach(id => {
            const input = document.getElementById(id);
            input.type = 'date';
            input.addEventListener('change', () => {
                const s = document.getElementById('srStart').value, e = document.getElementById('srEnd').value;
                if (s && e) srSetRange(s <= e ? s : e, s <= e ? e : s);
            });
        });
    }

    document.addEventListener('click', e => {
        const multi = document.getElementById('srModel');
        if (multi && !multi.contains(e.target)) document.getElementById('srModelMenu').hidden = true;
    });
    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && document.body.classList.contains('sr-kiosk')) toggleSrKiosk(false);
    });
    document.addEventListener('fullscreenchange', () => {
        if (!document.fullscreenElement && document.body.classList.contains('sr-kiosk')) toggleSrKiosk(false);
    });
    srSyncControls();
}

function srReadUrl() {
    const p = new URLSearchParams(window.location.search);
    if (p.get('report') !== 'summary') return;
    const iso = /^\d{4}-\d{2}-\d{2}$/;
    if (['EA01', 'EA02', 'BOTH'].includes(p.get('line'))) srState.line = p.get('line');
    if (SR_STAGES.includes(p.get('stage'))) srState.stage = p.get('stage');
    if (iso.test(p.get('from') || '') && iso.test(p.get('to') || '') && p.get('from') <= p.get('to')) {
        srState.start = p.get('from');
        srState.end = p.get('to');
    }
    if (SR_SHIFTS.includes(p.get('shift'))) srState.shift = p.get('shift');
    if (['M1', 'M2'].includes(p.get('machine'))) srState.machine = p.get('machine');
    if (p.get('basis') === 'all') srState.basis = 'all';
    if (p.get('models')) srState.models = p.get('models').split(',').filter(Boolean);
    if (p.get('sample') === '1') srSample = true;
}

function srWriteUrl() {
    if (!document.getElementById('tab-summary-report')?.classList.contains('active')) return;
    const p = new URLSearchParams({ report: 'summary', line: srState.line, stage: srState.stage, from: srState.start, to: srState.end });
    if (srState.shift) p.set('shift', srState.shift);
    if (srState.models.length) p.set('models', srState.models.join(','));
    if (srState.machine) p.set('machine', srState.machine);
    if (srState.basis !== 'latest') p.set('basis', srState.basis);
    history.replaceState(null, '', `${window.location.pathname}?${p.toString()}`);
}

// Filter controls show srDraft (what the next stage click will apply); the stage buttons, view
// toggles and panels show srState (what is on screen).
function srSyncControls() {
    const setSeg = (id, value) => document.querySelectorAll(`#${id} button`).forEach(b => b.classList.toggle('active', b.dataset.value === value));
    setSeg('srLineSeg', srDraft.line);
    setSeg('srBasisSeg', srDraft.basis);
    setSeg('srTrendSeg', srState.trend);
    setSeg('srMatrixSeg', srState.matrixMetric);
    setSeg('srHourSeg', srState.hourMetric);
    const preset = ['today', 'yesterday', 'month', 'lastMonth'].find(k => {
        const r = srPresetRange(k);
        return r.start === srDraft.start && r.end === srDraft.end;
    });
    setSeg('srPresetSeg', preset || '');

    document.querySelectorAll('#srStages .sr-stage').forEach(b => {
        b.classList.toggle('active', b.dataset.stage === srState.stage);
    });

    const shift = document.getElementById('srShift');
    const machine = document.getElementById('srMachine');
    shift.value = srDraft.shift;
    machine.value = srDraft.machine;
    shift.closest('.sr-field').classList.toggle('is-filtered', !!srDraft.shift);
    machine.closest('.sr-field').classList.toggle('is-filtered', !!srDraft.machine);
    document.getElementById('srLeakPanels').hidden = srState.stage !== 'Leak';
    document.getElementById('srAutoRefresh').checked = srAutoRefresh;

    const startInput = document.getElementById('srStart');
    const endInput = document.getElementById('srEnd');
    if (startInput._flatpickr) startInput._flatpickr.setDate(srDraft.start, false); else startInput.value = srDraft.start;
    if (endInput._flatpickr) endInput._flatpickr.setDate(srDraft.end, false); else endInput.value = srDraft.end;

    // Unapplied filter changes: prompt for a stage click.
    const pending = JSON.stringify(srCopyFilters(srDraft)) !== JSON.stringify(srCopyFilters(srState));
    document.getElementById('srPending').hidden = !pending;
    document.getElementById('srStages').classList.toggle('is-pending', pending);
    renderSrModelLabel(srLastModels);
}

function srNotice(kind, html) {
    const el = document.getElementById('srNotice');
    if (!el) return;
    if (!kind) { el.hidden = true; el.innerHTML = ''; return; }
    const icon = { loading: 'progress_activity', error: 'error', sample: 'science' }[kind];
    el.className = `sr-notice is-${kind}`;
    el.innerHTML = `<span class="material-symbols-outlined">${icon}</span><span>${html}</span>`;
    el.hidden = false;
}

async function loadSr(force = false) {
    if (!srState.start || !srState.end) return;
    if (srDays().length > SR_MAX_DAYS) {
        srNotice('error', `Please choose ${SR_MAX_DAYS} days or fewer.`);
        return;
    }

    const seq = ++srFetchSeq;
    const lines = srLines();
    const stage = srState.stage;
    const { start, end } = srState;
    const hasData = lines.every(l => srData(l));
    if (!hasData) srNotice('loading', `Loading ${stage} data for ${lines.join(' + ')}...`);

    const results = await Promise.allSettled(lines.map(l => srFetch(l, stage, start, end, force)));
    if (seq !== srFetchSeq) return;

    const errors = results.filter(r => r.status === 'rejected').map(r => r.reason?.message || 'request failed');
    if (errors.length) {
        console.error('Summary report load failed', errors);
        srNotice('error', `Could not load ${cwrEsc(errors.join(' · '))}. If the stored procedures are not created yet, you can
            <button class="sr-btn" onclick="setSrSample(true)"><span class="material-symbols-outlined">science</span>Preview with sample data</button>`);
    } else if (srSample) {
        srNotice('sample', `<b>Sample data</b> - generated in the browser to preview the layout, not read from the database.
            <button class="sr-btn" onclick="setSrSample(false)"><span class="material-symbols-outlined">database</span>Use live data</button>`);
    } else {
        srNotice(null);
    }
    renderSr();

    // Previous period only feeds the KPI deltas, so it loads after the page is already drawn.
    if (errors.length) return;
    const prev = srPrevRange();
    await Promise.allSettled(lines.map(l => srFetch(l, stage, prev.start, prev.end, false)));
    if (seq !== srFetchSeq) return;
    renderSrKpis(srLastModels);
}

function refreshSr() {
    loadSr(true);
}

function srStartTimers() {
    clearInterval(srRefreshTimer);
    srRefreshTimer = null;
    if (srAutoRefresh || document.body.classList.contains('sr-kiosk')) {
        srRefreshTimer = setInterval(() => loadSr(true), SR_REFRESH_MS);
    }
}

// ---- Control handlers ----
// Stage buttons are the "apply" action: they take every pending filter, then load that stage.
function setSrStage(stage) {
    Object.assign(srState, srCopyFilters(srDraft), { stage });
    srSyncControls();
    srWriteUrl();
    renderSr();          // shows cached data at once when available
    loadSr();
}

// Filter controls only change the draft until a stage button is clicked.
function srSetDraft(changes) {
    Object.assign(srDraft, changes);
    srSyncControls();
}

function setSrLine(line) { srSetDraft({ line }); }
function srSetRange(start, end) { srSetDraft({ start, end }); }
function setSrPreset(preset) { srSetDraft(srPresetRange(preset)); }
function setSrFilter(key, value) { srSetDraft({ [key]: value }); }

function setSrTrend(mode) { srState.trend = mode; srSyncControls(); renderSr(); }
function setSrMatrixMetric(metric) { srState.matrixMetric = metric; srSyncControls(); renderSr(); }
function setSrHourMetric(metric) { srState.hourMetric = metric; srSyncControls(); renderSr(); }

function setSrAutoRefresh(on) {
    srAutoRefresh = on;
    try { localStorage.setItem('srAutoRefresh', on ? '1' : '0'); } catch (e) { /* storage blocked */ }
    srStartTimers();
}

function setSrSample(on) {
    srSample = on;
    loadSr(true);
}

// Clear resets the filters (keeping the line) and reloads the current stage, like the Rework report.
function clearSrFilters() {
    const r = srPresetRange('month');
    Object.assign(srDraft, { start: r.start, end: r.end, shift: '', models: [], machine: '', basis: 'latest' });
    setSrStage(srState.stage);
}

function toggleSrKiosk(force) {
    const on = typeof force === 'boolean' ? force : !document.body.classList.contains('sr-kiosk');
    document.body.classList.toggle('sr-kiosk', on);
    const progress = document.getElementById('srKioskProgress');
    clearInterval(srRotateTimer);
    srRotateTimer = null;
    if (on) {
        document.documentElement.requestFullscreen?.().catch(() => { /* not allowed - kiosk still works */ });
        progress.style.setProperty('--sr-rotate', `${SR_ROTATE_MS / 1000}s`);
        progress.hidden = false;
        srRotateTimer = setInterval(() => {
            setSrStage(SR_STAGES[(SR_STAGES.indexOf(srState.stage) + 1) % SR_STAGES.length]);
        }, SR_ROTATE_MS);
    } else {
        progress.hidden = true;
        if (document.fullscreenElement) document.exitFullscreen?.().catch(() => { });
    }
    srStartTimers();
    setTimeout(renderSr, 60);   // charts re-measure after the layout change
}

// ---- Model multi-select ----
function srModelOptions() {
    const models = new Set(srDraft.models);
    srLines().forEach(line => {
        const d = srData(line);
        if (d) [...d.daily, ...d.range, ...d.rework].forEach(r => { if (r.modelCode) models.add(r.modelCode); });
    });
    return [...models].sort((a, b) => a.localeCompare(b));
}

function toggleSrModelMenu() {
    const menu = document.getElementById('srModelMenu');
    menu.hidden = !menu.hidden;
    if (!menu.hidden) {
        renderSrModelOptions();
        document.getElementById('srModelSearch').focus();
    }
}

function renderSrModelOptions() {
    const list = document.getElementById('srModelList');
    const term = (document.getElementById('srModelSearch').value || '').trim().toUpperCase();
    const options = srModelOptions().filter(m => !term || m.toUpperCase().includes(term));
    list.innerHTML = options.length
        ? options.map(m => `<label><input type="checkbox" value="${cwrEsc(m)}" ${srDraft.models.includes(m) ? 'checked' : ''}
              onchange="toggleSrModel(this.value, this.checked)">${cwrEsc(m)}</label>`).join('')
        : '<div class="sr-multi-empty">No models in the loaded data</div>';
}

function toggleSrModel(model, on) {
    const set = new Set(srDraft.models);
    if (on) set.add(model); else set.delete(model);
    setSrModels([...set].sort());
}

function setSrModels(models) {
    srSetDraft({ models });
    if (!document.getElementById('srModelMenu').hidden) renderSrModelOptions();
}

function renderSrModelLabel(models) {
    const label = document.getElementById('srModelLabel');
    const btn = document.getElementById('srModelBtn');
    const selected = srDraft.models || [];
    label.textContent = !selected.length ? 'All models'
        : selected.length === 1 ? selected[0] : `${selected.length} models`;
    btn.title = models.length && models.every(m => !m.data.hasModels) ? 'This stage has no model data (EA01 PDI)' : '';
    btn.closest('.sr-field').classList.toggle('is-filtered', selected.length > 0);
}

// ---- Rendering ----
function renderSr() {
    if (!srInitialised) return;
    const models = srLines().map(line => {
        const d = srData(line);
        return d ? srBuild(line, d) : null;
    }).filter(Boolean);
    srLastModels = models;

    const lineText = srState.line === 'BOTH' ? 'EA01 + EA02' : srState.line;
    document.getElementById('srTitle').textContent = `${lineText} Quality Summary`;
    document.getElementById('srSubtitle').textContent =
        `${SR_STAGE_LABELS[srState.stage][srState.line === 'BOTH' ? 'EA02' : srState.line]} · ${srRangeLabel()}`;
    const stamps = models.map(m => m.data.generatedAt).filter(Boolean).sort();
    document.getElementById('srRefreshed').textContent = srSample ? 'Sample data'
        : stamps.length ? `Updated ${new Date(stamps[0]).toLocaleTimeString('en-GB')}` : 'Not loaded yet';

    const sub = srState.stage === 'Leak' ? '' : srState.basis === 'all' ? ' · all attempts' : ' · latest result per engine per day';
    document.getElementById('srTrendTitle').innerHTML = `Production trend<small>OK vs NOK engines${sub}</small>`;
    document.getElementById('srMatrixTitle').innerHTML = `Day × Shift<small>Cell colour = rejection %${sub}</small>`;
    document.getElementById('srHourSub').textContent = srState.stage === 'Leak'
        ? 'Total engines per hour bucket · NOK in red'
        : 'Total engines per hour bucket · NOK in red · all attempts (as Power BI)';

    renderSrModelLabel(models);
    renderSrKpis(models);
    renderSrTrend(models);
    renderSrDonuts(models);
    renderSrMatrix(models);
    renderSrHourly(models);
    if (srState.stage === 'Leak') {
        renderSrStatus(models);
        renderSrRework(models);
    }
}

function renderSrKpis(models) {
    const el = document.getElementById('srKpis');
    if (!el) return;
    const both = models.length > 1;
    const combined = srM(srMerge(models.map(m => m.kpi)));

    const prev = srPrevRange();
    const prevModels = models.map(m => {
        const d = srData(m.line, prev.start, prev.end);
        return d ? srBuild(m.line, d) : null;
    });
    const prevCombined = prevModels.every(Boolean) && models.length ? srM(srMerge(prevModels.map(m => m.kpi))) : null;

    const cards = [
        { key: 'total', label: 'Total', cls: 'is-accent', fmt: srFmt, kind: 'count' },
        { key: 'ok', label: 'OK', cls: 'is-ok', fmt: srFmt, kind: 'count', better: 1 },
        { key: 'nok', label: 'NOK', cls: 'is-nok', fmt: srFmt, kind: 'count', better: -1 },
        { key: 'ppm', label: 'PPM', fmt: srFmtPpm, kind: 'abs', better: -1 },
        { key: 'rej', label: 'Rejection %', fmt: srFmtPct, kind: 'pp', better: -1 },
        { key: 'pass', label: 'Straight pass %', fmt: srFmtPct, kind: 'pp', better: 1 }
    ];

    const delta = card => {
        if (!prevCombined) return '<div class="sr-kpi-delta">&nbsp;</div>';
        const now = combined[card.key];
        const before = prevCombined[card.key];
        const diff = now - before;
        let text;
        if (card.kind === 'count') text = before ? `${Math.abs(diff / before * 100).toFixed(1)}%` : '-';
        else if (card.kind === 'pp') text = `${Math.abs(diff).toFixed(2)} pp`;
        else text = srFmtPpm(Math.abs(diff));
        const arrow = Math.abs(diff) < 1e-9 ? '=' : diff > 0 ? '▲' : '▼';
        const tone = !card.better || Math.abs(diff) < 1e-9 ? '' : (diff * card.better > 0 ? ' is-good' : ' is-bad');
        const tip = `Previous ${srDays(prev.start, prev.end).length} days (${srRangeLabel(prev.start, prev.end)}): ${card.fmt(before)}`;
        return `<div class="sr-kpi-delta${tone}" title="${cwrEsc(tip)}">${arrow} ${text} vs previous period</div>`;
    };

    el.innerHTML = cards.map(card => {
        const split = both
            ? `<div class="sr-kpi-split">${models.map(m => `<span><i style="background: var(${m.line === 'EA01' ? '--sr-line-1' : '--sr-line-2'});"></i>${m.line} <b>${card.fmt(m.kpi[card.key])}</b></span>`).join('')}</div>`
            : '';
        const note = card.key === 'total' && models.length ? `<div class="sr-kpi-note">${cwrEsc(srBasisNote(models))}</div>` : '';
        return `<div class="sr-kpi ${card.cls || ''}">
            <div class="sr-kpi-label">${card.label}</div>
            <div class="sr-kpi-value">${models.length ? card.fmt(combined[card.key]) : '--'}</div>
            ${split}${delta(card)}${note}
        </div>`;
    }).join('');
}

function srTrendAxis() {
    if (srState.trend === 'shift') {
        const keys = srState.shift ? [srState.shift] : SR_SHIFTS;
        return { keys, labels: keys.map(k => SR_SHIFT_LABELS[k]), pick: (m, k) => m.byShift.get(k) };
    }
    if (srState.trend === 'hour') {
        const hours = SR_HOURS.filter(h => !srState.shift || h.shift === srState.shift);
        return { keys: hours.map(h => h.key), labels: hours.map(h => h.label), pick: (m, k) => m.byHour.get(k) };
    }
    const keys = srDays();
    return { keys, labels: keys.map(srDayLabel), pick: (m, k) => m.byDay.get(k) };
}

function srDestroy(chart) {
    if (chart) chart.destroy();
    return null;
}

// Message drawn over an empty chart box (CSS ::after), or cleared when the chart has data.
function srChartEmpty(canvasId, message) {
    const box = document.getElementById(canvasId)?.parentElement;
    if (!box) return;
    if (message) box.dataset.empty = message; else delete box.dataset.empty;
}

function srEmptyMessage(models) {
    return !models.length ? 'Choose filters, then click Leak, PDI or Testing to load the report'
        : models.every(m => !srM(m.all).total) ? 'No OK / NOK engines for the selected filters' : '';
}

function renderSrTrend(models) {
    srCharts.trend = srDestroy(srCharts.trend);
    srCharts.ppm = srDestroy(srCharts.ppm);
    const empty = srEmptyMessage(models);
    srChartEmpty('srTrendChart', empty);
    srChartEmpty('srPpmChart', empty ? ' ' : '');
    if (typeof Chart === 'undefined' || empty) return;

    const c = srColors();
    const both = models.length > 1;
    const { keys, labels, pick } = srTrendAxis();
    const datasets = [];
    models.forEach((m, i) => {
        const fade = i === 1 ? 'a6' : '';   // EA02 bars lighter in "Both" mode; the legend names each
        const prefix = both ? `${m.line} ` : '';
        datasets.push({
            label: `${prefix}OK`, stack: m.line, data: keys.map(k => pick(m, k)?.ok || 0),
            backgroundColor: c.ok + fade, borderWidth: 0, borderRadius: 0
        });
        datasets.push({
            label: `${prefix}NOK`, stack: m.line, data: keys.map(k => pick(m, k)?.nok || 0),
            backgroundColor: c.nok + fade, borderColor: c.surface,
            borderWidth: { top: 0, right: 0, bottom: 2, left: 0 }, borderSkipped: false,
            borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 }
        });
    });

    // Total labels above each stack when there are few enough bars to stay legible.
    const totalLabels = {
        id: 'srTotals',
        afterDatasetsDraw(chart) {
            if (keys.length > 16) return;
            const { ctx } = chart;
            ctx.save();
            ctx.textAlign = 'center';
            ctx.fillStyle = c.text;
            ctx.font = '700 11px Inter, sans-serif';
            models.forEach((m, i) => {
                const meta = chart.getDatasetMeta(i * 2 + 1);
                if (meta.hidden) return;
                meta.data.forEach((bar, k) => {
                    const s = pick(m, keys[k]);
                    const total = (s?.ok || 0) + (s?.nok || 0);
                    if (total) ctx.fillText(srFmt(total), bar.x, bar.y - 6);
                });
            });
            ctx.restore();
        }
    };

    const axisWidth = scale => { scale.width = 64; };   // both charts share x positions
    const xTicks = { color: c.muted, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 8 };

    srCharts.trend = new Chart(document.getElementById('srTrendChart').getContext('2d'), {
        type: 'bar',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 250 },
            layout: { padding: { top: 18 } },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { position: 'bottom', labels: { color: c.text, boxWidth: 12, boxHeight: 12, useBorderRadius: true, borderRadius: 3 } },
                tooltip: {
                    callbacks: {
                        label: ctx => ` ${ctx.dataset.label}: ${srFmt(ctx.parsed.y)}`,
                        footer: items => {
                            const k = keys[items[0]?.dataIndex];
                            return models.map(m => {
                                const x = srM(pick(m, k));
                                return `${both ? m.line + ' · ' : ''}Total ${srFmt(x.total)} · PPM ${srFmtPpm(x.ppm)} · NOK ${srFmtPct(x.rej)}`;
                            });
                        }
                    }
                }
            },
            scales: {
                x: { stacked: true, ticks: xTicks, grid: { display: false } },
                y: { stacked: true, beginAtZero: true, ticks: { color: c.muted, precision: 0 }, grid: { color: c.grid }, afterFit: axisWidth }
            }
        },
        plugins: [totalLabels]
    });

    // PPM gets its own chart under the bars instead of a second y-axis on the same plot.
    srCharts.ppm = new Chart(document.getElementById('srPpmChart').getContext('2d'), {
        type: 'line',
        data: {
            labels,
            datasets: models.map(m => ({
                label: `${m.line} PPM`,
                data: keys.map(k => { const x = srM(pick(m, k)); return x.total ? Math.round(x.ppm) : null; }),
                borderColor: c.lines[m.line],
                backgroundColor: c.lines[m.line],
                borderWidth: 2,
                pointRadius: keys.length > 40 ? 2 : 4,
                pointHoverRadius: 6,
                pointBorderColor: c.surface,
                pointBorderWidth: 2,
                tension: 0.25,
                spanGaps: true
            }))
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 250 },
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: both, position: 'bottom', labels: { color: c.text, boxWidth: 12, boxHeight: 2 } },
                tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${srFmtPpm(ctx.parsed.y)}` } }
            },
            scales: {
                x: { ticks: { ...xTicks, display: false }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { color: c.muted, maxTicksLimit: 4, callback: v => srFmtPpm(v) }, grid: { color: c.grid }, afterFit: axisWidth }
            }
        }
    });
}

function renderSrDonuts(models) {
    srCharts.donuts.forEach(ch => ch.destroy());
    srCharts.donuts = [];
    const box = document.getElementById('srDonuts');
    document.getElementById('srDonutSub').textContent = models.length ? srBasisNote(models) : 'Selected range';
    if (!models.length || models.every(m => !m.kpi.total)) {
        const message = models.length ? 'No OK / NOK engines for the selected filters' : 'Not loaded yet';
        box.innerHTML = `<div class="sr-empty"><span class="material-symbols-outlined">donut_large</span>${message}</div>`;
        return;
    }
    const both = models.length > 1;
    box.innerHTML = models.map((m, i) => `
        <div class="sr-donut">
            ${both ? `<div class="sr-donut-name">${srLineTag(m.line)}</div>` : ''}
            <div class="sr-donut-canvas">
                <canvas id="srDonut${i}" aria-label="${m.line} OK ${m.kpi.ok}, NOK ${m.kpi.nok}"></canvas>
                <div class="sr-donut-center"><b>${srFmtPct(m.kpi.rej)}</b><span>NOK</span></div>
            </div>
            <div class="sr-legend">
                <span><i style="background: var(--sr-ok);"></i>OK ${srFmt(m.kpi.ok)} (${srFmtPct(m.kpi.pass)})</span>
                <span><i style="background: var(--sr-nok);"></i>NOK ${srFmt(m.kpi.nok)}</span>
            </div>
        </div>`).join('');

    if (typeof Chart === 'undefined') return;
    const c = srColors();
    models.forEach((m, i) => {
        srCharts.donuts.push(new Chart(document.getElementById(`srDonut${i}`).getContext('2d'), {
            type: 'doughnut',
            data: {
                labels: ['OK', 'NOK'],
                datasets: [{
                    data: [m.kpi.ok, m.kpi.nok],
                    backgroundColor: [c.ok, c.nok],
                    borderColor: c.surface,
                    borderWidth: 2,
                    hoverOffset: 4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                cutout: '72%',
                animation: { duration: 250 },
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${srFmt(ctx.parsed)} (${srFmtPct(m.kpi.total ? ctx.parsed / m.kpi.total * 100 : 0)})` } }
                }
            }
        }));
    });
}

function srEmptyTable(table, message) {
    table.innerHTML = `<tbody><tr><td class="sr-empty-cell"><div class="sr-empty"><span class="material-symbols-outlined">search_off</span>${message}</div></td></tr></tbody>`;
}

// One matrix / hourwise cell. Background = rejection % relative to the worst cell in the table.
function srCell(sum, metric, maxRej, title) {
    const x = srM(sum);
    if (!x.total) return '<td class="sr-num"></td>';
    const text = metric === 'ppm' ? srFmtPpm(x.ppm)
        : metric === 'pct' ? srFmtPct(x.rej)
            : srFmt(x.total) + (x.nok ? `<small>${srFmt(x.nok)} NOK</small>` : '');
    // Squared so typical cells stay faint and only the worst shifts/hours stand out.
    const alpha = x.nok && maxRej > 0 ? (0.6 * Math.min(x.rej / maxRej, 1) ** 2).toFixed(2) : 0;
    const style = alpha ? ` style="background: rgba(var(--sr-heat), ${alpha});"` : '';
    const tip = `${title}: OK ${srFmt(x.ok)} · NOK ${srFmt(x.nok)} · Total ${srFmt(x.total)} · PPM ${srFmtPpm(x.ppm)} · Rejection ${srFmtPct(x.rej)}`;
    return `<td class="sr-num"${style} title="${cwrEsc(tip)}">${text}</td>`;
}

// Bold total cell; pass cls = '' for an inline (non-sticky) totals row.
function srTotalCell(sum, metric, cls = ' sr-total') {
    const x = srM(sum);
    const text = !x.total ? '' : metric === 'ppm' ? srFmtPpm(x.ppm) : metric === 'pct' ? srFmtPct(x.rej)
        : srFmt(x.total) + (x.nok ? `<small>${srFmt(x.nok)} NOK</small>` : '');
    return `<td class="sr-num${cls}">${text}</td>`;
}

function srMaxRej(maps) {
    let max = 0;
    maps.forEach(map => map.forEach(s => { const x = srM(s); if (x.nok && x.rej > max) max = x.rej; }));
    return max;
}

function renderSrMatrix(models) {
    const table = document.getElementById('srMatrix');
    if (!models.length || models.every(m => !m.daily.length)) {
        srEmptyTable(table, 'No data for the selected filters');
        return;
    }
    const days = srDays();
    const shifts = srState.shift ? [srState.shift] : SR_SHIFTS;
    const metric = srState.matrixMetric;
    const both = models.length > 1;
    const maxRej = srMaxRej(models.map(m => m.byDayShift));

    const head = `<tr><th class="sr-sticky">${both ? 'Line · Shift' : 'Shift'}</th>` +
        days.map(d => `<th>${srDayLabel(d)}</th>`).join('') + '<th class="sr-total">Total</th></tr>';

    let body = '';
    models.forEach((m, mi) => {
        shifts.forEach((s, si) => {
            const cls = [mi % 2 ? 'sr-alt' : '', both && si === 0 && mi > 0 ? 'sr-shift-start' : ''].filter(Boolean).join(' ');
            body += `<tr class="${cls}"><td class="sr-sticky">${both ? srLineTag(m.line) : ''}${SR_SHIFT_LABELS[s]}</td>` +
                days.map(d => srCell(m.byDayShift.get(`${d}|${s}`), metric, maxRej, `${m.line} · ${srDayLabel(d)} · Shift ${s}`)).join('') +
                srTotalCell(m.byShift.get(s), metric) + '</tr>';
        });
        if (both) {
            body += `<tr class="${mi % 2 ? 'sr-alt' : ''}"><td class="sr-sticky">${srLineTag(m.line)}<b>Day total</b></td>` +
                days.map(d => srTotalCell(m.byDay.get(d), metric, '')).join('') +
                srTotalCell(m.all, metric) + '</tr>';
        }
    });

    const foot = `<tr><td class="sr-sticky">${both ? 'All lines' : 'Day total'}</td>` +
        days.map(d => srTotalCell(srMerge(models.map(m => m.byDay.get(d))), metric, '')).join('') +
        srTotalCell(srMerge(models.map(m => m.all)), metric) + '</tr>';

    table.innerHTML = `<thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot>`;
}

function renderSrHourly(models) {
    const table = document.getElementById('srHourly');
    if (!models.length || models.every(m => !m.hourly.length)) {
        srEmptyTable(table, 'No hourly data for the selected filters');
        return;
    }
    const days = srDays();
    const hours = SR_HOURS.filter(h => !srState.shift || h.shift === srState.shift);
    const metric = srState.hourMetric;
    const both = models.length > 1;
    const maxRej = srMaxRej(models.map(m => m.byDayHour));

    const head = `<tr><th class="sr-sticky">${both ? 'Line · Hour' : 'Hour'}</th><th>Shift</th>` +
        days.map(d => `<th>${srDayLabel(d)}</th>`).join('') + '<th class="sr-total">Total</th></tr>';

    let body = '';
    models.forEach(m => {
        hours.forEach((h, hi) => {
            const shiftStart = hi > 0 && hours[hi - 1].shift !== h.shift;
            const lineStart = both && hi === 0 && m.line !== models[0].line;
            const cls = shiftStart || lineStart ? ' class="sr-shift-start"' : '';
            body += `<tr${cls}><td class="sr-sticky">${both ? srLineTag(m.line) : ''}${h.label}</td><td class="sr-num">${h.shift}</td>` +
                days.map(d => srCell(m.byDayHour.get(`${d}|${h.key}`), metric, maxRej, `${m.line} · ${srDayLabel(d)} · ${h.label}`)).join('') +
                srTotalCell(m.byHour.get(h.key), metric) + '</tr>';
        });
    });

    const byDay = d => srMerge(models.flatMap(m => hours.map(h => m.byDayHour.get(`${d}|${h.key}`))));
    const foot = `<tr><td class="sr-sticky">Day total</td><td></td>` +
        days.map(d => srTotalCell(byDay(d), metric, '')).join('') +
        srTotalCell(srMerge(models.flatMap(m => hours.map(h => m.byHour.get(h.key)))), metric) + '</tr>';

    table.innerHTML = `<thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot>`;
}

const SR_STATUSES = [
    { key: 'ok', label: 'OK', color: '--sr-ok' },
    { key: 'nok', label: 'NOK', color: '--sr-nok' },
    { key: 'byp', label: 'Bypassed', color: '--sr-byp' },
    { key: 'na', label: 'NA', color: '--sr-na' },
    { key: 'empty', label: 'Empty', color: '--sr-empty' }
];

function renderSrStatus(models) {
    srCharts.status = srDestroy(srCharts.status);
    const table = document.getElementById('srStatusTable');
    const days = srDays();
    if (!models.length || models.every(m => !m.statusByDay.size)) {
        srEmptyTable(table, 'No leak status data for the selected filters');
        return;
    }
    const both = models.length > 1;
    const merged = days.map(d => srMerge(models.map(m => m.statusByDay.get(d))));

    if (typeof Chart !== 'undefined') {
        const c = srColors();
        const colorOf = { ok: c.ok, nok: c.nok, byp: c.byp, na: c.na, empty: c.empty };
        srCharts.status = new Chart(document.getElementById('srStatusChart').getContext('2d'), {
            type: 'bar',
            data: {
                labels: days.map(srDayLabel),
                datasets: SR_STATUSES.map((s, i) => ({
                    label: s.label,
                    data: merged.map(x => x[s.key]),
                    backgroundColor: colorOf[s.key],
                    borderColor: c.surface,
                    borderWidth: i ? { top: 0, right: 0, bottom: 2, left: 0 } : 0,
                    borderSkipped: false
                }))
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 250 },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { position: 'bottom', labels: { color: c.text, boxWidth: 12, boxHeight: 12, useBorderRadius: true, borderRadius: 3 } },
                    tooltip: { callbacks: { label: ctx => ` ${ctx.dataset.label}: ${srFmt(ctx.parsed.y)}` } }
                },
                scales: {
                    x: { stacked: true, ticks: { color: c.muted, font: { size: 11 }, maxRotation: 0, autoSkipPadding: 8 }, grid: { display: false } },
                    y: { stacked: true, beginAtZero: true, ticks: { color: c.muted, precision: 0 }, grid: { color: c.grid } }
                }
            }
        });
    }

    const head = `<tr><th class="sr-sticky">${both ? 'Line · Status' : 'Status'}</th>` +
        days.map(d => `<th>${srDayLabel(d)}</th>`).join('') + '<th class="sr-total">Total</th></tr>';
    let body = '';
    models.forEach((m, mi) => {
        const all = srMerge([...m.statusByDay.values()]);
        const row = (label, value, cls = '') => `<tr class="${cls}"><td class="sr-sticky">${both ? srLineTag(m.line) : ''}${label}</td>` +
            days.map(d => { const v = value(m.statusByDay.get(d)); return `<td class="sr-num">${v ? srFmt(v) : ''}</td>`; }).join('') +
            `<td class="sr-num sr-total">${srFmt(value(all))}</td></tr>`;
        SR_STATUSES.forEach((s, si) => {
            body += row(`<span class="sr-dot" style="background: var(${s.color});"></span>${s.label}`, x => x?.[s.key] || 0,
                both && si === 0 && mi > 0 ? 'sr-shift-start' : '');
        });
        body += row('<b>Total (OK + NOK)</b>', x => (x?.ok || 0) + (x?.nok || 0), 'sr-alt');
    });
    table.innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
}

function srReworkMetrics(x) {
    const total = x.ok + x.rework;
    return { ok: x.ok, rework: x.rework, total, ppm: total ? x.rework / total * 1e6 : 0, pct: total ? x.rework / total * 100 : 0 };
}

function renderSrRework(models) {
    const kpiBox = document.getElementById('srReworkKpis');
    const table = document.getElementById('srReworkTable');
    const days = srDays();
    const sumOf = m => [...m.reworkByDay.values()].reduce((a, x) => ({ ok: a.ok + x.ok, rework: a.rework + x.rework }), { ok: 0, rework: 0 });
    const all = srReworkMetrics(models.map(sumOf).reduce((a, x) => ({ ok: a.ok + x.ok, rework: a.rework + x.rework }), { ok: 0, rework: 0 }));

    kpiBox.innerHTML = [
        { label: 'Leak OK', value: srFmt(all.ok), cls: 'is-ok' },
        { label: 'Rework qty', value: srFmt(all.rework), cls: 'is-nok' },
        { label: 'Rework total', value: srFmt(all.total), cls: 'is-accent' },
        { label: 'Rework PPM', value: srFmtPpm(all.ppm) },
        { label: 'Rework %', value: srFmtPct(all.pct) }
    ].map(k => `<div class="sr-kpi ${k.cls || ''}"><div class="sr-kpi-label">${k.label}</div><div class="sr-kpi-value">${models.length ? k.value : '--'}</div></div>`).join('');

    if (!models.length || models.every(m => !m.reworkByDay.size)) {
        srEmptyTable(table, 'No rework data for the selected filters');
        return;
    }
    const both = models.length > 1;
    const head = `<tr><th class="sr-sticky">${both ? 'Line · Measure' : 'Measure'}</th>` +
        days.map(d => `<th>${srDayLabel(d)}</th>`).join('') + '<th class="sr-total">Total</th></tr>';
    let body = '';
    models.forEach((m, mi) => {
        const total = srReworkMetrics(sumOf(m));
        [
            { label: 'Leak OK', fmt: srFmt, key: 'ok' },
            { label: 'Rework qty', fmt: srFmt, key: 'rework' },
            { label: 'Rework total', fmt: srFmt, key: 'total' },
            { label: 'Rework %', fmt: srFmtPct, key: 'pct' }
        ].forEach((r, ri) => {
            body += `<tr class="${both && ri === 0 && mi > 0 ? 'sr-shift-start' : ''}"><td class="sr-sticky">${both ? srLineTag(m.line) : ''}${r.label}</td>` +
                days.map(d => {
                    const x = m.reworkByDay.get(d);
                    return `<td class="sr-num">${x && (x.ok || x.rework) ? r.fmt(srReworkMetrics(x)[r.key]) : ''}</td>`;
                }).join('') +
                `<td class="sr-num sr-total">${r.fmt(total[r.key])}</td></tr>`;
        });
    });
    table.innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
}

// ---- Excel export (long format - one row per line / day / shift or hour - so it pivots easily) ----
async function exportSrToExcel() {
    const models = srLastModels;
    if (!models.length) {
        alert('No data to export');
        return;
    }
    try {
        const workbook = new ExcelJS.Workbook();
        const border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        const gold = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE8B923' } };
        const days = srDays();
        const filterText = [
            `Line: ${srState.line === 'BOTH' ? 'EA01 + EA02' : srState.line}`,
            `Stage: ${srState.stage}`,
            `Production days: ${srRangeLabel()}`,
            `Shift: ${srState.shift ? SR_SHIFT_LABELS[srState.shift] : 'All'}`,
            `Model: ${srState.models.length ? srState.models.join(', ') : 'All'}`,
            ...(srState.stage === 'Leak' ? [`Machine: ${srState.machine || 'All'}`] : [`Basis: ${srState.basis === 'all' ? 'All attempts' : 'Latest result'}`]),
            ...(srSample ? ['SAMPLE DATA - not from the database'] : [])
        ].join('   |   ');

        const addSheet = (name, headers, rows, widths) => {
            const sheet = workbook.addWorksheet(name);
            sheet.mergeCells(1, 1, 1, Math.max(headers.length, 4));
            sheet.getCell(1, 1).value = `${srState.line === 'BOTH' ? 'EA01 + EA02' : srState.line} SUMMARY REPORT - ${srState.stage.toUpperCase()} - ${name.toUpperCase()}`;
            sheet.getCell(1, 1).font = { name: 'Arial', size: 14, bold: true, color: { argb: 'FFC8102E' } };
            sheet.mergeCells(2, 1, 2, Math.max(headers.length, 4));
            sheet.getCell(2, 1).value = filterText;
            sheet.getCell(2, 1).font = { italic: true, size: 10 };
            sheet.getCell(3, 1).value = `Exported on: ${new Date().toLocaleString()} · quantities = distinct engines · Total = OK + NOK`;
            sheet.getCell(3, 1).font = { size: 10 };
            headers.forEach((h, i) => {
                const cell = sheet.getRow(5).getCell(i + 1);
                cell.value = h;
                cell.font = { bold: true };
                cell.fill = gold;
                cell.border = border;
                cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
            });
            rows.forEach((values, r) => {
                const row = sheet.getRow(6 + r);
                values.forEach((v, i) => { row.getCell(i + 1).value = v; row.getCell(i + 1).border = border; });
            });
            widths.forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
            sheet.views = [{ state: 'frozen', ySplit: 5 }];
        };
        const metricCols = x => [x.ok, x.nok, x.total, Math.round(x.ppm), Number(x.rej.toFixed(2))];
        const shifts = srState.shift ? [srState.shift] : SR_SHIFTS;
        const hours = SR_HOURS.filter(h => !srState.shift || h.shift === srState.shift);

        addSheet('KPIs', ['Line', 'Total', 'OK', 'NOK', 'PPM', 'Rejection %', 'Straight pass %', 'Basis'],
            models.map(m => [m.line, m.kpi.total, m.kpi.ok, m.kpi.nok, Math.round(m.kpi.ppm), Number(m.kpi.rej.toFixed(2)), Number(m.kpi.pass.toFixed(2)), SR_BASIS_NOTES[m.kpiBasis]]),
            [8, 12, 12, 12, 12, 13, 15, 50]);

        const dayShiftRows = [];
        models.forEach(m => days.forEach(d => shifts.forEach(s => {
            const x = srM(m.byDayShift.get(`${d}|${s}`));
            if (x.total) dayShiftRows.push([m.line, d, SR_SHIFT_LABELS[s], ...metricCols(x)]);
        })));
        addSheet('Day x Shift', ['Line', 'Production Date', 'Shift', 'OK', 'NOK', 'Total', 'PPM', 'Rejection %'], dayShiftRows, [8, 16, 20, 10, 10, 10, 10, 13]);

        const hourRows = [];
        models.forEach(m => days.forEach(d => hours.forEach(h => {
            const x = srM(m.byDayHour.get(`${d}|${h.key}`));
            if (x.total) hourRows.push([m.line, d, h.label, h.shift, ...metricCols(x)]);
        })));
        addSheet('Hourwise', ['Line', 'Production Date', 'Hour', 'Shift', 'OK', 'NOK', 'Total', 'PPM', 'Rejection %'], hourRows, [8, 16, 15, 8, 10, 10, 10, 10, 13]);

        if (srState.stage === 'Leak') {
            const statusRows = [];
            models.forEach(m => days.forEach(d => {
                const x = m.statusByDay.get(d);
                if (x) statusRows.push([m.line, d, x.ok, x.nok, x.byp, x.na, x.empty, x.ok + x.nok]);
            }));
            addSheet('Leak Status', ['Line', 'Production Date', 'OK', 'NOK', 'Bypassed', 'NA', 'Empty', 'Total (OK + NOK)'], statusRows, [8, 16, 10, 10, 11, 10, 10, 17]);

            const reworkRows = [];
            models.forEach(m => days.forEach(d => {
                const x = m.reworkByDay.get(d);
                if (x) { const r = srReworkMetrics(x); reworkRows.push([m.line, d, r.ok, r.rework, r.total, Math.round(r.ppm), Number(r.pct.toFixed(2))]); }
            }));
            addSheet('Leak Rework', ['Line', 'Production Date', 'Leak OK', 'Rework Qty', 'Rework Total', 'Rework PPM', 'Rework %'], reworkRows, [8, 16, 11, 12, 13, 12, 11]);
        }

        await downloadWorkbook(workbook, `Summary_Report_${srState.line}_${srState.stage}_${srState.start}_${srState.end}.xlsx`);
    } catch (err) {
        console.error('Error generating excel:', err);
        alert('Error generating Excel file');
    }
}

// ---- Sample data: same shape as the API, generated deterministically per line/stage/day so the
// layout can be reviewed before the stored procedures exist. Never mixed with live data. ----
function srRandom(seed) {
    let h = 2166136261;
    for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
    return () => {
        h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
        return ((h >>> 0) % 100000) / 100000;
    };
}

function srSampleData(line, stage, start, end) {
    const rand = srRandom(`${line}|${stage}|${start}|${end}`);
    const models = stage === 'Testing' ? ['AJ1LA073', 'AJ1LA074', 'AJ1LA084']
        : stage === 'PDI' && line === 'EA01' ? [null]
            : ['AJ1LA007', 'AJ1LA010', 'AJ1LA020'];
    const machines = stage === 'Leak' ? ['M1', 'M2'] : [null];
    const nokRate = { Leak: 0.018, PDI: 0.008, Testing: 0.035 }[stage] * (line === 'EA02' ? 1.3 : 1);
    const shiftMinutes = { A: 420, B: 510, C: 510 };
    const data = { line, stage, generatedAt: new Date().toISOString(), daily: [], status: [], hourly: [], latest: [], range: [], rework: [] };
    const rangeTotals = new Map();

    srDays(start, end).forEach(day => {
        const productionDate = `${day}T00:00:00`;
        const sunday = srParse(day).getDay() === 0;
        SR_SHIFTS.forEach(shift => models.forEach(modelCode => machines.forEach(machine => {
            if (sunday && rand() < 0.8) return;
            const volume = Math.round((stage === 'Leak' ? 45 : 90) * (0.6 + rand() * 0.8) * (shift === 'C' ? 0.8 : 1));
            const nok = Math.round(volume * nokRate * (0.3 + rand() * 1.7));
            const ok = volume - Math.round(nok * 0.3);   // most NOK engines pass on retest the same day
            const base = { productionDate, shift, modelShortCode: null, modelCode, machine };
            const status = stage === 'Leak'
                ? { bypassedQty: rand() < 0.3 ? Math.ceil(rand() * 3) : 0, naQty: rand() < 0.15 ? 1 : 0, emptyQty: rand() < 0.1 ? 1 : 0 }
                : {};
            data.daily.push({ ...base, okQty: ok, nokQty: nok, actualQty: volume });
            if (stage === 'Leak') data.status.push({ ...base, ...status, okQty: ok, nokQty: nok });
            if (stage === 'Leak') {
                if (machine === 'M1') data.rework.push({ productionDate, shift, modelShortCode: null, modelCode, reworkQty: Math.round(nok * 1.4) });
            } else {
                const latestNok = Math.round(nok * 0.3);
                data.latest.push({ ...base, okQty: volume - latestNok, nokQty: latestNok, actualQty: volume });
                const t = rangeTotals.get(modelCode) || { ok: 0, nok: 0, actual: 0 };
                t.ok += volume - latestNok; t.nok += latestNok; t.actual += volume;
                rangeTotals.set(modelCode, t);
            }

            // Spread the shift's engines over its hour buckets by bucket length.
            const buckets = SR_HOURS.filter(h => h.shift === shift);
            let okLeft = ok;
            let nokLeft = nok;
            buckets.forEach((h, i) => {
                const last = i === buckets.length - 1;
                const hOk = last ? okLeft : Math.min(okLeft, Math.round(ok * h.minutes / shiftMinutes[shift] * (0.8 + rand() * 0.4)));
                const hNok = last ? nokLeft : Math.min(nokLeft, rand() < nok / buckets.length ? 1 : 0);
                okLeft -= hOk;
                nokLeft -= hNok;
                if (hOk || hNok) data.hourly.push({ ...base, hourBucket: h.key, okQty: hOk, nokQty: hNok, actualQty: hOk + hNok });
            });
        })));
    });
    rangeTotals.forEach((t, modelCode) => {
        // Monthly table (EA01 only, as in Power BI): engines retested on several days count once.
        if (line === 'EA01') data.range.push({ modelShortCode: null, modelCode, okQty: Math.round(t.ok * 0.97), nokQty: Math.round(t.nok * 0.9), actualQty: Math.round(t.actual * 0.97) });
    });
    return data;
}

// A shared link (?report=summary&...) opens this report directly. Deferred so switchTab doesn't
// read the DOMContentLoaded event as a nav click.
document.addEventListener('DOMContentLoaded', () => {
    if (new URLSearchParams(window.location.search).get('report') === 'summary') {
        setTimeout(() => switchTab('summary-report'), 0);
    }
});
