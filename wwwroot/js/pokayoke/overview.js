// =============================================================================================
// PokaYoke > Overview: one card per line (JEA1 Engine Line, JEA2 Engine Line, Crank Shaft) with
// OK / Manual Inspection / Total tiles and an OK vs MI donut, plus an "Overall Poka Yoke" card
// (inner ring: all lines OK vs MI; outer ring: each line's share, split OK / MI) and its line
// table. The numbers are the line screens' summary values (GET /api/pokayoke/<api>/stations
// -> total, the same values as their HC table), so the cards always match the line screens; the
// tiles and table values open the same checkpoint pop-up as there. Polls while the tab is open.
// Crank Shaft (EA1) is a placeholder until its screen is built (no API yet): shown as "–" and not
// counted in the Overall card.
// =============================================================================================

// key = the line screen's tab id (its registered api is used for the data); tag = the badge.
const PKY_OV_LINES = [
    { key: 'pky-jea1-line', title: 'JEA1 Engine Line (EA1)', tag: 'EA1', short: 'EA1', tableName: 'JEA1 Engine Line-EA1' },
    { key: 'pky-jea2-line', title: 'JEA2 Engine Line (EA2)', tag: 'EA2', short: 'EA2', tableName: 'JEA2 Engine Line-EA2' },
    { key: 'pky-jea1-crankshaft', title: 'Crank Shaft (EA1)', tag: '', short: 'Crank Shaft', tableName: 'JEA1 Crank Shaft', placeholder: true }
];

let pkyOvData = {};        // line key -> { ok, mi } | { error }
let pkyOvUpdatedAt = null;
let pkyOvBuilt = false;

pkyRegisterScreen('pky-overview', { show: pkyOvShow });

function pkyOvLiveLines() {
    return PKY_OV_LINES.filter(l => !l.placeholder && pkyScreens[l.key] && pkyScreens[l.key].api);
}

function pkyOvShow(key, seq) {
    pkyOvBuild();
    pkyOvRender();
    pkyOvPoll(seq);
}

async function pkyOvPoll(seq) {
    let delaySeconds = 60;
    const lines = pkyOvLiveLines();
    const results = await Promise.all(lines.map(async l => {
        try {
            const res = await fetch(`/api/pokayoke/${pkyScreens[l.key].api}/stations`);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const d = await res.json();
            if (d.error) throw new Error(d.error);
            delaySeconds = Math.max(15, d.refreshSeconds || 60);
            return [l.key, { ok: d.total.ok, mi: d.total.mi, updatedAt: d.updatedAt, errors: (d.errors || []).length }];
        } catch (e) {
            // Keep the last good numbers on screen; flag the line.
            return [l.key, { ...(pkyOvData[l.key] || {}), error: e.message || 'Could not reach the server.' }];
        }
    }));
    if (seq !== pkyPollSeq) return;
    results.forEach(([k, v]) => { pkyOvData[k] = v; });
    pkyOvUpdatedAt = new Date();
    if (results.some(([, v]) => v.error)) delaySeconds = 15;   // retry soon after a failure
    pkyOvRender();
    pkyPollTimer = setTimeout(() => pkyOvPoll(seq), delaySeconds * 1000);
}

// ---- Markup (built once) ----
function pkyOvKpis(id, clickKey) {
    const click = f => clickKey ? ` data-pky-ov-line="${clickKey}" data-pky-ov-filter="${f}" title="Show the checkpoints"` : '';
    return `
        <div class="pky-ov-kpis">
            <div class="pky-ov-kpi ok"${click('OK')}>
                <div class="pky-ov-kpi-val"><b id="${id}Ok">–</b><small id="${id}OkPct"></small></div>
                <div class="pky-ov-kpi-label">OK</div>
            </div>
            <div class="pky-ov-kpi mi"${click('MI')}>
                <div class="pky-ov-kpi-val"><b id="${id}Mi">–</b>
                    <span class="pky-ov-kpi-alert"><img id="${id}MiIcon" src="assets/Caution.gif" alt="Manual Inspection"><small id="${id}MiPct"></small></span>
                </div>
                <div class="pky-ov-kpi-label">Manual Inspection (MI)</div>
            </div>
            <div class="pky-ov-kpi total"${click('all')}>
                <div class="pky-ov-kpi-val"><b id="${id}Total">–</b></div>
                <div class="pky-ov-kpi-label">Total Count(TC)</div>
            </div>
        </div>`;
}

function pkyOvDonut(id, extraClass = '') {
    return `
        <div class="pky-ov-donut ${extraClass}">
            <div class="pky-donut-label mi">MI <span id="${id}DonutMi">0%</span></div>
            <div class="pky-ov-donut-chart">
                <canvas id="${id}Donut"></canvas>
                <img class="pky-ov-donut-icon" src="assets/pky-bike.png" alt="">
            </div>
            <div class="pky-donut-label ok"><span id="${id}DonutOk">100%</span> OK</div>
        </div>`;
}

function pkyOvCard(l, i) {
    const id = `pkyOv${i}`;
    const open = l.placeholder ? '' : ` onclick="switchTab('${l.key}')"`;
    return `
        <div class="pky-ov-card pky-ov-line${i}${l.placeholder ? ' placeholder' : ''}">
            <div class="pky-ov-head">
                <span class="pky-ov-title${l.placeholder ? '' : ' link'}"${open}>${pkyEsc(l.title)}</span>
                ${l.tag ? `<span class="pky-ov-tag">${pkyEsc(l.tag)}</span>` : ''}
                <span class="pky-ov-detail${l.placeholder ? '' : ' link'}"${open} title="${l.placeholder ? 'Not built yet' : 'Open the station screen'}">
                    <span class="material-symbols-outlined">home</span>Detailed Poka Yoke</span>
            </div>
            ${pkyOvKpis(id, l.placeholder ? '' : l.key)}
            ${l.placeholder ? '<div class="pky-ov-note">Crank Shaft Poka Yoke is not built yet.</div>' : ''}
            ${pkyOvDonut(id)}
        </div>`;
}

function pkyOvBuild() {
    if (pkyOvBuilt) return;
    const grid = document.getElementById('pkyOvGrid');
    if (!grid) return;
    pkyOvBuilt = true;
    grid.innerHTML = PKY_OV_LINES.map(pkyOvCard).join('') + `
        <div class="pky-ov-card pky-ov-overall">
            <div class="pky-ov-head center">
                <span class="pky-ov-title">Overall Poka Yoke</span>
                <span class="pky-sample" id="pkyOvStatus">Loading...</span>
            </div>
            ${pkyOvKpis('pkyOvAll', '')}
            ${pkyOvDonut('pkyOvAll', 'overall')}
            <table class="pky-ov-table">
                <thead><tr><th>Line Name</th><th>OK</th><th>MI</th><th>TOTAL</th></tr></thead>
                <tbody id="pkyOvTableBody"></tbody>
            </table>
        </div>`;
    // Tiles / table values -> the line's checkpoint pop-up (pokayoke.js).
    grid.addEventListener('click', e => {
        const el = e.target.closest('[data-pky-ov-line]');
        if (el && pkyOvData[el.dataset.pkyOvLine] && !pkyOvData[el.dataset.pkyOvLine].error)
            pkyOpenSummary(el.dataset.pkyOvLine, el.dataset.pkyOvFilter);
    });
}

// ---- Render ----
const pkyOvPct = (v, total, digits) => total ? (v / total * 100).toFixed(digits) : (0).toFixed(digits);

function pkyOvSetKpis(id, d) {
    const has = d && typeof d.ok === 'number';
    const total = has ? d.ok + d.mi : 0;
    document.getElementById(`${id}Ok`).textContent = has ? d.ok : '–';
    document.getElementById(`${id}Mi`).textContent = has ? d.mi : '–';
    document.getElementById(`${id}Total`).textContent = has ? total : '–';
    document.getElementById(`${id}OkPct`).textContent = has ? `${pkyOvPct(d.ok, total, 2)} %` : '';
    document.getElementById(`${id}MiPct`).textContent = has ? `${pkyOvPct(d.mi, total, 2)} %` : '';
    // Caution icon only while there is Manual Inspection (as the line screens' alert).
    document.getElementById(`${id}MiIcon`).style.display = has && d.mi > 0 ? '' : 'none';
    document.getElementById(`${id}DonutOk`).textContent = has && total ? `${Math.round(d.ok / total * 100)}%` : '–';
    document.getElementById(`${id}DonutMi`).textContent = has && total ? `${Math.round(d.mi / total * 100)}%` : '–';
}

function pkyOvLineDonut(id, d) {
    const has = d && typeof d.ok === 'number' && d.ok + d.mi > 0;
    pkyOvChart(`${id}Donut`, {
        type: 'doughnut',
        data: {
            labels: ['OK', 'Manual Inspection'],
            datasets: [{
                data: has ? [d.ok, d.mi] : [1, 0],
                backgroundColor: has ? [PKY_OK_COLOR, PKY_MI_COLOR] : ['#9ca3af', '#9ca3af'],
                borderWidth: 0
            }]
        },
        options: { cutout: '55%', maintainAspectRatio: false, animation: false,
            plugins: { legend: { display: false }, tooltip: { enabled: has } } }
    });
}

// Outer ring of the Overall donut: line name outside each line's share, share % on it.
const pkyOvOuterLabels = {
    id: 'pkyOvOuterLabels',
    afterDatasetsDraw(chart) {
        const groups = chart.$pkyOvGroups;
        if (!groups) return;
        const meta = chart.getDatasetMeta(0);
        const ctx = chart.ctx;
        const color = getComputedStyle(document.body).getPropertyValue('--dark').trim() || '#000';
        ctx.save();
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        groups.forEach(g => {
            const first = meta.data[g.from], last = meta.data[g.to];
            if (!first || !last || !g.total) return;
            const { x, y, outerRadius, innerRadius } = first.getProps(['x', 'y', 'outerRadius', 'innerRadius'], true);
            const start = first.getProps(['startAngle'], true).startAngle;
            const end = last.getProps(['endAngle'], true).endAngle;
            const mid = (start + end) / 2;
            ctx.fillStyle = color;
            ctx.font = '600 15px Inter, sans-serif';
            ctx.fillText(g.name, x + Math.cos(mid) * (outerRadius + 30), y + Math.sin(mid) * (outerRadius + 18));
            ctx.fillStyle = '#111';
            ctx.font = '600 11px Inter, sans-serif';
            const r = (outerRadius + innerRadius) / 2;
            ctx.fillText(g.pct, x + Math.cos(mid) * r, y + Math.sin(mid) * r);
        });
        ctx.restore();
    }
};

function pkyOvOverallDonut(lines, all) {
    // Outer: per line [OK, MI]; inner: overall [OK, MI].
    const outer = [], colors = [], groups = [];
    const grand = all.ok + all.mi;
    lines.forEach(l => {
        const d = pkyOvData[l.key];
        if (!d || typeof d.ok !== 'number') return;
        const t = d.ok + d.mi;
        groups.push({ name: l.short, from: outer.length, to: outer.length + 1, total: t, pct: `${grand ? Math.round(t / grand * 100) : 0}%` });
        outer.push(d.ok, d.mi);
        colors.push(PKY_OK_COLOR, PKY_MI_COLOR);
    });
    const has = grand > 0;
    const chart = pkyOvChart('pkyOvAllDonut', {
        type: 'doughnut',
        data: {
            labels: groups.flatMap(g => [`${g.name} OK`, `${g.name} MI`]),
            datasets: [
                { data: has ? outer : [1], backgroundColor: has ? colors : ['#9ca3af'], borderColor: '#ffffff', borderWidth: 2, weight: 1 },
                { data: has ? [all.ok, all.mi] : [1], backgroundColor: has ? [PKY_OK_COLOR, PKY_MI_COLOR] : ['#9ca3af'], borderColor: '#ffffff', borderWidth: 2, weight: 1 }
            ]
        },
        options: {
            cutout: '45%', maintainAspectRatio: false, animation: false,
            layout: { padding: 34 },
            plugins: {
                legend: { display: false },
                tooltip: {
                    enabled: has,
                    callbacks: { label: c => c.datasetIndex === 1 ? ` Overall ${c.dataIndex ? 'MI' : 'OK'}: ${c.raw}` : ` ${c.label}: ${c.raw}` }
                }
            }
        },
        plugins: [pkyOvOuterLabels]
    });
    chart.$pkyOvGroups = has ? groups : null;
    chart.draw();
}

function pkyOvChart(canvasId, config) {
    if (pkyCharts[canvasId]) pkyCharts[canvasId].destroy();
    const canvas = document.getElementById(canvasId);
    pkyCharts[canvasId] = new Chart(canvas.getContext('2d'), config);
    return pkyCharts[canvasId];
}

function pkyOvRender() {
    if (!pkyOvBuilt) return;
    const live = pkyOvLiveLines();
    PKY_OV_LINES.forEach((l, i) => {
        const d = l.placeholder ? null : pkyOvData[l.key];
        pkyOvSetKpis(`pkyOv${i}`, d);
        pkyOvLineDonut(`pkyOv${i}`, d);
    });

    const all = { ok: 0, mi: 0 };
    live.forEach(l => { const d = pkyOvData[l.key]; if (d && typeof d.ok === 'number') { all.ok += d.ok; all.mi += d.mi; } });
    const anyData = live.some(l => pkyOvData[l.key] && typeof pkyOvData[l.key].ok === 'number');
    pkyOvSetKpis('pkyOvAll', anyData ? all : null);
    pkyOvOverallDonut(live, all);

    const cell = (l, f, v) => l.placeholder || v === '–' ? `<td>${v}</td>` : `<td><span class="pky-ov-num" data-pky-ov-line="${l.key}" data-pky-ov-filter="${f}" title="Show the checkpoints">${v}</span></td>`;
    document.getElementById('pkyOvTableBody').innerHTML = PKY_OV_LINES.map(l => {
        const d = l.placeholder ? null : pkyOvData[l.key];
        const has = d && typeof d.ok === 'number';
        return `<tr${l.placeholder ? ' class="placeholder"' : ''}>
            <td>${pkyEsc(l.tableName)}</td>
            ${cell(l, 'OK', has ? d.ok : '–')}${cell(l, 'MI', has ? d.mi : '–')}${cell(l, 'all', has ? d.ok + d.mi : '–')}
        </tr>`;
    }).join('');

    // Status pill: live / some line failed / nothing yet.
    const el = document.getElementById('pkyOvStatus');
    const failed = live.filter(l => pkyOvData[l.key] && pkyOvData[l.key].error);
    if (!pkyOvUpdatedAt) {
        el.className = 'pky-sample'; el.textContent = 'Loading...'; el.title = 'Loading live data';
    } else if (failed.length) {
        el.className = `pky-sample ${anyData ? 'pky-status-warn' : 'pky-status-error'}`;
        el.textContent = anyData ? `Partial · ${pkyOvUpdatedAt.toLocaleTimeString('en-GB')}` : 'No data';
        el.title = failed.map(l => `${l.short}: ${pkyOvData[l.key].error}`).join('\n');
    } else {
        el.className = 'pky-sample pky-status-live';
        el.textContent = `Live · ${pkyOvUpdatedAt.toLocaleTimeString('en-GB')}`;
        el.title = live.map(l => `${l.short}: data ${new Date(pkyOvData[l.key].updatedAt).toLocaleTimeString('en-GB')}`).join('\n');
    }
}
