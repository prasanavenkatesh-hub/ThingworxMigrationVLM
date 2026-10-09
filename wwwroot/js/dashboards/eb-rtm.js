// ---------------------------------------------
// EB Real Time Monitoring Dashboard - live via GET /api/ebrtm/status (fast poll, in-memory),
// GET /api/ebrtm/history and GET /api/ebrtm/energy (slower poll, DB-backed). Backend bridges
// the "vlmEnergyMonitoring" MQTT topic for the 33KV incomer meter (VLM_EMS.Meter4_SID7).
// ---------------------------------------------
// Top filter tabs, mirroring the source mashup. 'all' = gauges + 2x2 trend grid; every other
// tab swaps that for one large chart (#ebDetailView):
//   trend      - the selected day's logged readings of `field` (line/area, 00:00-24:00 axis)
//   pfDaily    - per-day power failure Count / Duration bars, 7 days ending on the selected date
//   energy     - per-day consumption for the whole month the selected date falls in
// refLine draws a dashed horizontal reference (a number, or 'maxDemandLimit' for the live limit).
const EB_FILTERS = [
    { key: 'all', label: 'ALL', kind: 'all' },
    { key: 'voltage', label: 'Voltage (V)', kind: 'trend', field: 'avgVoltage', axisTitle: 'Voltage (kV)', decimals: 2 },
    { key: 'frequency', label: 'Frequency (Hz)', kind: 'trend', field: 'frequency', axisTitle: 'Frequency (Hz)', decimals: 2 },
    { key: 'powerfactor', label: 'Power Factor (PF)', kind: 'trend', field: 'powerFactorSigned', axisTitle: 'Power Factor (PF)', decimals: 2 },
    { key: 'current', label: 'Current (A)', kind: 'trend', field: 'avgCurrent', axisTitle: 'Current (A)', decimals: 2, refLine: 150 },
    { key: 'pfduration', label: 'Power Failure Duration', kind: 'pfDaily', field: 'durationMinutes', title: 'Power Failure Duration / day', yTitle: 'Minutes', decimals: 2 },
    { key: 'pfcount', label: 'Power Failure Count', kind: 'pfDaily', field: 'count', title: 'Power Failure Count / day', yTitle: 'Count', decimals: 0 },
    { key: 'energy', label: 'Energy Consumption', kind: 'energy', title: 'Energy Consumption Historical Data' },
    { key: 'maxdemand', label: 'Max Demand (kVA)', kind: 'trend', field: 'maxDemand', axisTitle: 'Max Demand (kVA)', decimals: 2, refLine: 'maxDemandLimit' }
];
const EB_PF_DAILY_DAYS = 7;

// Gauge zone colors - the source mashup's pure red/orange/green.
const EB_RED = '#ff0000', EB_ORANGE = '#ffa500', EB_GREEN = '#00ff00';

// Static visual config only (gauge ranges/color bands/dial labelling) - live value/display are
// merged in by applyEbRtmStatus() on every status poll. Each dial has 5 labelled major
// divisions (min..max), each split into 5 minor ticks; labelDecimals sets the label precision.
const EB_GAUGES = [
    { id: 'voltage', statusKey: 'avgVoltage', title: 'Voltage (kV)', min: 0, max: 40, labelDecimals: 0, value: 0, zones: [{ to: 25, color: EB_RED }, { to: 30, color: EB_ORANGE }, { to: 35, color: EB_GREEN }, { to: 37.5, color: EB_ORANGE }, { to: 40, color: EB_RED }], display: '--' },
    // Current / Active Power low-side limits (red below / orange below) are provisional - replace
    // with the plant's confirmed values.
    { id: 'current', statusKey: 'avgCurrent', title: 'Current (A)', min: 0, max: 200, labelDecimals: 0, value: 0, zones: [{ to: 20, color: EB_RED }, { to: 40, color: EB_ORANGE }, { to: 150, color: EB_GREEN }, { to: 175, color: EB_ORANGE }, { to: 200, color: EB_RED }], display: '--' },
    { id: 'frequency', statusKey: 'frequency', title: 'Frequency (Hz)', min: 45, max: 55, labelDecimals: 0, value: 50, zones: [{ to: 46.5, color: EB_RED }, { to: 48, color: EB_ORANGE }, { to: 51, color: EB_GREEN }, { to: 53, color: EB_ORANGE }, { to: 55, color: EB_RED }], display: '--' },
    { id: 'activepower', statusKey: 'activePower', title: 'Active Power (kW)', min: 0, max: 9000, labelDecimals: 0, value: 0, zones: [{ to: 900, color: EB_RED }, { to: 1800, color: EB_ORANGE }, { to: 7500, color: EB_GREEN }, { to: 8250, color: EB_ORANGE }, { to: 9000, color: EB_RED }], display: '--' },
    { id: 'powerfactor', statusKey: 'powerFactorSigned', title: 'Power Factor (PF)', min: 0.9, max: 1, labelDecimals: 2, value: 0.99, zones: [{ to: 0.95, color: EB_RED }, { to: 0.96, color: EB_ORANGE }, { to: 1, color: EB_GREEN }], display: '--' }
];

// Chart canvas id -> EbRtmReadingDto field the history endpoint returns for it.
const EB_CHART_FIELDS = [
    { id: 'ebChartVoltage', field: 'avgVoltage' },
    { id: 'ebChartFrequency', field: 'frequency' },
    { id: 'ebChartPf', field: 'powerFactorSigned' },
    { id: 'ebChartCurrent', field: 'avgCurrent' }
];

let ebCharts = {};
let ebRtmPollTimer = null;
let ebRtmSlowPollTimer = null;
let ebDatePicker = null;
// Day the charts show (local midnight) - the trend tabs show this day, the power failure tabs
// the 7 days ending on it, and Energy Consumption its whole month. Defaults to today; changed
// via the topbar date picker. Gauges/sidebar stay live regardless of this selection.
let ebSelectedDate = ebStartOfDay(new Date());
let ebActiveFilter = 'all';
// Bumped on every chart-data request so a slow response for a previously selected date/tab
// can't overwrite the charts after the user has already moved on.
let ebViewRequestSeq = 0;
// Last fetched data per view, so a theme switch can re-render without refetching.
let ebLastPowerFailureDaily = [];
let ebLastEnergyDaily = [];
// Set when the last daily-chart request failed (e.g. "HTTP 404"), so the chart can say so
// instead of misleadingly reporting "no data".
let ebLastViewError = null;
let ebMaxDemandLimit = null;
let ebDetailChart = null;

function ebStartOfDay(d) {
    const x = new Date(d);
    x.setHours(0, 0, 0, 0);
    return x;
}

function ebIsSelectedDateToday() {
    return ebSelectedDate.getTime() === ebStartOfDay(new Date()).getTime();
}

function startEbRtmPolling() {
    renderEbRtmShell();
    initEbDatePicker();
    fetchEbRtmStatus();
    stopEbRtmPolling();
    ebRtmPollTimer = setInterval(fetchEbRtmStatus, 3000);
    ebShowActiveView();
    ebLoadActiveView();
    fetchEbRtmEnergy();
    ebRtmSlowPollTimer = setInterval(() => {
        fetchEbRtmEnergy();
        // A past day's log is fixed - only today's charts need refreshing as new rows land.
        // Energy Consumption only plots completed days, so it can't change within a minute either.
        if (ebIsSelectedDateToday() && ebActiveFilter !== 'energy') ebLoadActiveView();
    }, 60000);
}

function ebFilterDef(key) {
    return EB_FILTERS.find(f => f.key === key) || EB_FILTERS[0];
}

function ebSelectFilter(key) {
    ebActiveFilter = ebFilterDef(key).key;
    document.querySelectorAll('#ebFilterBar .eb-filter-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.key === ebActiveFilter);
    });
    ebShowActiveView();
    ebLoadActiveView();
}

// ALL shows the gauge row + 2x2 grid; every other tab shows the single large detail chart.
function ebShowActiveView() {
    const isAll = ebActiveFilter === 'all';
    document.getElementById('ebAllView').style.display = isAll ? 'flex' : 'none';
    document.getElementById('ebDetailView').style.display = isAll ? 'none' : 'flex';
}

// Fetches whatever the active tab needs for the selected date and renders it.
function ebLoadActiveView() {
    const kind = ebFilterDef(ebActiveFilter).kind;
    if (kind === 'pfDaily') fetchEbPowerFailureDaily();
    else if (kind === 'energy') fetchEbEnergyDaily();
    else fetchEbRtmHistory();
}

// Re-renders the active tab from already-fetched data (used after a theme switch).
function ebRenderActiveView() {
    const def = ebFilterDef(ebActiveFilter);
    if (def.kind === 'all') ebRenderCharts(window.ebLastHistory || []);
    else if (def.kind === 'trend') ebRenderTrendDetail(def, window.ebLastHistory || []);
    else if (def.kind === 'pfDaily') ebRenderPowerFailureDetail(def, ebLastPowerFailureDaily);
    else ebRenderEnergyDetail(def, ebLastEnergyDaily);
}

function ebDateKey(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ebMonthLabel(d) {
    return d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function initEbDatePicker() {
    if (ebDatePicker) return;
    ebDatePicker = flatpickr('#ebDateInput', {
        dateFormat: 'd/m/Y',
        defaultDate: ebSelectedDate,
        maxDate: 'today',
        disableMobile: true,
        onChange: selectedDates => {
            if (!selectedDates.length) return;
            ebSelectedDate = ebStartOfDay(selectedDates[0]);
            ebLoadActiveView();
        }
    });
}

function ebOpenDatePicker() {
    if (ebDatePicker) ebDatePicker.open();
}

function stopEbRtmPolling() {
    if (ebRtmPollTimer) { clearInterval(ebRtmPollTimer); ebRtmPollTimer = null; }
    if (ebRtmSlowPollTimer) { clearInterval(ebRtmSlowPollTimer); ebRtmSlowPollTimer = null; }
}

async function fetchEbRtmStatus() {
    try {
        const res = await fetch('/api/ebrtm/status');
        if (!res.ok) return;
        applyEbRtmStatus(await res.json());
    } catch (e) {
        // Broker/API unreachable - keep showing the last known values.
    }
}

function ebFormatDuration(totalSeconds) {
    const s = Math.max(0, Math.floor(totalSeconds || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return `${h}h : ${m}m : ${sec}s`;
}

function applyEbRtmStatus(data) {
    EB_GAUGES.forEach(g => {
        const v = data[g.statusKey];
        if (typeof v === 'number') {
            g.value = v;
            g.display = g.id === 'powerfactor' ? v.toFixed(2) : (Math.round(v * 100) / 100).toString();
        }
    });

    if (typeof data.maxDemandLimitKva === 'number') ebMaxDemandLimit = data.maxDemandLimitKva;
    document.getElementById('ebMaxDemand').textContent = typeof data.maxDemand === 'number' ? data.maxDemand : '--';
    document.getElementById('ebMaxLimit').textContent = (typeof data.maxDemandLimitKva === 'number' ? data.maxDemandLimitKva : '--') + ' kVA';
    document.getElementById('ebPresentDemand').textContent = typeof data.presentDemand === 'number' ? data.presentDemand : '--';
    document.getElementById('ebPfDuration').textContent = ebFormatDuration(data.powerFailureCurrentDurationSeconds);
    document.getElementById('ebPfCount').textContent = typeof data.powerFailureCountToday === 'number' ? data.powerFailureCountToday : 0;

    renderEbRtmGauges();
}

// Trend charts for the selected day (00:00:00.000 - 23:59:59.999 local), read from the logged
// readings table via /api/ebrtm/history. Feeds both the ALL grid and the single-field tabs.
async function fetchEbRtmHistory() {
    const seq = ++ebViewRequestSeq;
    const start = new Date(ebSelectedDate);
    const end = new Date(ebSelectedDate); end.setHours(23, 59, 59, 999);

    try {
        const res = await fetch(`/api/ebrtm/history?start=${encodeURIComponent(start.toISOString())}&end=${encodeURIComponent(end.toISOString())}`);
        if (seq !== ebViewRequestSeq) return;
        const history = res.ok ? await res.json() : [];
        if (seq !== ebViewRequestSeq) return;
        window.ebLastHistory = history;
        ebRenderActiveView();
    } catch (e) {
        // API unreachable - charts just keep showing their last render.
    }
}

// Power Failure Count / Duration tabs: 7 calendar days ending on the selected date.
async function fetchEbPowerFailureDaily() {
    const seq = ++ebViewRequestSeq;
    try {
        const res = await fetch(`/api/ebrtm/powerfailure/daily?end=${ebDateKey(ebSelectedDate)}&days=${EB_PF_DAILY_DAYS}`);
        if (seq !== ebViewRequestSeq) return;
        ebLastViewError = res.ok ? null : `Could not load data from the server (HTTP ${res.status})`;
        const rows = res.ok ? await res.json() : [];
        if (seq !== ebViewRequestSeq) return;
        ebLastPowerFailureDaily = rows;
        ebRenderActiveView();
    } catch (e) {
        // API unreachable - chart just keeps showing its last render.
    }
}

// Energy Consumption tab: every completed day of the selected date's month.
async function fetchEbEnergyDaily() {
    const seq = ++ebViewRequestSeq;
    try {
        const res = await fetch(`/api/ebrtm/energy/daily?year=${ebSelectedDate.getFullYear()}&month=${ebSelectedDate.getMonth() + 1}`);
        if (seq !== ebViewRequestSeq) return;
        ebLastViewError = res.ok ? null : `Could not load data from the server (HTTP ${res.status})`;
        const rows = res.ok ? await res.json() : [];
        if (seq !== ebViewRequestSeq) return;
        ebLastEnergyDaily = rows;
        ebRenderActiveView();
    } catch (e) {
        // API unreachable - chart just keeps showing its last render.
    }
}

async function fetchEbRtmEnergy() {
    try {
        const res = await fetch('/api/ebrtm/energy');
        if (!res.ok) return;
        renderEbRtmEnergyTable(await res.json());
    } catch (e) {
        // API unreachable - energy table just keeps showing its last render.
    }
}

function renderEbRtmEnergyTable(rows) {
    const body = document.getElementById('ebEnergyTableBody');
    if (!body) return;
    // RealEnergyIntoLoad (and thus these deltas) is kept in its raw unit for calculation -
    // only converted to kWh here for display.
    const fmt = v => typeof v === 'number' ? (v / 1000).toFixed(2) : '--';
    body.innerHTML = (rows || []).map(r => `
        <tr>
            <td>${r.shift}</td>
            <td>${fmt(r.currentDay)}</td>
            <td>${fmt(r.previousDay)}</td>
        </tr>
    `).join('');
}

function ebPolarToCartesian(cx, cy, r, angleDeg) {
    const rad = angleDeg * Math.PI / 180;
    return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function ebDescribeArc(cx, cy, r, startAngle, endAngle) {
    const start = ebPolarToCartesian(cx, cy, r, startAngle);
    const end = ebPolarToCartesian(cx, cy, r, endAngle);
    const largeArc = (endAngle - startAngle) <= 180 ? 0 : 1;
    return `M${start.x.toFixed(1)},${start.y.toFixed(1)} A${r},${r} 0 ${largeArc} 1 ${end.x.toFixed(1)},${end.y.toFixed(1)}`;
}

// Zone color the given value falls in (values outside min..max take the end zones' colors).
function ebZoneColor(cfg, v) {
    const zone = cfg.zones.find(z => v <= z.to) || cfg.zones[cfg.zones.length - 1];
    return zone.color;
}

// Speedometer-style dial (270deg sweep, min at bottom-left, max at bottom-right) mirroring the
// source mashup's gauge: thick color-band arc, 5 labelled major divisions each split into 5
// minor ticks, a tapered needle tinted with the zone color the value falls in, and a shaded hub.
function ebGaugeSvg(cfg) {
    const cx = 100, cy = 100;
    const span = cfg.max - cfg.min;
    const angle = v => 135 + 270 * (Math.max(cfg.min, Math.min(cfg.max, v)) - cfg.min) / span;

    let prev = cfg.min, arcs = '';
    cfg.zones.forEach(z => {
        arcs += `<path d="${ebDescribeArc(cx, cy, 84, angle(prev), angle(z.to))}" class="eb-gauge-zone" stroke="${z.color}"></path>`;
        prev = z.to;
    });

    const majorDivisions = 5, minorPerMajor = 5;
    const totalTicks = majorDivisions * minorPerMajor;
    let ticks = '', labels = '';
    for (let i = 0; i <= totalTicks; i++) {
        const a = 135 + 270 * i / totalTicks;
        const isMajor = i % minorPerMajor === 0;
        const outer = ebPolarToCartesian(cx, cy, 74, a);
        const inner = ebPolarToCartesian(cx, cy, isMajor ? 64 : 69, a);
        ticks += `<line x1="${outer.x.toFixed(1)}" y1="${outer.y.toFixed(1)}" x2="${inner.x.toFixed(1)}" y2="${inner.y.toFixed(1)}" class="eb-gauge-tick${isMajor ? ' major' : ''}"></line>`;
        if (isMajor) {
            const p = ebPolarToCartesian(cx, cy, 50, a);
            const value = cfg.min + span * i / totalTicks;
            labels += `<text x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" class="eb-gauge-label">${value.toFixed(cfg.labelDecimals)}</text>`;
        }
    }

    // Tapered needle: a thin triangle from a wide base at the hub to a point just inside the arc.
    const a = angle(cfg.value);
    const tip = ebPolarToCartesian(cx, cy, 80, a);
    const baseL = ebPolarToCartesian(cx, cy, 6, a - 90);
    const baseR = ebPolarToCartesian(cx, cy, 6, a + 90);
    const needleColor = ebZoneColor(cfg, cfg.value);
    const hubGradId = `ebHubGrad-${cfg.id}`;

    return `<svg viewBox="0 0 200 172" class="eb-gauge-svg">
        <defs>
            <radialGradient id="${hubGradId}" cx="35%" cy="35%" r="65%">
                <stop offset="0%" stop-color="#8a8a8a"></stop>
                <stop offset="100%" stop-color="#151515"></stop>
            </radialGradient>
        </defs>
        ${arcs}
        ${ticks}
        ${labels}
        <polygon points="${tip.x.toFixed(1)},${tip.y.toFixed(1)} ${baseL.x.toFixed(1)},${baseL.y.toFixed(1)} ${baseR.x.toFixed(1)},${baseR.y.toFixed(1)}" class="eb-needle" fill="${needleColor}"></polygon>
        <circle cx="${cx}" cy="${cy}" r="10" class="eb-needle-hub" fill="url(#${hubGradId})"></circle>
    </svg>`;
}

// One-time-per-visit shell: the filter bar and gauge card skeletons don't depend on live data,
// so this only needs to run when the tab is (re-)entered, not on every poll tick.
function renderEbRtmShell() {
    document.getElementById('ebFilterBar').innerHTML = EB_FILTERS.map(f => `
        <button class="eb-filter-btn${f.key === ebActiveFilter ? ' active' : ''}" data-key="${f.key}" onclick="ebSelectFilter('${f.key}')">${f.label}</button>
    `).join('');

    renderEbRtmGauges();
}

function renderEbRtmGauges() {
    // Value box takes the color of the zone the live value is in (black text on top); stays
    // neutral until the first reading arrives.
    document.getElementById('ebGaugeRow').innerHTML = EB_GAUGES.map(g => {
        const hasValue = g.display !== '--';
        const boxStyle = hasValue ? ` style="background:${ebZoneColor(g, g.value)};"` : '';
        return `
        <div class="eb-gauge-card">
            <div class="eb-gauge-title">${g.title}</div>
            ${ebGaugeSvg(g)}
            <div class="eb-gauge-value${hasValue ? '' : ' empty'}"${boxStyle}>${g.display}</div>
        </div>`;
    }).join('');
}

function ebRenderCharts(historyRows) {
    Object.values(ebCharts).forEach(c => c.destroy());
    ebCharts = {};

    const isLightMode = document.body.classList.contains('light-mode');
    const textColor = isLightMode ? '#57606f' : '#9ca3af';
    const gridColor = isLightMode ? '#e5e5ea' : '#1a1a1a';

    const rows = historyRows || [];
    const labels = rows.map(r => {
        const d = new Date(r.timestamp);
        return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
    });
    // A full day's log can be thousands of rows - per-point dots just become noise at that density.
    const pointRadius = rows.length > 200 ? 0 : 2;

    const noDataPlugin = ebNoDataPlugin(!rows.length, `No data logged for ${ebSelectedDate.toLocaleDateString('en-GB')}`, textColor);

    EB_CHART_FIELDS.forEach(cfg => {
        const canvas = document.getElementById(cfg.id);
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 0, 180);
        grad.addColorStop(0, 'rgba(57,255,20,0.4)');
        grad.addColorStop(1, 'rgba(57,255,20,0)');
        const values = rows.map(r => typeof r[cfg.field] === 'number' ? r[cfg.field] : null);
        ebCharts[cfg.id] = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{ data: values, borderColor: '#39ff14', backgroundColor: grad, fill: true, tension: 0.4, pointRadius, pointBackgroundColor: isLightMode ? '#ffffff' : '#0a0a0a', spanGaps: false }]
            },
            plugins: [noDataPlugin],
            options: {
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: {
                    x: { ticks: { color: textColor, font: { size: 8 } }, grid: { color: gridColor } },
                    y: { ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } }
                }
            }
        });
    });
}


// ---- Shared chart helpers (EB-RTM) ----

function ebChartTheme() {
    const isLightMode = document.body.classList.contains('light-mode');
    return {
        isLightMode,
        textColor: isLightMode ? '#57606f' : '#9ca3af',
        labelColor: isLightMode ? '#1d1d1f' : '#ffffff',
        gridColor: isLightMode ? '#e5e5ea' : '#2a2a2a'
    };
}

// Shown in place of an empty grid when there's nothing to plot.
function ebNoDataPlugin(isEmpty, message, color) {
    return {
        id: 'ebNoData',
        afterDraw(chart) {
            if (!isEmpty) return;
            const { ctx, chartArea } = chart;
            ctx.save();
            ctx.fillStyle = color;
            ctx.font = '12px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(message, (chartArea.left + chartArea.right) / 2, (chartArea.top + chartArea.bottom) / 2);
            ctx.restore();
        }
    };
}

// Draws each point's/bar's value just above it (first dataset only), like the source mashup's
// Energy Consumption and Power Failure charts.
function ebValueLabelsPlugin(format, color) {
    return {
        id: 'ebValueLabels',
        afterDatasetsDraw(chart) {
            const meta = chart.getDatasetMeta(0);
            const data = chart.data.datasets[0].data;
            const { ctx } = chart;
            ctx.save();
            ctx.fillStyle = color;
            ctx.font = '600 11px Inter, sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'bottom';
            meta.data.forEach((el, i) => {
                const v = data[i];
                if (typeof v !== 'number') return;
                ctx.fillText(format(v), el.x, el.y - 5);
            });
            ctx.restore();
        }
    };
}

// Source mashup's area-chart look: light green line + diamond markers over a muted green fill.
const EB_AREA_LINE = '#90ee90';
const EB_AREA_FILL = 'rgba(104, 178, 104, 0.6)';
const EB_BAR_COLOR = '#f0587a';

function ebAxisTitle(text, color) {
    return { display: true, text, color, font: { size: 13, weight: 'bold' } };
}

function ebNewDetailChart(config) {
    if (ebDetailChart) { ebDetailChart.destroy(); ebDetailChart = null; }
    const canvas = document.getElementById('ebDetailChart');
    if (!canvas) return;
    ebDetailChart = new Chart(canvas.getContext('2d'), config);
}

// dd-MM-yyyy from the API's "yyyy-MM-ddT00:00:00" day values (parsed as local time).
function ebFormatDay(isoDate) {
    return new Date(isoDate).toLocaleDateString('en-GB').replace(/\//g, '-');
}

// Voltage / Frequency / Power Factor / Current / Max Demand tabs: the selected day's logged
// readings on a fixed 00:00-24:00 time axis, so gaps in logging show up as gaps in time.
function ebRenderTrendDetail(def, rows) {
    const t = ebChartTheme();
    document.getElementById('ebDetailTitle').textContent = '';

    const dayStart = ebSelectedDate.getTime();
    const dayEnd = dayStart + 24 * 3600000;
    const points = (rows || [])
        .filter(r => typeof r[def.field] === 'number')
        .map(r => ({ x: new Date(r.timestamp).getTime(), y: r[def.field] }));
    const hhmm = ms => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

    const datasets = [{
        data: points,
        borderColor: EB_AREA_LINE,
        backgroundColor: EB_AREA_FILL,
        borderWidth: 1.5,
        fill: 'start',
        tension: 0,
        pointStyle: 'rectRot',
        pointRadius: points.length > 150 ? 2 : 3,
        pointBackgroundColor: EB_AREA_LINE,
        pointBorderColor: EB_AREA_LINE
    }];

    const ref = def.refLine === 'maxDemandLimit' ? ebMaxDemandLimit : def.refLine;
    if (typeof ref === 'number') {
        datasets.push({
            data: [{ x: dayStart, y: ref }, { x: dayEnd, y: ref }],
            borderColor: t.textColor,
            borderDash: [4, 4],
            borderWidth: 1.5,
            pointRadius: 0,
            fill: false
        });
    }

    ebNewDetailChart({
        type: 'line',
        data: { datasets },
        plugins: [ebNoDataPlugin(!points.length, `No data logged for ${ebSelectedDate.toLocaleDateString('en-GB')}`, t.textColor)],
        options: {
            maintainAspectRatio: false,
            animation: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    filter: item => item.datasetIndex === 0,
                    callbacks: {
                        title: items => items.length ? hhmm(items[0].parsed.x) : '',
                        label: item => `${def.axisTitle}: ${item.parsed.y.toFixed(def.decimals)}`
                    }
                }
            },
            scales: {
                x: {
                    type: 'linear',
                    min: dayStart,
                    max: dayEnd,
                    ticks: {
                        color: t.textColor,
                        stepSize: 3600000,
                        callback: v => `${String(Math.round((v - dayStart) / 3600000)).padStart(2, '0')}:00`
                    },
                    grid: { color: t.gridColor },
                    title: ebAxisTitle(def.axisTitle, t.labelColor)
                },
                y: {
                    ticks: { color: t.textColor, callback: v => Number(v).toFixed(def.decimals) },
                    grid: { color: t.gridColor }
                }
            }
        }
    });
}

// Power Failure Count / Duration tabs: one bar per day for the 7 days ending on the selected date.
function ebRenderPowerFailureDetail(def, rows) {
    const t = ebChartTheme();
    document.getElementById('ebDetailTitle').textContent = def.title;
    rows = rows || [];
    const values = rows.map(r => typeof r[def.field] === 'number' ? r[def.field] : 0);

    ebNewDetailChart({
        type: 'bar',
        data: {
            labels: rows.map(r => ebFormatDay(r.date)),
            datasets: [{
                data: values,
                backgroundColor: EB_BAR_COLOR,
                barPercentage: 0.6,
                minBarLength: 3 // keeps zero days visible as a thin bar, like the source chart
            }]
        },
        plugins: [
            ebValueLabelsPlugin(v => v.toFixed(def.decimals), t.labelColor),
            ebNoDataPlugin(!rows.length, ebLastViewError || 'No power failure data available', t.textColor)
        ],
        options: {
            maintainAspectRatio: false,
            animation: false,
            layout: { padding: { top: 18 } },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: item => `${def.yTitle}: ${Number(item.raw).toFixed(def.decimals)}` } }
            },
            scales: {
                x: { ticks: { color: t.textColor }, grid: { display: false }, title: ebAxisTitle('Date', t.labelColor) },
                y: {
                    beginAtZero: true,
                    suggestedMax: 1,
                    ticks: { color: t.textColor, precision: def.decimals === 0 ? 0 : undefined },
                    grid: { color: t.gridColor },
                    title: ebAxisTitle(def.yTitle, t.labelColor)
                }
            }
        }
    });
}

// Energy Consumption tab: one point per completed day of the selected date's month, in kWh
// (API values are the raw register delta, same /1000 display conversion as the sidebar table).
function ebRenderEnergyDetail(def, rows) {
    const t = ebChartTheme();
    const monthLabel = ebMonthLabel(ebSelectedDate);
    document.getElementById('ebDetailTitle').textContent = `${def.title} - ${monthLabel}`;
    // Only days with logged data at both ends are plotted - days before logging began (or with a
    // logging gap at a day boundary) are left out entirely rather than shown as blank slots.
    rows = (rows || []).filter(r => typeof r.consumption === 'number');
    const values = rows.map(r => Math.round(r.consumption / 1000));
    const hasData = values.length > 0;

    ebNewDetailChart({
        type: 'line',
        data: {
            labels: rows.map(r => ebFormatDay(r.date)),
            datasets: [{
                data: values,
                borderColor: EB_AREA_LINE,
                backgroundColor: EB_AREA_FILL,
                borderWidth: 2,
                fill: 'start',
                tension: 0,
                spanGaps: false,
                pointStyle: 'rectRot',
                pointRadius: 3,
                pointBackgroundColor: EB_AREA_LINE,
                pointBorderColor: EB_AREA_LINE
            }]
        },
        plugins: [
            ebValueLabelsPlugin(v => String(v), t.labelColor),
            ebNoDataPlugin(!hasData, ebLastViewError || `No completed days logged for ${monthLabel}`, t.textColor)
        ],
        options: {
            maintainAspectRatio: false,
            animation: false,
            layout: { padding: { top: 18, right: 20 } },
            plugins: {
                legend: { display: false },
                tooltip: { callbacks: { label: item => `Consumption: ${item.raw} kWh` } }
            },
            scales: {
                x: { ticks: { color: t.textColor }, grid: { color: t.gridColor } },
                y: {
                    ticks: { color: t.textColor, callback: v => Number(v).toFixed(2) },
                    grid: { color: t.gridColor },
                    title: ebAxisTitle('kWh', t.labelColor)
                }
            }
        }
    });
}
