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

    const { start, end } = currentProductionDayRange();
    const startInput = document.getElementById('cylinderHeadStart');
    const endInput = document.getElementById('cylinderHeadEnd');
    if (startInput && startInput._flatpickr) startInput._flatpickr.setDate(start);
    if (endInput && endInput._flatpickr) endInput._flatpickr.setDate(end);

    fetchCylinderHeadReport();
}

document.addEventListener('DOMContentLoaded', () => {
    const { start, end } = currentProductionDayRange();
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

