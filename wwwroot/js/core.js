// =============================================================================================
// core.js - shared shell for every screen: tab switching, logout, header (version, MQTT
// indicator, line dropdown), generic helpers. Loaded first; each dashboard / report lives in its
// own file under js/dashboards/ and js/reports/ (all classic scripts sharing the global scope).
// =============================================================================================

// Authentication Check (Global) - temporarily disabled
// if (window.location.pathname.indexOf('login.html') === -1) {
//     if (sessionStorage.getItem('isLoggedIn') !== 'true') {
//         window.location.href = 'login.html';
//     } else {
//         const empId = sessionStorage.getItem('empId');
//         if (empId) {
//             const sidebarBadge = document.getElementById('sidebarEmpId');
//             if (sidebarBadge) sidebarBadge.textContent = empId;
//         }
//     }
// }

// Tabs that use the header's global Line dropdown (#mainDashboardDropdown).
const LINE_DROPDOWN_TABS = ['poke-yoke', 'poke-yoke-summary', 'reports', 'biometric-engine-barcode'];

function switchTab(tabId) {
    // Nav active state: the clicked nav item, or (when called programmatically) #nav-<tabId>.
    document.querySelectorAll('.nav-item').forEach(el => el.classList.remove('active'));
    if (event && event.currentTarget && event.currentTarget.classList && event.currentTarget.classList.contains('nav-item')) {
        event.currentTarget.classList.add('active');
    } else {
        const nav = document.getElementById(`nav-${tabId}`);
        if (nav) {
            nav.classList.add('active');
            // Expand the (possibly nested) sub-menus it sits in, e.g. Reports > Production.
            for (let p = nav.parentElement; p; p = p.parentElement) {
                if (p.classList && p.classList.contains('sub-menu')) p.style.display = 'block';
            }
        }
    }

    // Tab pane visibility
    document.querySelectorAll('.tab-pane').forEach(el => el.classList.remove('active'));
    // Not every nav entry has a page yet (e.g. "Overview" / dashboard-1).
    const pane = document.getElementById(`tab-${tabId}`);
    if (pane) pane.classList.add('active');

    const dashboardDropdown = document.getElementById('mainDashboardDropdown');
    if (dashboardDropdown) {
        dashboardDropdown.style.display = LINE_DROPDOWN_TABS.includes(tabId) ? 'block' : 'none';
    }

    // Live dashboards only poll (and the Summary Report only auto-refreshes) while their own tab
    // is active.
    stopFireHydrantPolling();
    stopGasLeakPolling();
    stopEbRtmPolling();
    stopEmsSolarPolling();
    if (tabId !== 'summary-report') leaveSrTab();

    if (tabId === 'fire-hydrant') {
        startFireHydrantPolling();
    } else if (tabId === 'gas-leak') {
        startGasLeakPolling();
    } else if (tabId === 'ems-renewable') {
        renderEmsRenewable();
        startEmsSolarPolling();
        fetchEmsOtherSourceSummary();
    } else if (tabId === 'eb-rtm') {
        startEbRtmPolling();
    } else if (tabId === 'qhold') {
        loadQHoldDefaultView();
    } else if (tabId === 'cylinder-head-leak') {
        loadCylinderHeadDefaultView();
    } else if (tabId === 'categorywise-rework') {
        loadCwrDefaultView();
    } else if (tabId === 'summary-report') {
        loadSrDefaultView();
    }
}

function logout() {
    sessionStorage.removeItem('isLoggedIn');
    sessionStorage.removeItem('empId');
    sessionStorage.removeItem('username');
    window.location.href = 'login.html';
}

// Generic CSV download (used by the Fire Hydrant and Gas Leak report screens).
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

// Saves an ExcelJS workbook as `filename` (used by every report's Excel export).
async function downloadWorkbook(workbook, filename) {
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
}

// Current production day: 00:15 today -> 00:15 tomorrow (or the previous day's window if it's
// still before 00:15). Default From/To range for the line reports' date pickers.
function currentProductionDayRange() {
    const now = new Date();
    const start = new Date(now);
    start.setHours(0, 15, 0, 0);
    if (now < start) start.setDate(start.getDate() - 1);
    const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
    return { start, end };
}

// The line reports' red "reset" buttons: put that report's From/To pickers back to the current
// production day. The report is re-run with its Apply button.
const RESET_FILTER_INPUTS = {
    'reports': ['reportsStart', 'reportsEnd'],
    'main-line': ['mainLineStart', 'mainLineEnd'],
    'poke-yoke': ['pokeYokeStart', 'pokeYokeEnd'],
    'poke-yoke-summary': ['pokeYokeSummaryStart', 'pokeYokeSummaryEnd']
};

function resetFilter(tab) {
    const ids = RESET_FILTER_INPUTS[tab];
    if (!ids) return;
    const { start, end } = currentProductionDayRange();
    const sInput = document.getElementById(ids[0]);
    const eInput = document.getElementById(ids[1]);
    if (sInput && sInput._flatpickr) sInput._flatpickr.setDate(start);
    if (eInput && eInput._flatpickr) eInput._flatpickr.setDate(end);
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

// ---------------------------------------------
// Header MQTT indicator - polls GET /api/mqtt/status (in-memory, cheap) on every tab, not just
// the dashboards, and summarizes all feeds (Fire Hydrant / Gas Leak / EB-RTM) into one pill.
// Hover tooltip lists each feed's state and how long ago its last payload arrived.
// ---------------------------------------------
function mqttAgeText(secs) {
    if (secs === null || secs === undefined) return 'no data received yet';
    if (secs < 60) return `last data ${secs}s ago`;
    if (secs < 3600) return `last data ${Math.floor(secs / 60)}m ago`;
    return `last data ${Math.floor(secs / 3600)}h ago`;
}

function applyMqttIndicator(state, text, tooltip) {
    const el = document.getElementById('mqttIndicator');
    if (!el) return;
    el.className = `mqtt-indicator ${state}`;
    el.title = tooltip;
    document.getElementById('mqttIndicatorText').textContent = text;
}

// Status is driven by whether data is actually arriving (server says a payload landed within
// its stale window), not by whether the broker connection is open.
async function fetchMqttStatus() {
    try {
        const res = await fetch('/api/mqtt/status');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const feeds = await res.json();
        const up = feeds.filter(f => f.receiving).length;
        const tooltip = feeds.map(f => `${f.name}: ${f.receiving ? 'Receiving data' : 'No data'} (${mqttAgeText(f.secondsSinceLastData)})`).join('\n');

        if (up === feeds.length) applyMqttIndicator('ok', 'MQTT OK', tooltip);
        else if (up === 0) applyMqttIndicator('down', 'MQTT No Data', tooltip);
        else applyMqttIndicator('partial', `MQTT ${up}/${feeds.length} Receiving`, tooltip);
    } catch (e) {
        // Surface the actual failure (e.g. "HTTP 404" = server running a build without
        // MqttStatusController) so it's diagnosable from the tooltip.
        applyMqttIndicator('unknown', 'MQTT Unknown', `Could not get MQTT status from the server (${e.message})`);
    }
}

document.addEventListener('DOMContentLoaded', () => {
    fetchMqttStatus();
    setInterval(fetchMqttStatus, 10000);
});

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
