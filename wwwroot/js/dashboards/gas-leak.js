// ---------------------------------------------
// LPG Gas Leak Monitoring - live via GET /api/gasleak/status (backend bridges the plant MQTT
// broker, see GasLeakMqttBackgroundService). Ported from the standalone GasSentry project
// (originally React/JSX) into vanilla JS/DOM updates matching this app's house style; exact
// coordinates/thresholds carried over unchanged from that project's app.js.
// ---------------------------------------------
let gasLeakPollTimer = null;
let gasLeakAlertsPollTimer = null;
let gasLeakOpenAlerts = [];

function startGasLeakPolling() {
    fetchGasLeakStatus();
    stopGasLeakPolling();
    gasLeakPollTimer = setInterval(fetchGasLeakStatus, 1000);
    fetchGasLeakAlerts();
    gasLeakAlertsPollTimer = setInterval(fetchGasLeakAlerts, 20000);
    fitGasLeakCanvasScale();
    window.addEventListener('resize', fitGasLeakCanvasScale);
}

function stopGasLeakPolling() {
    if (gasLeakPollTimer) { clearInterval(gasLeakPollTimer); gasLeakPollTimer = null; }
    if (gasLeakAlertsPollTimer) { clearInterval(gasLeakAlertsPollTimer); gasLeakAlertsPollTimer = null; }
    window.removeEventListener('resize', fitGasLeakCanvasScale);
}

async function fetchGasLeakStatus() {
    try {
        const res = await fetch('/api/gasleak/status');
        if (!res.ok) return;
        applyGasLeakStatus(await res.json());
    } catch (e) {
        // Broker/API unreachable - keep showing the last known values.
    }
}

function gasleakSirenImg(band) {
    switch (band) {
        case 'red': return 'assets/gasleak/RE_Safety_GasLeak_SirenRed_MD.png';
        case 'yellow': return 'assets/gasleak/RE_Safety_GasLeak_SirenYellow_MD.png';
        case 'grey': return 'assets/gasleak/RE_Safety_GasLeak_SirenGrey_MD.png';
        default: return 'assets/gasleak/RE_Safety_GasLeak_SirenGreen_MD.png';
    }
}

// Matches the sprinkler pressure gauge's ValueFormat.StateFormats bands from the source
// mashup XML: red <4.5, yellow 4.5-6, green 6-8, yellow 8-9.5, red >9.5.
function gasleakPressureBand(p) {
    if (p < 4.5) return 'red';
    if (p < 6) return 'yellow';
    if (p < 8) return 'green';
    if (p < 9.5) return 'yellow';
    return 'red';
}

function gasleakWorstStatus(points) {
    if (points.some(p => p.status === 'red')) return 'red';
    if (points.some(p => p.status === 'yellow')) return 'yellow';
    if (points.every(p => p.status === 'grey')) return 'grey'; // shop not live-wired
    return 'green';
}

function applyGasLeakStatus(data) {
    const gauge = document.getElementById('gasleakSprinklerGauge');
    const valueEl = document.getElementById('gasleakSprinklerValue');
    if (gauge && valueEl) {
        valueEl.textContent = data.sprinklerPressure.toFixed(2);
        gauge.className = 'gasleak-ov gasleak-gauge-circle state-' + gasleakPressureBand(data.sprinklerPressure);
    }

    applyGasLeakZone(data.lot1, 'gasleakLot1Status', 'gasleakLot1Valve', 'gasleakLot1Siren');
    applyGasLeakZone(data.lot2, 'gasleakLot2Status', 'gasleakLot2Valve', 'gasleakLot2Siren');

    const ps2Points = data.paintShop2.points || [];
    applyGasLeakPointColor('gasleakPS2_hwg3', (ps2Points.find(p => p.name === 'HWG - 3') || {}).status);
    applyGasLeakPointColor('gasleakPS2_hwg4', (ps2Points.find(p => p.name === 'HWG - 4') || {}).status);
    applyGasLeakPointColor('gasleakPS2_heatup', (ps2Points.find(p => p.name === 'PTCED - 2 Heat up') || {}).status);
    applyGasLeakPointColor('gasleakPS2_holdup', (ps2Points.find(p => p.name === 'PTCED - 2 Hold up') || {}).status);

    const ps1Siren = document.getElementById('gasleakPS1Siren');
    if (ps1Siren) ps1Siren.src = gasleakSirenImg(gasleakWorstStatus(data.paintShop1.points || []));
    const ps2Siren = document.getElementById('gasleakPS2Siren');
    if (ps2Siren) ps2Siren.src = gasleakSirenImg(gasleakWorstStatus(ps2Points));

    const danger = data.lot1.alert || data.lot2.alert || data.tagQualityAlert;
    const dangerGif = document.getElementById('gasleakDangerGif');
    if (dangerGif) dangerGif.hidden = !danger;
    // Bell badge count is driven by the DB-backed, snooze-aware alerts list (see
    // renderGasLeakAlertsTable), not the raw live flags here - matching Fire Hydrant's design.
}

function applyGasLeakZone(zone, statusElId, valveElId, sirenElId) {
    const statusEl = document.getElementById(statusElId);
    if (statusEl) {
        statusEl.textContent = zone.alert ? 'Danger' : 'Normal';
        statusEl.classList.toggle('danger', !!zone.alert);
    }
    const valveEl = document.getElementById(valveElId);
    if (valveEl) valveEl.classList.toggle('closed', !zone.valveOpen);
    const sirenEl = document.getElementById(sirenElId);
    if (sirenEl) sirenEl.src = gasleakSirenImg(zone.band);
}

function applyGasLeakPointColor(elId, status) {
    const el = document.getElementById(elId);
    if (el && status) el.src = gasleakSirenImg(status);
}

// Scales the fixed 2030x1030 design canvas (matching the Mashup XML's own coordinate space)
// to "contain"-fit the available viewport space - unlike fitScadaCanvasScale (height-only),
// this scales on both width and height since the source layout is wider than it is tall.
function fitGasLeakCanvasScale() {
    const wrap = document.getElementById('gasleakCanvasWrap');
    const scaler = document.getElementById('gasleakCanvasScaler');
    const canvas = document.getElementById('gasleakCanvas');
    if (!wrap || !scaler || !canvas) return;
    const scale = Math.min(wrap.clientWidth / 2030, wrap.clientHeight / 1030);
    if (!isFinite(scale) || scale <= 0) return;
    canvas.style.transform = `scale(${scale})`;
    scaler.style.width = (2030 * scale) + 'px';
    scaler.style.height = (1030 * scale) + 'px';
}

async function gasleakToggleValve(target) {
    try {
        const res = await fetch(`/api/gasleak/valve/${target}`, { method: 'POST' });
        if (!res.ok) { console.error(`Failed to toggle valve '${target}': HTTP ${res.status}`); return; }
        fetchGasLeakStatus();
    } catch (e) {
        console.error(`Failed to toggle valve '${target}':`, e);
    }
}

function gasleakOpenAssetInfo(name) {
    alert(`${name}\n\nLive property detail for this asset will be wired up once its tag is mapped in the Kepware/MQTT configuration.`);
}

function gasleakUpdateBellBadge(count) {
    const btn = document.getElementById('gasleakAlertBellBtn');
    const badge = document.getElementById('gasleakAlertBellBadge');
    if (!btn || !badge) return;
    btn.classList.toggle('has-alerts', count > 0);
    badge.style.display = count > 0 ? '' : 'none';
    badge.textContent = String(count);
}

// Same due/snooze semantics as fireHydrantAlertIsDue: a snoozed-and-not-yet-due alert stays
// out of the visible list (and the bell badge count) until its snooze deadline passes.
function gasleakAlertIsDue(a) {
    return !a.snoozeTime || new Date(a.snoozeTime).getTime() <= Date.now();
}

async function fetchGasLeakAlerts() {
    try {
        const res = await fetch('/api/gasleak/alerts');
        if (!res.ok) return;
        gasLeakOpenAlerts = await res.json();
        renderGasLeakAlertsTable();
    } catch (e) {
        // Broker/API unreachable - keep showing the last known list.
    }
}

let gasleakSnoozePicker = null;

function updateGasLeakSnoozeButtonState() {
    const btn = document.getElementById('gasleakSnoozeBtn');
    if (!btn) return;
    btn.disabled = document.querySelectorAll('.gasleak-alert-check:checked').length === 0;
}

function renderGasLeakAlertsTable() {
    const tbody = document.getElementById('gasleakAlertsTbody');
    const empty = document.getElementById('gasleakAlertsEmpty');
    if (!tbody) return;
    tbody.innerHTML = '';
    const visible = gasLeakOpenAlerts.filter(gasleakAlertIsDue);
    if (visible.length === 0) {
        if (empty) empty.style.display = 'block';
    } else {
        if (empty) empty.style.display = 'none';
        visible.forEach(a => {
            const tr = document.createElement('tr');
            const ts = new Date(a.eventTime).toLocaleString();
            tr.innerHTML = `
                <td><input type="checkbox" class="gasleak-alert-check" value="${a.alertId}"></td>
                <td>${ts}</td>
                <td>${a.type}</td>
                <td>${a.description}</td>
            `;
            tbody.appendChild(tr);
        });
    }
    gasleakUpdateBellBadge(visible.length);
    updateGasLeakSnoozeButtonState();
}

function openGasLeakAlerts() {
    const overlay = document.getElementById('gasleakAlertsOverlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    if (!gasleakSnoozePicker) {
        gasleakSnoozePicker = flatpickr('#gasleakSnoozeInput', {
            enableTime: true,
            dateFormat: "Y-m-d\\TH:i",
            altInput: true,
            minDate: 'today'
        });
    }
    fetchGasLeakAlerts();
}

function gasleakCloseAlerts() {
    const overlay = document.getElementById('gasleakAlertsOverlay');
    if (overlay) overlay.style.display = 'none';
}

async function snoozeGasLeakAlerts() {
    // AlertId is a 17-digit number exceeding JS's safe integer range, so it's carried as a
    // string end-to-end (matching the backend's JsonNumberHandling.WriteAsString) - never
    // round-tripped through Number(), which would silently corrupt it.
    const checked = Array.from(document.querySelectorAll('.gasleak-alert-check:checked')).map(c => c.value);
    if (checked.length === 0) return; // button is disabled in this case, but guard anyway
    const snoozeUntil = gasleakSnoozePicker && gasleakSnoozePicker.selectedDates[0];
    if (!snoozeUntil) { alert('Pick a snooze date/time first.'); return; }
    try {
        await fetch('/api/gasleak/alerts/snooze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ alertIds: checked, snoozeUntil: snoozeUntil.toISOString() })
        });
        fetchGasLeakAlerts();
    } catch (e) {
        // API unreachable - user can retry.
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const tbody = document.getElementById('gasleakAlertsTbody');
    if (tbody) tbody.addEventListener('change', updateGasLeakSnoozeButtonState);
});

// ---------------------------------------------
// Gas Leak Report screen - a single Alerts-history table (S.No/Type/Description/Start/End
// Event), bound to the Reports button. Unlike Fire Hydrant's report modal, there are no
// Duration/Count tabs here - Gas Leak has no pump-like counting domain, only alert history.
let gasleakReportFromPicker = null;
let gasleakReportToPicker = null;
let gasleakReportAlertsData = [];

function openGasLeakReport() {
    const overlay = document.getElementById('gasleakReportOverlay');
    if (!overlay) return;
    overlay.style.display = 'flex';
    if (!gasleakReportFromPicker) {
        const pickerConfig = { enableTime: true, dateFormat: "Y-m-d\\TH:i", altInput: true };
        gasleakReportFromPicker = flatpickr('#gasleakReportFrom', { ...pickerConfig, defaultDate: new Date(Date.now() - 24 * 3600000) });
        gasleakReportToPicker = flatpickr('#gasleakReportTo', { ...pickerConfig, defaultDate: new Date() });
    }
    fetchGasLeakReport();
}

function closeGasLeakReport() {
    const overlay = document.getElementById('gasleakReportOverlay');
    if (overlay) overlay.style.display = 'none';
}

async function fetchGasLeakReport() {
    const from = gasleakReportFromPicker && gasleakReportFromPicker.selectedDates[0];
    const to = gasleakReportToPicker && gasleakReportToPicker.selectedDates[0];
    if (!from || !to) return;
    try {
        const range = `start=${encodeURIComponent(from.toISOString())}&end=${encodeURIComponent(to.toISOString())}`;
        const res = await fetch(`/api/gasleak/alerts/history?${range}`);
        if (!res.ok) return;
        gasleakReportAlertsData = await res.json();
        renderGasLeakReportAlertsTable();
    } catch (e) {
        // API unreachable - user can retry via Apply.
    }
}

function renderGasLeakReportAlertsTable() {
    const tbody = document.getElementById('gasleakReportAlertsTbody');
    const empty = document.getElementById('gasleakReportAlertsEmpty');
    if (!tbody) return;
    tbody.innerHTML = '';
    if (gasleakReportAlertsData.length === 0) {
        if (empty) empty.style.display = 'block';
        return;
    }
    if (empty) empty.style.display = 'none';
    gasleakReportAlertsData.forEach((a, i) => {
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

// Reuses the generic downloadCsvBlob() helper from core.js.
function downloadGasLeakReportCsv() {
    if (gasleakReportAlertsData.length === 0) { alert('No data to export.'); return; }
    const header = ['S.No', 'Type', 'Description', 'Start Event', 'End Event'];
    const rows = gasleakReportAlertsData.map((a, i) => [
        i + 1,
        a.type,
        a.description,
        new Date(a.startEvent).toLocaleString(),
        a.endEvent ? new Date(a.endEvent).toLocaleString() : 'Ongoing'
    ]);
    downloadCsvBlob('gas-leak-alerts-report', header, rows);
}
