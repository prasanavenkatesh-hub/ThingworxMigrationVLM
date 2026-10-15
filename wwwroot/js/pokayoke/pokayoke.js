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
        }
    });

    (layout.labels || []).forEach(l => {
        html += `<div class="pky-label${l.vertical ? ' vertical' : ''}${l.wrap ? ' wrap' : ''}" style="${pos(l.x, l.y)}width:${l.w}px;height:${Y(l.h)}px;">
            <span>${pkyEsc(l.text)}</span></div>`;
    });

    (layout.stations || []).forEach(st => {
        const w = st.w || PKY_STATION_W;
        const h = st.h || PKY_STATION_H;
        const c = counts[st.id] || { ok: 0, mi: 0 };
        const state = st.auto ? 'auto' : (c.mi > 0 ? 'mi' : 'ok');
        // Horizontal stations show the id on two lines ("ML-54" -> ML / 54, "SA 42I" -> SA / 42I).
        const text = st.vertical ? `<span>${pkyEsc(st.id)}</span>` : pkyEsc(st.id).replace(/[ -]/, '<br>');
        const tip = `${st.id}${st.auto ? ' (auto station)' : ''}${st.noCounts ? '' : ` - OK ${c.ok}, Manual Inspection ${c.mi}`}`;
        html += `<div class="pky-station ${state}${st.vertical ? ' vertical' : ''}" style="${pos(st.x, st.y)}width:${w}px;height:${Y(h)}px;" title="${pkyEsc(tip)}">${text}</div>`;
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
            <td><span class="pky-link">${r.total}</span></td>
            <td><span class="pky-link">${r.ok}</span></td>
            <td><span class="pky-link">${r.mi}</span></td>
        </tr>`).join('');
    document.getElementById(ids.alert).style.visibility = mi > 0 ? 'visible' : 'hidden';

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
