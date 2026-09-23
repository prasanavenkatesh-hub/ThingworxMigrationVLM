const API_BASE = '/api/pdi';

// Authentication Check (Global)
if (window.location.pathname.indexOf('login.html') === -1) {
    if (sessionStorage.getItem('isLoggedIn') !== 'true') {
        window.location.href = 'login.html';
    } else {
        // Show logged in user if element exists
        const empId = sessionStorage.getItem('empId');
        if (empId) {
            // We might want to show this somewhere, e.g. sidebar
            const sidebarBadge = document.getElementById('sidebarEmpId');
            if (sidebarBadge) {
                sidebarBadge.textContent = empId;
            }
        }
    }
}

let currentChecklist = [];
let currentAbs = '';
let currentModel = '';
let cachedCompletedSubmission = null; // Store for direct access
let initialReworkState = null; // Store initial checklist state for rework validation

function switchTab(tabId) {
    // Nav Active State
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    // Find nav item by onclick matching tabId hack or just pass 'this' from HTML if I updated html? 
    // HTML uses onclick="switchTab('new', this)"... wait, let's check input signature.
    // Signature is switchTab(tabId). The HTML `onclick="switchTab('rework')"` relies on `event.currentTarget`.
    if (event && event.currentTarget) {
        // Only add active if it's a nav-item (sometimes called programmatically)
        if (event.currentTarget.classList.contains('nav-item')) {
            event.currentTarget.classList.add('active');
        }
    } else {
        // Fallback: Find nav item with onclick string matching? Or just rely on ID?
        // Let's assume the DOM has IDs for nav items or we just skip highlighting if triggered programmatically
        // Actually, let's use ID-based highlighting if available.
        const nav = document.getElementById(`nav-${tabId}`);
        if (nav) nav.classList.add('active');
    }

    // Tab Pane Visibility
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
    document.getElementById(`tab-${tabId}`).classList.add('active');

    // Dashboard Dropdown Visibility (Only for Poke Yoke)
    const dashboardDropdown = document.getElementById('mainDashboardDropdown');
    if (dashboardDropdown) {
        dashboardDropdown.style.display = (tabId === 'poke-yoke' || tabId === 'poke-yoke-summary' || tabId === 'reports' || tabId === 'biometric-engine-barcode') ? 'block' : 'none';
    }

    // Clear Search UX on Tab Switch
    // Search context is now separate per tab (preserved), no need to clear.

    // Fire Hydrant live polling only runs while its tab is active.
    stopFireHydrantPolling();

    // Fetch data if switching to Rework or Completed or Reports
    if (tabId === 'rework' || tabId === 'completed') {
        fetchSubmissions(tabId);
    } else if (tabId === 'reports') {
        fetchSubmissions('reports');
        fetchModels();
    } else if (tabId === 'fire-hydrant') {
        startFireHydrantPolling();
    } else if (tabId === 'ems-renewable') {
        renderEmsRenewable();
    } else if (tabId === 'eb-rtm') {
        renderEbRtm();
    } else if (tabId === 'qhold') {
        loadQHoldDefaultView();
    } else if (tabId === 'cylinder-head-leak') {
        loadCylinderHeadDefaultView();
    }
}

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
const SCADA_PUMPS = [
    { id: 'diesel', label: 'Diesel Pump', kind: 'main', line: 'hydrant', running: false, count: 0 },
    { id: 'hmain', label: 'Hydrant Main Pump', kind: 'main', line: 'hydrant', running: false, count: 0 },
    { id: 'hjockey', label: 'Hydrant Jockey Pump', kind: 'jockey', line: 'hydrant', running: true, count: 12 },
    { id: 'sjockey', label: 'Sprinkler Jockey Pump', kind: 'jockey', line: 'sprinkler', running: false, count: 0 },
    { id: 'smain', label: 'Sprinkler Main Pump', kind: 'main', line: 'sprinkler', running: false, count: 0 }
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

function downloadCsvBlob(filenamePrefix, header, rows) {
    const csvEscape = v => `"${String(v).replace(/"/g, '""')}"`;
    const csv = [header, ...rows].map(r => r.map(csvEscape).join(',')).join('\r\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `${filenamePrefix}-${Date.now()}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(link.href);
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

function scadaPumpIconSvg(p) {
    const color = p.kind === 'jockey' ? '#3b82f6' : '#eab308';
    return `<svg class="scada-pump-icon-svg" viewBox="0 0 44 44" width="40" height="40">
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
            <div class="scada-branch-slot label">
                <div class="scada-pump-label2">${p.label}</div>
                <div class="scada-pump-count">Count: ${p.count}</div>
            </div>
            <div class="scada-branch-slot toggle">
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
            <div class="scada-branch-slot pump-icon">${scadaPumpIconSvg(p)}</div>
            <div class="scada-branch-slot gate-valve">
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
        return { pump: p, x: Math.round(gate.cx), bottomY: gate.bottom, topY: outlet.top };
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
    const crossX = Math.round((hydrantBranches[hydrantBranches.length - 1].x + sprinklerBranches[0].x) / 2);
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
    svg += `<path class="scada-manifold-pipe" data-role="header" style="stroke:${bottomGrad}" d="M${leftX},${bottomHeaderY} L${rightX},${bottomHeaderY}"></path>`;
    let segX = leftX;
    branches.forEach(b => {
        svg += `<path class="scada-flow-overlaypipe" data-flow-group="bottom-${b.pump.id}" d="M${segX},${bottomHeaderY} L${b.x},${bottomHeaderY}"></path>`;
        segX = b.x;
    });
    branches.forEach(b => {
        const topY = b.pump.line === 'hydrant' ? hydrantHeaderY : sprinklerHeaderY;
        addPipe(`M${b.x},${bottomHeaderY} L${b.x},${topY}`, false, b.x, `branch-${b.pump.id}`);
    });
    // Hydrant Line: body stays one piece; overlay segmented per feeding branch, lit
    // left-to-right starting at the leftmost running pump, through to the outlet.
    const hydrantGrad = pipeGrad(true, hydrantHeaderY);
    svg += `<path class="scada-manifold-pipe" data-role="header" style="stroke:${hydrantGrad}" d="M${hydrantBranches[0].x},${hydrantHeaderY} L${rightX},${hydrantHeaderY}"></path>`;
    hydrantBranches.forEach((b, i) => {
        const nextX = i + 1 < hydrantBranches.length ? hydrantBranches[i + 1].x : rightX;
        svg += `<path class="scada-flow-overlaypipe" data-flow-group="hline-${b.pump.id}" d="M${b.x},${hydrantHeaderY} L${nextX},${hydrantHeaderY}"></path>`;
    });

    // Sprinkler Line: same idea, but its leftmost segment is fed by the cross-connect
    // (from the hydrant side) rather than a pump branch directly.
    const sprinklerGrad = pipeGrad(true, sprinklerHeaderY);
    svg += `<path class="scada-manifold-pipe" data-role="header" style="stroke:${sprinklerGrad}" d="M${crossX},${sprinklerHeaderY} L${rightX},${sprinklerHeaderY}"></path>`;
    const sprinklerPoints = [{ x: crossX, group: 'cross' }, ...sprinklerBranches.map(b => ({ x: b.x, group: b.pump.id }))];
    sprinklerPoints.forEach((p, i) => {
        const nextX = i + 1 < sprinklerPoints.length ? sprinklerPoints[i + 1].x : rightX;
        svg += `<path class="scada-flow-overlaypipe" data-flow-group="sline-${p.group}" d="M${p.x},${sprinklerHeaderY} L${nextX},${sprinklerHeaderY}"></path>`;
    });

    addPipe(`M${crossX},${sprinklerHeaderY} L${crossX},${hydrantHeaderY}`, false, crossX, 'cross');
    svg += `<image id="scadaCrossValve" class="scada-valve-img" href="assets/valve.png" x="${crossX - 11}" y="${(crossMidY - 15.8).toFixed(1)}" width="22" height="22" transform="rotate(90 ${crossX} ${crossMidY})"></image>`;
    svg += `<text x="${rightX - 4}" y="${hydrantHeaderY - 6}" text-anchor="end" class="scada-manifold-header-label">Hydrant Line</text>`;
    svg += `<text x="${rightX - 4}" y="${sprinklerHeaderY - 6}" text-anchor="end" class="scada-manifold-header-label">Sprinkler Line</text>`;
    pipesGroup.innerHTML = `<defs>${defs.join('')}</defs>${svg}`;
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

// ---------------------------------------------
// EMS Renewable Dashboard (UI mock-up - sample data; backend wiring TBD)
// ---------------------------------------------
const EMS_GREEN = { pctGreen: 94, co2: 1074, co2Prev: 0, totalGreenPrev: 15.00, totalGreenCurr: 0, totalUnitsPrev: 15.84, totalUnitsCurr: 0, monthPrev: 'February - 2026', monthCurr: 'March - 2026' };
const EMS_SOURCES = [
    { name: 'GCP Solar', icon: 'solar', prev: 2.89, prevPct: 19, curr: 0, currPct: 0 },
    { name: '3rd party Solar', icon: 'solar', prev: 5.17, prevPct: 34, curr: 0, currPct: 0 },
    { name: '3rd party Wind', icon: 'wind', prev: 0.00, prevPct: 0, curr: 0, currPct: 0 },
    { name: 'IEX Renewable', icon: 'recycle', prev: 6.56, prevPct: 44, curr: 0, currPct: 0 },
    { name: 'Roof Top Solar', icon: 'solar', prev: 0.38, prevPct: 3, curr: 0, currPct: 0 }
];
const EMS_VOC = {
    totalStation: 12, liveStation: 12, monitoringPct: 100, spec: '0 - 100 ppm',
    labels: ['STA-1', 'STA-2', 'STA-3', 'STA-4', 'STA-5', 'STA-6', 'STA-7', 'STA-8', 'STA-9', 'STA-10', 'STA-11', 'STA-12'],
    values: [0, 3, 4, 8, 0, 7, 6, 5, 1, 0, 0, 0],
    gaugeValue: 12, gaugeMax: 110
};
const EMS_SOLAR = {
    live: 0, today: 4378, yesterday: 4009, mtd: 109335,
    labels: ['03:00', '04:00', '05:00', '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00'],
    values: [0, 0, 0, 5, 60, 180, 320, 430, 610, 560, 480, 640, 560, 430, 330, 190, 70, 10, 0, 0, 0]
};
const EMS_CONTRIB = { labels: ['FY 25-26', 'FY 26-27', 'Jul - 2026', 'Aug - 2026'], values: [54, 87, 94, 0] };

let emsCharts = {};

function emsValClass(v) {
    return (v > 0) ? 'neon' : 'muted';
}

function emsIconSvg(kind) {
    if (kind === 'wind') return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#60a5fa" stroke-width="1.5"><path d="M3 12h10a3 3 0 1 0-3-3"/><path d="M3 17h13a3 3 0 1 1-3 3"/><path d="M3 7h7a2 2 0 1 0-2-2"/></svg>';
    if (kind === 'recycle') return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#22c55e" stroke-width="1.5"><path d="M7 19l-2-3 2-3M17 5l2 3-2 3M12 3v4M12 21v-4M5 8l3-3M19 16l-3 3"/></svg>';
    return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#facc15" stroke-width="1.5"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
}

function emsGaugeSvg(value, max) {
    const pct = Math.max(0, Math.min(1, value / max));
    const deg = pct * 180 - 90;
    return `
        <svg viewBox="0 0 120 65" class="ems-gauge-svg">
            <path d="M10,60 A50,50 0 0 1 44.55,12.45" class="ems-gauge-zone ok"></path>
            <path d="M44.55,12.45 A50,50 0 0 1 75.45,12.45" class="ems-gauge-zone warn"></path>
            <path d="M75.45,12.45 A50,50 0 0 1 110,60" class="ems-gauge-zone fault"></path>
            <line x1="60" y1="60" x2="60" y2="22" class="ems-needle" transform="rotate(${deg} 60 60)"></line>
            <circle cx="60" cy="60" r="4" class="ems-needle-hub"></circle>
        </svg>
        <div class="ems-gauge-value">${value} <span>Values in PPM</span></div>
        <div class="ems-gauge-title">Actual Status</div>
    `;
}

function emsValueLabelPlugin(color) {
    return {
        id: 'emsValueLabels',
        afterDatasetsDraw(chart) {
            const ctx = chart.ctx;
            chart.data.datasets.forEach((ds, i) => {
                chart.getDatasetMeta(i).data.forEach((bar, idx) => {
                    const val = ds.data[idx];
                    ctx.save();
                    ctx.fillStyle = color;
                    ctx.font = '11px Inter, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(val, bar.x, bar.y - 6);
                    ctx.restore();
                });
            });
        }
    };
}

function renderEmsRenewable() {
    document.getElementById('emsMonthToggle').textContent = `${EMS_GREEN.monthPrev} | ${EMS_GREEN.monthCurr}`;
    document.getElementById('emsPctGreen').textContent = EMS_GREEN.pctGreen + '%';
    document.getElementById('emsCo2').innerHTML = `${EMS_GREEN.co2} <span class="unit">Tons</span> | <span class="${emsValClass(EMS_GREEN.co2Prev)}">${EMS_GREEN.co2Prev}</span> <span class="unit">Tons</span>`;
    document.getElementById('emsTotalGreen').innerHTML = `Total Green Power : <b>${EMS_GREEN.totalGreenPrev.toFixed(2)} Lakhs kWh</b> | <b class="${emsValClass(EMS_GREEN.totalGreenCurr)}">${EMS_GREEN.totalGreenCurr} kWh</b>`;
    document.getElementById('emsTotalUnits').innerHTML = `Total Units : <b>${EMS_GREEN.totalUnitsPrev.toFixed(2)} Lakhs kWh</b> | <b class="${emsValClass(EMS_GREEN.totalUnitsCurr)}">${EMS_GREEN.totalUnitsCurr} kWh</b>`;

    document.getElementById('emsSourceTableBody').innerHTML = EMS_SOURCES.map(s => `
        <tr>
            <td class="ems-source-name">${emsIconSvg(s.icon)} <span>${s.name}</span></td>
            <td>${s.prev.toFixed(2)}</td>
            <td class="${emsValClass(s.prevPct)}">${s.prevPct} %</td>
            <td>${s.curr.toFixed(2)}</td>
            <td class="${emsValClass(s.currPct)}">${s.currPct} %</td>
        </tr>
    `).join('');
    const footerPct = document.getElementById('emsSourceFooterPct');
    footerPct.textContent = '0 %';
    footerPct.className = emsValClass(0);

    document.getElementById('emsTotalStation').textContent = EMS_VOC.totalStation;
    document.getElementById('emsLiveStation').textContent = EMS_VOC.liveStation;
    document.getElementById('emsMonitoringStage').textContent = EMS_VOC.monitoringPct + ' %';
    document.getElementById('emsSpec').textContent = EMS_VOC.spec;
    document.getElementById('emsGauge').innerHTML = emsGaugeSvg(EMS_VOC.gaugeValue, EMS_VOC.gaugeMax);

    const liveEl = document.getElementById('emsLive');
    liveEl.textContent = EMS_SOLAR.live;
    liveEl.className = 'ems-stat-value ' + emsValClass(EMS_SOLAR.live);
    document.getElementById('emsToday').textContent = EMS_SOLAR.today;
    document.getElementById('emsYesterday').textContent = EMS_SOLAR.yesterday;
    document.getElementById('emsMtd').textContent = EMS_SOLAR.mtd;

    emsRenderCharts();
}

function emsRenderCharts() {
    Object.values(emsCharts).forEach(c => c.destroy());
    emsCharts = {};

    const isLightMode = document.body.classList.contains('light-mode');
    const textColor = isLightMode ? '#57606f' : '#9ca3af';
    const gridColor = isLightMode ? '#e5e5ea' : '#1a1a1a';
    const labelColor = isLightMode ? '#1d1d1f' : '#e5e7eb';

    emsCharts.donut = new Chart(document.getElementById('emsDonutChart'), {
        type: 'doughnut',
        data: {
            labels: ['GCP Solar', '3rd party Solar', 'IEX Renewable', 'Roof Top Solar'],
            datasets: [{ data: [19, 34, 44, 3], backgroundColor: ['#a855f7', '#3b82f6', '#1e3a8a', '#22c55e'], borderWidth: 0 }]
        },
        options: {
            cutout: '55%',
            maintainAspectRatio: false,
            plugins: { legend: { display: false } }
        }
    });

    emsCharts.voc = new Chart(document.getElementById('emsVocChart'), {
        type: 'bar',
        data: { labels: EMS_VOC.labels, datasets: [{ data: EMS_VOC.values, backgroundColor: '#ec4899', borderRadius: 3, maxBarThickness: 28 }] },
        options: {
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: textColor, font: { size: 9 }, minRotation: 90, maxRotation: 90 }, grid: { display: false } },
                y: { ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor }, title: { display: true, text: 'ppm in %', color: textColor, font: { size: 10 } } }
            }
        }
    });

    const solarCtx = document.getElementById('emsSolarChart').getContext('2d');
    const solarGrad = solarCtx.createLinearGradient(0, 0, 0, 220);
    solarGrad.addColorStop(0, 'rgba(57,255,20,0.45)');
    solarGrad.addColorStop(1, 'rgba(57,255,20,0)');
    emsCharts.solar = new Chart(solarCtx, {
        type: 'line',
        data: {
            labels: EMS_SOLAR.labels,
            datasets: [{ data: EMS_SOLAR.values, borderColor: '#39ff14', backgroundColor: solarGrad, fill: true, tension: 0.4, pointRadius: 2, pointBackgroundColor: isLightMode ? '#ffffff' : '#0a0a0a' }]
        },
        options: {
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor }, title: { display: true, text: 'Time', color: textColor, font: { size: 10 } } },
                y: { ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor }, title: { display: true, text: 'KW', color: textColor, font: { size: 10 } } }
            }
        }
    });

    emsCharts.contrib = new Chart(document.getElementById('emsContribChart'), {
        type: 'bar',
        data: { labels: EMS_CONTRIB.labels, datasets: [{ data: EMS_CONTRIB.values, backgroundColor: '#22c55e', borderRadius: 3, maxBarThickness: 60 }] },
        options: {
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            layout: { padding: { top: 20 } },
            scales: {
                x: { ticks: { color: textColor, font: { size: 10 } }, grid: { display: false } },
                y: { ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } }
            }
        },
        plugins: [emsValueLabelPlugin(labelColor)]
    });
}

// ---------------------------------------------
// EB Real Time Monitoring Dashboard (UI mock-up - sample data; backend wiring TBD)
// ---------------------------------------------
const EB_PHASES = [
    { phase: 'A', v1: 48464, v2: 151978 },
    { phase: 'B', v1: 45777, v2: 46006 },
    { phase: 'C', v1: 0, v2: 50758 }
];
const EB_DEMAND = { max: 9465, maxLimit: 9350, present: 8800 };
const EB_POWERFAIL = { duration: '0h : 0m : 0s', count: 0 };
const EB_FILTERS = ['ALL', 'Voltage (V)', 'Frequency (Hz)', 'Power Factor (PF)', 'Current (A)', 'Power Failure Duration', 'Power Failure Count', 'Energy Consumption', 'Max Demand (kVA)'];
const EB_GAUGES = [
    { id: 'voltage', title: 'Voltage (kV)', min: 0, max: 40, value: 32, zones: [{ to: 25, color: '#ef4444' }, { to: 30, color: '#eab308' }, { to: 35, color: '#22c55e' }, { to: 37.5, color: '#eab308' }, { to: 40, color: '#ef4444' }], display: '32' },
    { id: 'current', title: 'Current (A)', min: 0, max: 200, value: 139, zones: [{ to: 150, color: '#22c55e' }, { to: 175, color: '#eab308' }, { to: 200, color: '#ef4444' }], display: '139' },
    { id: 'frequency', title: 'Frequency (Hz)', min: 45, max: 55, value: 50, zones: [{ to: 46.5, color: '#ef4444' }, { to: 48, color: '#eab308' }, { to: 51, color: '#22c55e' }, { to: 53, color: '#eab308' }, { to: 55, color: '#ef4444' }], display: '50' },
    { id: 'activepower', title: 'Active Power (kW)', min: 0, max: 9000, value: 7711, zones: [{ to: 7500, color: '#22c55e' }, { to: 8250, color: '#eab308' }, { to: 9000, color: '#ef4444' }], display: '7711', warn: true },
    { id: 'powerfactor', title: 'Power Factor (PF)', min: 0.9, max: 1, value: 0.99, zones: [{ to: 0.95, color: '#ef4444' }, { to: 0.96, color: '#eab308' }, { to: 1, color: '#22c55e' }], display: '0.99' }
];
const EB_TIME_LABELS = ['03:00', '04:00', '05:00', '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00'];
const EB_CHARTS = [
    { id: 'ebChartVoltage', title: 'Voltage (V)', values: [null, null, null, 32420, 32460, 32480, 32450, 32500, 32560, 32480, 32420, 32440, 32560, 32520, 32480, 32450, 32460, null, null, null, null] },
    { id: 'ebChartFrequency', title: 'Frequency (Hz)', values: [null, null, null, null, 50.02, 50.06, 50.08, 50.04, 50.02, 50.00, 50.01, 50.00, 50.00, 50.00, 50.00, null, null, null, null, null, null] },
    { id: 'ebChartPf', title: 'Power Factor (PF)', values: [0.982, 0.981, 0.983, 0.984, 0.983, 0.986, 0.988, 0.985, 0.998, 0.996, 0.999, 0.997, 0.999, 0.998, 0.999, 0.998, 0.999, 0.998, 0.999, 0.999, 0.999] },
    { id: 'ebChartCurrent', title: 'Current (A)', values: [null, 148, 145, 149, 147, 146, 144, 145, 142, 140, 139, 138, 137, 136, 135, 133, null, 132, 133, 139, null] }
];

let ebCharts = {};

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

function ebGaugeSvg(cfg) {
    const angle = v => 135 + 270 * (Math.max(cfg.min, Math.min(cfg.max, v)) - cfg.min) / (cfg.max - cfg.min);
    let prev = cfg.min, arcs = '';
    cfg.zones.forEach(z => {
        arcs += `<path d="${ebDescribeArc(60, 60, 46, angle(prev), angle(z.to))}" class="eb-gauge-zone" stroke="${z.color}"></path>`;
        prev = z.to;
    });
    const tip = ebPolarToCartesian(60, 60, 38, angle(cfg.value));
    return `<svg viewBox="0 0 120 120" class="eb-gauge-svg">
        ${arcs}
        <line x1="60" y1="60" x2="${tip.x.toFixed(1)}" y2="${tip.y.toFixed(1)}" class="eb-needle"></line>
        <circle cx="60" cy="60" r="5" class="eb-needle-hub"></circle>
    </svg>`;
}

function renderEbRtm() {
    document.getElementById('ebPhaseTable').innerHTML = EB_PHASES.map(p => `
        <tr>
            <td class="eb-phase-label">${p.phase}</td>
            <td class="eb-phase-val">${p.v1}</td>
            <td class="eb-phase-val">${p.v2}</td>
        </tr>
    `).join('');
    document.getElementById('ebMaxDemand').textContent = EB_DEMAND.max;
    document.getElementById('ebMaxLimit').textContent = EB_DEMAND.maxLimit + ' kVA';
    document.getElementById('ebPresentDemand').textContent = EB_DEMAND.present;
    document.getElementById('ebPfDuration').textContent = EB_POWERFAIL.duration;
    document.getElementById('ebPfCount').textContent = EB_POWERFAIL.count;

    document.getElementById('ebFilterBar').innerHTML = EB_FILTERS.map((f, i) => `
        <button class="eb-filter-btn${i === 0 ? ' active' : ''}">${f}</button>
    `).join('');

    document.getElementById('ebGaugeRow').innerHTML = EB_GAUGES.map(g => `
        <div class="eb-gauge-card">
            <div class="eb-gauge-title">${g.title}</div>
            ${ebGaugeSvg(g)}
            <div class="eb-gauge-value${g.warn ? ' warn' : ''}">${g.display}</div>
        </div>
    `).join('');

    ebRenderCharts();
}

function ebRenderCharts() {
    Object.values(ebCharts).forEach(c => c.destroy());
    ebCharts = {};

    const isLightMode = document.body.classList.contains('light-mode');
    const textColor = isLightMode ? '#57606f' : '#9ca3af';
    const gridColor = isLightMode ? '#e5e5ea' : '#1a1a1a';

    EB_CHARTS.forEach(cfg => {
        const ctx = document.getElementById(cfg.id).getContext('2d');
        const grad = ctx.createLinearGradient(0, 0, 0, 180);
        grad.addColorStop(0, 'rgba(57,255,20,0.4)');
        grad.addColorStop(1, 'rgba(57,255,20,0)');
        ebCharts[cfg.id] = new Chart(ctx, {
            type: 'line',
            data: {
                labels: EB_TIME_LABELS,
                datasets: [{ data: cfg.values, borderColor: '#39ff14', backgroundColor: grad, fill: true, tension: 0.4, pointRadius: 2, pointBackgroundColor: isLightMode ? '#ffffff' : '#0a0a0a', spanGaps: false }]
            },
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

function logout() {
    sessionStorage.removeItem('isLoggedIn');
    sessionStorage.removeItem('empId');
    sessionStorage.removeItem('username');

    // Optional: Visual feedback before redirect can be added here if needed
    window.location.href = 'login.html';
}

function handleEnter(e) {
    console.log("Key pressed:", e.key, e.keyCode);
    if (e.key === 'Enter' || e.keyCode === 13) {
        e.preventDefault(); // Prevent default form submission or newline
        fetchAbsDetails();
    }
}

async function fetchAbsDetails() {
    const absInput = document.getElementById('absInput');
    const messageEl = document.getElementById('scanMessage');
    const abs = absInput.value.trim();

    // Reset message
    messageEl.textContent = '';
    messageEl.className = 'scan-message';

    // Clear previous inspection data immediately
    document.getElementById('inspection-area').style.display = 'none';
    document.getElementById('alreadyCompletedLink').style.display = 'none'; // Reset Link
    currentAbs = '';
    currentModel = '';

    // Validate Length
    if (abs.length !== 11) {
        // Show error inline with animation
        messageEl.textContent = `${abs} - Invalid ABS scanned!`;

        // Force reflow to restart animation
        messageEl.classList.remove('show');
        void messageEl.offsetWidth; // trigger reflow
        messageEl.classList.add('show');
        absInput.value = ''; // Clear input on invalid length
        return;
    }

    try {
        const res = await fetch(`${API_BASE}/scan/${abs}`);

        if (!res.ok) {
            const errorText = await res.text();
            throw new Error(errorText || "Failed to fetch or Bad Request from Server");
        }

        const data = await res.json();

        // CHECK HISTORY (Validation for Rework/Completed logic)
        try {
            const histRes = await fetch(`${API_BASE}/history/${data.absNumber}`);
            if (histRes.ok && histRes.status !== 204) {
                const history = await histRes.json();
                if (history && (history.status === 'P' || history.status === 'RP')) {
                    handleAlreadyCompleted(data.absNumber, history.status, history);
                    return; // Stop processing
                }

                if (history && history.status === 'R') {
                    messageEl.textContent = "Resuming Rework Inspection";
                    messageEl.classList.add('show', 'warning-message');
                }
            }
        } catch (histErr) {
            if (histErr.message === "Inspection already completed") throw histErr;
            console.warn("History check failed, proceeding as new", histErr);
        }

        currentAbs = data.absNumber;
        currentModel = data.model;

        // Format Date
        let formattedDate = 'N/A';
        if (data.testedDate) {
            const dateObj = new Date(data.testedDate);
            formattedDate = dateObj.toLocaleDateString('en-GB', {
                day: 'numeric', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: true
            }).toUpperCase();
        }

        document.getElementById('displayKit').textContent = data.absKitNumber || 'N/A';
        document.getElementById('displayDate').textContent = formattedDate;

        currentChecklist = data.checklist.map(item => ({ ...item, status: null }));
        initialReworkState = null; // Reset for new scan

        // Apply Rework Pre-fill and History Display
        const histRes2 = await fetch(`${API_BASE}/history/${data.absNumber}`);
        if (histRes2.ok && histRes2.status !== 204) {
            const h = await histRes2.json();
            if (h && h.status === 'R') {
                // Pre-fill Logic from Full Checklist History
                if (h.checklist && h.checklist.length > 0) {
                    // Find Max Iteration
                    let maxIter = 0;
                    h.checklist.forEach(c => { if (c.iterationId > maxIter) maxIter = c.iterationId; });

                    h.checklist.forEach(prevItem => {
                        if (prevItem.iterationId === maxIter) {
                            const item = currentChecklist.find(c => c.id === prevItem.id);
                            if (item) {
                                // Status is already boolean in new API response
                                item.status = prevItem.status;
                            }
                        }
                    });
                }

                // Capture initial state for validation
                initialReworkState = currentChecklist.map(i => ({ id: i.id, status: i.status }));

                // Load Visual History (now we can optimize this too, but leaving for now)
                await loadReworkHistory(data.absNumber);
            } else {
                // Clear history if not rework
                document.getElementById('reworkHistoryContainer').innerHTML = '';
            }
        } else {
            document.getElementById('reworkHistoryContainer').innerHTML = '';
        }





        displayInspection();

    } catch (err) {
        // Show error inline with animation
        messageEl.textContent = `${abs} - ${err.message}`;

        // Force reflow to restart animation
        messageEl.classList.remove('show');
        void messageEl.offsetWidth; // trigger reflow
        messageEl.classList.add('show');

        // Clear input for all errors
        document.getElementById('absInput').value = '';

        // Clear input if blocked
        if (err.message === "Inspection already completed") {
            currentAbs = abs; // Keep the ABS for navigation reference
            absInput.value = '';

            // Show the Link Tile
            const linkTile = document.getElementById('alreadyCompletedLink');
            document.getElementById('linkAbs').textContent = abs;
            linkTile.style.display = 'block';
        }

        console.error(err);
    }
}

function handleAlreadyCompleted(abs, status, fullData) {
    const messageEl = document.getElementById('scanMessage');
    const linkTile = document.getElementById('alreadyCompletedLink');
    const absInput = document.getElementById('absInput');

    // 1. Show Green Success Message
    messageEl.textContent = "Inspection already completed";
    messageEl.className = 'scan-message show success'; // Add success class

    // Force reflow
    messageEl.classList.remove('show');
    void messageEl.offsetWidth;
    messageEl.classList.add('show');

    // 2. Clear Input & Set Navigation Ref
    currentAbs = abs;
    cachedCompletedSubmission = fullData; // Cache for direct modal access
    absInput.value = '';

    // 3. Configure Link Tile (Green Theme)
    document.getElementById('linkAbs').textContent = abs;
    linkTile.style.display = 'block';
    linkTile.classList.add('success'); // Green border/text

    // 4. Inject Badge for Straight Pass
    const badgeEl = document.getElementById('linkBadge');
    if (status === 'P') {
        badgeEl.innerHTML = '<span class="status-badge straight-pass" style="font-size: 10px; padding: 2px 8px;">Straight Pass</span>';
    } else {
        badgeEl.innerHTML = ''; // Clear if RP
    }
}

function displayInspection() {
    // Clear Input immediately when showing inspection
    document.getElementById('absInput').value = '';

    // Clear any previous submit errors
    const submitMsg = document.getElementById('submitMessage');
    if (submitMsg) {
        submitMsg.textContent = '';
        submitMsg.className = 'submit-message';
    }

    document.getElementById('displayAbs').textContent = currentAbs;
    document.getElementById('displayModel').textContent = currentModel;
    document.getElementById('inspection-area').style.display = 'flex';

    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('checklistBody');
    tbody.innerHTML = '';

    currentChecklist.forEach((item, index) => {
        const tr = document.createElement('tr');

        tr.innerHTML = `
            <td>${item.seqNo}</td>
            <td>${item.description}</td>
            <td>${item.specification}</td>
            <td>
                <div class="check-actions">
                    <button class="check-btn ok ${item.status === true ? 'active' : ''}" onclick="toggleStatus(${index}, true)">✓</button>
                    <button class="check-btn not-ok ${item.status === false ? 'active' : ''}" onclick="toggleStatus(${index}, false)">✕</button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

function toggleStatus(index, isOk) {
    // Toggle logic
    if (currentChecklist[index].status === isOk) {
        currentChecklist[index].status = null; // deselect
    } else {
        currentChecklist[index].status = isOk;
    }
    renderTable();
}

async function submitPdi() {
    const messageEl = document.getElementById('submitMessage');
    messageEl.textContent = ''; // Reset
    messageEl.className = 'submit-message'; // Reset classes

    // Validate Checklist Existence
    if (!currentChecklist || currentChecklist.length === 0) {
        messageEl.textContent = "No Checklist available for Inspection. Please add checklist and try again!";
        messageEl.classList.add('error'); // Ensure it looks like an error (red)
        return;
    }

    // Validate ABS Kit Existence
    const absKit = document.getElementById('displayKit').textContent;
    if (!absKit || absKit === 'N/A' || absKit.toLowerCase() === 'unknown') {
        messageEl.textContent = "ABS Kit is unavailable. Please contact Admin!";
        messageEl.classList.add('error');
        return;
    }

    // Validate all answered?
    const unanswered = currentChecklist.filter(i => i.status === null);
    if (unanswered.length > 0) {
        messageEl.textContent = `Please complete all ${unanswered.length} items before submitting.`;
        messageEl.classList.add('error');
        return;
    }

    // NEW: Rework Duplicate Check
    // If we have an initial state (meaning it was Rework), check if ANY change was made
    if (initialReworkState) {
        // Check if every item matches the initial state exactly
        const isIdentical = currentChecklist.every(curr => {
            const init = initialReworkState.find(i => i.id === curr.id);
            // Return true if matches
            return init && init.status === curr.status;
        });

        if (isIdentical) {
            messageEl.textContent = "Please clear the defects or raise new defects";
            messageEl.classList.add('error');
            return;
        }
    }

    // Prepare Payload matching PdiSubmission model
    const payload = {
        absModulator: currentAbs,
        absKit: document.getElementById('displayKit').textContent, // Get from UI or store globally
        model: currentModel,
        checklist: currentChecklist.map(i => ({
            id: i.id,
            description: i.description,
            specification: i.specification,
            status: i.status // boolean
        })),
        testedDate: new Date().toISOString(), // Or keep original? Backend sets CreatedDate.
        testedEmployeeId: sessionStorage.getItem('empId') || 'Unknown'
    };

    try {
        const res = await fetch(`${API_BASE}/submit`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (res.ok) {
            const result = await res.json(); // May return { status: "P", message: "..." }

            // Better UX: Show Success Message/Toast
            showSuccessPopup(result.status);

            // Reset
            absInput.value = '';

            // Clear Scan Message
            const scanMsg = document.getElementById('scanMessage');
            if (scanMsg) {
                scanMsg.textContent = '';
                scanMsg.className = 'scan-message'; // Reset to default class
            }

            document.getElementById('inspection-area').style.display = 'none';
            currentChecklist = [];
            currentAbs = '';

            // Optional: Auto-focus input for next scan
            document.getElementById('absInput').focus();

        } else {
            const errText = await res.text();
            alert(`Submission Failed: ${errText}`);
        }
    } catch (err) {
        console.error(err);
        alert('Error submitting data');
    }
}

// Global Submissions for Modal Access
let currentSubmissions = [];
let pendingHighlightAbs = null; // For navigation from Scan

function navigateToHistory() {
    if (cachedCompletedSubmission) {
        openHistoryModal(null, cachedCompletedSubmission);
        return;
    }

    // Fallback if no cached data (shouldn't happen in this flow)
    if (!currentAbs) return;
    pendingHighlightAbs = currentAbs;
    switchTab('completed');
}

// Pagination State
// Pagination State
let pageState = {
    rework: 1,
    completed: 1,
    reports: 1
};
const ITEMS_PER_PAGE = 12;
const ITEMS_PER_REPORT_PAGE = 10;


function changeReportPage(delta) {
    const newPage = pageState.reports + delta;
    if (newPage < 1) return;

    pageState.reports = newPage;
    fetchSubmissions('reports', false, true); // keepPage = true
}

// Search State
let isSearchActive = false;

// --- Reports Features ---

function renderReportsTable(data, isLoadMore) {
    const tbody = document.getElementById('reportsBody');
    const emptyState = document.getElementById('reportsEmpty');
    const tableContainer = document.querySelector('#tab-reports .table-container');

    if (!isLoadMore) tbody.innerHTML = '';

    if (!data || data.length === 0) {
        if (!isLoadMore) {
            emptyState.style.display = 'block';
            tableContainer.style.display = 'none';
        }
        return;
    }

    emptyState.style.display = 'none';
    tableContainer.style.display = 'block';

    data.forEach((item, index) => {
        const row = document.createElement('tr');
        row.style.borderBottom = '1px solid #333';
        row.style.color = '#e0e0e0';

        // S.No (Pagination Aware)
        // (Page - 1) * Limit + Index + 1
        const limit = ITEMS_PER_REPORT_PAGE;
        const page = pageState.reports;
        const sNo = ((page - 1) * limit) + (index + 1);

        // Status Badge logic
        let statusBadge = '';
        if (item.status === 'P') statusBadge = '<span class="status-badge status-pass">Pass</span>';
        else if (item.status === 'F') statusBadge = '<span class="status-badge status-rework">Fail</span>';
        else if (item.status === 'R') statusBadge = '<span class="status-badge status-rework">Rework</span>';
        else if (item.status === 'RP') statusBadge = '<span class="status-badge status-pass">Rework Pass</span>';
        else statusBadge = item.status;

        let dateStr = '-';
        if (item.testedDate) {
            const d = new Date(item.testedDate);
            dateStr = d.toLocaleDateString('en-GB', {
                day: 'numeric', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: true
            }).toUpperCase();
        }

        // Find true index in global store for modal
        const trueIndex = currentSubmissions.indexOf(item);

        row.innerHTML = `
            <td style="padding: 10px;">${sNo}</td>
            <td style="padding: 10px;">${item.absModulator}</td>
            <td style="padding: 10px;">${item.absKit || '-'}</td>
            <td style="padding: 10px;">${item.model || '-'}</td>
            <td style="padding: 10px;">${statusBadge}</td>
            <td style="padding: 10px;">${dateStr}</td>
            <td style="padding: 10px;">${item.testedEmployeeId || '-'}</td>
            <td style="padding: 10px;">
                <button class="btn-history-modern" onclick="openHistoryModal(${trueIndex})" title="View Iteration History">
                     <span class="material-symbols-outlined">visibility</span>
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function fetchModels() {
    try {
        const res = await fetch(`${API_BASE}/models`);
        if (res.ok) {
            const models = await res.json();
            const select = document.getElementById('reportsModel');
            if (select) {
                select.innerHTML = '<option value="">All Models</option>';
                models.forEach(m => {
                    const opt = document.createElement('option');
                    opt.value = m;
                    opt.textContent = m;
                    select.appendChild(opt);
                });
            }
        }
    } catch (e) {
        console.error("Failed to fetch models", e);
    }
}

async function exportToExcel() {
    // Collect filters
    const sInput = document.getElementById('reportsStart');
    const eInput = document.getElementById('reportsEnd');
    const searchInput = document.getElementById('reportsSearch');
    const modelInput = document.getElementById('reportsModel');

    let query = `?limit=100000&status=reports`; // Fetch ALL records
    if (sInput && sInput.value) query += `&start=${encodeURIComponent(sInput.value)}`;
    if (eInput && eInput.value) query += `&end=${encodeURIComponent(eInput.value)}`;
    if (searchInput && searchInput.value) query += `&q=${encodeURIComponent(searchInput.value)}`;
    if (modelInput && modelInput.value) query += `&model=${encodeURIComponent(modelInput.value)}`;

    try {
        const res = await fetch(`${API_BASE}/submissions${query}`);
        if (!res.ok) throw new Error("Export Fetch Failed");
        const data = await res.json();

        if (!data || data.length === 0) {
            alert("No data to export");
            return;
        }

        // --- 1. Analytics & Pre-processing ---
        let total = data.length;
        let passCount = 0;
        let reworkCount = 0;
        let reworkPassCount = 0;

        data.forEach(item => {
            // Normalize Status
            let status = item.status || 'UNKNOWN';
            if (status === 'P') status = 'PASS';
            if (status === 'R') status = 'REWORK';
            if (status === 'RP') status = 'REWORK PASS';

            item.status = status; // Update item for export

            if (status === 'PASS') passCount++;
            else if (status === 'REWORK') reworkCount++;
            else if (status === 'REWORK PASS') reworkPassCount++;
        });

        // --- 2. Build Excel ---
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('PDI Reports');

        // Fetch Logo
        const logoRes = await fetch('assets/logo-small.png');
        const logoBlob = await logoRes.blob();
        const logoBuffer = await logoBlob.arrayBuffer();
        const logoId = workbook.addImage({
            buffer: logoBuffer,
            extension: 'png',
        });

        // Add Logo (Top Left)
        sheet.addImage(logoId, {
            tl: { col: 0, row: 0 },
            ext: { width: 80, height: 80 }
        });

        // Title (Moved to B Column)
        sheet.mergeCells('B2:F2');
        const titleCell = sheet.getCell('B2');
        titleCell.value = 'ABS PRE-DELIVERY INSPECTION REPORTS';
        titleCell.font = { name: 'Arial', size: 18, bold: true, color: { argb: 'FFD71920' } };
        titleCell.alignment = { vertical: 'middle', horizontal: 'left' };

        // Generated info (Moved to B Column)
        sheet.mergeCells('B3:F3');
        const genCell = sheet.getCell('B3');
        const generatedDateStr = new Date().toLocaleString('en-GB', {
            day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true
        }).toUpperCase();
        genCell.value = `Generated on: ${generatedDateStr}`;
        genCell.font = { italic: true, size: 10 };


        // --- Summary Table (Row 6) ---
        const summaryStartRow = 6;
        sheet.getCell(`B${summaryStartRow}`).value = "SUMMARY STATISTICS";
        sheet.getCell(`B${summaryStartRow}`).font = { bold: true, color: { argb: 'FFD71920' } };

        const summaryData = [
            ["Total Inspections", total],
            ["Straight Pass", passCount],
            ["In Rework", reworkCount],
            ["Rework Passed", reworkPassCount]
        ];

        summaryData.forEach((row, i) => {
            const r = summaryStartRow + 1 + i;
            sheet.getCell(`B${r}`).value = row[0];
            sheet.getCell(`C${r}`).value = row[1];
            sheet.getCell(`B${r}`).border = { left: { style: 'thin' }, top: { style: 'thin' }, bottom: { style: 'thin' } };
            sheet.getCell(`C${r}`).border = { right: { style: 'thin' }, top: { style: 'thin' }, bottom: { style: 'thin' } };
            // Optional: Background for labels
            sheet.getCell(`B${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F5F5' } };
            sheet.getCell(`B${r}`).font = { bold: true };
        });


        // --- Main Data Table (Start Row 15) ---
        // Moved up since graph is gone
        const headerRowIdx = 15;
        const headers = ["S.No", "ABS Modulator", "ABS Kit", "Model", "Make", "Status", "PDI Date", "Inspected By"];
        const headerRow = sheet.getRow(headerRowIdx);
        headerRow.values = headers;

        // Header Styling
        headerRow.eachCell((cell) => {
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD71920' } };
            cell.font = { color: { argb: 'FFFFFFFF' }, bold: true };
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });

        // Data Rows
        data.forEach((item, idx) => {
            const rowIndex = headerRowIdx + 1 + idx;
            const row = sheet.getRow(rowIndex);

            let pdiDate = '';
            if (item.testedDate) {
                pdiDate = new Date(item.testedDate).toLocaleString('en-GB', {
                    day: 'numeric', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', hour12: true
                }).toUpperCase();
            }

            row.values = [
                idx + 1,
                item.absModulator,
                item.absKit || '',
                item.model || '',
                'Royal Enfield',
                item.status,
                pdiDate,
                item.testedEmployeeId || '' // Added for Excel Export
            ];

            row.eachCell((cell) => {
                cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
                cell.alignment = { horizontal: 'left' };
            });
            row.getCell(1).alignment = { horizontal: 'center' };
            row.getCell(6).alignment = { horizontal: 'center' };
        });

        // Widths
        sheet.getColumn(1).width = 8;
        sheet.getColumn(2).width = 20;
        sheet.getColumn(3).width = 25;
        sheet.getColumn(4).width = 15;
        sheet.getColumn(5).width = 15;
        sheet.getColumn(6).width = 18; // Status
        sheet.getColumn(7).width = 25;
        sheet.getColumn(8).width = 20; // Inspected By width

        // Download
        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
        saveAs(blob, `ABS_PDI_Report_Analytics_${new Date().toISOString().slice(0, 10)}.xlsx`);

    } catch (e) {
        console.error("Export Error", e);
        alert("Export failed. See console.");
    }
}

async function fetchSubmissions(statusType, isLoadMore = false, keepPage = false) {
    try {
        let sInput, eInput;
        // Select inputs based on context
        if (statusType === 'rework') {
            sInput = document.getElementById('reworkStart');
            eInput = document.getElementById('reworkEnd');
            searchInput = document.getElementById('reworkSearch');
        } else if (statusType === 'completed') {
            // Completed
            sInput = document.getElementById('completedStart');
            eInput = document.getElementById('completedEnd');
            searchInput = document.getElementById('completedSearch');
        } else {
            // Reports
            sInput = document.getElementById('reportsStart');
            eInput = document.getElementById('reportsEnd');
            searchInput = document.getElementById('reportsSearch');
        }

        const searchTerm = searchInput ? searchInput.value.trim() : '';
        const modelInput = document.getElementById('reportsModel');
        const modelValue = (statusType === 'reports' && modelInput) ? modelInput.value : '';

        // Reset Page logic
        if (!isLoadMore && !keepPage) {
            pageState[statusType] = 1;
            // If search is active, we might need to handle UI differently (clear filters?)
            // For now, if search term exists, it overrides filters.
        }

        // Select inputs based on context
        // Inputs selected above

        // Select inputs based on context
        // Inputs selected above

        let limit = ITEMS_PER_PAGE;
        if (statusType === 'reports') limit = ITEMS_PER_REPORT_PAGE;

        let query = `?page=${pageState[statusType]}&limit=${limit}`;
        // Add Status Mode to Query
        let statusParam = 'completed';
        if (statusType === 'rework') statusParam = 'rework';
        if (statusType === 'reports') statusParam = 'reports';

        query += `&status=${statusParam}`;

        // Add Model Logic
        if (modelValue) query += `&model=${encodeURIComponent(modelValue)}`;

        if (searchTerm) {
            query += `&q=${encodeURIComponent(searchTerm)}`;
            isSearchActive = true;
        } else {
            isSearchActive = false;
            // Only apply date filters if NO search term
            if (sInput && sInput.value) query += `&start=${encodeURIComponent(sInput.value)}`;
            if (eInput && eInput.value) query += `&end=${encodeURIComponent(eInput.value)}`;
        }

        const res = await fetch(`${API_BASE}/submissions${query}`);
        if (!res.ok) throw new Error("Failed to fetch history");

        const allSubmissions = await res.json();

        // Server now handles all filtering (Search + Status + Date).
        const filtered = allSubmissions;

        // Store for modal access
        // For pagination, we always replace currentSubmissions with the new page's data
        currentSubmissions = filtered;


        if (statusType === 'reports') {
            renderReportsTable(filtered, isLoadMore);
        } else {
            renderHistoryList(filtered, statusType, isLoadMore);
        }

        // Manage Load More / Pagination Visibility
        if (statusType === 'reports') {
            // Pagination Logic
            const pContainer = document.getElementById('reportsPagination');
            const btnPrev = document.getElementById('btnPrevReport');
            const btnNext = document.getElementById('btnNextReport');
            const pageLabel = document.getElementById('reportsPageLabel');

            if (allSubmissions.length === 0 && pageState.reports === 1) {
                pContainer.style.display = 'none';
            } else {
                pContainer.style.display = 'flex';

                // Fallback: If TotalCount is missing (backend issue?), use array length
                let count = 0;
                if (allSubmissions.length > 0) {
                    const first = allSubmissions[0];
                    // Check both camelCase and PascalCase
                    const t = (first.totalCount !== undefined) ? first.totalCount : first.TotalCount;
                    count = (t !== undefined) ? t : allSubmissions.length;
                }

                pageLabel.textContent = `Page ${pageState.reports}`;
                document.getElementById('reportsTotalCount').textContent = `Total Count: ${count}`;

                // Prev State
                btnPrev.disabled = (pageState.reports <= 1);
                btnPrev.style.opacity = (pageState.reports <= 1) ? 0.5 : 1;

                // Next State (Simple heuristic: if less than limit, no next)
                const hasNext = (allSubmissions.length === ITEMS_PER_REPORT_PAGE);
                btnNext.disabled = !hasNext;
                btnNext.style.opacity = !hasNext ? 0.5 : 1;
            }
        } else {
            // Standard Pagination for Rework/Completed (handled in renderHistoryList)
            // No need for loadMore button logic here anymore
        }

    } catch (err) {
        console.error(err);
    }
}

function changePage(statusType, direction) {
    const newPage = pageState[statusType] + direction;
    if (newPage < 1) return;

    pageState[statusType] = newPage;
    // We treat pagination as a fresh load (replace content), not append
    fetchSubmissions(statusType, false, true);
}

// Bind Search
function resetFilter(statusType) {
    const today = new Date();
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const startDefault = new Date(today.setHours(0, 15, 0, 0)); // 12:15 AM
    const endDefault = new Date(tomorrow.setHours(0, 15, 0, 0)); // Next Day 12:15 AM

    const sId = statusType === 'rework' ? 'reworkStart' : (statusType === 'completed' ? 'completedStart' : 'reportsStart');
    const eId = statusType === 'rework' ? 'reworkEnd' : (statusType === 'completed' ? 'completedEnd' : 'reportsEnd');

    const sInput = document.getElementById(sId);
    const eInput = document.getElementById(eId);

    if (sInput && sInput._flatpickr) sInput._flatpickr.setDate(startDefault);
    if (eInput && eInput._flatpickr) eInput._flatpickr.setDate(endDefault);

    // Refresh Data
    fetchSubmissions(statusType);
}

document.addEventListener('DOMContentLoaded', () => {
    const searchBtn = document.getElementById('searchBtn');
    if (searchBtn) {
        searchBtn.onclick = () => {
            const isRework = document.getElementById('tab-rework').classList.contains('active');
            fetchSubmissions(isRework ? 'rework' : 'completed');
        };
    }

    // Allow Enter key in Scoped Search inputs
    ['reworkSearch', 'completedSearch'].forEach(id => {
        const input = document.getElementById(id);
        if (input) {
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    e.preventDefault();
                    // Determine context based on ID or Active Tab?
                    // Safe to rely on active tab since these are IN the tab panes.
                    // Or explicit:
                    const type = id === 'reworkSearch' ? 'rework' : 'completed';
                    fetchSubmissions(type);
                }
            });
        }
    });

});

function renderHistoryList(items, tabId, isLoadMore = false) {
    let container = document.getElementById(`${tabId}-list-container`);
    if (!container) container = document.getElementById(`tab-${tabId}`);

    // Clear existing content for a fresh page load
    container.innerHTML = '';

    if (items.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <span class="material-symbols-outlined icon">${tabId === 'rework' ? 'build_circle' : 'check_circle'}</span>
                <h3>No items in ${tabId === 'rework' ? 'Rework' : 'Completed'}</h3>
            </div>
        `;
        // Inject Pagination Controls even for empty state to allow navigation back
        // Standardized Pagination (Mirrored from Main View)
        const prevDisabled = pageState[tabId] <= 1 ? 'disabled' : '';
        const nextDisabled = 'disabled'; // Always disabled for empty state if logic implies end of list

        let totalCount = 0;
        if (items.length > 0) {
            const first = items[0];
            const t = (first.totalCount !== undefined) ? first.totalCount : first.TotalCount;
            totalCount = (t !== undefined) ? t : 0;
        }

        const paginationHtml = `
            <div style="display:flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px; border-top: 1px solid #333; background: #1e1e1e; width: 100%; margin-top: 20px;">
                <span class="total-count-badge">Total Count: ${totalCount}</span>
                <div style="display:flex; align-items: center; gap: 12px;">
                    <button class="btn-pagination-modern" ${prevDisabled}
                        style="padding: 6px 12px; font-size: 13px;"
                        onclick="${pageState[tabId] > 1 ? `changePage('${tabId}', -1)` : ''}">
                        Previous
                    </button>
                    <span style="color: #cccccc; font-size: 13px; font-family: 'Inter', sans-serif; font-weight: 500; margin: 0 10px;">Page ${pageState[tabId]}</span>
                    <button class="btn-pagination-modern" ${nextDisabled}
                        style="padding: 6px 12px; font-size: 13px;">
                        Next
                    </button>
                </div>
            </div>
        `;
        container.insertAdjacentHTML('beforeend', paginationHtml);
        return;
    }

    // Create a wrapper for the list items
    const listWrapper = document.createElement('div');
    listWrapper.className = 'history-list';
    container.appendChild(listWrapper);

    let html = '';
    items.forEach((item, index) => {
        const trueIndex = currentSubmissions.indexOf(item);

        let statusHtml = '';
        let clickAttr = '';

        // "Straight Pass" Logic
        if (item.status === 'P') {
            statusHtml = `<span class="status-badge straight-pass">Straight Pass</span>`;
            // Add click event for Read-Only View
            clickAttr = `onclick="openHistoryModal(${trueIndex})"`;
        } else if (item.status === 'R') {
            statusHtml = `<span class="status-badge rework">Rework</span>`;
            clickAttr = `onclick="resumeRework('${item.absModulator}')"`;
        } else {
            // Handle RP or other statuses
            const label = item.status === 'RP' ? 'Rework Passed' : item.status;
            statusHtml = `<span class="status-badge ${item.status.toLowerCase()}">${label}</span>`;

            if (item.status === 'RP' || item.status === 'P') {
                clickAttr = `onclick="openHistoryModal(${trueIndex})"`;
            }
        }

        // Format Date
        let dateDisplay = 'N/A';
        if (item.testedDate) {
            const d = new Date(item.testedDate);
            dateDisplay = d.toLocaleDateString('en-GB', {
                day: 'numeric', month: 'short', year: 'numeric',
                hour: '2-digit', minute: '2-digit', hour12: true
            }).toUpperCase();
        }

        // Calculate Issues (Current vs Previous)
        let checklistData = item.checklist || [];
        let maxIter = 0;
        checklistData.forEach(c => { if (c.iterationId > maxIter) maxIter = c.iterationId; });

        // If no iteration data (legacy), treat all as current
        if (maxIter === 0) maxIter = 1;

        const currentIssues = checklistData.filter(c => (c.iterationId === maxIter || !c.iterationId) && !c.status).length;

        const prevIssuesSet = new Set();
        checklistData.forEach(c => {
            if (c.iterationId < maxIter && !c.status) {
                prevIssuesSet.add(c.id);
            }
        });
        const prevIssues = prevIssuesSet.size;

        let issuesHtml = `<strong>${currentIssues === 0 ? 'NIL' : currentIssues}</strong>`;
        let prevHtml = '';
        if (prevIssues > 0) {
            prevHtml = `<span style="font-size:0.85em; color:#888; font-weight:400;">(Prev: ${prevIssues})</span>`;
        }

        let idAttr = '';
        let extraClass = '';
        if (pendingHighlightAbs && item.absModulator === pendingHighlightAbs) {
            idAttr = `id="highlight-${item.absModulator}"`;
            extraClass = 'highlight-card';
        }

        // Compact Date Format for Card
        const shortDate = new Date(item.testedDate).toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short', year: '2-digit',
            hour: '2-digit', minute: '2-digit', hour12: true
        }).toUpperCase();

        html += `
            <div class="history-card ${extraClass}" ${idAttr} ${clickAttr}>
                <div class="card-header">
                    <span class="abs-num">${item.absModulator}</span>
                    ${statusHtml}
                </div>
                <div class="info-row">
                    <span style="font-weight:600; color:var(--dark)">${item.model || 'N/A'}</span>
                    <span style="font-size:11px">${shortDate}</span>
                </div>
                 <div class="info-row">
                    <span>Issues: ${issuesHtml}</span>
                    ${prevHtml}
                </div>
                 <div class="info-row" style="margin-top: 4px; border-top: 1px solid #333; padding-top: 4px;">
                    <span style="font-size:11px; color:#ccc;">Inspected By: <strong style="color: #fff;">${item.testedEmployeeId || 'N/A'}</strong></span>
                </div>
            </div>
        `;
    });

    listWrapper.insertAdjacentHTML('beforeend', html);

    // Inject Pagination Controls
    // Inject Pagination Controls (Mirrored from Reports with Inline Styles)
    const prevDisabled = pageState[tabId] <= 1 ? 'disabled' : '';
    const nextDisabled = items.length < ITEMS_PER_PAGE ? 'disabled' : '';

    let totalCount = 0;
    if (items.length > 0) {
        const first = items[0];
        const t = (first.totalCount !== undefined) ? first.totalCount : first.TotalCount;
        totalCount = (t !== undefined) ? t : 0;
    }

    const paginationHtml = `
        <div style="display:flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px; border-top: 1px solid #333; background: #1e1e1e; width: 100%; margin-top: 20px;">
            <span class="total-count-badge">Total Count: ${totalCount}</span>
            <div style="display:flex; align-items: center; gap: 12px;">
                <button class="btn-pagination-modern" ${prevDisabled}
                    style="padding: 6px 12px; font-size: 13px;"
                    onclick="${pageState[tabId] > 1 ? `changePage('${tabId}', -1)` : ''}">
                    Previous
                </button>
                <span style="color: #cccccc; font-size: 13px; font-family: 'Inter', sans-serif; font-weight: 500; margin: 0 10px;">Page ${pageState[tabId]}</span>
                <button class="btn-pagination-modern" ${nextDisabled}
                    style="padding: 6px 12px; font-size: 13px;"
                    onclick="${items.length >= ITEMS_PER_PAGE ? `changePage('${tabId}', 1)` : ''}">
                    Next
                </button>
            </div>
        </div>
    `;

    // Append new pagination
    container.insertAdjacentHTML('beforeend', paginationHtml);

    // Trigger Scroll and Highlight if pending
    if (pendingHighlightAbs) {
        setTimeout(() => {
            const el = document.getElementById(`highlight - ${pendingHighlightAbs} `);
            if (el) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                el.classList.add('pulse-animation');
            }

            // AUTO-OPEN MODAL Logic
            const itemIndex = currentSubmissions.findIndex(s => s.absModulator === pendingHighlightAbs);
            if (itemIndex !== -1) {
                openHistoryModal(itemIndex);
            }

            pendingHighlightAbs = null; // Reset
        }, 300);
    }
}


// Helper for grouping items by Iteration
function groupChecklistByIteration(checklist) {
    const groups = {};
    checklist.forEach(item => {
        const iter = item.iterationId || 1; // Default to 1 if missing
        if (!groups[iter]) {
            groups[iter] = {
                id: iter,
                id: iter,
                date: item.iterationDate, // Use item date
                testedEmployeeId: item.testedEmployeeId, // Capture inspector for this iteration
                items: []
            };
        }
        groups[iter].items.push(item);
    });
    // Return array sorted by Iteration DESC (Latest first)
    // AND Ensure items within each iteration are sorted Alphabetically by Description
    const sortedGroups = Object.values(groups).sort((a, b) => b.id - a.id);
    sortedGroups.forEach(group => {
        group.items.sort((a, b) => (a.description || '').localeCompare(b.description || ''));
    });
    return sortedGroups;
}

// Read-Only Modal Logic
function openHistoryModal(index, directData = null) {
    // Determine Data Source
    const data = directData || currentSubmissions[index];
    if (!data) return;

    window.currentModalData = data; // Store for PDF access

    // Populate Header
    const badgeContainer = document.getElementById('modalAbsBadge');
    // Only show Straight Pass if Status is P (and effectively only 1 iteration usually, but P implies first time pass)
    // Actually, P = it passed. If Iteration > 1, it's RP.
    // Logic: P = Straight Pass, RP = Rework Passed
    if (data.status === 'P') {
        badgeContainer.innerHTML = '<span class="status-badge straight-pass">Straight Pass</span>';
    } else {
        badgeContainer.innerHTML = '';
    }

    document.getElementById('modalAbs').textContent = data.absModulator;
    document.getElementById('modalModel').textContent = data.model;
    document.getElementById('modalKit').textContent = data.absKit || 'N/A';

    // Header Date (Latest)
    let dateStr = 'N/A';
    if (data.testedDate) {
        const d = new Date(data.testedDate);
        dateStr = d.toLocaleDateString('en-GB', {
            day: 'numeric', month: 'short', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true
        }).toUpperCase();
    }
    document.getElementById('modalDate').textContent = dateStr;

    // Populate Body - Multi-Table for Iterations
    const container = document.getElementById('modalBody');
    // Note: modalBody is a TBODY. We need to clear it, but actually we want to render multiple tables or headers within the wrapper.
    // The current HTML structure has a single table. We need to replace the innerHTML of .modal-table-wrapper or just hack the tbody to include header rows?
    // Better: Update HTML structure dynamically or inject rows with "Iteration Headers".

    container.innerHTML = '';

    if (data.checklist) {
        const iterations = groupChecklistByIteration(data.checklist);

        iterations.forEach(iter => {
            // Render Iteration Header Row
            let iterDate = 'N/A';
            if (iter.date) {
                iterDate = new Date(iter.date).toLocaleDateString('en-GB', {
                    day: 'numeric', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', hour12: true
                }).toUpperCase();
            }

            const headerRow = document.createElement('tr');
            headerRow.style.background = '#e5e7eb';
            headerRow.innerHTML = `
                <td colspan="4" style="padding: 0; border-bottom: 1px solid #ddd;">
                    <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 15px; background: #f0f0f0;">
                         <div style="font-weight: bold; color: #333;">
                            ITERATION ${iter.id} <span style="font-weight: normal; font-size: 13px; color: #555; margin-left: 8px;">(${iterDate})</span>
                        </div>
                        <div style="font-size: 12px; font-weight: 500; color: #666;">
                            INSPECTED BY: <strong style="color: #000;">${iter.testedEmployeeId || 'N/A'}</strong>
                        </div>
                    </div>
                </td>
            `;
            container.appendChild(headerRow);

            // Render Items
            iter.items.forEach((item, idx) => {
                const tr = document.createElement('tr');
                const statusColor = item.status ? 'color: var(--success); font-weight:bold;' : 'color: var(--danger); font-weight:bold;';
                const statusIcon = item.status ? 'OK' : 'NOT OK';

                tr.innerHTML = `
                    <td>${idx + 1}</td>
                    <td>${item.description}</td>
                    <td>${item.specification}</td>
                    <td style="${statusColor}">${statusIcon}</td>
                `;
                container.appendChild(tr);
            });
        });
    }

    // Show Modal
    document.getElementById('readOnlyModal').classList.add('active');
}

function closeModal() {
    document.getElementById('readOnlyModal').classList.remove('active');
}

// Close on background click
document.getElementById('readOnlyModal').addEventListener('click', function (e) {
    if (e.target === this) {
        closeModal();
    }
});

// PDF Generation Logic
function downloadPdf() {
    // Use stored object if available (supports both direct and list view)
    const data = window.currentModalData;
    if (!data) return;

    // Create a temporary container for PDF content
    const element = document.createElement('div');
    element.className = 'pdf-container';

    // Format Date for "Generated On"
    const genDate = new Date().toLocaleString('en-GB', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', hour12: true
    }).toUpperCase();

    // Format Tested Date
    let testedDate = 'N/A';
    if (data.testedDate) {
        testedDate = new Date(data.testedDate).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase();
    }

    // Build Table Rows
    let rowsHtml = '';
    if (data.checklist) {
        data.checklist.forEach((item, index) => {
            const statusStyle = item.status ? 'color: #10b981; font-weight: bold;' : 'color: #ef4444; font-weight: bold;';
            rowsHtml += `
                <tr style="border-bottom: 1px solid #ddd;">
                    <td style="padding: 10px;">${index + 1}</td>
                    <td style="padding: 10px;">${item.description}</td>
                    <td style="padding: 10px;">${item.specification}</td>
                    <td style="${statusStyle} padding: 10px;">${item.status ? 'OK' : 'NOT OK'}</td>
                </tr>`;
        });
    }

    element.innerHTML = `
        <div style="padding: 40px; font-family: 'Inter', sans-serif; background: white; color: black;">
            <div style="display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #333; padding-bottom: 20px; margin-bottom: 30px;">
                <img src="assets/royal_enfield_text.png" style="height: 40px;">
                <div style="text-align: right;">
                    <h2 style="margin: 0; font-size: 24px; text-transform: uppercase;">ABS Inspection Report</h2>
                    <span style="font-size: 12px; color: #666;">Generated on: ${genDate}</span>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 30px; background: #f9f9f9; padding: 20px; border-radius: 8px;">
                <div><strong style="color: #666; font-size: 10px; text-transform: uppercase;">ABS Modulator</strong><br><span style="font-size: 16px; font-weight: bold;">${data.absModulator}</span></div>
                <div><strong style="color: #666; font-size: 10px; text-transform: uppercase;">Model</strong><br><span style="font-size: 16px; font-weight: bold;">${data.model}</span></div>
                <div><strong style="color: #666; font-size: 10px; text-transform: uppercase;">Kit Number</strong><br><span style="font-size: 16px; font-weight: bold;">${data.absKit || 'N/A'}</span></div>
                <div><strong style="color: #666; font-size: 10px; text-transform: uppercase;">PDI Completion Date</strong><br><span style="font-size: 16px; font-weight: bold;">${testedDate}</span></div>
            </div>

            <table style="width: 100%; border-collapse: collapse; font-size: 12px;">
                <thead>
                    <tr style="background: #f0f0f0; border-bottom: 2px solid #333;">
                        <th style="padding: 10px; text-align: left;">S.No</th>
                        <th style="padding: 10px; text-align: left;">Description</th>
                        <th style="padding: 10px; text-align: left;">Specification</th>
                        <th style="padding: 10px; text-align: left;">Status</th>
                    </tr>
                </thead>
                <tbody>
                    ${(() => {
            let html = '';
            if (data.checklist) {
                const iterations = groupChecklistByIteration(data.checklist);
                iterations.forEach(iter => {
                    // Iteration Header
                    let iterDate = 'N/A';
                    if (iter.date) {
                        iterDate = new Date(iter.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).toUpperCase();
                    }
                    html += `<tr style="background: #e5e7eb; border-bottom: 1px solid #ddd;">
                                            <td colspan="4" style="padding: 0;">
                                                <div style="display: flex; justify-content: space-between; align-items: center; padding: 8px 10px;">
                                                    <span style="font-weight: bold; color: #333;">ITERATION ${iter.id} <span style="font-weight: normal; font-size: 11px; color: #555; margin-left: 10px;">(${iterDate})</span></span>
                                                    <span style="font-size: 10px; font-weight: normal; color: #555;">INSPECTED BY: <strong style="color: #000;">${iter.testedEmployeeId || 'N/A'}</strong></span>
                                                </div>
                                            </td>
                                         </tr>`;

                    // Items
                    iter.items.forEach((item, idx) => {
                        const statusStyle = item.status ? 'color: #10b981; font-weight: bold;' : 'color: #ef4444; font-weight: bold;';
                        html += `
                                    <tr style="border-bottom: 1px solid #ddd;">
                                        <td style="padding: 10px;">${idx + 1}</td>
                                        <td style="padding: 10px;">${item.description}</td>
                                        <td style="padding: 10px;">${item.specification}</td>
                                        <td style="${statusStyle} padding: 10px;">${item.status ? 'OK' : 'NOT OK'}</td>
                                    </tr>`;
                    });
                });
            }
            return html;
        })()}
                </tbody>
            </table>
            
            <div style="margin-top: 40px; text-align: center; border-top: 1px solid #ddd; padding-top: 20px; color: #999; font-size: 10px;">
                FactRE Connect - VQF System | Royal Enfield
            </div>
        </div>
        `;

    // Generate PDF
    const opt = {
        margin: 0,
        filename: `Inspection_${data.absModulator}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2 },
        jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' }
    };

    html2pdf().set(opt).from(element).save();
}

// Global Scroll Detection...
let scrollTimer = null;
document.addEventListener('scroll', function () {
    const body = document.body;
    if (!body.classList.contains('is-scrolling')) {
        body.classList.add('is-scrolling');
    }

    if (scrollTimer) {
        clearTimeout(scrollTimer);
    }

    scrollTimer = setTimeout(() => {
        body.classList.remove('is-scrolling');
    }, 800); // Keep glowing for 800ms after scroll stops
}, true); // Capture phase to catch all scrolling elements

function resumeRework(absNumber) {
    // Switch to New Inspection Tab
    switchTab('new');

    // Set Input Value
    const absInput = document.getElementById('absInput');
    absInput.value = absNumber;

    // Trigger Scan Logic
    fetchAbsDetails();
}

async function loadReworkHistory(absNumber) {
    const container = document.getElementById('reworkHistoryContainer');
    container.innerHTML = ''; // Clear

    try {
        const res = await fetch(`${API_BASE}/submissions`);
        if (!res.ok) return;

        const all = await res.json();
        const mySub = all.find(s => s.absModulator === absNumber);

        if (mySub && mySub.checklist) {
            const history = groupChecklistByIteration(mySub.checklist);

            // Filter OUT the latest iteration if it's the one we are about to edit?
            // User says: "previous iterations should display but only the latest iterations should be made editable".
            // Since we load a FREAH checklist for editing, ALL history items returned are effectively "previous" or "current state of DB".
            // If the status is 'R', the DB contains the FAILED iteration. 
            // We want to show that failed iteration as read-only.
            // The active editing table is separate (checklistTable).

            // So we render ALL groupings from history as Read-Only.

            let html = '';
            history.forEach(group => {
                let dateStr = 'Unknown Date';
                if (group.date) {
                    const d = new Date(group.date);
                    dateStr = d.toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit', hour12: true
                    }).toUpperCase();
                }

                html += `
                    <div class="history-iteration-block">
                        <div class="iteration-header" style="display: flex; justify-content: space-between; align-items: center;">
                            <span>ITERATION ${group.id} <span style="font-weight:400; font-size: 0.9em; color: #aaa;">(${dateStr})</span></span>
                            <span style="font-size: 0.8em; font-weight: normal; color: #888;">INSPECTED BY: <strong style="color: #fff;">${group.testedEmployeeId || 'N/A'}</strong></span>
                        </div>
                        <table class="read-only-table">
                            <thead>
                                <tr>
                                    <th style="width: 50px;">S.No</th>
                                    <th>Description</th>
                                    <th>Specification</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                `;

                group.items.forEach((item, idx) => {
                    const statusClass = item.status ? 'status-ok' : 'status-nok';
                    const statusText = item.status ? 'OK' : 'NOK';

                    html += `
                        <tr>
                            <td>${idx + 1}</td>
                            <td>${item.description}</td>
                            <td>${item.specification}</td>
                            <td><span class="${statusClass}">${statusText}</span></td>
                        </tr>
                    `;
                });

                html += `
                            </tbody>
                        </table>
                    </div>
                `;
            });

            container.innerHTML = html;
        }
    } catch (e) {
        console.error("Failed to load rework history", e);
    }
}

function showSuccessPopup(status) {
    const popup = document.getElementById('successPopup');
    const title = document.getElementById('popupTitle');
    const badgeContainer = document.getElementById('popupBadgeContainer');

    // Set Text
    if (status === 'P') {
        title.textContent = 'Inspection Completed Successfully!';
        badgeContainer.innerHTML = '<span class="status-badge straight-pass" style="font-size: 14px; padding: 6px 16px;">Straight Pass</span>';
    } else if (status === 'RP') {
        title.textContent = 'Rework Completed Successfully!';
        badgeContainer.innerHTML = '<span class="status-badge rp" style="font-size: 14px; padding: 6px 16px;">Rework Passed</span>';
    } else if (status === 'R') {
        title.textContent = 'Submitted for Rework';
        badgeContainer.innerHTML = '<span class="status-badge rework" style="font-size: 14px; padding: 6px 16px;">Rework Required</span>';
    } else {
        title.textContent = 'Submission Successful!';
        badgeContainer.innerHTML = '';
    }

    // Show
    popup.classList.add('active');

    // Auto Hide
    setTimeout(() => {
        popup.classList.remove('active');
    }, 2000);
}

// --- Shift Filter Initialization (Flatpickr) ---
function initShiftFilter() {
    // 1. Calculate Shift Defaults
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);

    start.setHours(0, 15, 0, 0);
    // If current time is < 00:15 (e.g. 00:05), belongs to previous day's shift
    if (now < start) {
        start.setDate(start.getDate() - 1);
    }

    end.setTime(start.getTime() + (24 * 60 * 60 * 1000)); // +24 hours

    // 2. Initialize Flatpickr
    const config = {
        enableTime: true,
        dateFormat: "Y-m-d\\TH:i", // Standard ISO format (Y-m-dTH:i) - No seconds since enableSeconds is false
        altInput: true,
        altFormat: "d M Y, h:i K", // Display: 27 Dec 2025, 12:15 AM
        time_24hr: false, // Use AM/PM selector
        theme: "dark"
    };

    // Helper to init a pair
    const initPair = (startId, endId) => {
        flatpickr(startId, { ...config, defaultDate: start });
        flatpickr(endId, { ...config, defaultDate: end });
    };

    // Rework Filter
    initPair("#reworkStart", "#reworkEnd");

    // Completed Filter
    initPair("#completedStart", "#completedEnd");

    // Reports Filter
    initPair("#reportsStart", "#reportsEnd");

    // 3. Bind Apply Buttons
    const bindApply = (btnId, statusType) => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.onclick = () => fetchSubmissions(statusType);
        }
    };

    bindApply('reworkApplyBtn', 'rework');
    bindApply('completedApplyBtn', 'completed');
    const btnReports = document.getElementById('reportsApplyBtn');
    if (btnReports) btnReports.onclick = fetchBiometricReport;
}
document.addEventListener('DOMContentLoaded', initShiftFilter);

// --- SEARCH CLEAR LOGIC ---
document.addEventListener('DOMContentLoaded', () => {
    ['rework', 'completed', 'reports'].forEach(tab => {
        const input = document.getElementById(`${tab}Search`);
        const btn = document.getElementById(`${tab}ClearBtn`);

        if (input && btn) {
            input.addEventListener('input', () => {
                if (input.value.length > 0) {
                    btn.classList.add('visible');
                } else {
                    btn.classList.remove('visible');
                }
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    fetchSubmissions(tab);
                }
            });
        }
    });
});

function clearSearch(tab) {
    const input = document.getElementById(`${tab}Search`);
    const btn = document.getElementById(`${tab}ClearBtn`);

    if (input) {
        input.value = '';
        if (btn) btn.classList.remove('visible');

        // Trigger Search / Refresh
        // Reports uses same fetchSubmissions logic now
        if (typeof fetchSubmissions === 'function') {
            fetchSubmissions(tab);
        }
    }
}

// --- APP VERSION ---
async function loadAppVersion() {
    try {
        const res = await fetch('/api/configuration/version');
        if (res.ok) {
            const data = await res.json();
            const el = document.getElementById('appVersion');
            if (el && data.version) {
                el.textContent = data.version;
            }
            // We want to show that failed iteration as read-only.
            // The active editing table is separate (checklistTable).

            // So we render ALL groupings from history as Read-Only.

            let html = '';
            history.forEach(group => {
                let dateStr = 'Unknown Date';
                if (group.date) {
                    const d = new Date(group.date);
                    dateStr = d.toLocaleDateString('en-GB', {
                        day: 'numeric', month: 'short', year: 'numeric',
                        hour: '2-digit', minute: '2-digit', hour12: true
                    }).toUpperCase();
                }

                html += `
                    <div class="history-iteration-block">
                        <div class="iteration-header" style="display: flex; justify-content: space-between; align-items: center;">
                            <span>ITERATION ${group.id} <span style="font-weight:400; font-size: 0.9em; color: #aaa;">(${dateStr})</span></span>
                            <span style="font-size: 0.8em; font-weight: normal; color: #888;">INSPECTED BY: <strong style="color: #fff;">${group.testedEmployeeId || 'N/A'}</strong></span>
                        </div>
                        <table class="read-only-table">
                            <thead>
                                <tr>
                                    <th style="width: 50px;">S.No</th>
                                    <th>Description</th>
                                    <th>Specification</th>
                                    <th>Status</th>
                                </tr>
                            </thead>
                            <tbody>
                `;

                group.items.forEach((item, idx) => {
                    const statusClass = item.status ? 'status-ok' : 'status-nok';
                    const statusText = item.status ? 'OK' : 'NOK';

                    html += `
                        <tr>
                            <td>${idx + 1}</td>
                            <td>${item.description}</td>
                            <td>${item.specification}</td>
                            <td><span class="${statusClass}">${statusText}</span></td>
                        </tr>
                    `;
                });

                html += `
                            </tbody>
                        </table>
                    </div>
                `;
            });

            container.innerHTML = html;
        }
    } catch (e) {
        console.error("Failed to load rework history", e);
    }
}

function showSuccessPopup(status) {
    const popup = document.getElementById('successPopup');
    const title = document.getElementById('popupTitle');
    const badgeContainer = document.getElementById('popupBadgeContainer');

    // Set Text
    if (status === 'P') {
        title.textContent = 'Inspection Completed Successfully!';
        badgeContainer.innerHTML = '<span class="status-badge straight-pass" style="font-size: 14px; padding: 6px 16px;">Straight Pass</span>';
    } else if (status === 'RP') {
        title.textContent = 'Rework Completed Successfully!';
        badgeContainer.innerHTML = '<span class="status-badge rp" style="font-size: 14px; padding: 6px 16px;">Rework Passed</span>';
    } else if (status === 'R') {
        title.textContent = 'Submitted for Rework';
        badgeContainer.innerHTML = '<span class="status-badge rework" style="font-size: 14px; padding: 6px 16px;">Rework Required</span>';
    } else {
        title.textContent = 'Submission Successful!';
        badgeContainer.innerHTML = '';
    }

    // Show
    popup.classList.add('active');

    // Auto Hide
    setTimeout(() => {
        popup.classList.remove('active');
    }, 2000);
}

// --- Shift Filter Initialization (Flatpickr) ---
function initShiftFilter() {
    // 1. Calculate Shift Defaults
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);

    start.setHours(0, 15, 0, 0);
    // If current time is < 00:15 (e.g. 00:05), belongs to previous day's shift
    if (now < start) {
        start.setDate(start.getDate() - 1);
    }

    end.setTime(start.getTime() + (24 * 60 * 60 * 1000)); // +24 hours

    // 2. Initialize Flatpickr
    const config = {
        enableTime: true,
        dateFormat: "Y-m-d\\TH:i", // Standard ISO format (Y-m-dTH:i) - No seconds since enableSeconds is false
        altInput: true,
        altFormat: "d M Y, h:i K", // Display: 27 Dec 2025, 12:15 AM
        time_24hr: false, // Use AM/PM selector
        theme: "dark"
    };

    // Helper to init a pair
    const initPair = (startId, endId) => {
        flatpickr(startId, { ...config, defaultDate: start });
        flatpickr(endId, { ...config, defaultDate: end });
    };

    // Rework Filter
    initPair("#reworkStart", "#reworkEnd");

    // Completed Filter
    initPair("#completedStart", "#completedEnd");

    // Reports Filter
    initPair("#reportsStart", "#reportsEnd");

    // 3. Bind Apply Buttons
    const bindApply = (btnId, statusType) => {
        const btn = document.getElementById(btnId);
        if (btn) {
            btn.onclick = () => fetchSubmissions(statusType);
        }
    };

    bindApply('reworkApplyBtn', 'rework');
    bindApply('completedApplyBtn', 'completed');
    const btnReports2 = document.getElementById('reportsApplyBtn');
    if (btnReports2) btnReports2.onclick = fetchBiometricReport;
}
document.addEventListener('DOMContentLoaded', initShiftFilter);

// --- SEARCH CLEAR LOGIC ---
document.addEventListener('DOMContentLoaded', () => {
    ['rework', 'completed', 'reports'].forEach(tab => {
        const input = document.getElementById(`${tab}Search`);
        const btn = document.getElementById(`${tab}ClearBtn`);

        if (input && btn) {
            input.addEventListener('input', () => {
                if (input.value.length > 0) {
                    btn.classList.add('visible');
                } else {
                    btn.classList.remove('visible');
                }
            });

            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    fetchSubmissions(tab);
                }
            });
        }
    });
});

function clearSearch(tab) {
    const input = document.getElementById(`${tab}Search`);
    const btn = document.getElementById(`${tab}ClearBtn`);

    if (input) {
        input.value = '';
        if (btn) btn.classList.remove('visible');

        // Trigger Search / Refresh
        // Reports uses same fetchSubmissions logic now
        if (typeof fetchSubmissions === 'function') {
            fetchSubmissions(tab);
        }
    }
}

// --- APP VERSION ---
async function loadAppVersion() {
    try {
        const res = await fetch('/api/configuration/version');
        if (res.ok) {
            const data = await res.json();
            const el = document.getElementById('appVersion');
            if (el && data.version) {
                el.textContent = data.version;
            }
        }
    } catch (e) {
        console.error("Failed to load app version", e);
    }
}
document.addEventListener('DOMContentLoaded', loadAppVersion);

async function loadDashboardDropdown() {
    try {
        const res = await fetch('/api/configuration/dashboard-dropdown');
        const dropdown = document.getElementById('mainDashboardDropdown');
        if (!dropdown) return;
        
        if (res.ok) {
            const values = await res.json();
            if (values && values.length > 0) {
                dropdown.innerHTML = '';
                values.forEach(val => {
                    const opt = document.createElement('option');
                    opt.value = val;
                    opt.textContent = val;
                    dropdown.appendChild(opt);
                });
                dropdown.addEventListener('change', fetchPokeYokeHistoryCards);
                fetchPokeYokeHistoryCards();
            } else {
                dropdown.innerHTML = '<option value="">No Options</option>';
            }
        } else {
            dropdown.innerHTML = '<option value="">Error Loading</option>';
        }
    } catch (e) {
        console.error("Failed to load dashboard dropdown", e);
        const dropdown = document.getElementById('mainDashboardDropdown');
        if (dropdown) dropdown.innerHTML = '<option value="">Error</option>';
    }
}
document.addEventListener('DOMContentLoaded', loadDashboardDropdown);

// --- MAIN LINE CYCLE TIME REPORT ---
let mainLineData = [];
let mainLinePage = 1;
const MAIN_LINE_ITEMS_PER_PAGE = 10;

async function fetchMainLineReport() {
    try {
        const start = document.getElementById('mainLineStart').value;
        const end = document.getElementById('mainLineEnd').value;
        if (!start || !end) {
            return;
        }

        const res = await fetch(`/api/reports/mainline?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`);
        if (!res.ok) throw new Error('Failed to fetch Main Line Cycle Time data');

        mainLineData = await res.json();
        mainLinePage = 1; // Reset to page 1 on new fetch
        renderMainLineTable();

    } catch (e) {
        console.error(e);
        alert('Error loading Main Line report.');
    }
}

function renderMainLineTable() {
    const tbody = document.getElementById('mainLineBody');
    const emptyState = document.getElementById('mainLineEmpty');
    const pContainer = document.getElementById('mainLinePagination');

    tbody.innerHTML = '';

    if (mainLineData.length === 0) {
        emptyState.style.display = 'flex';
        document.getElementById('mainLineTable').style.display = 'none';
        if (pContainer) pContainer.style.display = 'none';
    } else {
        emptyState.style.display = 'none';
        document.getElementById('mainLineTable').style.display = 'table';
        if (pContainer) pContainer.style.display = 'flex';

        // Calculate pagination slices
        const startIndex = (mainLinePage - 1) * MAIN_LINE_ITEMS_PER_PAGE;
        const endIndex = startIndex + MAIN_LINE_ITEMS_PER_PAGE;
        const pageData = mainLineData.slice(startIndex, endIndex);

        pageData.forEach((row, index) => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid #333';

            const serialNo = startIndex + index + 1;
            let html = `<td style="padding: 10px;">${serialNo}</td>`;

            // Format Date (e.g., "06 May 2026, 12:58:54 PM")
            let dateStr = '-';
            if (row.date_Time) {
                const d = new Date(row.date_Time);
                dateStr = d.toLocaleDateString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                }) + ', ' + d.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
            }
            html += `<td style="padding: 10px; white-space: nowrap;">${dateStr}</td>`;

            // Add Max columns
            const maxStnName = row.max_STN_Name || '-';
            const maxCycleTime = row.max_CycleTime !== null && row.max_CycleTime !== undefined ? row.max_CycleTime : '-';
            html += `<td style="padding: 10px; font-weight: bold; color: #d8232a;">${maxStnName}</td>`;
            html += `<td style="padding: 10px; font-weight: bold; color: #d8232a;">${maxCycleTime}</td>`;

            // 54 Stations
            for (let i = 1; i <= 54; i++) {
                let val = row[`sT${i}_CycleTime`];
                html += `<td style="padding: 10px;">${val !== null && val !== undefined ? val : '-'}</td>`;
            }

            tr.innerHTML = html;
            tbody.appendChild(tr);
        });

        // Update Pagination Controls
        const totalEl = document.getElementById('mainLineTotalCount');
        const pageLabelEl = document.getElementById('mainLinePageLabel');
        const btnPrev = document.getElementById('btnPrevMainLine');
        const btnNext = document.getElementById('btnNextMainLine');

        if (totalEl) totalEl.textContent = `Total Count: ${mainLineData.length}`;
        if (pageLabelEl) pageLabelEl.textContent = `Page ${mainLinePage}`;

        if (btnPrev) {
            btnPrev.disabled = (mainLinePage <= 1);
            btnPrev.style.opacity = (mainLinePage <= 1) ? 0.5 : 1;
        }

        if (btnNext) {
            const hasNext = endIndex < mainLineData.length;
            btnNext.disabled = !hasNext;
            btnNext.style.opacity = !hasNext ? 0.5 : 1;
        }
    }
}

function changeMainLinePage(direction) {
    mainLinePage += direction;
    renderMainLineTable();
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. Calculate Shift Defaults matching Reports tab
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);

    start.setHours(0, 15, 0, 0);
    if (now < start) {
        start.setDate(start.getDate() - 1);
    }
    end.setTime(start.getTime() + (24 * 60 * 60 * 1000));

    // 2. Initialize Flatpickr matching reports tab config
    if (typeof flatpickr !== 'undefined') {
        const config = {
            enableTime: true,
            dateFormat: "Y-m-d\\TH:i",
            altInput: true,
            altFormat: "d M Y, h:i K",
            time_24hr: false,
            theme: "dark",
            onClose: function () {
                // Auto-fetch on close
                fetchMainLineReport();
            }
        };

        flatpickr("#mainLineStart", { ...config, defaultDate: start });
        flatpickr("#mainLineEnd", { ...config, defaultDate: end });
    }

    const btn = document.getElementById('mainLineApplyBtn');
    if (btn) {
        btn.addEventListener('click', fetchMainLineReport);
    }
});

async function exportMainLineToExcel() {
    if (!mainLineData || mainLineData.length === 0) {
        alert("No data to export");
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Main Line Cycle Time');

        // Fetch Logo
        const logoRes = await fetch('assets/logo-small.png');
        const logoBlob = await logoRes.blob();
        const logoBuffer = await logoBlob.arrayBuffer();
        const logoId = workbook.addImage({
            buffer: logoBuffer,
            extension: 'png',
        });

        // Add Logo (Top Left)
        sheet.addImage(logoId, {
            tl: { col: 0, row: 0 },
            ext: { width: 80, height: 80 }
        });

        sheet.mergeCells('B2:F2');
        const titleCell = sheet.getCell('B2');
        titleCell.value = 'MAIN LINE CYCLE TIME REPORT';
        titleCell.font = { name: 'Arial', size: 18, bold: true, color: { argb: 'FFD71920' } };

        sheet.getCell('B3').value = 'Exported On:';
        sheet.getCell('C3').value = new Date().toLocaleString();

        const headerRow = sheet.getRow(6);
        let colIndex = 1;
        headerRow.getCell(colIndex++).value = 'S.No';
        headerRow.getCell(colIndex++).value = 'DATE/TIME';
        headerRow.getCell(colIndex++).value = 'MAX STN NAME';
        headerRow.getCell(colIndex++).value = 'MAX CYCLE TIME';

        for (let i = 1; i <= 54; i++) {
            headerRow.getCell(colIndex++).value = 'ST' + i;
        }

        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF333333' }
        };

        let currentRow = 7;
        let serialNo = 1;
        mainLineData.forEach(row => {
            const excelRow = sheet.getRow(currentRow++);
            let cIdx = 1;

            excelRow.getCell(cIdx++).value = serialNo++;

            let dateStr = '-';
            if (row.date_Time) {
                const d = new Date(row.date_Time);
                dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
            }

            excelRow.getCell(cIdx++).value = dateStr;
            excelRow.getCell(cIdx++).value = row.max_STN_Name || '-';
            excelRow.getCell(cIdx++).value = row.max_CycleTime !== null && row.max_CycleTime !== undefined ? row.max_CycleTime : '-';

            for (let i = 1; i <= 54; i++) {
                excelRow.getCell(cIdx++).value = row[`sT${i}_CycleTime`] !== null ? row[`sT${i}_CycleTime`] : '-';
            }
        });

        // Adjust column widths
        sheet.getColumn(1).width = 8; // S.No
        sheet.getColumn(2).width = 25; // Date
        sheet.getColumn(3).width = 15; // Max STN Name
        sheet.getColumn(4).width = 15; // Max Cycle Time
        for (let i = 5; i <= 58; i++) {
            sheet.getColumn(i).width = 8;
        }

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `MainLineCycleTime_${new Date().getTime()}.xlsx`;
        a.click();
        window.URL.revokeObjectURL(url);

    } catch (e) {
        console.error("Export Error", e);
        alert("Export failed. See console.");
    }
}

// --- POKE YOKE MANUAL INSPECTION OVERALL ---
let pokeYokeData = [];
let pokeYokePage = 1;
const POKE_YOKE_ITEMS_PER_PAGE = 10;

let pokeYokeSummaryData = [];
let pokeYokeSummaryPage = 1;
const POKE_YOKE_SUMMARY_ITEMS_PER_PAGE = 10;

async function fetchPokeYokeHistoryCards() {
    const lineDropdown = document.getElementById('mainDashboardDropdown');
    const line = lineDropdown ? lineDropdown.value : '';
    if (!line) return;

    try {
        const res = await fetch(`/api/reports/poke-yoke/history-cards?line=${encodeURIComponent(line)}`);
        const selectElement = document.getElementById('pokeYokeModel');
        if (!selectElement) return;

        if (res.ok) {
            const hcs = await res.json();
            
            selectElement.innerHTML = '<option value="">Select HC</option>';
            hcs.forEach(hc => {
                const opt = document.createElement('option');
                opt.value = hc;
                opt.textContent = hc;
                selectElement.appendChild(opt);
            });
            
            const summarySelectElement = document.getElementById('pokeYokeSummaryModel');
            if (summarySelectElement) {
                summarySelectElement.innerHTML = '<option value="">Select HC</option>';
                hcs.forEach(hc => {
                    const opt = document.createElement('option');
                    opt.value = hc;
                    opt.textContent = hc;
                    summarySelectElement.appendChild(opt);
                });
            }

            const biometricSelectElement = document.getElementById('reportsHcDropdown');
            if (biometricSelectElement) {
                biometricSelectElement.innerHTML = '<option value="">Select HC</option><option value="ALL">ALL</option>';
                hcs.forEach(hc => {
                    const opt = document.createElement('option');
                    opt.value = hc;
                    opt.textContent = hc;
                    biometricSelectElement.appendChild(opt);
                });
            }

            const engineBarcodeSelectElement = document.getElementById('engineBarcodeHcDropdown');
            if (engineBarcodeSelectElement) {
                engineBarcodeSelectElement.innerHTML = '<option value="">Select HC</option>';
                hcs.forEach(hc => {
                    const opt = document.createElement('option');
                    opt.value = hc;
                    opt.textContent = hc;
                    engineBarcodeSelectElement.appendChild(opt);
                });
            }
        } else {
            selectElement.innerHTML = '<option value="">Error Loading</option>';
            const summarySelectElement = document.getElementById('pokeYokeSummaryModel');
            if (summarySelectElement) summarySelectElement.innerHTML = '<option value="">Error Loading</option>';
            const biometricSelectElement = document.getElementById('reportsHcDropdown');
            if (biometricSelectElement) biometricSelectElement.innerHTML = '<option value="">Error Loading</option>';
            const engineBarcodeSelectElement = document.getElementById('engineBarcodeHcDropdown');
            if (engineBarcodeSelectElement) engineBarcodeSelectElement.innerHTML = '<option value="">Error Loading</option>';
        }
    } catch (e) {
        console.error("Failed to load HC filter", e);
    }
}

async function fetchPokeYokeStations() {
    const lineDropdown = document.getElementById('mainDashboardDropdown');
    const modelDropdown = document.getElementById('pokeYokeModel');
    
    const line = lineDropdown ? lineDropdown.value : '';
    const hc = modelDropdown ? modelDropdown.value : '';
    
    const cbContainer = document.getElementById('pokeYokeStationCheckboxes');
    const btn = document.getElementById('pokeYokeStationBtn');
    
    if (!line || !hc) {
        if (cbContainer) cbContainer.innerHTML = '';
        if (btn) btn.textContent = 'Select Stations';
        return;
    }

    try {
        const res = await fetch(`/api/reports/poke-yoke/stations?line=${encodeURIComponent(line)}&historyCard=${encodeURIComponent(hc)}`);
        if (!cbContainer) return;

        if (res.ok) {
            const stations = await res.json();
            cbContainer.innerHTML = '';
            stations.forEach(st => {
                const lbl = document.createElement('label');
                lbl.style.cursor = 'pointer';
                lbl.style.display = 'block';
                lbl.innerHTML = `<input type="checkbox" class="pokeYokeStationCb" value="${st}" onclick="updateStationBtnText()"> <span>${st}</span>`;
                cbContainer.appendChild(lbl);
            });
            updateStationBtnText();
        } else {
            cbContainer.innerHTML = '<span style="color:red;">Error Loading</span>';
        }
    } catch (e) {
        console.error("Failed to load Station filter", e);
    }
}

async function fetchPokeYokeSummaryStations() {
    const lineDropdown = document.getElementById('mainDashboardDropdown');
    const modelDropdown = document.getElementById('pokeYokeSummaryModel');
    
    const line = lineDropdown ? lineDropdown.value : '';
    const hc = modelDropdown ? modelDropdown.value : '';
    
    const cbContainer = document.getElementById('pokeYokeSummaryStationCheckboxes');
    const btn = document.getElementById('pokeYokeSummaryStationBtn');
    
    if (!line || !hc) {
        if (cbContainer) cbContainer.innerHTML = '';
        if (btn) btn.textContent = 'Select Stations';
        return;
    }

    try {
        const res = await fetch(`/api/reports/poke-yoke/stations?line=${encodeURIComponent(line)}&historyCard=${encodeURIComponent(hc)}`);
        if (!cbContainer) return;

        if (res.ok) {
            const stations = await res.json();
            cbContainer.innerHTML = '';
            stations.forEach(st => {
                const lbl = document.createElement('label');
                lbl.style.cursor = 'pointer';
                lbl.style.display = 'block';
                lbl.innerHTML = `<input type="checkbox" class="pokeYokeSummaryStationCb" value="${st}" onclick="updateSummaryStationBtnText()"> <span>${st}</span>`;
                cbContainer.appendChild(lbl);
            });
            updateSummaryStationBtnText();
        } else {
            cbContainer.innerHTML = '<span style="color:red;">Error Loading</span>';
        }
    } catch (e) {
        console.error("Failed to load Summary Station filter", e);
    }
}

function toggleAllSummaryStations(selectAllCb) {
    const checkboxes = document.querySelectorAll('.pokeYokeSummaryStationCb');
    checkboxes.forEach(cb => cb.checked = selectAllCb.checked);
    updateSummaryStationBtnText();
}

function updateSummaryStationBtnText() {
    const checkboxes = document.querySelectorAll('.pokeYokeSummaryStationCb');
    const checked = Array.from(checkboxes).filter(cb => cb.checked);
    const btn = document.getElementById('pokeYokeSummaryStationBtn');
    if(btn) {
        if(checked.length === 0) btn.textContent = "Select Stations";
        else if (checked.length === checkboxes.length) btn.textContent = "All Selected";
        else btn.textContent = `${checked.length} Selected`;
    }
}

function togglePokeYokeMode() {
    const isEngMode = document.getElementById('pokeYokeModeToggle').checked;
    const mode = isEngMode ? 'eng' : 'hc';
    const hcElements = document.querySelectorAll('.poke-yoke-hc-mode-elements');
    const engElements = document.querySelectorAll('.poke-yoke-eng-mode-elements');

    // Update labels styling based on toggle
    const lblHC = document.getElementById('modeLabelHC');
    const lblEng = document.getElementById('modeLabelEng');
    if (isEngMode) {
        lblHC.classList.remove('active');
        lblEng.classList.add('active');
    } else {
        lblHC.classList.add('active');
        lblEng.classList.remove('active');
    }

    if (mode === 'hc') {
        hcElements.forEach(el => {
            // Restore display: contents for the specific inline wrappers or block for the div container
            if(el.tagName === 'SPAN') el.style.display = 'contents';
            else if (el.tagName === 'INPUT') el.style.display = 'inline-block';
            else el.style.display = 'block';
        });
        engElements.forEach(el => el.style.display = 'none');
    } else {
        hcElements.forEach(el => el.style.display = 'none');
        engElements.forEach(el => {
            if (el.tagName === 'INPUT') el.style.display = 'inline-block';
            else el.style.display = 'block';
        });
    }
}

function toggleAllStations(selectAllCb) {
    const checkboxes = document.querySelectorAll('.pokeYokeStationCb');
    checkboxes.forEach(cb => cb.checked = selectAllCb.checked);
    updateStationBtnText();
}

function updateStationBtnText() {
    const checkboxes = document.querySelectorAll('.pokeYokeStationCb');
    const checked = Array.from(checkboxes).filter(cb => cb.checked);
    const btn = document.getElementById('pokeYokeStationBtn');
    if(btn) {
        if(checked.length === 0) btn.textContent = "Select Stations";
        else if (checked.length === checkboxes.length) btn.textContent = "All Selected";
        else btn.textContent = `${checked.length} Selected`;
    }
}

async function fetchPokeYokeReport() {
    const toggleElement = document.getElementById('pokeYokeModeToggle');
    const mode = (toggleElement && toggleElement.checked) ? 'eng' : 'hc';
    const lineDropdown = document.getElementById('mainDashboardDropdown');
    const modelDropdown = document.getElementById('pokeYokeModel');
    const line = lineDropdown ? lineDropdown.value : '';
    const hc = modelDropdown ? modelDropdown.value : '';

    let url = '';

    if (mode === 'hc') {
        const startInput = document.getElementById('pokeYokeStart');
        const endInput = document.getElementById('pokeYokeEnd');
        const start = startInput ? startInput.value : '';
        const end = endInput ? endInput.value : '';
        
        const checkedStations = Array.from(document.querySelectorAll('.pokeYokeStationCb:checked')).map(cb => cb.value);
        const station = checkedStations.join(',');

        if (!line || !hc || !station || !start || !end) {
            alert("Please fill all filters (Line, HC, Station, Start Date, End Date)");
            return;
        }
        url = `/api/reports/poke-yoke/data?line=${encodeURIComponent(line)}&historyCard=${encodeURIComponent(hc)}&station=${encodeURIComponent(station)}&startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`;
    } else {
        const engNoInput = document.getElementById('pokeYokeEngNo');
        const engNo = engNoInput ? engNoInput.value.trim() : '';

        if (!line || !hc || !engNo) {
            alert("Please select Line, HC and enter an Engine Number");
            return;
        }
        url = `/api/reports/poke-yoke/data?line=${encodeURIComponent(line)}&historyCard=${encodeURIComponent(hc)}&engineNo=${encodeURIComponent(engNo)}`;
    }

    try {
        const btn = document.getElementById('pokeYokeApplyBtn');
        if (btn) btn.innerHTML = '<span class="material-symbols-outlined">refresh</span> Loading...';

        // Close dropdown if open
        const dropdown = document.getElementById('pokeYokeStationDropdown');
        if (dropdown) dropdown.style.display = 'none';

        const res = await fetch(url);
        
        if (res.ok) {
            pokeYokeData = await res.json();
            pokeYokePage = 1;
            renderPokeYokeTable();
        } else {
            alert("Failed to load report data.");
            pokeYokeData = [];
            renderPokeYokeTable();
        }
    } catch (e) {
        console.error("Fetch Error", e);
        alert("Error fetching report data.");
    } finally {
        const btn = document.getElementById('pokeYokeApplyBtn');
        if (btn) btn.innerHTML = 'Apply';
    }
}

function renderPokeYokeTable() {
    const tbody = document.getElementById('pokeYokeBody');
    const emptyState = document.getElementById('pokeYokeEmpty');
    const pContainer = document.getElementById('pokeYokePagination');

    tbody.innerHTML = '';

    if (pokeYokeData.length === 0) {
        emptyState.style.display = 'flex';
        document.getElementById('pokeYokeTable').style.display = 'none';
        if (pContainer) pContainer.style.display = 'none';
    } else {
        emptyState.style.display = 'none';
        document.getElementById('pokeYokeTable').style.display = 'table';
        if (pContainer) pContainer.style.display = 'flex';

        // Calculate pagination slices
        const startIndex = (pokeYokePage - 1) * POKE_YOKE_ITEMS_PER_PAGE;
        const endIndex = startIndex + POKE_YOKE_ITEMS_PER_PAGE;
        const pageData = pokeYokeData.slice(startIndex, endIndex);

        pageData.forEach((row, index) => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid #333';

            const serialNo = startIndex + index + 1;
            let html = `<td style="padding: 10px;">${serialNo}</td>`;

            // Format Date (e.g., "06 May 2026, 12:58:54 PM")
            let dateStr = '-';
            if (row.date_Time) {
                const d = new Date(row.date_Time);
                dateStr = d.toLocaleDateString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                }) + ', ' + d.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
            }
            const maxStnName = row.stn_Number || '-';
            const maxCycleTime = row.engine_Number || '-';
            const desc = row.description || '';
            
            html += `<td style="padding: 10px;">${desc}</td>`;
            html += `<td style="padding: 10px;">${maxStnName}</td>`;
            html += `<td style="padding: 10px;">${maxCycleTime}</td>`;
            html += `<td style="padding: 10px; white-space: nowrap;">${dateStr}</td>`;

            tr.innerHTML = html;
            tbody.appendChild(tr);
        });

        // Update Pagination Controls
        const totalEl = document.getElementById('pokeYokeTotalCount');
        const pageLabelEl = document.getElementById('pokeYokePageLabel');
        const btnPrev = document.getElementById('btnPrevPokeYoke');
        const btnNext = document.getElementById('btnNextPokeYoke');

        if (totalEl) totalEl.textContent = `Total Count: ${pokeYokeData.length}`;
        if (pageLabelEl) pageLabelEl.textContent = `Page ${pokeYokePage}`;

        if (btnPrev) {
            btnPrev.disabled = (pokeYokePage <= 1);
            btnPrev.style.opacity = (pokeYokePage <= 1) ? 0.5 : 1;
        }

        if (btnNext) {
            const hasNext = endIndex < pokeYokeData.length;
            btnNext.disabled = !hasNext;
            btnNext.style.opacity = !hasNext ? 0.5 : 1;
        }
    }
}

function changePokeYokePage(direction) {
    pokeYokePage += direction;
    renderPokeYokeTable();
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. Calculate Shift Defaults matching Reports tab
    const now = new Date();
    const start = new Date(now);
    const end = new Date(now);

    start.setHours(0, 15, 0, 0);
    if (now < start) {
        start.setDate(start.getDate() - 1);
    }
    end.setTime(start.getTime() + (24 * 60 * 60 * 1000));

    // 2. Initialize Flatpickr matching reports tab config
    if (typeof flatpickr !== 'undefined') {
        const config = {
            enableTime: true,
            dateFormat: "Y-m-d\\TH:i",
            altInput: true,
            altFormat: "d M Y, h:i K",
            time_24hr: false,
            theme: "dark",
            onClose: function () {
                // Auto-fetch on close
                fetchPokeYokeReport();
            }
        };

        flatpickr("#pokeYokeStart", { ...config, defaultDate: start });
        flatpickr("#pokeYokeEnd", { ...config, defaultDate: end });
        
        flatpickr("#pokeYokeSummaryStart", { ...config, defaultDate: start, onClose: function() { /* fetchPokeYokeSummaryReport(); */ } });
        flatpickr("#pokeYokeSummaryEnd", { ...config, defaultDate: end, onClose: function() { /* fetchPokeYokeSummaryReport(); */ } });
    }

    const modelSelect = document.getElementById('pokeYokeModel');
    if (modelSelect) {
        modelSelect.addEventListener('change', fetchPokeYokeStations);
    }
    
    const summaryModelSelect = document.getElementById('pokeYokeSummaryModel');
    if (summaryModelSelect) {
        summaryModelSelect.addEventListener('change', fetchPokeYokeSummaryStations);
    }

    const btn = document.getElementById('pokeYokeApplyBtn');
    if (btn) {
        btn.addEventListener('click', fetchPokeYokeReport);
    }
    
    const summaryBtn = document.getElementById('pokeYokeSummaryApplyBtn');
    if (summaryBtn) {
        summaryBtn.addEventListener('click', fetchPokeYokeSummaryReport);
    }
});

async function exportPokeYokeToExcel() {
    if (!pokeYokeData || pokeYokeData.length === 0) {
        alert("No data to export");
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Poke Yoke Manual Inspection');

        // Fetch Logo
        const logoRes = await fetch('assets/logo-small.png');
        const logoBlob = await logoRes.blob();
        const logoBuffer = await logoBlob.arrayBuffer();
        const logoId = workbook.addImage({
            buffer: logoBuffer,
            extension: 'png',
        });

        // Add Logo (Top Left)
        sheet.addImage(logoId, {
            tl: { col: 0, row: 0 },
            ext: { width: 80, height: 80 }
        });

        sheet.mergeCells('B2:F2');
        const titleCell = sheet.getCell('B2');
        titleCell.value = 'POKE YOKE MANUAL INSPECTION OVERALL';
        titleCell.font = { name: 'Arial', size: 18, bold: true, color: { argb: 'FFD71920' } };

        sheet.getCell('B3').value = 'Exported On:';
        sheet.getCell('C3').value = new Date().toLocaleString();

        const headerRow = sheet.getRow(6);
        let colIndex = 1;
        headerRow.getCell(colIndex++).value = 'S.No';
        headerRow.getCell(colIndex++).value = 'DATE/TIME';
        headerRow.getCell(colIndex++).value = 'MAX STN NAME';
        headerRow.getCell(colIndex++).value = 'MAX CYCLE TIME';

        for (let i = 1; i <= 54; i++) {
            headerRow.getCell(colIndex++).value = 'ST' + i;
        }

        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF333333' }
        };

        let currentRow = 7;
        let serialNo = 1;
        pokeYokeData.forEach(row => {
            const excelRow = sheet.getRow(currentRow++);
            let cIdx = 1;

            excelRow.getCell(cIdx++).value = serialNo++;

            let dateStr = '-';
            if (row.date_Time) {
                const d = new Date(row.date_Time);
                dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
            }

            excelRow.getCell(cIdx++).value = dateStr;
            excelRow.getCell(cIdx++).value = row.max_STN_Name || '-';
            excelRow.getCell(cIdx++).value = row.max_CycleTime !== null && row.max_CycleTime !== undefined ? row.max_CycleTime : '-';

            for (let i = 1; i <= 54; i++) {
                excelRow.getCell(cIdx++).value = row[`sT${i}_CycleTime`] !== null ? row[`sT${i}_CycleTime`] : '-';
            }
        });

        // Adjust column widths
        sheet.getColumn(1).width = 8; // S.No
        sheet.getColumn(2).width = 25; // Date
        sheet.getColumn(3).width = 15; // Max STN Name
        sheet.getColumn(4).width = 15; // Max Cycle Time
        for (let i = 5; i <= 58; i++) {
            sheet.getColumn(i).width = 8;
        }

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `PokeYokeCycleTime_${new Date().getTime()}.xlsx`;
        a.click();
        window.URL.revokeObjectURL(url);

    } catch (e) {
        console.error("Export Error", e);
        alert("Export failed. See console.");
    }
}


let paretoChartInstance = null;
let currentParetoTab = 'stoppage';

function switchParetoTab(tab) {
    currentParetoTab = tab;

    document.getElementById('tabLineStoppage').classList.toggle('active', tab === 'stoppage');
    document.getElementById('tabEngineLoss').classList.toggle('active', tab === 'engineLoss');

    document.getElementById('paretoLoading').innerHTML = `
        <span class="material-symbols-outlined" style="animation: spin 1s linear infinite; font-size:40px; color:var(--primary);">autorenew</span>
        <p style="margin-top:10px; font-weight: bold;">Processing Pareto Chart...</p>
    `;
    document.getElementById('paretoLoading').style.display = 'flex';
    document.getElementById('paretoChart').style.display = 'none';

    setTimeout(renderParetoData, 50);
}

function closeParetoView() {
    const modal = document.getElementById('paretoModal');
    modal.classList.remove('active');
    setTimeout(() => {
        if (paretoChartInstance) {
            paretoChartInstance.destroy();
            paretoChartInstance = null;
        }
    }, 300); // Wait for transition to finish
}

function openParetoView() {
    if (!mainLineData || mainLineData.length === 0) {
        alert("No data available to generate Pareto chart.");
        return;
    }

    currentParetoTab = 'stoppage';
    document.getElementById('tabLineStoppage').classList.add('active');
    document.getElementById('tabEngineLoss').classList.remove('active');

    const modal = document.getElementById('paretoModal');
    modal.style.display = '';
    modal.classList.add('active');

    document.getElementById('paretoLoading').innerHTML = `
        <span class="material-symbols-outlined" style="animation: spin 1s linear infinite; font-size:40px; color:var(--primary);">autorenew</span>
        <p style="margin-top:10px; font-weight: bold;">Processing Pareto Chart...</p>
    `;
    document.getElementById('paretoLoading').style.display = 'flex';
    document.getElementById('paretoChart').style.display = 'none';

    setTimeout(renderParetoData, 100);
}

function renderParetoData() {
    if (paretoChartInstance) {
        paretoChartInstance.destroy();
        paretoChartInstance = null;
    }

    try {
        let sortedStations = [];
        let yAxisLabel = 'Count';

        if (currentParetoTab === 'stoppage') {
            yAxisLabel = 'Count';
            const occurrences = {};
            mainLineData.forEach(row => {
                const stn = row.max_STN_Name ? String(row.max_STN_Name).trim() : null;
                if (stn && stn !== '' && stn !== '-') {
                    occurrences[stn] = (occurrences[stn] || 0) + 1;
                }
            });

            sortedStations = Object.keys(occurrences).map(stn => {
                return { station: stn, count: occurrences[stn] };
            });
        } else if (currentParetoTab === 'engineLoss') {
            yAxisLabel = 'Calculated Engine Loss';
            const groupedCycleTimes = {};

            mainLineData.forEach(row => {
                const stn = row.max_STN_Name ? String(row.max_STN_Name).trim() : null;
                const cycleTime = parseFloat(row.max_CycleTime);

                if (stn && stn !== '' && stn !== '-' && !isNaN(cycleTime) && cycleTime > 40.5) {
                    groupedCycleTimes[stn] = (groupedCycleTimes[stn] || 0) + cycleTime;
                }
            });

            sortedStations = Object.keys(groupedCycleTimes).map(stn => {
                const loss = groupedCycleTimes[stn] / 40.5;
                return { station: stn, count: Math.round(loss) };
            });
        }

        if (sortedStations.length === 0) {
            document.getElementById('paretoLoading').innerHTML = "<p>No data found for the current selection.</p>";
            return;
        }

        sortedStations.sort((a, b) => b.count - a.count);

        const totalOccurrences = sortedStations.reduce((sum, item) => sum + item.count, 0);
        let runningTotal = 0;

        const categories = [];
        const countData = [];
        const percentageData = [];

        sortedStations.forEach(item => {
            runningTotal += item.count;
            const cumPct = totalOccurrences > 0 ? (runningTotal / totalOccurrences) * 100 : 0;

            categories.push(item.station);
            countData.push(item.count);
            percentageData.push(parseFloat(cumPct.toFixed(2)));
        });

        const ctx = document.getElementById('paretoChart').getContext('2d');
        const isLightMode = document.body.classList.contains('light-mode');
        const textColor = isLightMode ? '#333333' : '#ffffff';
        const gridColor = isLightMode ? '#e5e7eb' : '#374151';

        document.getElementById('paretoLoading').style.display = 'none';
        document.getElementById('paretoChart').style.display = 'block';

        paretoChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: categories,
                datasets: [{
                    type: 'bar',
                    label: yAxisLabel,
                    data: countData,
                    backgroundColor: '#f43f5e',
                    yAxisID: 'y'
                }, {
                    type: 'line',
                    label: 'Cumulative Percentage',
                    data: percentageData,
                    borderColor: '#eab308',
                    backgroundColor: '#eab308',
                    borderWidth: 3,
                    yAxisID: 'y1'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: textColor }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: textColor, maxRotation: 90, minRotation: 90 },
                        grid: { color: gridColor }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: { display: true, text: yAxisLabel, color: textColor },
                        ticks: { color: textColor, precision: currentParetoTab === 'stoppage' ? 0 : undefined },
                        grid: { color: gridColor },
                        beginAtZero: true
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: { display: true, text: 'Percentage', color: textColor },
                        ticks: {
                            color: textColor,
                            callback: function (value) { return value + '%'; }
                        },
                        grid: { drawOnChartArea: false },
                        min: 0,
                        max: 100
                    }
                }
            }
        });
    } catch (e) {
        console.error("Error generating Pareto chart:", e);
        document.getElementById('paretoLoading').innerHTML = `<p style="color:red;">Error generating chart: ${e.message}</p>`;
    }
}
// --- POKE YOKE SUMMARY LOGIC ---
async function fetchPokeYokeSummaryReport() {
    const lineDropdown = document.getElementById('mainDashboardDropdown');
    const modelDropdown = document.getElementById('pokeYokeSummaryModel');
    const line = lineDropdown ? lineDropdown.value : '';
    const hc = modelDropdown ? modelDropdown.value : '';

    const startInput = document.getElementById('pokeYokeSummaryStart');
    const endInput = document.getElementById('pokeYokeSummaryEnd');
    const start = startInput ? startInput.value : '';
    const end = endInput ? endInput.value : '';
    
    const checkedStations = Array.from(document.querySelectorAll('.pokeYokeSummaryStationCb:checked')).map(cb => cb.value);
    const station = checkedStations.join(',');

    if (!line || !hc || !station || !start || !end) {
        alert("Please fill all filters (Line, HC, Station, Start Date, End Date)");
        return;
    }

    const url = `/api/reports/poke-yoke/summary/data?line=${encodeURIComponent(line)}&historyCard=${encodeURIComponent(hc)}&station=${encodeURIComponent(station)}&startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`;

    const btn = document.getElementById('pokeYokeSummaryApplyBtn');
    if (btn) btn.innerHTML = '<span class="material-symbols-outlined">refresh</span> Loading...';

    // Close dropdown if open
    const dropdown = document.getElementById('pokeYokeSummaryStationDropdown');
    if (dropdown) dropdown.style.display = 'none';

    try {
        const res = await fetch(url);
        
        if (res.ok) {
            pokeYokeSummaryData = await res.json();
            pokeYokeSummaryPage = 1;
            renderPokeYokeSummaryTable();
        } else {
            alert("Failed to load summary report data.");
            pokeYokeSummaryData = [];
            renderPokeYokeSummaryTable();
        }
    } catch (err) {
        console.error('Error fetching poke yoke summary data', err);
        alert("Error connecting to server");
    } finally {
        if (btn) btn.innerHTML = 'Apply';
    }
}

function renderPokeYokeSummaryTable() {
    const tbody = document.getElementById('pokeYokeSummaryBody');
    const emptyState = document.getElementById('pokeYokeSummaryEmpty');
    
    if (!tbody || !emptyState) return;

    tbody.innerHTML = '';

    if (pokeYokeSummaryData.length === 0) {
        emptyState.style.display = 'flex';
        document.getElementById('pokeYokeSummaryTable').style.display = 'none';
        document.getElementById('pokeYokeSummaryPagination').style.display = 'none';
    } else {
        emptyState.style.display = 'none';
        document.getElementById('pokeYokeSummaryTable').style.display = 'table';
        document.getElementById('pokeYokeSummaryPagination').style.display = 'flex';

        const startIndex = (pokeYokeSummaryPage - 1) * POKE_YOKE_SUMMARY_ITEMS_PER_PAGE;
        const endIndex = startIndex + POKE_YOKE_SUMMARY_ITEMS_PER_PAGE;
        const pageData = pokeYokeSummaryData.slice(startIndex, endIndex);

        pageData.forEach((row, index) => {
            const tr = document.createElement('tr');
            
            const startDt = new Date(row.startingDatetime);
            const startDtStr = isNaN(startDt) ? row.startingDatetime : `${startDt.getFullYear()}-${String(startDt.getMonth()+1).padStart(2,'0')}-${String(startDt.getDate()).padStart(2,'0')} ${String(startDt.getHours()).padStart(2,'0')}:${String(startDt.getMinutes()).padStart(2,'0')}:${String(startDt.getSeconds()).padStart(2,'0')}`;
            const endDt = new Date(row.endingDatetime);
            const endDtStr = isNaN(endDt) ? row.endingDatetime : `${endDt.getFullYear()}-${String(endDt.getMonth()+1).padStart(2,'0')}-${String(endDt.getDate()).padStart(2,'0')} ${String(endDt.getHours()).padStart(2,'0')}:${String(endDt.getMinutes()).padStart(2,'0')}:${String(endDt.getSeconds()).padStart(2,'0')}`;

            tr.innerHTML = `
                <td>${startIndex + index + 1}</td>
                <td>All</td>
                <td>${row.noOfEngines}</td>
                <td>${row.stationDescription}</td>
                <td>${row.stationNumber}</td>
                <td>MI</td>
                <td>${row.startingEngineNumber}</td>
                <td>${row.endingEngineNumber}</td>
                <td>${startDtStr}</td>
                <td>${endDtStr}</td>
                <td>${row.durationSeconds} sec</td>
            `;
            tbody.appendChild(tr);
        });

        // Update Pagination Controls
        const totalEl = document.getElementById('pokeYokeSummaryTotalCount');
        const pageLabelEl = document.getElementById('pokeYokeSummaryPageLabel');
        const btnPrev = document.getElementById('btnPrevPokeYokeSummary');
        const btnNext = document.getElementById('btnNextPokeYokeSummary');

        if (totalEl) totalEl.textContent = `Total Count: ${pokeYokeSummaryData.length}`;
        if (pageLabelEl) pageLabelEl.textContent = `Page ${pokeYokeSummaryPage}`;

        if (btnPrev) {
            btnPrev.disabled = pokeYokeSummaryPage === 1;
            btnPrev.style.opacity = pokeYokeSummaryPage === 1 ? 0.5 : 1;
        }

        if (btnNext) {
            const hasNext = endIndex < pokeYokeSummaryData.length;
            btnNext.disabled = !hasNext;
            btnNext.style.opacity = !hasNext ? 0.5 : 1;
        }
    }
}

function changePokeYokeSummaryPage(direction) {
    pokeYokeSummaryPage += direction;
    renderPokeYokeSummaryTable();
}

async function exportPokeYokeSummaryToExcel() {
    if (!pokeYokeSummaryData || pokeYokeSummaryData.length === 0) {
        alert("No data to export");
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Poke Yoke Summary');

        const logoRes = await fetch('assets/logo-small.png');
        const logoBlob = await logoRes.blob();
        const logoBuffer = await logoBlob.arrayBuffer();
        const logoId = workbook.addImage({
            buffer: logoBuffer,
            extension: 'png',
        });

        sheet.addImage(logoId, {
            tl: { col: 0, row: 0 },
            ext: { width: 80, height: 80 }
        });

        sheet.mergeCells('B2:F2');
        const titleCell = sheet.getCell('B2');
        titleCell.value = 'POKE YOKE MANUAL INSPECTION SUMMARY';
        titleCell.font = { name: 'Arial', size: 18, bold: true, color: { argb: 'FFD71920' } };

        sheet.getCell('B3').value = 'Exported On:';
        sheet.getCell('C3').value = new Date().toLocaleString();

        const headerRow = sheet.getRow(6);
        const headers = ['S.No', 'Shift', 'No Of Engines', 'Station Description', 'Station Number', 'Status', 'Starting Engine Number', 'Ending Engine Number', 'Starting Date time', 'Ending Date time', 'Duration'];
        
        headers.forEach((h, idx) => {
            headerRow.getCell(idx + 1).value = h;
            headerRow.getCell(idx + 1).font = { bold: true };
            headerRow.getCell(idx + 1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };
            headerRow.getCell(idx + 1).border = {
                top: {style:'thin'},
                left: {style:'thin'},
                bottom: {style:'thin'},
                right: {style:'thin'}
            };
        });

        let currentRow = 7;
        let serialNo = 1;
        pokeYokeSummaryData.forEach(row => {
            const excelRow = sheet.getRow(currentRow++);
            const startDt = new Date(row.startingDatetime);
            const startDtStr = isNaN(startDt) ? row.startingDatetime : `${startDt.getFullYear()}-${String(startDt.getMonth()+1).padStart(2,'0')}-${String(startDt.getDate()).padStart(2,'0')} ${String(startDt.getHours()).padStart(2,'0')}:${String(startDt.getMinutes()).padStart(2,'0')}:${String(startDt.getSeconds()).padStart(2,'0')}`;
            const endDt = new Date(row.endingDatetime);
            const endDtStr = isNaN(endDt) ? row.endingDatetime : `${endDt.getFullYear()}-${String(endDt.getMonth()+1).padStart(2,'0')}-${String(endDt.getDate()).padStart(2,'0')} ${String(endDt.getHours()).padStart(2,'0')}:${String(endDt.getMinutes()).padStart(2,'0')}:${String(endDt.getSeconds()).padStart(2,'0')}`;

            excelRow.getCell(1).value = serialNo++;
            excelRow.getCell(2).value = 'All';
            excelRow.getCell(3).value = row.noOfEngines;
            excelRow.getCell(4).value = row.stationDescription;
            excelRow.getCell(5).value = row.stationNumber;
            excelRow.getCell(6).value = 'MI';
            excelRow.getCell(7).value = row.startingEngineNumber;
            excelRow.getCell(8).value = row.endingEngineNumber;
            excelRow.getCell(9).value = startDtStr;
            excelRow.getCell(10).value = endDtStr;
            excelRow.getCell(11).value = `${row.durationSeconds} sec`;
            
            for(let i=1; i<=11; i++) {
                excelRow.getCell(i).border = {
                    top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'}
                };
            }
        });

        for (let i = 1; i <= 11; i++) {
            sheet.getColumn(i).width = 20;
        }

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Poke_Yoke_Summary_${new Date().getTime()}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (err) {
        console.error('Error generating excel:', err);
        alert("Error generating Excel file");
    }
}

// --- ENGINE QHOLD REPORT LOGIC ---
let qHoldData = [];
let qHoldPage = 1;
let qHoldMode = 'Overall';
let qHoldChart = null;
let qHoldInitialLoadDone = false;
const QHOLD_ITEMS_PER_PAGE = 10;

function getCurrentQHoldShift() {
    const time = new Date();
    const minutes = time.getHours() * 60 + time.getMinutes();
    if (minutes > 15 && minutes <= 435) return 'A';   // 00:15 - 07:15
    if (minutes > 435 && minutes <= 945) return 'B';  // 07:15 - 15:45
    return 'C';                                        // 15:45 - 00:15
}

function loadQHoldDefaultView() {
    if (qHoldInitialLoadDone) return;
    qHoldInitialLoadDone = true;

    const currentShift = getCurrentQHoldShift();
    const shiftSelect = document.getElementById('qHoldShift');
    if (shiftSelect) {
        if (!Array.from(shiftSelect.options).some(o => o.value === currentShift)) {
            const opt = document.createElement('option');
            opt.value = currentShift;
            opt.textContent = currentShift;
            shiftSelect.appendChild(opt);
        }
        shiftSelect.value = currentShift;
    }

    fetchQHoldReport('Overall');
}

function formatQHoldDateTime(value) {
    if (!value) return '-';
    const dt = new Date(value);
    if (isNaN(dt)) return value;
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}:${String(dt.getSeconds()).padStart(2, '0')}`;
}

function qHoldDefaultRange() {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 15, 0, 0);
    if (now < start) {
        start.setDate(start.getDate() - 1);
    }
    const end = new Date(start.getTime() + (24 * 60 * 60 * 1000));
    return { start, end };
}

async function fetchQHoldReport(mode) {
    qHoldMode = mode || qHoldMode || 'Overall';

    const start = document.getElementById('qHoldStart')?.value || '';
    const end = document.getElementById('qHoldEnd')?.value || '';
    const model = document.getElementById('qHoldModel')?.value || '';
    const engineNumber = document.getElementById('qHoldEngineNumber')?.value || '';
    const rejectionDetails = document.getElementById('qHoldRejectionDetails')?.value || '';
    const reworkDetails = document.getElementById('qHoldReworkDetails')?.value || '';
    const category = document.getElementById('qHoldCategory')?.value || '';
    const result = document.getElementById('qHoldResult')?.value || '';
    const station = document.getElementById('qHoldStation')?.value || '';
    const shift = document.getElementById('qHoldShift')?.value || '';

    const params = new URLSearchParams({
        mode: qHoldMode,
        startDate: start,
        endDate: end,
        model, engineNumber, qHoldStation: station, result, category,
        rejectionDetails, reworkDetails, shift
    });

    const btnMap = { Overall: 'qHoldOverallBtn', Distinct: 'qHoldDistinctBtn', Duplicate: 'qHoldDuplicateBtn' };
    const actionButtons = Object.values(btnMap).map(id => document.getElementById(id)).filter(Boolean);
    const activeBtn = document.getElementById(btnMap[qHoldMode]);
    const originalLabel = activeBtn ? activeBtn.textContent : '';

    actionButtons.forEach(b => b.disabled = true);
    if (activeBtn) activeBtn.textContent = 'Loading...';

    try {
        const res = await fetch(`/api/reports/qhold/data?${params.toString()}`);
        if (res.ok) {
            qHoldData = await res.json();
        } else {
            alert('Failed to load QHold report data.');
            qHoldData = [];
        }
    } catch (err) {
        console.error('Error fetching QHold report', err);
        alert('Error connecting to server');
        qHoldData = [];
    } finally {
        qHoldPage = 1;
        renderQHoldTable();
        updateQHoldDonut();
        populateQHoldFilterDropdowns();
        actionButtons.forEach(b => b.disabled = false);
        if (activeBtn) activeBtn.textContent = originalLabel;
    }
}

const QHOLD_DROPDOWN_FIELDS = [
    { id: 'qHoldModel', prop: 'model' },
    { id: 'qHoldEngineNumber', prop: 'engineNumber' },
    { id: 'qHoldRejectionDetails', prop: 'rejectionDetails' },
    { id: 'qHoldReworkDetails', prop: 'reworkDetails' },
    { id: 'qHoldCategory', prop: 'category' },
    { id: 'qHoldResult', prop: 'result' },
    { id: 'qHoldStation', prop: 'qHoldStation' },
    { id: 'qHoldShift', prop: 'shift' }
];

function populateQHoldFilterDropdowns() {
    QHOLD_DROPDOWN_FIELDS.forEach(field => {
        const select = document.getElementById(field.id);
        if (!select) return;

        const previousValue = select.value || 'ALL';
        const values = Array.from(new Set(
            (qHoldData || [])
                .map(row => (row[field.prop] ?? '').toString().trim())
                .filter(v => v.length > 0)
        )).sort();

        select.innerHTML = '<option value="ALL">ALL</option>' + values.map(v => `<option value="${v}">${v}</option>`).join('');
        select.value = values.includes(previousValue) ? previousValue : 'ALL';
    });
}

function renderQHoldTable() {
    const tbody = document.getElementById('qHoldBody');
    const emptyState = document.getElementById('qHoldEmpty');
    if (!tbody || !emptyState) return;

    tbody.innerHTML = '';

    if (qHoldData.length === 0) {
        emptyState.style.display = 'flex';
        document.getElementById('qHoldTable').style.display = 'none';
        document.getElementById('qHoldPagination').style.display = 'none';
        return;
    }

    emptyState.style.display = 'none';
    document.getElementById('qHoldTable').style.display = 'table';
    document.getElementById('qHoldPagination').style.display = 'flex';

    const startIndex = (qHoldPage - 1) * QHOLD_ITEMS_PER_PAGE;
    const endIndex = startIndex + QHOLD_ITEMS_PER_PAGE;
    const pageData = qHoldData.slice(startIndex, endIndex);

    pageData.forEach((row, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${startIndex + index + 1}</td>
            <td>${formatQHoldDateTime(row.date)}</td>
            <td>${row.shift ?? '-'}</td>
            <td>${row.engineNumber ?? '-'}</td>
            <td>${row.model ?? '-'}</td>
            <td>${row.qHoldStation ?? '-'}</td>
            <td>${row.userId ?? '-'}</td>
            <td>${row.result ?? '-'}</td>
            <td>${row.rejectionDetails ?? '-'}</td>
            <td>${row.rootCause ?? '-'}</td>
            <td>${row.reworkDetails ?? '-'}</td>
            <td>${row.category ?? '-'}</td>
            <td>${row.supplier ?? '-'}</td>
            <td>${formatQHoldDateTime(row.reworkDate)}</td>
            <td>${row.recheckStatus ?? '-'}</td>
            <td>${row.reworkedBy ?? '-'}</td>
            <td>${row.verifiedBy ?? '-'}</td>
            <td>${row.barcode1 ?? '-'}</td>
        `;
        tbody.appendChild(tr);
    });

    const totalEl = document.getElementById('qHoldTotalCount');
    const pageLabelEl = document.getElementById('qHoldPageLabel');
    const btnPrev = document.getElementById('btnPrevQHold');
    const btnNext = document.getElementById('btnNextQHold');

    if (totalEl) totalEl.textContent = `Total Count: ${qHoldData.length}`;
    if (pageLabelEl) pageLabelEl.textContent = `Page ${qHoldPage}`;

    if (btnPrev) {
        btnPrev.disabled = qHoldPage === 1;
        btnPrev.style.opacity = qHoldPage === 1 ? 0.5 : 1;
    }
    if (btnNext) {
        const hasNext = endIndex < qHoldData.length;
        btnNext.disabled = !hasNext;
        btnNext.style.opacity = !hasNext ? 0.5 : 1;
    }
}

function changeQHoldPage(direction) {
    qHoldPage += direction;
    renderQHoldTable();
}

function updateQHoldDonut() {
    const counts = { OK: 0, NOK: 0, BYPASSED: 0, OTHER: 0 };
    (qHoldData || []).forEach(r => {
        const res = (r.result || '').toString().trim().toUpperCase();
        if (Object.prototype.hasOwnProperty.call(counts, res)) counts[res]++;
        else counts.OTHER++;
    });

    const total = qHoldData.length;
    const buckets = [
        { label: 'OK', color: '#22c55e', count: counts.OK },
        { label: 'NOK', color: '#ef4444', count: counts.NOK },
        { label: 'BYPASSED', color: '#3b82f6', count: counts.BYPASSED }
    ];
    if (counts.OTHER > 0) buckets.push({ label: 'OTHER', color: '#9ca3af', count: counts.OTHER });

    const ctx = document.getElementById('qHoldStatusChart');
    if (ctx && typeof Chart !== 'undefined') {
        if (qHoldChart) {
            qHoldChart.destroy();
            qHoldChart = null;
        }
        qHoldChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: buckets.map(b => b.label),
                datasets: [{ data: buckets.map(b => b.count), backgroundColor: buckets.map(b => b.color), borderWidth: 0 }]
            },
            options: {
                cutout: '65%',
                maintainAspectRatio: false,
                plugins: { legend: { display: false } }
            }
        });
    }

    const legendEl = document.getElementById('qHoldStatusLegend');
    if (legendEl) {
        legendEl.innerHTML = buckets.map(b => {
            const pct = total > 0 ? Math.round((b.count / total) * 100) : 0;
            return `<span style="display:flex; align-items:center; gap:4px;"><span style="width:8px;height:8px;border-radius:50%;background:${b.color};display:inline-block;"></span>${b.label}: ${b.count} (${pct}%)</span>`;
        }).join('');
    }
}

function clearQHoldFilters() {
    QHOLD_DROPDOWN_FIELDS.forEach(field => {
        const select = document.getElementById(field.id);
        if (select) select.value = 'ALL';
    });

    const { start, end } = qHoldDefaultRange();
    const startInput = document.getElementById('qHoldStart');
    const endInput = document.getElementById('qHoldEnd');
    if (startInput && startInput._flatpickr) startInput._flatpickr.setDate(start);
    if (endInput && endInput._flatpickr) endInput._flatpickr.setDate(end);

    qHoldData = [];
    qHoldPage = 1;
    renderQHoldTable();
    updateQHoldDonut();
}

async function exportQHoldToExcel() {
    if (!qHoldData || qHoldData.length === 0) {
        alert("No data to export");
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('QHold Report');

        const logoRes = await fetch('assets/logo-small.png');
        const logoBlob = await logoRes.blob();
        const logoBuffer = await logoBlob.arrayBuffer();
        const logoId = workbook.addImage({ buffer: logoBuffer, extension: 'png' });

        sheet.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 80, height: 80 } });

        sheet.mergeCells('B2:F2');
        const titleCell = sheet.getCell('B2');
        titleCell.value = 'ENGINE QHOLD REPORT';
        titleCell.font = { name: 'Arial', size: 18, bold: true, color: { argb: 'FFD71920' } };

        sheet.getCell('B3').value = 'Exported On:';
        sheet.getCell('C3').value = new Date().toLocaleString();

        const headers = ['S.No', 'Date', 'Shift', 'Engine Number', 'Model Code', 'Qhold Station', 'User ID', 'Qhold Result', 'Rejection Details', 'Root Cause', 'Rework Details', 'Category', 'Supplier', 'Rework Date', 'Recheck Status', 'Reworked By', 'Verified By', 'Barcode 1'];
        const headerRow = sheet.getRow(6);
        headers.forEach((h, idx) => {
            const cell = headerRow.getCell(idx + 1);
            cell.value = h;
            cell.font = { bold: true };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });

        let currentRow = 7;
        let serialNo = 1;
        qHoldData.forEach(row => {
            const excelRow = sheet.getRow(currentRow++);
            const values = [
                serialNo++, formatQHoldDateTime(row.date), row.shift, row.engineNumber, row.model,
                row.qHoldStation, row.userId, row.result, row.rejectionDetails, row.rootCause,
                row.reworkDetails, row.category, row.supplier, formatQHoldDateTime(row.reworkDate),
                row.recheckStatus, row.reworkedBy, row.verifiedBy, row.barcode1
            ];
            values.forEach((v, idx) => {
                const cell = excelRow.getCell(idx + 1);
                cell.value = v ?? '-';
                cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            });
        });

        for (let i = 1; i <= headers.length; i++) {
            sheet.getColumn(i).width = 18;
        }

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `QHold_Report_${qHoldMode}_${new Date().getTime()}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (err) {
        console.error('Error generating excel:', err);
        alert("Error generating Excel file");
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const { start, end } = qHoldDefaultRange();
    if (typeof flatpickr !== 'undefined') {
        const config = {
            enableTime: true,
            dateFormat: "Y-m-d\\TH:i",
            altInput: true,
            altFormat: "d M Y, h:i K",
            time_24hr: false,
            theme: "dark"
        };
        flatpickr("#qHoldStart", { ...config, defaultDate: start });
        flatpickr("#qHoldEnd", { ...config, defaultDate: end });
    }
    renderQHoldTable();
    updateQHoldDonut();
});

// --- CYLINDER HEAD LEAK REJECTION REPORT ---

let cylinderHeadData = [];
let cylinderHeadView = 'summary';
let cylinderHeadChart = null;
let cylinderHeadInitialLoadDone = false;

const CYLINDER_HEAD_CELL_ORDER = ['ORG-cell1', 'ORG-cell2', 'VLM-cell1', 'VLM-cell2', 'VLM-cell3', 'VLM-cell4', 'VLM-cell5', 'VLM-cell6'];
const CYLINDER_HEAD_CARD_ORDER = [
    { location: 'ORAGADAM', assemblyLine: 'EA3', label: 'ORAGADAM - EA3' },
    { location: 'VALLAM', assemblyLine: 'EA1', label: 'VALLAM - EA1' },
    { location: 'VALLAM', assemblyLine: 'EA2', label: 'VALLAM - EA2' }
];
const CYLINDER_HEAD_CHART_COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#8b5cf6', '#22c55e', '#eab308', '#ec4899', '#06b6d4'];

function cylinderHeadDefaultRange() {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 15, 0, 0);
    if (now < start) {
        start.setDate(start.getDate() - 1);
    }
    const end = new Date(start.getTime() + (24 * 60 * 60 * 1000));
    return { start, end };
}

function cylinderHeadDateKey(value) {
    if (!value) return '';
    return typeof value === 'string' ? value.slice(0, 10) : new Date(value).toISOString().slice(0, 10);
}

function cylinderHeadFormatDateLabel(dateKey) {
    const parts = dateKey.split('-');
    if (parts.length !== 3) return dateKey;
    return `${parseInt(parts[2], 10)}.${parseInt(parts[1], 10)}.${parts[0].slice(2)}`;
}

function cylinderHeadRejPct(nok, actual) {
    return actual > 0 ? Math.round((nok / actual) * 100) : 0;
}

function cylinderHeadSetLoading(isLoading) {
    const loadingEl = document.getElementById('cylinderHeadLoading');
    if (loadingEl) loadingEl.style.display = isLoading ? 'flex' : 'none';
}

function loadCylinderHeadDefaultView() {
    if (cylinderHeadInitialLoadDone) return;
    cylinderHeadInitialLoadDone = true;
    fetchCylinderHeadReport();
}

async function fetchCylinderHeadReport() {
    const plant = document.getElementById('cylinderHeadPlant')?.value || 'ALL';
    const line = document.getElementById('cylinderHeadLine')?.value || 'ALL';
    const shift = document.getElementById('cylinderHeadShift')?.value || 'ALL';
    const start = document.getElementById('cylinderHeadStart')?.value || '';
    const end = document.getElementById('cylinderHeadEnd')?.value || '';

    const params = new URLSearchParams({ startDate: start, endDate: end });
    if (plant !== 'ALL') params.set('plant', plant);
    if (line !== 'ALL') params.set('assemblyLine', line);
    if (shift !== 'ALL') params.set('shift', shift);

    const summaryBtn = document.getElementById('cylinderHeadSummaryBtn');
    const trendBtn = document.getElementById('cylinderHeadTrendBtn');
    [summaryBtn, trendBtn].forEach(b => { if (b) b.disabled = true; });
    cylinderHeadSetLoading(true);

    try {
        const res = await fetch(`/api/reports/cylinder-head-leak/data?${params.toString()}`);
        if (res.ok) {
            cylinderHeadData = await res.json();
        } else {
            alert('Failed to load Cylinder Head Leak Rejection report data.');
            cylinderHeadData = [];
        }
    } catch (err) {
        console.error('Error fetching Cylinder Head Leak report', err);
        alert('Error connecting to server');
        cylinderHeadData = [];
    } finally {
        cylinderHeadSetLoading(false);
        [summaryBtn, trendBtn].forEach(b => { if (b) b.disabled = false; });
        renderCylinderHeadCards();
        renderCylinderHeadPivotTable();
        renderCylinderHeadTrendChart();
    }
}

function renderCylinderHeadCards() {
    const container = document.getElementById('cylinderHeadCards');
    if (!container) return;

    const groups = {};
    (cylinderHeadData || []).forEach(row => {
        const key = `${row.location}|${row.assemblyLine}`;
        if (!groups[key]) groups[key] = { ok: 0, nok: 0, actual: 0 };
        groups[key].ok += row.okQty || 0;
        groups[key].nok += row.notOkQty || 0;
        groups[key].actual += row.actualQty || 0;
    });

    const knownKeys = new Set(CYLINDER_HEAD_CARD_ORDER.map(c => `${c.location}|${c.assemblyLine}`));
    const extraCards = Object.keys(groups)
        .filter(key => !knownKeys.has(key))
        .map(key => {
            const [location, assemblyLine] = key.split('|');
            return { location, assemblyLine, label: `${location} - ${assemblyLine}` };
        });

    // Always show all known lines (even with zero data for the current filters), plus any unexpected ones found in the data.
    const cards = [...CYLINDER_HEAD_CARD_ORDER, ...extraCards];

    container.innerHTML = cards.map(c => {
        const g = groups[`${c.location}|${c.assemblyLine}`] || { ok: 0, nok: 0, actual: 0 };
        const rejPct = cylinderHeadRejPct(g.nok, g.actual);
        return `
            <div style="flex:1; min-width:220px; background:#1e1e1e; border:1px solid #333; border-radius:8px; overflow:hidden;">
                <div style="background:var(--primary); color:#fff; font-size:12px; font-weight:700; padding:6px 10px; text-align:center;">${c.label}</div>
                <div style="display:flex; padding:10px 6px; gap:6px;">
                    <div style="flex:1; text-align:center;">
                        <div style="font-size:18px; font-weight:700; color:#fff;">${g.actual}</div>
                        <div style="font-size:10px; color:#888;">Total</div>
                    </div>
                    <div style="flex:1; text-align:center;">
                        <div style="font-size:18px; font-weight:700; color:#22c55e;">${g.ok}</div>
                        <div style="font-size:10px; color:#888;">OK</div>
                    </div>
                    <div style="flex:1; text-align:center;">
                        <div style="font-size:18px; font-weight:700; color:#ef4444;">${g.nok}</div>
                        <div style="font-size:10px; color:#888;">NOK</div>
                    </div>
                    <div style="flex:1; text-align:center;">
                        <div style="font-size:18px; font-weight:700; color:#f59e0b;">${rejPct}%</div>
                        <div style="font-size:10px; color:#888;">Rej%</div>
                    </div>
                </div>
            </div>`;
    }).join('');
}

function renderCylinderHeadPivotTable() {
    const thead = document.getElementById('cylinderHeadTableHead');
    const tbody = document.getElementById('cylinderHeadTableBody');
    const emptyState = document.getElementById('cylinderHeadEmpty');
    const table = document.getElementById('cylinderHeadTable');
    if (!thead || !tbody || !emptyState || !table) return;

    thead.innerHTML = '';
    tbody.innerHTML = '';

    if (!cylinderHeadData || cylinderHeadData.length === 0) {
        table.style.display = 'none';
        emptyState.style.display = 'flex';
        return;
    }
    table.style.display = 'table';
    emptyState.style.display = 'none';

    const dates = Array.from(new Set(cylinderHeadData.map(r => cylinderHeadDateKey(r.date)))).sort();
    const shifts = ['A', 'B', 'C'];
    const metrics = [{ key: 'actual', label: 'Consumption' }, { key: 'ok', label: 'OK' }, { key: 'nok', label: 'NOK' }, { key: 'rej', label: 'Rej%' }];

    // pivot[cell][date][shift] = { ok, nok, actual }, pooled across AssemblyLine
    const pivot = {};
    const cellsPresent = new Set();
    cylinderHeadData.forEach(row => {
        const cell = row.cell || 'Unknown';
        const dateKey = cylinderHeadDateKey(row.date);
        cellsPresent.add(cell);
        pivot[cell] = pivot[cell] || {};
        pivot[cell][dateKey] = pivot[cell][dateKey] || {};
        const bucket = pivot[cell][dateKey][row.shift] || { ok: 0, nok: 0, actual: 0 };
        bucket.ok += row.okQty || 0;
        bucket.nok += row.notOkQty || 0;
        bucket.actual += row.actualQty || 0;
        pivot[cell][dateKey][row.shift] = bucket;
    });

    const cellOrder = [...CYLINDER_HEAD_CELL_ORDER.filter(c => cellsPresent.has(c)), ...Array.from(cellsPresent).filter(c => !CYLINDER_HEAD_CELL_ORDER.includes(c))];

    const cellStyle = 'padding:6px 8px; text-align:center; white-space:nowrap; font-size:12px;';
    const headStyle = 'padding:6px 8px; text-align:center; white-space:nowrap; font-size:12px; color:#888; border-bottom:1px solid #333;';

    const row0 = document.createElement('tr');
    row0.innerHTML = `<th rowspan="3" style="${headStyle} text-align:left; background:#1f1f1f; position:sticky; left:0; z-index:11;">Cell</th>` +
        dates.map(d => `<th colspan="12" style="${headStyle}">${cylinderHeadFormatDateLabel(d)}</th>`).join('') +
        `<th colspan="4" rowspan="2" style="${headStyle} background:rgba(218,41,28,0.15);">Total</th>`;
    thead.appendChild(row0);

    const row1 = document.createElement('tr');
    row1.innerHTML = dates.map(() => shifts.map(s => `<th colspan="4" style="${headStyle}">Shift ${s}</th>`).join('')).join('');
    thead.appendChild(row1);

    const row2 = document.createElement('tr');
    row2.innerHTML = dates.map(() => shifts.map(() => metrics.map(m => `<th style="${headStyle}">${m.label}</th>`).join('')).join('')).join('') +
        metrics.map(m => `<th style="${headStyle} background:rgba(218,41,28,0.15);">${m.label}</th>`).join('');
    thead.appendChild(row2);

    cellOrder.forEach(cell => {
        const tr = document.createElement('tr');
        let html = `<td style="${cellStyle} text-align:left; font-weight:600; background:#1e1e1e; position:sticky; left:0;">${cell}</td>`;
        const totals = { ok: 0, nok: 0, actual: 0 };

        dates.forEach(d => {
            shifts.forEach(s => {
                const b = (pivot[cell]?.[d]?.[s]) || { ok: 0, nok: 0, actual: 0 };
                totals.ok += b.ok; totals.nok += b.nok; totals.actual += b.actual;
                html += `<td style="${cellStyle}">${b.actual || ''}</td><td style="${cellStyle}">${b.ok || ''}</td><td style="${cellStyle}">${b.nok || ''}</td><td style="${cellStyle}">${b.actual > 0 ? cylinderHeadRejPct(b.nok, b.actual) + '%' : ''}</td>`;
            });
        });

        html += `<td style="${cellStyle} background:rgba(218,41,28,0.1); font-weight:600;">${totals.actual}</td><td style="${cellStyle} background:rgba(218,41,28,0.1); font-weight:600;">${totals.ok}</td><td style="${cellStyle} background:rgba(218,41,28,0.1); font-weight:600;">${totals.nok}</td><td style="${cellStyle} background:rgba(218,41,28,0.1); font-weight:600;">${cylinderHeadRejPct(totals.nok, totals.actual)}%</td>`;
        tr.innerHTML = html;
        tbody.appendChild(tr);
    });

    // Grand total row
    const grandTr = document.createElement('tr');
    let grandHtml = `<td style="${cellStyle} text-align:left; font-weight:700; background:#1e1e1e; position:sticky; left:0;">Total</td>`;
    const grandTotal = { ok: 0, nok: 0, actual: 0 };
    dates.forEach(d => {
        shifts.forEach(s => {
            let ok = 0, nok = 0, actual = 0;
            cellOrder.forEach(cell => {
                const b = (pivot[cell]?.[d]?.[s]) || { ok: 0, nok: 0, actual: 0 };
                ok += b.ok; nok += b.nok; actual += b.actual;
            });
            grandTotal.ok += ok; grandTotal.nok += nok; grandTotal.actual += actual;
            grandHtml += `<td style="${cellStyle} font-weight:600;">${actual || ''}</td><td style="${cellStyle} font-weight:600;">${ok || ''}</td><td style="${cellStyle} font-weight:600;">${nok || ''}</td><td style="${cellStyle} font-weight:600;">${actual > 0 ? cylinderHeadRejPct(nok, actual) + '%' : ''}</td>`;
        });
    });
    grandHtml += `<td style="${cellStyle} background:rgba(218,41,28,0.15); font-weight:700;">${grandTotal.actual}</td><td style="${cellStyle} background:rgba(218,41,28,0.15); font-weight:700;">${grandTotal.ok}</td><td style="${cellStyle} background:rgba(218,41,28,0.15); font-weight:700;">${grandTotal.nok}</td><td style="${cellStyle} background:rgba(218,41,28,0.15); font-weight:700;">${cylinderHeadRejPct(grandTotal.nok, grandTotal.actual)}%</td>`;
    grandTr.innerHTML = grandHtml;
    tbody.appendChild(grandTr);
}

function renderCylinderHeadTrendChart() {
    const canvas = document.getElementById('cylinderHeadTrendChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const dates = Array.from(new Set((cylinderHeadData || []).map(r => cylinderHeadDateKey(r.date)))).sort();
    const cellsPresent = new Set((cylinderHeadData || []).map(r => r.cell || 'Unknown'));
    const cellOrder = [...CYLINDER_HEAD_CELL_ORDER.filter(c => cellsPresent.has(c)), ...Array.from(cellsPresent).filter(c => !CYLINDER_HEAD_CELL_ORDER.includes(c))];

    // agg[cell][date] = { ok, nok, actual }, pooled across AssemblyLine and Shift
    const agg = {};
    (cylinderHeadData || []).forEach(row => {
        const cell = row.cell || 'Unknown';
        const dateKey = cylinderHeadDateKey(row.date);
        agg[cell] = agg[cell] || {};
        const bucket = agg[cell][dateKey] || { ok: 0, nok: 0, actual: 0 };
        bucket.ok += row.okQty || 0;
        bucket.nok += row.notOkQty || 0;
        bucket.actual += row.actualQty || 0;
        agg[cell][dateKey] = bucket;
    });

    const datasets = cellOrder.map((cell, idx) => {
        const color = CYLINDER_HEAD_CHART_COLORS[idx % CYLINDER_HEAD_CHART_COLORS.length];
        const data = dates.map(d => {
            const b = agg[cell]?.[d];
            return b ? cylinderHeadRejPct(b.nok, b.actual) : null;
        });
        return { label: cell, data, borderColor: color, backgroundColor: color, borderWidth: 2, fill: false, tension: 0.3, pointRadius: 3, pointHoverRadius: 5, spanGaps: true };
    });

    if (cylinderHeadChart) {
        cylinderHeadChart.destroy();
        cylinderHeadChart = null;
    }

    // Draws each cell's name, in its own line color, right at the end of its line -
    // so the chart is self-explanatory without needing to cross-reference the legend.
    const cylinderHeadEndLabelPlugin = {
        id: 'cylinderHeadEndLabels',
        afterDatasetsDraw(chart) {
            const { ctx } = chart;
            chart.data.datasets.forEach((dataset, i) => {
                const meta = chart.getDatasetMeta(i);
                if (meta.hidden) return;
                let lastIndex = -1;
                for (let idx = dataset.data.length - 1; idx >= 0; idx--) {
                    if (dataset.data[idx] !== null && dataset.data[idx] !== undefined) { lastIndex = idx; break; }
                }
                if (lastIndex === -1) return;
                const point = meta.data[lastIndex];
                if (!point) return;
                ctx.save();
                ctx.fillStyle = dataset.borderColor;
                ctx.font = 'bold 10px Arial';
                ctx.textBaseline = 'middle';
                ctx.fillText(dataset.label, point.x + 6, point.y);
                ctx.restore();
            });
        }
    };

    cylinderHeadChart = new Chart(canvas, {
        type: 'line',
        data: { labels: dates.map(cylinderHeadFormatDateLabel), datasets },
        plugins: [cylinderHeadEndLabelPlugin],
        options: {
            maintainAspectRatio: false,
            layout: { padding: { right: 85 } },
            plugins: {
                legend: { display: true, position: 'bottom', labels: { color: '#ccc', font: { size: 11 }, boxWidth: 14, padding: 14 } },
                tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.formattedValue}%` } }
            },
            scales: {
                x: { title: { display: true, text: 'Date', color: '#888', font: { size: 11 } }, ticks: { color: '#888', font: { size: 9 } }, grid: { color: '#333' } },
                y: { title: { display: true, text: 'Rejection %', color: '#888', font: { size: 11 } }, ticks: { color: '#888', font: { size: 9 }, callback: v => v + '%' }, grid: { color: '#333' }, beginAtZero: true }
            }
        }
    });
}

function switchCylinderHeadView(view) {
    cylinderHeadView = view;
    const summaryView = document.getElementById('cylinderHeadSummaryView');
    const trendView = document.getElementById('cylinderHeadTrendView');
    const summaryBtn = document.getElementById('cylinderHeadSummaryBtn');
    const trendBtn = document.getElementById('cylinderHeadTrendBtn');

    if (summaryView) summaryView.style.display = view === 'summary' ? 'flex' : 'none';
    if (trendView) trendView.style.display = view === 'trend' ? 'block' : 'none';
    if (summaryBtn) summaryBtn.style.background = view === 'summary' ? '' : '#555';
    if (trendBtn) trendBtn.style.background = view === 'trend' ? '' : '#555';

    // Clicking Summary or Cellwise rej trend applies the current filters, same as QHold's Overall/Distinct/Duplicate buttons.
    fetchCylinderHeadReport();
}

function clearCylinderHeadFilters() {
    const plantSelect = document.getElementById('cylinderHeadPlant');
    const lineSelect = document.getElementById('cylinderHeadLine');
    const shiftSelect = document.getElementById('cylinderHeadShift');
    if (plantSelect) plantSelect.value = 'ALL';
    if (lineSelect) lineSelect.value = 'ALL';
    if (shiftSelect) shiftSelect.value = 'ALL';

    const { start, end } = cylinderHeadDefaultRange();
    const startInput = document.getElementById('cylinderHeadStart');
    const endInput = document.getElementById('cylinderHeadEnd');
    if (startInput && startInput._flatpickr) startInput._flatpickr.setDate(start);
    if (endInput && endInput._flatpickr) endInput._flatpickr.setDate(end);

    fetchCylinderHeadReport();
}

document.addEventListener('DOMContentLoaded', () => {
    const { start, end } = cylinderHeadDefaultRange();
    if (typeof flatpickr !== 'undefined') {
        const config = {
            enableTime: true,
            dateFormat: "Y-m-d\\TH:i",
            altInput: true,
            altFormat: "d M Y, h:i K",
            time_24hr: false,
            theme: "dark"
        };
        flatpickr("#cylinderHeadStart", { ...config, defaultDate: start });
        flatpickr("#cylinderHeadEnd", { ...config, defaultDate: end });
    }
    renderCylinderHeadPivotTable();
});

// --- BIOMETRIC SHIFTWISE REPORT DATA ---

async function fetchBiometricReport() {
    const lineDropdown = document.getElementById('mainDashboardDropdown');
    const line = lineDropdown ? lineDropdown.value : '';
    if (!line) return;

    const sInput = document.getElementById('reportsStart');
    const eInput = document.getElementById('reportsEnd');
    const hcDropdown = document.getElementById('reportsHcDropdown');

    if (!sInput || !sInput.value || !eInput || !eInput.value) {
        return; // Date is required
    }

    let url = `/api/reports/biometric-shiftwise?line=${encodeURIComponent(line)}&startDate=${encodeURIComponent(sInput.value)}&endDate=${encodeURIComponent(eInput.value)}`;
    
    if (hcDropdown && hcDropdown.value) {
        url += `&historyCard=${encodeURIComponent(hcDropdown.value)}`;
    }

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch Biometric Shiftwise data');

        const data = await res.json();
        renderBiometricTable(data);
    } catch (e) {
        console.error("Failed to load Biometric Data", e);
        renderBiometricTable([]);
    }
}

function renderBiometricTable(data) {
    const tbody = document.getElementById('reportsBody');
    const emptyState = document.getElementById('reportsEmpty');
    
    if (!tbody || !emptyState) return;

    tbody.innerHTML = '';

    if (!data || data.length === 0) {
        tbody.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    tbody.style.display = 'table-row-group';
    emptyState.style.display = 'none';

    data.forEach(item => {
        const tr = document.createElement('tr');

        // Parse Date safely
        let punchDate = item.punchDateTime;
        if (punchDate) {
            const d = new Date(punchDate);
            punchDate = !isNaN(d) ? d.toLocaleString() : punchDate;
        } else {
            punchDate = '';
        }

        tr.innerHTML = `
            <td>${item.stationID || ''}</td>
            <td>${item.stationNumber || ''}</td>
            <td>${item.stationName || ''}</td>
            <td>${item.stationType || ''}</td>
            <td>${punchDate}</td>
            <td>${item.shift || ''}</td>
            <td>${item.employeeID || ''}</td>
            <td>${item.employeeName || ''}</td>
        `;
        tbody.appendChild(tr);
    });

    // We removed pagination for biometric (or we can add it back later if needed,
    // for now we just render all rows or let them scroll)
    const pContainer = document.getElementById('reportsPagination');
    if (pContainer) pContainer.style.display = 'none';
}

// --- BIOMETRIC ENGINE NO AND BARCODE REPORT ---

let engineBarcodeData = [];

function toggleEngineBarcodeMode() {
    const toggleElement = document.getElementById('engineBarcodeModeToggle');
    const isBarcodeMode = toggleElement && toggleElement.checked;

    const engineNoInput = document.getElementById('engineBarcodeEngineNo');
    const barcodeInput = document.getElementById('engineBarcodeBarcode');
    const labelEngine = document.getElementById('engineBarcodeLabelEngine');
    const labelBarcode = document.getElementById('engineBarcodeLabelBarcode');

    if (engineNoInput) { engineNoInput.disabled = isBarcodeMode; engineNoInput.style.opacity = isBarcodeMode ? '0.4' : '1'; }
    if (barcodeInput) { barcodeInput.disabled = !isBarcodeMode; barcodeInput.style.opacity = isBarcodeMode ? '1' : '0.4'; }

    if (labelEngine) labelEngine.classList.toggle('active', !isBarcodeMode);
    if (labelBarcode) labelBarcode.classList.toggle('active', isBarcodeMode);
}

async function fetchEngineBarcodeReport() {
    const lineDropdown = document.getElementById('mainDashboardDropdown');
    const hcDropdown = document.getElementById('engineBarcodeHcDropdown');
    const toggleElement = document.getElementById('engineBarcodeModeToggle');

    const line = lineDropdown ? lineDropdown.value : '';
    const hc = hcDropdown ? hcDropdown.value : '';
    const isBarcodeMode = toggleElement && toggleElement.checked;

    const engineNoInput = document.getElementById('engineBarcodeEngineNo');
    const barcodeInput = document.getElementById('engineBarcodeBarcode');
    const engineNo = engineNoInput ? engineNoInput.value.trim() : '';
    const barcode = barcodeInput ? barcodeInput.value.trim() : '';

    if (!line) {
        alert("Please select a Line.");
        return;
    }
    if (!hc) {
        alert("Please select a History Card.");
        return;
    }
    if (isBarcodeMode && !barcode) {
        alert("Please enter a Barcode Number.");
        return;
    }
    if (!isBarcodeMode && !engineNo) {
        alert("Please enter an Engine Number.");
        return;
    }

    let url = `/api/reports/biometric-engine-barcode?line=${encodeURIComponent(line)}`;
    if (hc) url += `&historyCard=${encodeURIComponent(hc)}`;
    url += isBarcodeMode ? `&barcode=${encodeURIComponent(barcode)}` : `&engineNo=${encodeURIComponent(engineNo)}`;

    const btn = document.getElementById('engineBarcodeApplyBtn');
    try {
        if (btn) btn.innerHTML = '<span class="material-symbols-outlined">refresh</span> Loading...';

        const res = await fetch(url);
        engineBarcodeData = res.ok ? await res.json() : [];
        if (!res.ok) console.error("Failed to load Biometric Engine No/Barcode data:", res.status);
    } catch (e) {
        console.error("Failed to load Biometric Engine No/Barcode data", e);
        engineBarcodeData = [];
    } finally {
        if (btn) btn.innerHTML = 'Apply';
        renderEngineBarcodeTable();
    }
}

function renderEngineBarcodeTable() {
    const tbody = document.getElementById('engineBarcodeBody');
    const emptyState = document.getElementById('engineBarcodeEmpty');
    const table = document.getElementById('engineBarcodeTable');
    if (!tbody || !emptyState || !table) return;

    tbody.innerHTML = '';

    if (!engineBarcodeData || engineBarcodeData.length === 0) {
        table.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    table.style.display = 'table';
    emptyState.style.display = 'none';

    engineBarcodeData.forEach(item => {
        const tr = document.createElement('tr');

        let punchDate = item.punchDateTime;
        if (punchDate) {
            const d = new Date(punchDate);
            punchDate = !isNaN(d) ? d.toLocaleString() : punchDate;
        } else {
            punchDate = '';
        }

        tr.innerHTML = `
            <td>${item.stationID || ''}</td>
            <td>${item.engineNoOrBarcode || ''}</td>
            <td>${item.stationNumber || ''}</td>
            <td>${item.stationName || ''}</td>
            <td>${item.stationType || ''}</td>
            <td>${punchDate}</td>
            <td>${item.shift || ''}</td>
            <td>${item.employeeID || ''}</td>
            <td>${item.employeeName || ''}</td>
        `;
        tbody.appendChild(tr);
    });
}

async function exportEngineBarcodeToExcel() {
    if (!engineBarcodeData || engineBarcodeData.length === 0) {
        alert("No data to export.");
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Biometric Engine-Barcode');

        const headers = ['S.No', 'Station ID', 'Engine Number / Barcode', 'Station Number', 'Station Name', 'Station Type', 'Punch DateTime', 'Shift', 'Emp ID', 'Emp Name'];
        sheet.addRow(headers).font = { bold: true };

        engineBarcodeData.forEach((item, index) => {
            let punchDate = item.punchDateTime ? new Date(item.punchDateTime).toLocaleString() : '';
            sheet.addRow([
                index + 1,
                item.stationID || '',
                item.engineNoOrBarcode || '',
                item.stationNumber || '',
                item.stationName || '',
                item.stationType || '',
                punchDate,
                item.shift || '',
                item.employeeID || '',
                item.employeeName || ''
            ]);
        });

        headers.forEach((_, i) => sheet.getColumn(i + 1).width = 22);

        const buffer = await workbook.xlsx.writeBuffer();
        const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `Biometric_Engine_Barcode_${new Date().getTime()}.xlsx`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    } catch (err) {
        console.error('Error generating excel:', err);
        alert("Error generating Excel file");
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('engineBarcodeApplyBtn');
    if (btn) btn.onclick = fetchEngineBarcodeReport;
});
