// =============================================================================================
// PokaYoke module - shared renderer for the "Poka Yoke Station Status" plant-layout screens
// (sidebar: PokaYoke > JEA1 Line / JEA2 Line / JEA1 Crankshaft). Each screen supplies a layout
// (labels, line shapes and stations with design coordinates) in its own file, e.g. jea1-line.js;
// this file draws it, colours each station and its count cells, and renders the right-hand
// summary panel (OK vs Manual Inspection donut, HC table, alert). All names are prefixed pky.
//
// Station colours: light green = normal, grey = auto station, orange = has Manual Inspection.
// Count cells (legend): green = OK count, orange = Manual Inspection count.
// =============================================================================================

const PKY_STATION_W = 27;
const PKY_STATION_H = 24;
const PKY_CELL_H = 14;
const PKY_OK_COLOR = '#5cb85c';
const PKY_MI_COLOR = '#f0a830';

let pkyCharts = {};

// ---- Layout helpers (used by the per-screen layout files) ----
// Station row / column: stations from x0 (y0), `step` apart.
const pkyRow = (ids, x0, step, y, side, extra = {}) => ids.map((id, i) => ({ id, x: Math.round(x0 + i * step), y, side, ...extra }));
const pkyCol = (ids, x, y0, step, side, extra = {}) => ids.map((id, i) => ({ id, x, y: Math.round(y0 + i * step), side, ...extra }));
// pkyRange('ML-', 54, 28) -> ML-54, ML-53, ... ML-28 (two-digit numbers).
const pkyRange = (prefix, from, to) => {
    const out = [];
    for (let n = from; from <= to ? n <= to : n >= to; n += from <= to ? 1 : -1) out.push(`${prefix}${String(n).padStart(2, '0')}`);
    return out;
};
// Mark stations as auto stations (grey) and/or without count cells.
const pkyMark = (stations, ids, flags) => stations.forEach(s => { if (ids.includes(s.id)) Object.assign(s, flags); });

function pkyEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Draws the layout into #canvasId at its design size (sized to fit by pkyFitLayout).
// layout.yScale (optional, set by pkyFitLayout) stretches every y coordinate and height.
// counts: { [stationId]: { ok, mi } }.
function pkyRenderLayout(canvasId, layout, counts) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const [ox, oy] = layout.origin || [0, 0];
    const sy = layout.yScale || 1;
    const Y = v => Math.round(v * sy);
    const pos = (x, y) => `left:${Math.round(x - ox)}px;top:${Y(y - oy)}px;`;
    canvas.style.width = `${layout.width}px`;
    canvas.style.height = `${Y(layout.height)}px`;

    let html = '';
    (layout.shapes || []).forEach(s => {
        const size = `width:${s.w}px;height:${Y(s.h)}px;`;
        if (s.type === 'track') {
            html += `<div class="pky-track" style="${pos(s.x, s.y)}${size}">
                <div class="pky-track-strip"><span>${pkyEsc(s.title)}</span></div>
            </div>`;
        } else if (s.type === 'loop') {
            html += `<div class="pky-loop" style="${pos(s.x, s.y)}${size}"></div>`;
        } else if (s.type === 'band') {
            html += `<div class="pky-band" style="${pos(s.x, s.y)}${size}"><span>${pkyEsc(s.title)}</span></div>`;
        }
    });

    (layout.labels || []).forEach(l => {
        html += `<div class="pky-label${l.vertical ? ' vertical' : ''}${l.wrap ? ' wrap' : ''}${l.plain ? ' plain' : ''}" style="${pos(l.x, l.y)}width:${l.w}px;height:${Y(l.h)}px;">
            <span>${pkyEsc(l.text)}</span></div>`;
    });

    (layout.stations || []).forEach(st => {
        const w = st.w || PKY_STATION_W;
        const h = st.h || PKY_STATION_H;
        const c = counts[st.id] || { ok: 0, mi: 0 };
        const state = st.auto ? 'auto' : (c.mi > 0 ? 'mi' : 'ok');
        // Horizontal stations show the id on two lines ("ML-54" -> ML / 54, "SA 42I" -> SA / 42I);
        // a station with a label shows the label on one line (Crankshaft "OP-10"). title = the name
        // in the tooltip and pop-up ("Cell 1 OP-10"); defaults to the id.
        const name = st.title || st.id;
        const text = st.label ? pkyEsc(st.label) : st.vertical ? `<span>${pkyEsc(st.id)}</span>` : pkyEsc(st.id).replace(/[ -]/, '<br>');
        const tip = `${name}${st.auto ? ' (auto station)' : ''}${st.noCounts ? '' : ` - OK ${c.ok}, Manual Inspection ${c.mi}`}`;
        const click = st.noCounts ? '' : ` data-station="${pkyEsc(st.id)}" data-title="${pkyEsc(name)}"`;
        html += `<div class="pky-station ${state}${st.vertical ? ' vertical' : ''}${st.label ? ' labeled' : ''}${st.noCounts ? '' : ' clickable'}"${click} style="${pos(st.x, st.y)}width:${w}px;height:${Y(h)}px;" title="${pkyEsc(tip)}">${text}</div>`;
        if (st.noCounts) return;

        // Manual Inspection cell next to the station, OK cell beyond it (above / below rows);
        // side stacks put OK on top. Cells are as wide as their station.
        const cw = w;
        const cell = (x, y, cls, v) => `<div class="pky-count ${cls}" style="${pos(x, y)}width:${cw}px;height:${Y(PKY_CELL_H)}px;">${v}</div>`;
        const cy = st.y + h / 2;
        if (st.side === 'above') {
            html += cell(st.x, st.y - PKY_CELL_H, 'mi', c.mi) + cell(st.x, st.y - 2 * PKY_CELL_H, 'ok', c.ok);
        } else if (st.side === 'below') {
            html += cell(st.x, st.y + h, 'mi', c.mi) + cell(st.x, st.y + h + PKY_CELL_H, 'ok', c.ok);
        } else {
            const x = st.side === 'left' ? st.x - cw - 1 : st.x + w + 1;
            html += cell(x, cy - PKY_CELL_H, 'ok', c.ok) + cell(x, cy, 'mi', c.mi);
        }
    });

    canvas.innerHTML = html;
}

// Renders the layout sized to its wrapper: zoom so the design width fills the wrapper, then
// stretch vertically (up to layout.maxYScale) to use the spare height - taller cells instead of
// empty space. If even the unstretched layout is too tall, zoom to the height instead.
// Uses CSS zoom rather than transform: scale so text is laid out at its final size and stays sharp.
function pkyFitLayout(wrapId, canvasId, layout, counts) {
    const wrap = document.getElementById(wrapId);
    const canvas = document.getElementById(canvasId);
    if (!wrap || !canvas || !wrap.clientWidth) return;
    let zoom = wrap.clientWidth / layout.width;
    let yScale = Math.min(layout.maxYScale || 1, wrap.clientHeight / (layout.height * zoom));
    if (yScale < 1) {
        yScale = 1;
        zoom = wrap.clientHeight / layout.height;
    }
    pkyRenderLayout(canvasId, { ...layout, yScale }, counts);
    canvas.style.zoom = zoom;
}

// Right-hand panel: OK vs Manual Inspection donut, the HC table and the alert.
// rows: [{ name, total, ok, mi }]; ids: element ids of the panel parts.
function pkyRenderSummary(ids, rows) {
    const ok = rows.reduce((s, r) => s + r.ok, 0);
    const mi = rows.reduce((s, r) => s + r.mi, 0);
    const total = ok + mi;
    const pct = v => total ? Math.round(v / total * 100) : 0;

    document.getElementById(ids.okPct).textContent = `${pct(ok)}%`;
    document.getElementById(ids.miPct).textContent = `${pct(mi)}%`;
    document.getElementById(ids.tableBody).innerHTML = rows.map(r => `
        <tr>
            <td>${pkyEsc(r.name)}</td>
            <td><span class="pky-link" data-pky-filter="all" title="Show all checkpoints">${r.total}</span></td>
            <td><span class="pky-link" data-pky-filter="OK" title="Show OK checkpoints">${r.ok}</span></td>
            <td><span class="pky-link" data-pky-filter="MI" title="Show Manual Inspection checkpoints">${r.mi}</span></td>
        </tr>`).join('');
    document.getElementById(ids.alert).classList.toggle('show', mi > 0);

    if (pkyCharts[ids.chart]) pkyCharts[ids.chart].destroy();
    const canvas = document.getElementById(ids.chart);
    if (!canvas) return;
    pkyCharts[ids.chart] = new Chart(canvas.getContext('2d'), {
        type: 'doughnut',
        data: {
            labels: ['OK', 'Manual Inspection'],
            datasets: [{ data: total ? [ok, mi] : [1, 0], backgroundColor: [PKY_OK_COLOR, PKY_MI_COLOR], borderWidth: 0 }]
        },
        options: {
            cutout: '68%',
            maintainAspectRatio: false,
            animation: false,
            plugins: { legend: { display: false }, tooltip: { enabled: total > 0 } }
        }
    });
}

// ---- Screens ----
// Each layout file registers its screen under its tab id (e.g. 'pky-jea1-line'):
//   layout   - the layout definition
//   prefix   - element id prefix of its pane in index.html (<prefix>CanvasWrap, <prefix>Canvas,
//              <prefix>Donut, <prefix>OkPct, <prefix>MiPct, <prefix>TableBody, <prefix>Alert)
//   line     - header Line dropdown value prefix the MI buttons select (e.g. 'JEA1' -> JEA1_New)
//   api      - live data: GET /api/pokayoke/<api>/stations (PokaYokeStatusService); without it the
//              screen shows sample counts and its "Sample data" badge
//   sampleMi - station ids given a Manual Inspection count in the sample data
//   show     - instead of a layout: show(key, pollSeq) renders the screen itself (overview.js)
// switchTab() calls pkyShowScreen(tabId) (pkyStopPolling() for every other tab); unregistered tabs
// (placeholder screens) are ignored. Live screens poll at the API's refreshSeconds while open.
const pkyScreens = {};
let pkyActiveScreen = null;
let pkyResizeTimer = null;
let pkyPollTimer = null;
let pkyPollSeq = 0;

function pkyRegisterScreen(key, def) {
    pkyScreens[key] = { ...def, counts: {} };
}

// Sample counts (deterministic per station) until live data is connected.
function pkySampleCounts(screen) {
    const counts = {};
    screen.layout.stations.forEach(st => {
        let h = 0;
        for (const ch of st.id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
        counts[st.id] = { ok: st.noCounts ? 0 : h % 16, mi: (screen.sampleMi || []).includes(st.id) ? 1 : 0 };
    });
    return counts;
}

function pkyShowScreen(key) {
    const screen = pkyScreens[key];
    if (!screen) return;
    pkyActiveScreen = key;
    pkyStopPolling();
    // Screens without a plant layout (Overview) render themselves; they poll with
    // pkyPollTimer / pkyPollSeq, so pkyStopPolling() stops them too.
    if (screen.show) { screen.show(key, ++pkyPollSeq); return; }

    if (!screen.api) {
        const counts = pkySampleCounts(screen);
        const ok = Object.values(counts).reduce((sum, c) => sum + c.ok, 0);
        const mi = Object.values(counts).reduce((sum, c) => sum + c.mi, 0);
        pkyRenderScreen(key, counts, { ok, mi });
        return;
    }

    // Live: keep the last data on screen (dashes before the first answer) and poll.
    if (!screen.live) pkyRenderScreen(key, pkyLiveCounts(screen, {}), { ok: 0, mi: 0 });
    pkyPoll(key, ++pkyPollSeq);
}

// Live counts per layout station; a station without data shows a dash, not a 0.
function pkyLiveCounts(screen, stations) {
    const counts = {};
    screen.layout.stations.forEach(st => {
        counts[st.id] = stations[pkyStationKey(st.id)] || { ok: '–', mi: '–' };
    });
    return counts;
}

function pkyStopPolling() {
    clearTimeout(pkyPollTimer);
    pkyPollTimer = null;
    pkyPollSeq++;
}

// Layout station id -> tag-master station number ("SA 42I" -> "SA-42I", "TB QA1" -> "TB-QA1").
function pkyStationKey(id) {
    return id.replace(' ', '-');
}

async function pkyPoll(key, seq) {
    const screen = pkyScreens[key];
    let delaySeconds = 60;
    try {
        const res = await fetch(`/api/pokayoke/${screen.api}/stations`);
        if (seq !== pkyPollSeq) return;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = await res.json();
        if (seq !== pkyPollSeq) return;
        delaySeconds = Math.max(15, (data.refreshSeconds || 60) / 2);
        if (!data.error) {
            screen.live = data;
            pkyRenderScreen(key, pkyLiveCounts(screen, data.stations || {}), data.total || { ok: 0, mi: 0 });
        }
        pkySetStatus(screen, data);
    } catch (e) {
        if (seq !== pkyPollSeq) return;
        pkySetStatus(screen, { error: e.message || 'Could not reach the server.' });
        delaySeconds = 15;   // retry soon after a failed request
    }
    if (seq === pkyPollSeq) pkyPollTimer = setTimeout(() => pkyPoll(key, seq), delaySeconds * 1000);
}

// Title-bar badge of a live screen: "Live" (amber when some station tables could not
// be read, red when there is no data); the tooltip lists the details.
function pkySetStatus(screen, data) {
    const el = document.getElementById(`${screen.prefix}Status`);
    if (!el) return;
    // A failed request keeps the last snapshot on screen, so the stamp keeps its time.
    if (!data.error) pkySetUpdated(`${screen.prefix}Updated`, el, data);
    if (data.error) {
        el.className = 'pky-sample pky-status-error';
        el.textContent = screen.live ? `Data from ${new Date(screen.live.updatedAt).toLocaleTimeString('en-GB')}` : 'No data';
        el.title = `Could not load Poka Yoke data: ${data.error}`;
        return;
    }
    // Amber only for read errors; tables without a source rule are a config gap, listed in the tooltip.
    el.className = `pky-sample ${(data.errors || []).length ? 'pky-status-warn' : 'pky-status-live'}`;
    el.textContent = 'Live';   // the time is in the "Last updated" stamp next to it
    el.title = [
        `${data.checkpoints} checkpoints counted, ${data.ignored} without a value`,
        ...(data.unmatchedTables || []).map(t => `Not read (no source rule): ${t}`),
        ...(data.errors || []).slice(0, 15),
        (data.errors || []).length > 15 ? `... ${data.errors.length - 15} more errors` : ''
    ].filter(Boolean).join('\n');
}

function pkyRenderScreen(key, counts, total) {
    const screen = pkyScreens[key];
    const p = screen.prefix;
    screen.counts = counts;
    pkyBindStationClicks(key);
    pkyBindSummaryClicks(key);
    pkyRenderSummary(
        { chart: `${p}Donut`, okPct: `${p}OkPct`, miPct: `${p}MiPct`, tableBody: `${p}TableBody`, alert: `${p}Alert` },
        [{ name: 'Main Line', total: total.ok + total.mi, ok: total.ok, mi: total.mi }]
    );
    // Fit after layout so the wrapper has its real size.
    requestAnimationFrame(() => pkyFitScreen(key));
}

function pkyFitScreen(key) {
    const screen = pkyScreens[key];
    if (screen && screen.layout) pkyFitLayout(`${screen.prefix}CanvasWrap`, `${screen.prefix}Canvas`, screen.layout, screen.counts);
}

// Re-fit the open screen on resize (pkyFitLayout skips a hidden pane: its wrapper has no width).
window.addEventListener('resize', () => {
    clearTimeout(pkyResizeTimer);
    pkyResizeTimer = setTimeout(() => { if (pkyActiveScreen) pkyFitScreen(pkyActiveScreen); }, 100);
});

// MI - Overall / MI - Summary buttons: open the existing Poke Yoke Manual Inspection reports
// (Reports > Quality) with the header Line dropdown set to the screen's line.
function pkyOpenReport(key, tabId) {
    const screen = pkyScreens[key];
    const dropdown = document.getElementById('mainDashboardDropdown');
    const option = screen && dropdown && [...dropdown.options].find(o => o.value.toUpperCase().startsWith(screen.line.toUpperCase()));
    if (option && dropdown.value !== option.value) {
        dropdown.value = option.value;
        dropdown.dispatchEvent(new Event('change'));
    }
    switchTab(tabId);
    if (screen && screen.reportHc) pkySelectReportHc(tabId, screen.reportHc);
}

// Selects the report's "Select HC" value once the report has loaded the line's history cards
// (filled asynchronously after the Line dropdown changes); gives up after 10 s if it never appears.
const PKY_REPORT_HC_SELECT = { 'poke-yoke': 'pokeYokeModel', 'poke-yoke-summary': 'pokeYokeSummaryModel' };

function pkySelectReportHc(tabId, hc) {
    const select = document.getElementById(PKY_REPORT_HC_SELECT[tabId]);
    if (!select) return;
    const started = Date.now();
    const trySelect = () => {
        const option = [...select.options].find(o => o.value.trim().toUpperCase() === hc.toUpperCase());
        if (option) {
            if (select.value !== option.value) {
                select.value = option.value;
                select.dispatchEvent(new Event('change'));
            }
        } else if (Date.now() - started < 10000) {
            setTimeout(trySelect, 250);
        }
    };
    trySelect();
}

// ---- Station pop-up ----
// Clicking a station's name cell on a live screen lists its checkpoints: tag description +
// OK / Manual Inspection, ordered by the tag master's TagOrder.
// Data: GET /api/pokayoke/<api>/stations/<station> - the same snapshot as the counts.
let pkyModalSeq = 0;

function pkyBindStationClicks(key) {
    const screen = pkyScreens[key];
    const canvas = document.getElementById(`${screen.prefix}Canvas`);
    if (!canvas || canvas.dataset.pkyClicks) return;
    canvas.dataset.pkyClicks = '1';
    canvas.addEventListener('click', e => {
        const el = e.target.closest('.pky-station[data-station]');
        if (el && screen.api) pkyOpenStation(key, el.dataset.station, el.dataset.title);
    });
}

function pkyModal() {
    let modal = document.getElementById('pkyStationModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'pkyStationModal';
    modal.className = 'pky-modal';
    modal.innerHTML = `
        <div class="pky-modal-box" role="dialog" aria-modal="true" aria-labelledby="pkyModalTitle">
            <div class="pky-modal-head">
                <div>
                    <div class="pky-modal-title" id="pkyModalTitle"></div>
                    <div class="pky-modal-sub" id="pkyModalSub"></div>
                </div>
                <button class="pky-modal-close" type="button" title="Close" aria-label="Close">&times;</button>
            </div>
            <div class="pky-modal-tools" id="pkyModalTools">
                <input class="pky-modal-search" id="pkyModalSearch" type="search" placeholder="Search station, description or status..." autocomplete="off">
                <span class="pky-modal-count" id="pkyModalCount"></span>
                <button class="pky-modal-download" id="pkyModalDownload" type="button" title="Download the rows shown as Excel">Download Excel</button>
            </div>
            <div class="pky-modal-body" id="pkyModalBody"></div>
        </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => { if (e.target === modal || e.target.closest('.pky-modal-close')) pkyCloseStation(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') pkyCloseStation(); });
    document.getElementById('pkyModalSearch').addEventListener('input', pkyFilterCheckpoints);
    document.getElementById('pkyModalDownload').addEventListener('click', pkyDownloadCheckpoints);
    return modal;
}

function pkyCloseStation() {
    const modal = document.getElementById('pkyStationModal');
    if (modal) modal.classList.remove('open');
    pkyModalSeq++;
}

async function pkyOpenStation(key, stationId, title) {
    const screen = pkyScreens[key];
    const modal = pkyModal();
    const seq = ++pkyModalSeq;
    const body = document.getElementById('pkyModalBody');
    const sub = document.getElementById('pkyModalSub');
    document.getElementById('pkyModalTitle').textContent = `${title || stationId} - Poka Yoke checkpoints`;
    sub.textContent = 'Loading...';
    body.innerHTML = '';
    pkyResetTools();
    modal.classList.add('open');
    try {
        const res = await fetch(`/api/pokayoke/${screen.api}/stations/${encodeURIComponent(pkyStationKey(stationId))}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        if (seq !== pkyModalSeq) return;
        pkyFillCheckpoints(d, false, 'No checkpoint values for this station.', `PokaYoke_${screen.line}_${pkyStationKey(stationId)}`);
    } catch (e) {
        if (seq !== pkyModalSeq) return;
        sub.textContent = '';
        body.innerHTML = `<div class="pky-modal-empty">Could not load data: ${pkyEsc(e.message)}</div>`;
    }
}

// Fills the open pop-up from a station (withStation = false) or summary (true) response:
// sub-line with the OK / MI totals and data time, then the checkpoint table.
function pkyFillCheckpoints(d, withStation, emptyText, fileBase) {
    const body = document.getElementById('pkyModalBody');
    pkyModalData = { rows: d.checkpoints || [], withStation, fileBase,
        title: document.getElementById('pkyModalTitle').textContent };
    const time = d.updatedAt ? new Date(d.updatedAt).toLocaleTimeString('en-GB') : '--';
    document.getElementById('pkyModalSub').textContent =
        `OK ${d.ok} \u00b7 Manual Inspection ${d.mi} \u00b7 Total ${d.ok + d.mi} \u00b7 data ${time}`;
    if (d.error) { body.innerHTML = `<div class="pky-modal-empty">Could not load data: ${pkyEsc(d.error)}</div>`; return; }
    if (!d.checkpoints.length) { body.innerHTML = `<div class="pky-modal-empty">${emptyText}</div>`; return; }
    body.innerHTML = `
        <table class="pky-modal-table">
            <thead><tr><th>#</th>${withStation ? '<th>Station</th>' : ''}<th>Tag Description</th><th>Status</th></tr></thead>
            <tbody>${d.checkpoints.map((c, i) => `
                <tr class="${c.status === 'MI' ? 'mi' : ''}" data-i="${i}">
                    <td>${i + 1}</td>
                    ${withStation ? `<td class="pky-modal-station">${pkyEsc(c.station)}</td>` : ''}
                    <td>${pkyEsc(c.description)}</td>
                    <td><span class="pky-pill ${c.status === 'MI' ? 'mi' : 'ok'}" title="Value: ${pkyEsc(c.value)}">${c.status === 'MI' ? 'Manual Inspection' : 'OK'}</span></td>
                </tr>`).join('')}
            </tbody>
        </table>`;
    document.getElementById('pkyModalTools').classList.add('show');
    pkyFilterCheckpoints();
}

// ---- Pop-up search + Excel download ----
let pkyModalData = null;

function pkyResetTools() {
    pkyModalData = null;
    document.getElementById('pkyModalTools').classList.remove('show');
    document.getElementById('pkyModalSearch').value = '';
    document.getElementById('pkyModalCount').textContent = '';
}

function pkyCheckpointText(c) {
    return `${c.station} ${c.description} ${c.status === 'MI' ? 'Manual Inspection MI' : 'OK'} ${c.value}`.toLowerCase();
}

// Rows matching every word typed (station, description, status or raw value).
function pkyMatchingCheckpoints() {
    if (!pkyModalData) return [];
    const words = document.getElementById('pkyModalSearch').value.toLowerCase().split(/\s+/).filter(Boolean);
    return pkyModalData.rows.map((c, i) => ({ c, i }))
        .filter(({ c }) => { const t = pkyCheckpointText(c); return words.every(w => t.includes(w)); });
}

function pkyFilterCheckpoints() {
    if (!pkyModalData) return;
    const shown = new Set(pkyMatchingCheckpoints().map(x => x.i));
    document.querySelectorAll('#pkyModalBody tbody tr').forEach(tr => { tr.style.display = shown.has(+tr.dataset.i) ? '' : 'none'; });
    const total = pkyModalData.rows.length;
    document.getElementById('pkyModalCount').textContent = shown.size === total ? `${total} rows` : `${shown.size} of ${total} rows`;
    document.getElementById('pkyModalDownload').disabled = shown.size === 0;
}

// Excel of the rows shown (after the search filter).
async function pkyDownloadCheckpoints() {
    if (!pkyModalData || typeof ExcelJS === 'undefined') return;
    const rows = pkyMatchingCheckpoints();
    const { withStation } = pkyModalData;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Checkpoints');
    sheet.addRow([pkyModalData.title]).font = { bold: true, size: 13 };
    sheet.addRow([document.getElementById('pkyModalSub').textContent]);
    const search = document.getElementById('pkyModalSearch').value.trim();
    if (search) sheet.addRow([`Search: ${search}`]);
    sheet.addRow([]);
    const header = sheet.addRow(['#', ...(withStation ? ['Station'] : []), 'Tag Description', 'Status', 'Value']);
    header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    header.eachCell(cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3A3F47' } }; });
    rows.forEach(({ c, i }) => {
        const row = sheet.addRow([i + 1, ...(withStation ? [c.station] : []), c.description, c.status === 'MI' ? 'Manual Inspection' : 'OK', c.value]);
        if (c.status === 'MI') row.getCell(withStation ? 4 : 3).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF0A830' } };
    });
    sheet.columns = [{ width: 6 }, ...(withStation ? [{ width: 12 }] : []), { width: 80 }, { width: 20 }, { width: 24 }];
    const n = new Date(), p2 = v => String(v).padStart(2, '0');
    const stamp = `${n.getFullYear()}${p2(n.getMonth() + 1)}${p2(n.getDate())}_${p2(n.getHours())}${p2(n.getMinutes())}`;   // local time
    await downloadWorkbook(workbook, `${pkyModalData.fileBase}_${stamp}.xlsx`);
}

// ---- Summary (HC table) pop-up ----
// Total / OK / Manual Inspection values list the checkpoints behind them, with their station:
// GET /api/pokayoke/<api>/checkpoints?status=all|OK|MI (stations counted in the line total).
function pkyBindSummaryClicks(key) {
    const screen = pkyScreens[key];
    const tbody = document.getElementById(`${screen.prefix}TableBody`);
    if (!tbody || tbody.dataset.pkyClicks) return;
    tbody.dataset.pkyClicks = '1';
    tbody.addEventListener('click', e => {
        const el = e.target.closest('[data-pky-filter]');
        if (el && screen.api) pkyOpenSummary(key, el.dataset.pkyFilter);
    });
}

async function pkyOpenSummary(key, filter) {
    const screen = pkyScreens[key];
    const modal = pkyModal();
    const seq = ++pkyModalSeq;
    const body = document.getElementById('pkyModalBody');
    const sub = document.getElementById('pkyModalSub');
    const label = filter === 'OK' ? 'OK' : filter === 'MI' ? 'Manual Inspection' : 'All';
    document.getElementById('pkyModalTitle').textContent = `${screen.summaryName || `${screen.line} Main Line`} - ${label} checkpoints`;
    sub.textContent = 'Loading...';
    body.innerHTML = '';
    pkyResetTools();
    modal.classList.add('open');
    try {
        const res = await fetch(`/api/pokayoke/${screen.api}/checkpoints?status=${encodeURIComponent(filter)}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const d = await res.json();
        if (seq !== pkyModalSeq) return;
        pkyFillCheckpoints(d, true, `No ${label === 'All' ? '' : label + ' '}checkpoints.`, `PokaYoke_${(screen.summaryName || `${screen.line} MainLine`).replace(/ /g, '_')}_${label.replace(/ /g, '')}`);
    } catch (e) {
        if (seq !== pkyModalSeq) return;
        sub.textContent = '';
        body.innerHTML = `<div class="pky-modal-empty">Could not load data: ${pkyEsc(e.message)}</div>`;
    }
}

// ---- "Last updated" stamp ----
// Shows when the database was last queried for the data on screen ("Last updated 10:32:23 · 45 s
// ago"); the age ticks every second and turns amber once the data is older than 3 refresh periods.
// The stamp element is created next to the status badge (anchor) the first time.
function pkySetUpdated(id, anchor, data) {
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement('span');
        el.id = id;
        el.className = 'pky-updated';
        anchor.insertAdjacentElement('afterend', el);
    }
    el.dataset.pkyUpdated = data.updatedAt ? new Date(data.updatedAt).getTime() : '';
    el.dataset.pkyPeriod = data.refreshSeconds || 60;
    const fmt = d => new Date(d).toLocaleTimeString('en-GB');
    el.title = data.updatedAt
        ? [`Database queried ${data.queryStartedAt ? fmt(data.queryStartedAt) + ' - ' : ''}${fmt(data.updatedAt)}${data.querySeconds != null ? ` (${data.querySeconds} s)` : ''}`,
           `The server re-queries at most every ${data.refreshSeconds || 60} s while a PokaYoke screen is open; this screen checks every ${Math.max(15, (data.refreshSeconds || 60) / 2)} s.`].join('\n')
        : 'No data yet';
    pkyTickUpdated();
}

function pkyAgeText(seconds) {
    if (seconds < 60) return `${seconds} s ago`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${seconds % 60} s ago`;
    return `${Math.floor(seconds / 3600)} h ${Math.floor(seconds / 60) % 60} min ago`;
}

function pkyTickUpdated() {
    document.querySelectorAll('.pky-updated').forEach(el => {
        const ts = +el.dataset.pkyUpdated;
        if (!ts) { el.textContent = 'Not updated yet'; el.classList.remove('stale'); return; }
        const age = Math.max(0, Math.round((Date.now() - ts) / 1000));
        el.textContent = `Last updated ${new Date(ts).toLocaleTimeString('en-GB')} \u00b7 ${pkyAgeText(age)}`;
        el.classList.toggle('stale', age > 3 * (+el.dataset.pkyPeriod || 60));
    });
}

setInterval(pkyTickUpdated, 1000);
