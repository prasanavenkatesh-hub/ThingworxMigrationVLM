// ---------------------------------------------
// Fire Hydrant Monitoring SCADA - live via GET /api/firehydrant/status (backend bridges the
// plant MQTT broker). These constants seed the initial shapes render*() functions expect;
// fetchFireHydrantStatus() mutates them in place once polling starts.
// ---------------------------------------------
const SCADA_TANKS = [
    { id: 'wt1', label: 'Water Tank 1', capacity: 232, unit: 'm³', level: 88 },
    { id: 'wt2', label: 'Water Tank 2', capacity: 232, unit: 'm³', level: 89 }
];
const SCADA_DIESEL = { label: 'Diesel Tank', capacity: 283, unit: 'L', level: 76 };
// Pump pictures drawn behind each pump icon. w/h = source image size; rotate = CSS rotation (deg);
// ports = the pipe inlet/outlet ends in source-image pixels. With ports, the branch pipe is cut at
// the picture: the upper pipe meets the higher port, the lower pipe (and gate valve) the lower one.
const SCADA_PUMP_ART = {
    // Upper-left outlet stack (x 107-161, top edge) and bottom-right inlet pipe (x 459-511, bottom edge).
    // icon = where the spinning status icon sits (source pixels; default = picture centre): the red body panel.
    diesel: { src: 'assets/firehydrant/DieselPump.png', w: 512, h: 409, rotate: 0, ports: [{ x: 134, y: 0 }, { x: 485, y: 409 }], icon: { x: 221, y: 280 },
        // fuelIn = where the diesel feed line from the Diesel Tank meets the pump: top of the centre block.
        fuelIn: { x: 256, y: 152 },
        // body = the pump itself in source pixels, excluding the bottom-right inlet pipe (control line anchor).
        body: { x0: 4, y0: 0, x1: 394, y1: 408 } },
    // No ports (pipe runs straight behind); the picture is shifted so the red motor's centre sits on the icon.
    main: { src: 'assets/firehydrant/MainPump.png', w: 512, h: 512, rotate: 0, icon: { x: 308, y: 243 }, body: { x0: 0, y0: 84, x1: 510, y1: 427 },
        controlInset: 0.15 },   // control line 15% in from the body's right edge (others 10%)
    // Green inlet/outlet stubs end at x 31 / 317, centred on y 152; rotated 90deg anticlockwise
    // so they face down / up onto the vertical branch pipe.
    // body = the pump casing (stubs excluded), before rotation; x0 = its left edge where the control line meets it.
    jockey: { src: 'assets/firehydrant/JockeyPump.png', w: 352, h: 267, rotate: -90, ports: [{ x: 31, y: 152 }, { x: 317, y: 152 }], body: { x0: 70, y0: 4, x1: 300, y1: 215 } }
};
const SCADA_PUMP_ART_HEIGHT = 80;   // displayed picture height = .scada-branch-slot.pump-icon height
const SCADA_PUMP_ICON_SIZE = 34;    // spinning status icon (px), sized to sit inside the pump picture

const SCADA_PUMPS = [
    { id: 'diesel', label: 'Diesel Pump', kind: 'main', line: 'hydrant', running: false, count: 0, art: SCADA_PUMP_ART.diesel },
    { id: 'hmain', label: 'Hydrant Main Pump', kind: 'main', line: 'hydrant', running: false, count: 0, art: SCADA_PUMP_ART.main },
    { id: 'hjockey', label: 'Hydrant Jockey Pump', kind: 'jockey', line: 'hydrant', running: true, count: 12, art: SCADA_PUMP_ART.jockey },
    { id: 'sjockey', label: 'Sprinkler Jockey Pump', kind: 'jockey', line: 'sprinkler', running: false, count: 0, art: SCADA_PUMP_ART.jockey },
    { id: 'smain', label: 'Sprinkler Main Pump', kind: 'main', line: 'sprinkler', running: false, count: 0, art: SCADA_PUMP_ART.main }
];
const SCADA_GAUGES = [
    { id: 'hydrant', label: 'Hydrant Pressure (bar)', value: 6.78, max: 10 },
    { id: 'sprinkler', label: 'Sprinkler Pressure (bar)', value: 6.79, max: 10 }
];
const SCADA_PRESSURE_POINTS = [
    { key: 'ev', value: 7.05 },
    { key: 'g120', value: 7.06 },
    { key: 'ro', value: null },
    { key: 'fh', value: 6.78 },
    { key: 'mrs', value: null },
    { key: 'machine', value: 0 },
    { key: 'canteen', value: 6.93 },
    { key: 'engine', value: 0 },
    { key: 'paint2', value: 6.52 },
    { key: 'vehicle', value: 0 },
    { key: 'paint1', value: 6.51 },
    { key: 'warehouse', value: 9.45 }
];

let fireHydrantPollTimer = null;

function startFireHydrantPolling() {
    fetchFireHydrantStatus();
    stopFireHydrantPolling();
    fireHydrantPollTimer = setInterval(fetchFireHydrantStatus, 3000);
    fetchFireHydrantAlerts();
    fireHydrantAlertsPollTimer = setInterval(fetchFireHydrantAlerts, 20000);
}

function stopFireHydrantPolling() {
    if (fireHydrantPollTimer) {
        clearInterval(fireHydrantPollTimer);
        fireHydrantPollTimer = null;
    }
    if (fireHydrantAlertsPollTimer) {
        clearInterval(fireHydrantAlertsPollTimer);
        fireHydrantAlertsPollTimer = null;
    }
}

async function fetchFireHydrantStatus() {
    try {
        const res = await fetch('/api/firehydrant/status');
        if (!res.ok) return;
        applyFireHydrantStatus(await res.json());
    } catch (e) {
        // Broker/API unreachable - keep showing the last known values.
    }
}

function applyFireHydrantStatus(data) {
    (data.tanks || []).forEach(t => {
        const target = SCADA_TANKS.find(x => x.id === t.id);
        if (target) target.level = t.level;
    });
    if (data.diesel) SCADA_DIESEL.level = data.diesel.level;
    (data.pumps || []).forEach(p => {
        const target = SCADA_PUMPS.find(x => x.id === p.id);
        if (target) {
            target.running = p.running;
            target.count = p.count;
        }
    });
    (data.gauges || []).forEach(g => {
        const target = SCADA_GAUGES.find(x => x.id === g.id);
        if (target) target.value = g.value;
    });
    (data.pressurePoints || []).forEach(p => {
        const target = SCADA_PRESSURE_POINTS.find(x => x.key === p.key);
        if (target) target.value = p.value;
    });
    renderScadaDashboard();
}

function scadaLevelClass(pct) {
    if (pct >= 75) return 'ok';
    if (pct >= 50) return 'warn';
    return 'fault';
}

// Scales .scada-canvas to fill the actual available height of .scada-canvas-wrap, computed
// fresh on every render rather than a fixed CSS value - a fixed scale overflows at shorter
// viewports (e.g. 1366x768 at some browser zoom/OS-scaling combinations), and since the
// canvas has an opaque background, an overflowing canvas paints over the header row above it
// instead of just looking cramped, making the header appear to vanish entirely.
function fitScadaCanvasScale() {
    const wrap = document.querySelector('.scada-canvas-wrap');
    const canvas = document.getElementById('scadaCanvas');
    if (!wrap || !canvas) return;
    const available = wrap.clientHeight;
    if (available <= 0) return;
    const scale = Math.max(0.85, Math.min(1.6, available / 590));
    canvas.style.transform = `scale(${scale})`;
}

function renderScadaDashboard() {
    fitScadaCanvasScale();
    renderScadaTanks();
    renderScadaGauges();
    renderScadaManifold();
    renderScadaPressureGrid();
    updateScadaCaution();
}

// Re-fit on window resize (Chrome's page-zoom changes fire this too, not just a real resize)
// rather than waiting for the next 3s poll - debounced since resize can fire rapidly.
let scadaResizeTimer = null;
window.addEventListener('resize', () => {
    clearTimeout(scadaResizeTimer);
    scadaResizeTimer = setTimeout(renderScadaDashboard, 150);
});

// Caution icon on the control panel: shown if any water/diesel level is in the red
// band, or any pressure gauge / shopfloor pressure point is in the red band - except a
// condition whose matching alert is currently snoozed (not yet due), which is excluded so
// snoozing an alert also hides the caution icon for that specific condition.
function scadaAnyRedCondition() {
    const snoozed = fireHydrantSnoozedDescriptions();
    const levelRed = SCADA_TANKS.some(t => scadaLevelClass(t.level) === 'fault' && !snoozed.has(fhLevelDescription(t.label)))
        || (scadaLevelClass(SCADA_DIESEL.level) === 'fault' && !snoozed.has('Diesel level down to 20%'));
    const gaugeRed = SCADA_GAUGES.some(g => {
        if (scadaPressureColor(g.value) !== '#FF0000') return false;
        const zone = g.value < 4.5 ? 'low' : 'high';
        return !snoozed.has(fhPressureDescription(fhGaugeLabel(g.id), zone));
    });
    const pressureRed = SCADA_PRESSURE_POINTS.some(p => {
        if (typeof p.value !== 'number' || scadaPressureColor(p.value) !== '#FF0000') return false;
        const zone = p.value < 4.5 ? 'low' : 'high';
        return !snoozed.has(fhPressureDescription(fhPressurePointLabel(p.key), zone));
    });
    return levelRed || gaugeRed || pressureRed;
}

function updateScadaCaution() {
    const el = document.getElementById('scadaCautionIcon');
    if (el) el.classList.toggle('show', scadaAnyRedCondition());
}

// ---------------------------------------------
// Fire Hydrant Alerts popup - GET/POST /api/firehydrant/alerts(/snooze). The backend inserts
// an "open" row on a red-condition transition and a "close" row on recovery (same AlertId),
// and suppresses re-opening the same condition while it's snoozed. The popup only ever opens
// when the user clicks the Alerts button - no auto-reopen timer. A snoozed-and-not-yet-due
// alert is hidden from the table entirely (not just greyed out) and excluded from the caution
// icon's red-condition check; once its snooze time passes it reappears automatically on the
// next fetch if the condition is still abnormal.
let fireHydrantAlerts = [];
let fireHydrantAlertsPollTimer = null;
let fireHydrantSnoozePicker = null;

function fhLevelDescription(label) {
    return `${label} level down to 20%`;
}

function fhPressureDescription(label, zone) {
    return zone === 'low' ? `${label} pressure down to 4.5` : `${label} pressure raises to 9.5`;
}

function fhGaugeLabel(gaugeId) {
    return gaugeId === 'hydrant' ? 'Hydrant' : gaugeId === 'sprinkler' ? 'Sprinkler' : gaugeId;
}

function fhPressurePointLabel(key) {
    switch (key) {
        case 'ev': return 'EV Building';
        case 'g120': return 'G120';
        case 'machine': return 'Machine Shop';
        case 'canteen': return 'Canteen';
        case 'engine': return 'Engine Assembly';
        case 'paint2': return 'Paint Shop 2';
        case 'vehicle': return 'Vehicle Assembly';
        case 'paint1': return 'Paint Shop 1';
        case 'warehouse': return 'FG Warehouse';
        default: return key;
    }
}

// Descriptions of alerts that are currently snoozed (snoozeTime set and still in the future).
function fireHydrantSnoozedDescriptions() {
    const now = Date.now();
    const set = new Set();
    fireHydrantAlerts.forEach(a => {
        if (a.snoozeTime && new Date(a.snoozeTime).getTime() > now) set.add(a.description);
    });
    return set;
}

async function fetchFireHydrantAlerts() {
    try {
        const res = await fetch('/api/firehydrant/alerts');
        if (!res.ok) return;
        fireHydrantAlerts = await res.json();
        renderFireHydrantAlertsTable();
        updateScadaCaution();
    } catch (e) {
        // API unreachable - keep showing the last known alerts.
    }
}

function fireHydrantAlertIsDue(a) {
    return !a.snoozeTime || new Date(a.snoozeTime).getTime() <= Date.now();
}

function openFireHydrantAlerts() {
    const overlay = document.getElementById('fireHydrantAlertsOverlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    if (!fireHydrantSnoozePicker) {
        fireHydrantSnoozePicker = flatpickr('#fireHydrantSnoozeInput', {
            enableTime: true,
            dateFormat: "Y-m-d\\TH:i",
            altInput: true,
            minDate: 'today'
        });
    }
    fetchFireHydrantAlerts();
}

function closeFireHydrantAlerts() {
    const overlay = document.getElementById('fireHydrantAlertsOverlay');
    if (overlay) overlay.style.display = 'none';
}

function updateFireHydrantSnoozeButtonState() {
    const btn = document.getElementById('fireHydrantSnoozeBtn');
    if (!btn) return;
    btn.disabled = document.querySelectorAll('.fh-alert-check:checked').length === 0;
}

function renderFireHydrantAlertsTable() {
    const tbody = document.getElementById('fireHydrantAlertsTbody');
    const empty = document.getElementById('fireHydrantAlertsEmpty');
    if (!tbody) return;
    tbody.innerHTML = '';
    const visible = fireHydrantAlerts.filter(fireHydrantAlertIsDue);
    if (visible.length === 0) {
        if (empty) empty.style.display = 'block';
    } else {
        if (empty) empty.style.display = 'none';
        visible.forEach(a => {
            const tr = document.createElement('tr');
            const ts = new Date(a.eventTime).toLocaleString();
            tr.innerHTML = `
                <td><input type="checkbox" class="fh-alert-check" value="${a.alertId}"></td>
                <td>${ts}</td>
                <td>${a.type}</td>
                <td>${a.description}</td>
            `;
            tbody.appendChild(tr);
        });
    }
    const badge = document.getElementById('fireHydrantAlertBellBadge');
    if (badge) badge.style.display = visible.length > 0 ? 'block' : 'none';
    updateFireHydrantSnoozeButtonState();
}

async function snoozeFireHydrantAlerts() {
    // AlertId is a 17-digit number that exceeds JS's safe integer range, so it's carried as a
    // string end-to-end (matching the backend's JsonNumberHandling.WriteAsString) - never
    // round-tripped through Number(), which would silently corrupt it.
    const checked = Array.from(document.querySelectorAll('.fh-alert-check:checked')).map(c => c.value);
    if (checked.length === 0) return; // button is disabled in this case, but guard anyway
    const snoozeUntil = fireHydrantSnoozePicker && fireHydrantSnoozePicker.selectedDates[0];
    if (!snoozeUntil) { alert('Pick a snooze date/time first.'); return; }
    try {
        await fetch('/api/firehydrant/alerts/snooze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alertIds: checked, snoozeUntil: snoozeUntil.toISOString() })
        });
        fetchFireHydrantAlerts();
    } catch (e) {
        // API unreachable - user can retry.
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const tbody = document.getElementById('fireHydrantAlertsTbody');
    if (tbody) tbody.addEventListener('change', updateFireHydrantSnoozeButtonState);
});

// ---------------------------------------------
// Fire Hydrant Report screen - full-size modal (Duration/Count/Alerts tabs) bound to the
// Reports button. Duration (GET /pumpduration/sessions, one row per pump run session), Count
// (GET /pumpcount/summary, per-pump Start/End/Run count for the range), and Alerts (GET
// /alerts/history, pairing each alert's open row with its close row) are all backed by real data.
let fireHydrantReportFromPicker = null;
let fireHydrantReportToPicker = null;
let fireHydrantReportActiveTab = 'duration';
let fireHydrantReportAlertsData = [];
let fireHydrantReportCountData = [];
let fireHydrantReportDurationData = [];

function openFireHydrantReport() {
    const overlay = document.getElementById('fireHydrantReportOverlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    if (!fireHydrantReportFromPicker) {
        const pickerConfig = { enableTime: true, dateFormat: "Y-m-d\\TH:i", altInput: true };
        fireHydrantReportFromPicker = flatpickr('#fireHydrantReportFrom', { ...pickerConfig, defaultDate: new Date(Date.now() - 24 * 3600000) });
        fireHydrantReportToPicker = flatpickr('#fireHydrantReportTo', { ...pickerConfig, defaultDate: new Date() });
    }
    switchFireHydrantReportTab(fireHydrantReportActiveTab);
    fetchFireHydrantReport();
}

function closeFireHydrantReport() {
    const overlay = document.getElementById('fireHydrantReportOverlay');
    if (overlay) overlay.style.display = 'none';
}

function switchFireHydrantReportTab(tab) {
    fireHydrantReportActiveTab = tab;
    document.querySelectorAll('.scada-report-tab').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-report-tab') === tab);
    });
    document.querySelectorAll('.scada-report-pane').forEach(pane => {
        pane.style.display = pane.getAttribute('data-report-pane') === tab ? 'block' : 'none';
    });
}

async function fetchFireHydrantReport() {
    const from = fireHydrantReportFromPicker && fireHydrantReportFromPicker.selectedDates[0];
    const to = fireHydrantReportToPicker && fireHydrantReportToPicker.selectedDates[0];
    if (!from || !to) return;
    const range = `start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(to.toISOString())}`;
    try {
        if (fireHydrantReportActiveTab === 'duration') {
            const res = await fetch(`/api/firehydrant/pumpduration/sessions?${range}`);
            if (!res.ok) return;
            fireHydrantReportDurationData = await res.json();
            renderFireHydrantReportDurationTable();
        } else if (fireHydrantReportActiveTab === 'alerts') {
            const res = await fetch(`/api/firehydrant/alerts/history?${range}`);
            if (!res.ok) return;
            fireHydrantReportAlertsData = await res.json();
            renderFireHydrantReportAlertsTable();
        } else if (fireHydrantReportActiveTab === 'count') {
            const res = await fetch(`/api/firehydrant/pumpcount/summary?${range}`);
            if (!res.ok) return;
            fireHydrantReportCountData = await res.json();
            renderFireHydrantReportCountTable();
        }
    } catch (e) {
        // API unreachable - user can retry via Apply.
    }
}

// Backend Duration values are SQL `time` (capped under 24h, so no day-prefix to worry about),
// serialized as .NET's default "hh:mm:ss.fffffff" - trimmed to hh:mm:ss for display/CSV.
function formatDuration(d) {
    if (!d) return 'Ongoing';
    const match = /^(\d+:\d{2}:\d{2})/.exec(d);
    return match ? match[1] : d;
}

function renderFireHydrantReportDurationTable() {
    const tbody = document.getElementById('fireHydrantReportDurationTbody');
    const empty = document.getElementById('fireHydrantReportDurationEmpty');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (fireHydrantReportDurationData.length === 0) {
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';
    fireHydrantReportDurationData.forEach((d, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${i + 1}</td>
            <td>${d.pump}</td>
            <td>${new Date(d.startTime).toLocaleString()}</td>
            <td>${d.endTime ? new Date(d.endTime).toLocaleString() : 'Ongoing'}</td>
            <td>${formatDuration(d.duration)}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderFireHydrantReportAlertsTable() {
    const tbody = document.getElementById('fireHydrantReportAlertsTbody');
    const empty = document.getElementById('fireHydrantReportAlertsEmpty');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (fireHydrantReportAlertsData.length === 0) {
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';
    fireHydrantReportAlertsData.forEach((a, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${i + 1}</td>
            <td>${a.type}</td>
            <td>${a.description}</td>
            <td>${new Date(a.startEvent).toLocaleString()}</td>
            <td>${a.endEvent ? new Date(a.endEvent).toLocaleString() : 'Ongoing'}</td>
        `;
        tbody.appendChild(tr);
    });
}

function renderFireHydrantReportCountTable() {
    const tbody = document.getElementById('fireHydrantReportCountTbody');
    const empty = document.getElementById('fireHydrantReportCountEmpty');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (fireHydrantReportCountData.length === 0) {
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';
    fireHydrantReportCountData.forEach((c, i) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${i + 1}</td>
            <td>${c.pump}</td>
            <td>${c.startCount}</td>
            <td>${c.endCount}</td>
            <td>${c.runCount}</td>
        `;
        tbody.appendChild(tr);
    });
}

function downloadFireHydrantReportCsv() {
    if (fireHydrantReportActiveTab === 'duration') {
        if (fireHydrantReportDurationData.length === 0) { alert('No data to export.'); return; }
        const header = ['S.No', 'Pump', 'Start Time', 'End Time', 'Duration'];
        const rows = fireHydrantReportDurationData.map((d, i) => [
            i + 1,
            d.pump,
            new Date(d.startTime).toLocaleString(),
            d.endTime ? new Date(d.endTime).toLocaleString() : 'Ongoing',
            formatDuration(d.duration)
        ]);
        downloadCsvBlob('fire-hydrant-duration-report', header, rows);
    } else if (fireHydrantReportActiveTab === 'alerts') {
        if (fireHydrantReportAlertsData.length === 0) { alert('No data to export.'); return; }
        const header = ['S.No', 'Type', 'Description', 'Start Event', 'End Event'];
        const rows = fireHydrantReportAlertsData.map((a, i) => [
            i + 1,
            a.type,
            a.description,
            new Date(a.startEvent).toLocaleString(),
            a.endEvent ? new Date(a.endEvent).toLocaleString() : 'Ongoing'
        ]);
        downloadCsvBlob('fire-hydrant-alerts-report', header, rows);
    } else if (fireHydrantReportActiveTab === 'count') {
        if (fireHydrantReportCountData.length === 0) { alert('No data to export.'); return; }
        const header = ['S.No', 'Pump', 'Start Count', 'End Count', 'Run Count'];
        const rows = fireHydrantReportCountData.map((c, i) => [i + 1, c.pump, c.startCount, c.endCount, c.runCount]);
        downloadCsvBlob('fire-hydrant-count-report', header, rows);
    } else {
        alert('No data to export.');
    }
}

function renderScadaTanks() {
    const TANK_BODY_HEIGHT = 180;
    const TANK_BOTTOM = 214;
    SCADA_TANKS.forEach(t => {
        const fillEl = document.querySelector(`.scada-tank-fill2[data-tank="${t.id}"]`);
        const pctEl = document.querySelector(`.scada-tank-pct2[data-tank-pct="${t.id}"]`);
        if (!fillEl || !pctEl) return;
        const fillHeight = t.level / 100 * TANK_BODY_HEIGHT;
        fillEl.className = `scada-tank-fill2 ${scadaLevelClass(t.level)}`;
        fillEl.style.height = fillHeight + 'px';
        fillEl.style.top = (TANK_BOTTOM - fillHeight) + 'px';
        pctEl.textContent = t.level + '%';
    });
}

function renderScadaDiesel() {
    const el = document.querySelector('.scada-diesel-box[data-diesel]');
    if (!el) return;
    el.className = `scada-diesel-box ${scadaLevelClass(SCADA_DIESEL.level)}`;
    el.textContent = SCADA_DIESEL.level + '%';
}

// Pressure gauge zones: 0-4.5 red, 4.5-6 yellow, 6-8 green, 8-9.5 yellow, 9.5-max red.
const SCADA_GAUGE_ZONES = [
    { to: 4.5, color: '#ef4444' },
    { to: 6, color: '#eab308' },
    { to: 8, color: '#22c55e' },
    { to: 9.5, color: '#eab308' },
    { to: 10, color: '#ef4444' }
];

function scadaGaugeSvg(g) {
    // Semicircle sweeping left(180deg) to right(0/360deg) through the top, in the same
    // polar convention as ebPolarToCartesian/ebDescribeArc (0deg=east, clockwise).
    const angle = v => 180 + 180 * (Math.max(0, Math.min(g.max, v)) / g.max);
    let prev = 0, arcs = '';
    SCADA_GAUGE_ZONES.forEach(z => {
        arcs += `<path d="${ebDescribeArc(60, 60, 50, angle(prev), angle(Math.min(z.to, g.max)))}" class="scada-gauge-zone" stroke="${z.color}"></path>`;
        prev = z.to;
    });

    const step = g.max / 5;
    let ticks = '';
    for (let t = 0; t <= g.max + 0.001; t += step) {
        const a = angle(t);
        const outer = ebPolarToCartesian(60, 60, 50, a);
        const inner = ebPolarToCartesian(60, 60, 41, a);
        const label = ebPolarToCartesian(60, 60, 33, a);
        ticks += `<line x1="${inner.x.toFixed(1)}" y1="${inner.y.toFixed(1)}" x2="${outer.x.toFixed(1)}" y2="${outer.y.toFixed(1)}" class="scada-gauge-tick"></line>
            <text x="${label.x.toFixed(1)}" y="${label.y.toFixed(1)}" class="scada-gauge-tick-label">${Math.round(t)}</text>`;
    }

    const pct = Math.max(0, Math.min(1, g.value / g.max));
    const deg = pct * 180 - 90;
    return `
        <svg viewBox="0 0 120 65" class="scada-gauge-svg">
            ${arcs}
            ${ticks}
            <line x1="60" y1="60" x2="60" y2="22" class="scada-needle" transform="rotate(${deg} 60 60)"></line>
            <circle cx="60" cy="60" r="4" class="scada-needle-hub"></circle>
        </svg>
        <div class="scada-gauge-value">${g.value.toFixed(2)}</div>
        <div class="scada-gauge-label">${g.label}</div>
    `;
}

function renderScadaGauges() {
    SCADA_GAUGES.forEach(g => {
        const el = document.querySelector(`.scada-gauge[data-gauge="${g.id}"]`);
        if (el) el.innerHTML = scadaGaugeSvg(g);
    });
}

// Displayed geometry of a pump picture (after rotation, scaled to SCADA_PUMP_ART_HEIGHT):
// dx = picture-centre offset that puts the top port on the branch pipe; bottomDx = where the
// bottom port lands relative to the branch pipe; topFy/bottomFy = port heights as fractions.
function scadaPumpArtGeom(p) {
    const a = p.art;
    if (!a) return null;
    const rot = a.rotate || 0;
    const map = pt => rot === -90 ? { x: pt.y, y: a.w - pt.x }
        : rot === 90 ? { x: a.h - pt.y, y: pt.x } : { x: pt.x, y: pt.y };
    const rw = rot ? a.h : a.w;
    const rh = rot ? a.w : a.h;
    const k = SCADA_PUMP_ART_HEIGHT / rh;
    const ports = (a.ports || []).map(map).sort((u, v) => u.y - v.y);
    const top = ports[0];
    const bottom = ports[ports.length - 1];
    const icon = a.icon ? map(a.icon) : { x: rw / 2, y: rh / 2 };
    // With ports the top port sits on the branch pipe; without, the icon point does.
    const dx = (rw / 2 - (top ? top.x : icon.x)) * k;
    // Pump body box after rotation (source units), for the control-line anchor.
    const b = a.body || { x0: 0, y0: 0, x1: a.w, y1: a.h };
    const corners = [map({ x: b.x0, y: b.y0 }), map({ x: b.x1, y: b.y1 })];
    const body = {
        x0: Math.min(corners[0].x, corners[1].x), x1: Math.max(corners[0].x, corners[1].x),
        y0: Math.min(corners[0].y, corners[1].y), y1: Math.max(corners[0].y, corners[1].y)
    };
    return {
        rot,
        // Control-line anchor: bottom-right of the pump body, controlInset (default 10%) of its width in from the right.
        controlFx: (body.x1 - (a.controlInset ?? 0.1) * (body.x1 - body.x0)) / rw,
        controlFy: body.y1 / rh,
        cssW: a.w * k,
        cssH: a.h * k,
        dx,
        iconDx: dx + (icon.x - rw / 2) * k,
        iconDy: (icon.y - rh / 2) * k,
        bottomDx: top ? (bottom.x - top.x) * k : 0,
        topFy: top ? top.y / rh : null,
        bottomFy: bottom ? bottom.y / rh : null,
        // Horizontal distance from the branch (upper) pipe to the diesel feed line's drop (fuelIn).
        fuelDx: a.fuelIn ? dx + (map(a.fuelIn).x - rw / 2) * k : null
    };
}

function scadaPumpArtImg(p) {
    const g = scadaPumpArtGeom(p);
    if (!g) return '';
    return `<img class="scada-pump-bg" src="${p.art.src}" alt="" style="width:${g.cssW.toFixed(1)}px;height:${g.cssH.toFixed(1)}px;left:calc(50% + ${g.dx.toFixed(1)}px);transform:translate(-50%,-50%) rotate(${g.rot}deg)">`;
}

// Labels of a pump with a diesel feed line start 10px right of that line instead of the pipe.
function scadaBesideFeedStyle(p) {
    const g = scadaPumpArtGeom(p);
    return g && g.fuelDx !== null ? ` style="padding-left:calc(50% + ${(g.fuelDx + 10).toFixed(1)}px)"` : '';
}

function scadaPumpIconSvg(p) {
    const color = p.kind === 'jockey' ? '#3b82f6' : '#eab308';
    const g = scadaPumpArtGeom(p);
    const size = SCADA_PUMP_ICON_SIZE;
    // The icon's wheel is centred at viewBox (22,18), 4/44 above the box centre: shift down by that
    // so the wheel (the part that spins) lands on the picture's icon point.
    const shift = g ? ` style="left:${g.iconDx.toFixed(1)}px;top:${(g.iconDy + size * 4 / 44).toFixed(1)}px"` : '';
    return `<svg class="scada-pump-icon-svg" viewBox="0 0 44 44" width="${size}" height="${size}"${shift}>
        <rect x="8" y="30" width="28" height="8" rx="2" fill="#4b5563"></rect>
        <circle class="body" cx="22" cy="18" r="15" fill="${color}"></circle>
        <circle cx="22" cy="18" r="5" fill="#1f2937"></circle>
    </svg>`;
}

function renderScadaManifold() {
    const grid = document.getElementById('scadaManifoldGrid');
    if (!grid) return;

    grid.innerHTML = SCADA_PUMPS.map(p => `
        <div class="scada-branch ${p.running ? 'running' : ''}" data-branch="${p.id}">
            <div class="scada-branch-slot diesel-slot"></div>
            <div class="scada-branch-slot outlet">
                <img class="scada-valve-img inline vert" src="assets/valve.png" title="Non-return valve">
                <img class="scada-valve-img inline vert" src="assets/valve.png" title="Butterfly valve">
            </div>
            <div class="scada-branch-slot label"${scadaBesideFeedStyle(p)}>
                <div class="scada-pump-label2">${p.label}</div>
                <div class="scada-pump-count">Count: ${p.count}</div>
            </div>
            <div class="scada-branch-slot toggle"${scadaBesideFeedStyle(p)}>
                <div class="scada-power-label">POWER</div>
                <div class="scada-toggle-row">
                    <span class="scada-toggle-text">OFF</span>
                    <label class="scada-toggle">
                        <input type="checkbox" ${p.running ? 'checked' : ''} onchange="toggleScadaPump('${p.id}')">
                        <span class="slider"></span>
                    </label>
                    <span class="scada-toggle-text">ON</span>
                </div>
            </div>
            <div class="scada-branch-slot pump-icon">${scadaPumpArtImg(p)}${scadaPumpIconSvg(p)}</div>
            <div class="scada-branch-slot gate-valve"${scadaPumpArtGeom(p)?.bottomDx ? ` style="transform:translateX(${scadaPumpArtGeom(p).bottomDx.toFixed(1)}px)"` : ''}>
                <img class="scada-valve-img inline vert" src="assets/valve.png" title="Gate valve">
            </div>
        </div>
    `).join('') + '<div class="scada-diesel-label">Diesel Tank</div><div class="scada-diesel-box" data-diesel="1"></div>';

    renderScadaDiesel();
    layoutScadaManifoldPipes();
    updateScadaFlowState();
}

function layoutScadaManifoldPipes() {
    const canvas = document.getElementById('scadaCanvas');
    const pipesGroup = document.getElementById('scadaManifoldPipes');
    const panel = document.querySelector('.scada-control-panel');
    const tank1 = document.getElementById('scadaTank1Valve');
    const tank2 = document.getElementById('scadaTank2Valve');
    if (!canvas || !pipesGroup || !panel || !tank1 || !tank2) return;

    const canvasRect = canvas.getBoundingClientRect();
    // .scada-canvas is CSS-scaled to fit the viewport (see .scada-canvas { transform: scale(...) }),
    // but this SVG's own coordinate space is still its native 2000x590 viewBox. getBoundingClientRect()
    // reflects the scaled/visual size, so any on-screen pixel delta must be divided by the current
    // scale factor before being used as a viewBox-unit path coordinate, or every measured position
    // ends up scaled twice (once visually, once again in the path math).
    const scale = canvasRect.width / canvas.offsetWidth;
    const toLocal = rect => ({
        cx: (rect.left + rect.width / 2 - canvasRect.left) / scale,
        top: (rect.top - canvasRect.top) / scale,
        bottom: (rect.bottom - canvasRect.top) / scale
    });
    // The valve <img> is CSS-rotated 90deg around its pipe bore (50%, 71.68%), so its
    // post-rotation getBoundingClientRect() no longer centers on the bore. Read the bore
    // point from the un-rotated offset box instead (offsetLeft/Top/Width/Height ignore
    // CSS transforms), so the drop pipe lands exactly on the valve's pipe line.
    const valveBore = el => {
        const parentRect = el.offsetParent.getBoundingClientRect();
        return {
            cx: (parentRect.left - canvasRect.left) / scale + el.offsetLeft + el.offsetWidth / 2,
            bottom: (parentRect.top - canvasRect.top) / scale + el.offsetTop + el.offsetHeight * 0.7168
        };
    };

    const branches = SCADA_PUMPS.map(p => {
        const el = document.querySelector(`.scada-branch[data-branch="${p.id}"]`);
        const gate = toLocal(el.querySelector('.gate-valve').getBoundingClientRect());
        const outlet = toLocal(el.querySelector('.outlet').getBoundingClientRect());
        // x = lower pipe (gate valve), upperX = upper pipe (outlet valves); they differ when the
        // pump picture's ports are offset (Diesel). cut = where the picture's ports end the pipe.
        const g = scadaPumpArtGeom(p);
        const img = el.querySelector('.scada-pump-bg');
        let cut = null;
        if (g && g.topFy !== null && img) {
            const r = toLocal(img.getBoundingClientRect());
            cut = { top: r.top + g.topFy * (r.bottom - r.top), bottom: r.top + g.bottomFy * (r.bottom - r.top) };
        }
        return { pump: p, x: Math.round(gate.cx), upperX: Math.round(outlet.cx), bottomY: gate.bottom, topY: outlet.top, cut };
    });

    const bottomHeaderY = Math.round(branches[0].bottomY + 10);
    const sprinklerHeaderY = Math.round(branches[0].topY - 6);
    const hydrantHeaderY = sprinklerHeaderY - 34;
    const t1 = valveBore(tank1);
    const t2 = valveBore(tank2);
    const rightX = Math.round((panel.getBoundingClientRect().left - canvasRect.left) / scale - 10);
    const leftX = Math.round(Math.min(t1.cx, t2.cx));

    // Give every pipe a 3D "tube" look: a narrow band gradient (light highlight, dark
    // shadow band, mid body) drawn across the pipe's short axis so it reads as a rounded
    // metal/water pipe regardless of whether the run is horizontal or vertical.
    let gradCounter = 0;
    const defs = [];
    const pipeGrad = (horizontal, pos) => {
        const id = `scadaPipeGrad${gradCounter++}`;
        const half = 4.5;
        const coords = horizontal
            ? `x1="0" y1="${(pos - half).toFixed(1)}" x2="0" y2="${(pos + half).toFixed(1)}"`
            : `x1="${(pos - half).toFixed(1)}" y1="0" x2="${(pos + half).toFixed(1)}" y2="0"`;
        defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse" ${coords}><stop offset="0%" stop-color="#c9d6e0"/><stop offset="20%" stop-color="#f2f8fb"/><stop offset="45%" stop-color="#66798a"/><stop offset="70%" stop-color="#a7b7c2"/><stop offset="100%" stop-color="#465560"/></linearGradient>`);
        return `url(#${id})`;
    };

    const dropD1 = `M${Math.round(t1.cx)},${Math.round(t1.bottom)} L${Math.round(t1.cx)},${bottomHeaderY}`;
    const dropD2 = `M${Math.round(t2.cx)},${Math.round(t2.bottom)} L${Math.round(t2.cx)},${bottomHeaderY}`;
    const tank1Drop = document.getElementById('scadaTank1Drop');
    const tank2Drop = document.getElementById('scadaTank2Drop');
    tank1Drop.setAttribute('d', dropD1);
    tank2Drop.setAttribute('d', dropD2);
    tank1Drop.style.stroke = pipeGrad(false, t1.cx);
    tank2Drop.style.stroke = pipeGrad(false, t2.cx);
    document.getElementById('scadaTank1DropFlow').setAttribute('d', dropD1);
    document.getElementById('scadaTank2DropFlow').setAttribute('d', dropD2);

    const hydrantBranches = branches.filter(b => b.pump.line === 'hydrant');
    const sprinklerBranches = branches.filter(b => b.pump.line === 'sprinkler');
    const crossX = Math.round((hydrantBranches[hydrantBranches.length - 1].upperX + sprinklerBranches[0].upperX) / 2);
    const crossMidY = (hydrantHeaderY + sprinklerHeaderY) / 2;

    // Each pipe is drawn twice: a permanent 3D-gradient body, and a thin red dashed
    // "flow" overlay on the same path, tagged with which SCADA_FLOW_GROUPS key controls
    // it. updateScadaFlowState() decides which groups are actually flowing.
    let svg = '';
    const addPipe = (d, horizontal, pos, group) => {
        const g = pipeGrad(horizontal, pos);
        svg += `<path class="scada-manifold-pipe" data-role="header" style="stroke:${g}" d="${d}"></path>`;
        svg += `<path class="scada-flow-overlaypipe" data-flow-group="${group}" d="${d}"></path>`;
    };

    // Bottom header: one static body pipe, but the flow overlay is segmented per branch
    // tap-in point so it only lights up as far as the running pump's own vertical.
    const bottomGrad = pipeGrad(true, bottomHeaderY);
    // Control line: a thin red line from each pump's bottom-right (10% in from the right) down to
    // one shared bus just below the lowest pump, then right into the feedback/control panel.
    // Drawn first so the water pipes and valves sit on top where they cross.
    let controlSvg = '';
    const anchors = SCADA_PUMPS.map(p => {
        const g = scadaPumpArtGeom(p);
        const img = document.querySelector(`.scada-branch[data-branch="${p.id}"] .scada-pump-bg`);
        if (!g || !img) return null;
        const r = img.getBoundingClientRect();
        return {
            x: (r.left - canvasRect.left + g.controlFx * r.width) / scale,
            y: (r.top - canvasRect.top + g.controlFy * r.height) / scale
        };
    }).filter(Boolean);
    if (anchors.length) {
        const busY = Math.max(...anchors.map(a => a.y)) + 6;
        const panelX = (panel.getBoundingClientRect().left - canvasRect.left) / scale;
        let d = `M${anchors[0].x.toFixed(1)},${anchors[0].y.toFixed(1)} V${busY.toFixed(1)} H${panelX.toFixed(1)}`;
        anchors.slice(1).forEach(a => { d += ` M${a.x.toFixed(1)},${a.y.toFixed(1)} V${busY.toFixed(1)}`; });
        controlSvg = `<path class="scada-control-line" d="${d}"></path>`;
    }

    // Diesel feed: thin red line from the Diesel Tank box's left edge (10% up from its bottom)
    // across and down to the Diesel Pump picture's fuelIn point.
    const dieselBox = document.querySelector('.scada-diesel-box');
    const dieselPump = SCADA_PUMPS.find(p => p.id === 'diesel');
    const dieselImg = document.querySelector('.scada-branch[data-branch="diesel"] .scada-pump-bg');
    if (dieselBox && dieselImg && dieselPump?.art?.fuelIn) {
        const box = dieselBox.getBoundingClientRect();
        const img = dieselImg.getBoundingClientRect();
        const a = dieselPump.art;
        const startX = (box.left - canvasRect.left) / scale;
        const startY = (box.bottom - canvasRect.top) / scale - 0.1 * box.height / scale;
        const endX = (img.left - canvasRect.left) / scale + (a.fuelIn.x / a.w) * img.width / scale;
        const endY = (img.top - canvasRect.top) / scale + (a.fuelIn.y / a.h) * img.height / scale;
        svg += `<path class="scada-diesel-feed" d="M${startX.toFixed(1)},${startY.toFixed(1)} H${endX.toFixed(1)} V${endY.toFixed(1)}"></path>`;
    }

    // Ends at the last pump's branch (Sprinkler Main Pump) - nothing taps the header beyond it.
    const bottomEndX = branches[branches.length - 1].x;
    svg += `<path class="scada-manifold-pipe" data-role="header" style="stroke:${bottomGrad}" d="M${leftX},${bottomHeaderY} L${bottomEndX},${bottomHeaderY}"></path>`;
    let segX = leftX;
    branches.forEach(b => {
        svg += `<path class="scada-flow-overlaypipe" data-flow-group="bottom-${b.pump.id}" d="M${segX},${bottomHeaderY} L${b.x},${bottomHeaderY}"></path>`;
        segX = b.x;
    });
    branches.forEach(b => {
        const topY = b.pump.line === 'hydrant' ? hydrantHeaderY : sprinklerHeaderY;
        if (b.cut) {
            addPipe(`M${b.x},${bottomHeaderY} L${b.x},${b.cut.bottom.toFixed(1)}`, false, b.x, `branch-${b.pump.id}`);
            addPipe(`M${b.upperX},${b.cut.top.toFixed(1)} L${b.upperX},${topY}`, false, b.upperX, `branch-${b.pump.id}`);
        } else {
            addPipe(`M${b.x},${bottomHeaderY} L${b.x},${topY}`, false, b.x, `branch-${b.pump.id}`);
        }
    });
    // Hydrant Line: body stays one piece; overlay segmented per feeding branch, lit
    // left-to-right starting at the leftmost running pump, through to the outlet.
    const hydrantGrad = pipeGrad(true, hydrantHeaderY);
    svg += `<path class="scada-manifold-pipe" data-role="header" style="stroke:${hydrantGrad}" d="M${hydrantBranches[0].upperX},${hydrantHeaderY} L${rightX},${hydrantHeaderY}"></path>`;
    hydrantBranches.forEach((b, i) => {
        const nextX = i + 1 < hydrantBranches.length ? hydrantBranches[i + 1].upperX : rightX;
        svg += `<path class="scada-flow-overlaypipe" data-flow-group="hline-${b.pump.id}" d="M${b.upperX},${hydrantHeaderY} L${nextX},${hydrantHeaderY}"></path>`;
    });

    // Sprinkler Line: same idea, but its leftmost segment is fed by the cross-connect
    // (from the hydrant side) rather than a pump branch directly.
    const sprinklerGrad = pipeGrad(true, sprinklerHeaderY);
    svg += `<path class="scada-manifold-pipe" data-role="header" style="stroke:${sprinklerGrad}" d="M${crossX},${sprinklerHeaderY} L${rightX},${sprinklerHeaderY}"></path>`;
    const sprinklerPoints = [{ x: crossX, group: 'cross' }, ...sprinklerBranches.map(b => ({ x: b.upperX, group: b.pump.id }))];
    sprinklerPoints.forEach((p, i) => {
        const nextX = i + 1 < sprinklerPoints.length ? sprinklerPoints[i + 1].x : rightX;
        svg += `<path class="scada-flow-overlaypipe" data-flow-group="sline-${p.group}" d="M${p.x},${sprinklerHeaderY} L${nextX},${sprinklerHeaderY}"></path>`;
    });

    addPipe(`M${crossX},${sprinklerHeaderY} L${crossX},${hydrantHeaderY}`, false, crossX, 'cross');
    svg += `<image id="scadaCrossValve" class="scada-valve-img" href="assets/valve.png" x="${crossX - 11}" y="${(crossMidY - 15.8).toFixed(1)}" width="22" height="22" transform="rotate(90 ${crossX} ${crossMidY})"></image>`;
    svg += `<text x="${rightX - 4}" y="${hydrantHeaderY - 6}" text-anchor="end" class="scada-manifold-header-label">Hydrant Line</text>`;
    svg += `<text x="${rightX - 4}" y="${sprinklerHeaderY - 6}" text-anchor="end" class="scada-manifold-header-label">Sprinkler Line</text>`;
    pipesGroup.innerHTML = `<defs>${defs.join('')}</defs>${controlSvg}${svg}`;
}

// Which pipe segments actually carry water for the current pump on/off states.
// Hydrant-side pumps (diesel/hmain/hjockey) feed both lines via the cross-connect's
// non-return valve; sprinkler-side pumps (sjockey/smain) only feed the sprinkler line
// and cannot push back through that check valve.
function scadaFlowGroups() {
    const isOn = id => !!SCADA_PUMPS.find(p => p.id === id)?.running;
    const anyRunning = SCADA_PUMPS.some(p => p.running);
    const hydrantSide = isOn('diesel') || isOn('hmain') || isOn('hjockey');
    const order = ['diesel', 'hmain', 'hjockey', 'sjockey', 'smain'];
    const groups = { tank: anyRunning, cross: hydrantSide };
    let reach = false;
    for (let i = order.length - 1; i >= 0; i--) {
        reach = reach || isOn(order[i]);
        groups[`bottom-${order[i]}`] = reach; // bottom pipe reaches at least this branch's tap-in point
        groups[`branch-${order[i]}`] = isOn(order[i]);
    }

    // Hydrant Line: lit left-to-right starting at the leftmost running feeding pump.
    reach = false;
    ['diesel', 'hmain', 'hjockey'].forEach(id => {
        reach = reach || isOn(id);
        groups[`hline-${id}`] = reach;
    });

    // Sprinkler Line: the cross-connect feeds its leftmost segment (if any hydrant-side
    // pump is running), then sjockey, then smain each extend the lit region rightward.
    reach = hydrantSide;
    groups['sline-cross'] = reach;
    ['sjockey', 'smain'].forEach(id => {
        reach = reach || isOn(id);
        groups[`sline-${id}`] = reach;
    });

    return groups;
}

function updateScadaFlowState() {
    const groups = scadaFlowGroups();

    document.querySelectorAll('.scada-flow-overlaypipe[data-flow-group]').forEach(el => {
        el.classList.toggle('flowing', !!groups[el.dataset.flowGroup]);
    });

    const tank1Valve = document.getElementById('scadaTank1Valve');
    const tank2Valve = document.getElementById('scadaTank2Valve');
    if (tank1Valve) tank1Valve.classList.toggle('flowing', groups.tank);
    if (tank2Valve) tank2Valve.classList.toggle('flowing', groups.tank);
    const crossValve = document.getElementById('scadaCrossValve');
    if (crossValve) crossValve.classList.toggle('flowing', groups.cross);

    SCADA_PUMPS.forEach(p => {
        const el = document.querySelector(`.scada-branch[data-branch="${p.id}"]`);
        if (!el) return;
        el.classList.toggle('running', p.running);
        el.querySelectorAll('.scada-valve-img').forEach(v => v.classList.toggle('flowing', p.running));
    });
}

function toggleScadaPump(id) {
    const pump = SCADA_PUMPS.find(p => p.id === id);
    if (!pump) return;
    pump.running = !pump.running;
    updateScadaFlowState();
}

// Alarm Red outside the safe band, Operational Green in the middle, amber in between.
function scadaPressureColor(v) {
    if ((v >= 0 && v < 4.5) || v > 9.5) return '#FF0000';
    if (v >= 6 && v <= 8) return '#00FF00';
    if ((v >= 4.5 && v < 6) || (v > 8 && v <= 9.5)) return '#f9ef6b';
    return '';
}

function renderScadaPressureGrid() {
    SCADA_PRESSURE_POINTS.forEach(p => {
        const el = document.querySelector(`.pipe-card[data-key="${p.key}"]`);
        if (!el) return;
        const hasValue = typeof p.value === 'number';
        const valEl = el.querySelector('.pipe-card-val');
        valEl.textContent = hasValue ? p.value.toFixed(2) : '';
        valEl.style.color = hasValue ? scadaPressureColor(p.value) : '';
    });
}
