// --- CYLINDER HEAD LEAK REJECTION REPORT ---

let cylinderHeadAllData = [];   // rows returned by the API for the Plant / Line / Shift / date filters
let cylinderHeadData = [];      // the same rows after the Cell filter (applied in the browser) - what every view draws
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

const CYLINDER_HEAD_SHIFTS = ['A', 'B', 'C'];
const CYLINDER_HEAD_PDF_DAYS = 2;   // days per table block in the PDF (12 columns per day)
const CYLINDER_HEAD_METRICS =[{ key: 'actual', label: 'Consumption' }, { key: 'ok', label: 'OK' }, { key: 'nok', label: 'NOK' }, { key: 'rej', label: 'Rej%' }];

// One { location, assemblyLine, label, ok, nok, actual } per line card. Always lists the known lines (even with zero
// data for the current filters), plus any unexpected ones found in the data. Used by the cards, Excel and PDF.
function cylinderHeadLineTotals() {
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

    return [...CYLINDER_HEAD_CARD_ORDER, ...extraCards].map(c => ({
        ...c, ...(groups[`${c.location}|${c.assemblyLine}`] || { ok: 0, nok: 0, actual: 0 })
    }));
}

// pivot[cell][date][shift] = { ok, nok, actual }, pooled across AssemblyLine. Used by the table, trend chart, Excel and PDF.
function cylinderHeadBuildPivot() {
    const rows = cylinderHeadData || [];
    const dates = Array.from(new Set(rows.map(r => cylinderHeadDateKey(r.date)))).sort();
    const pivot = {};
    const cellsPresent = new Set();
    rows.forEach(row => {
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
    return { dates, cellOrder, pivot };
}

// A cell's day pooled across shifts (trend chart), or null when the cell has no rows that day.
function cylinderHeadDayBucket(pivot, cell, dateKey) {
    const day = pivot[cell]?.[dateKey];
    if (!day) return null;
    return Object.values(day).reduce((t, b) => ({ ok: t.ok + b.ok, nok: t.nok + b.nok, actual: t.actual + b.actual }), { ok: 0, nok: 0, actual: 0 });
}

function cylinderHeadSetLoading(isLoading) {
    const loadingEl = document.getElementById('cylinderHeadLoading');
    if (loadingEl) loadingEl.style.display = isLoading ? 'flex' : 'none';
}

// Load time: a running seconds counter while the report loads, then "Loaded in X s" (fetch + render).
let cylinderHeadLoadTimerId = null;

function cylinderHeadFormatSeconds(ms) {
    return `${(ms / 1000).toFixed(1)} s`;
}

function cylinderHeadStartLoadTimer() {
    const startedAt = performance.now();
    const timerEl = document.getElementById('cylinderHeadLoadTimer');
    const doneEl = document.getElementById('cylinderHeadLoadTime');
    if (doneEl) doneEl.textContent = '';
    if (timerEl) timerEl.textContent = '(0.0 s)';
    clearInterval(cylinderHeadLoadTimerId);
    cylinderHeadLoadTimerId = setInterval(() => {
        if (timerEl) timerEl.textContent = `(${cylinderHeadFormatSeconds(performance.now() - startedAt)})`;
    }, 100);
    return startedAt;
}

function cylinderHeadStopLoadTimer(startedAt, ok) {
    clearInterval(cylinderHeadLoadTimerId);
    cylinderHeadLoadTimerId = null;
    const doneEl = document.getElementById('cylinderHeadLoadTime');
    if (!doneEl) return;
    const time = new Date().toLocaleTimeString('en-GB');
    const took = cylinderHeadFormatSeconds(performance.now() - startedAt);
    doneEl.textContent = ok ? `Loaded in ${took} · ${time}` : `Failed after ${took} · ${time}`;
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
    const buttons = [summaryBtn, trendBtn, document.getElementById('cylinderHeadExcelBtn'), document.getElementById('cylinderHeadPdfBtn')];
    buttons.forEach(b => { if (b) b.disabled = true; });
    cylinderHeadSetLoading(true);
    const startedAt = cylinderHeadStartLoadTimer();
    let loadOk = false;

    try {
        const res = await fetch(`/api/reports/cylinder-head-leak/data?${params.toString()}`);
        if (res.ok) {
            cylinderHeadAllData = await res.json();
            loadOk = true;
        } else {
            alert('Failed to load Cylinder Head Leak Rejection report data.');
            cylinderHeadAllData = [];
        }
    } catch (err) {
        console.error('Error fetching Cylinder Head Leak report', err);
        alert('Error connecting to server');
        cylinderHeadAllData = [];
    } finally {
        cylinderHeadSetLoading(false);
        buttons.forEach(b => { if (b) b.disabled = false; });
        cylinderHeadFillCellOptions();
        applyCylinderHeadCellFilter();
        cylinderHeadStopLoadTimer(startedAt, loadOk);
    }
}

function renderCylinderHeadCards() {
    const container = document.getElementById('cylinderHeadCards');
    if (!container) return;

    container.innerHTML = cylinderHeadLineTotals().map(g => {
        const rejPct = cylinderHeadRejPct(g.nok, g.actual);
        return `
            <div style="flex:1; min-width:220px; background:#1e1e1e; border:1px solid #333; border-radius:8px; overflow:hidden;">
                <div style="background:var(--primary); color:#fff; font-size:16px; font-weight:700; padding:8px 10px; text-align:center; letter-spacing:0.3px;">${g.label}</div>
                <div style="display:flex; padding:14px 8px; gap:6px;">
                    <div style="flex:1; text-align:center;">
                        <div style="font-size:30px; font-weight:700; line-height:1.1; color:#fff;">${g.actual}</div>
                        <div style="font-size:13px; font-weight:600; color:#aaa; margin-top:2px;">Total</div>
                    </div>
                    <div style="flex:1; text-align:center;">
                        <div style="font-size:30px; font-weight:700; line-height:1.1; color:#22c55e;">${g.ok}</div>
                        <div style="font-size:13px; font-weight:600; color:#aaa; margin-top:2px;">OK</div>
                    </div>
                    <div style="flex:1; text-align:center;">
                        <div style="font-size:30px; font-weight:700; line-height:1.1; color:#ef4444;">${g.nok}</div>
                        <div style="font-size:13px; font-weight:600; color:#aaa; margin-top:2px;">NOK</div>
                    </div>
                    <div style="flex:1; text-align:center;">
                        <div style="font-size:30px; font-weight:700; line-height:1.1; color:#f59e0b;">${rejPct}%</div>
                        <div style="font-size:13px; font-weight:600; color:#aaa; margin-top:2px;">Rej%</div>
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

    const { dates, cellOrder, pivot } = cylinderHeadBuildPivot();
    const shifts = CYLINDER_HEAD_SHIFTS;
    const metrics = CYLINDER_HEAD_METRICS;

    const cellStyle = 'padding:10px 12px; text-align:center; white-space:nowrap; font-size:15px;';
    const headStyle = 'padding:8px 10px; text-align:center; white-space:nowrap; font-size:13px; font-weight:700; color:#bbb; border-bottom:1px solid #333;';

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
        let html = `<td class="cylinder-head-sticky-cell" style="${cellStyle} font-weight:600;">${cell}</td>`;
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
    let grandHtml = `<td class="cylinder-head-sticky-cell" style="${cellStyle} font-weight:700;">Total</td>`;
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
    requestAnimationFrame(cylinderHeadFitRows);
}

// Stretches the table rows to use the empty space below the table (up to CYLINDER_HEAD_MAX_ROW_PX per row);
// with more rows than fit, the rows keep their natural height and the table scrolls.
const CYLINDER_HEAD_MAX_ROW_PX = 64;

function cylinderHeadFitRows() {
    const table = document.getElementById('cylinderHeadTable');
    const thead = document.getElementById('cylinderHeadTableHead');
    const tbody = document.getElementById('cylinderHeadTableBody');
    const container = table?.parentElement;
    if (!table || !thead || !tbody || !container || table.style.display === 'none' || container.clientHeight === 0) return;

    const rows = Array.from(tbody.rows);
    if (rows.length === 0) return;
    rows.forEach(tr => { tr.style.height = ''; });
    const free = container.clientHeight - thead.offsetHeight - tbody.offsetHeight;
    if (free <= 0) return;
    const height = Math.min(CYLINDER_HEAD_MAX_ROW_PX, Math.floor(tbody.offsetHeight / rows.length + free / rows.length));
    rows.forEach(tr => { tr.style.height = `${height}px`; });
}

window.addEventListener('resize', () => {
    if (cylinderHeadView === 'summary') cylinderHeadFitRows();
});

function renderCylinderHeadTrendChart() {
    const canvas = document.getElementById('cylinderHeadTrendChart');
    if (!canvas || typeof Chart === 'undefined') return;

    const { dates, cellOrder, pivot } = cylinderHeadBuildPivot();

    const datasets = cellOrder.map((cell, idx) => {
        const color = CYLINDER_HEAD_CHART_COLORS[idx % CYLINDER_HEAD_CHART_COLORS.length];
        const data = dates.map(d => {
            const b = cylinderHeadDayBucket(pivot, cell, d);
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

// ---- Export (Excel opens in Excel and Google Sheets; PDF = browser print / Save as PDF) ----

function cylinderHeadFilterText() {
    const sel = id => document.getElementById(id)?.value || 'ALL';
    const dateText = id => {
        const input = document.getElementById(id);
        return input?._flatpickr?.altInput?.value || input?.value || '';
    };
    const all = v => (v === 'ALL' ? 'All' : v);
    return `Plant: ${all(sel('cylinderHeadPlant'))}   |   Assembly Line: ${all(sel('cylinderHeadLine'))}   |   Shift: ${all(sel('cylinderHeadShift'))}   |   Cell: ${all(sel('cylinderHeadCell'))}   |   From: ${dateText('cylinderHeadStart')}   |   To: ${dateText('cylinderHeadEnd')}`;
}

function cylinderHeadFileStamp() {
    const d = new Date();
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}

async function exportCylinderHeadExcel() {
    if (!cylinderHeadData || cylinderHeadData.length === 0) {
        alert('No data to export');
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        const border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        const gold = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7CD4F' } };
        const totalFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBE3E1' } };
        const filterText = cylinderHeadFilterText();
        const { dates, cellOrder, pivot } = cylinderHeadBuildPivot();
        const shifts = CYLINDER_HEAD_SHIFTS;
        const metrics = CYLINDER_HEAD_METRICS;

        const addTitle = (sheet, title, lastCol) => {
            sheet.mergeCells(1, 1, 1, Math.max(lastCol, 6));
            sheet.getCell(1, 1).value = title;
            sheet.getCell(1, 1).font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFD71920' } };
            sheet.mergeCells(2, 1, 2, Math.max(lastCol, 6));
            sheet.getCell(2, 1).value = filterText;
            sheet.getCell(2, 1).font = { italic: true, size: 10 };
            sheet.getCell(3, 1).value = `Exported On: ${new Date().toLocaleString()} · first attempt per barcode at SA-30E · Rej% = NOK / Consumption`;
            sheet.getCell(3, 1).font = { size: 10 };
        };
        const styleHeader = cell => {
            cell.font = { bold: true };
            cell.fill = gold;
            cell.border = border;
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        };
        // Rej% is stored as a fraction with a 0% format, so it shows like the screen but stays a number.
        const metricValue = (b, key) => {
            if (key === 'rej') return b.actual > 0 ? b.nok / b.actual : null;
            return b[key];
        };
        const writeMetrics = (row, firstCol, b, blankIfEmpty) => {
            metrics.forEach((m, i) => {
                const cell = row.getCell(firstCol + i);
                cell.value = blankIfEmpty && !b.actual ? null : (metricValue(b, m.key) ?? 0);
                if (m.key === 'rej') cell.numFmt = '0%';
                cell.border = border;
                cell.alignment = { horizontal: 'center' };
            });
        };

        // Sheet 1: line cards + the cell x date x shift table, as on screen.
        const lastCol = 1 + dates.length * 12 + 4;
        const sheet = workbook.addWorksheet('Summary');
        addTitle(sheet, 'CYLINDER HEAD LEAK REJECTION REPORT', lastCol);

        ['Line', 'Total', 'OK', 'NOK', 'Rej%'].forEach((h, i) => {
            sheet.getRow(5).getCell(1 + i).value = h;
            styleHeader(sheet.getRow(5).getCell(1 + i));
        });
        let r = 6;
        cylinderHeadLineTotals().forEach(c => {
            const row = sheet.getRow(r++);
            row.getCell(1).value = c.label;
            row.getCell(2).value = c.actual;
            row.getCell(3).value = c.ok;
            row.getCell(4).value = c.nok;
            row.getCell(5).value = c.actual > 0 ? c.nok / c.actual : 0;
            row.getCell(5).numFmt = '0%';
            for (let col = 1; col <= 5; col++) row.getCell(col).border = border;
        });

        r += 1;
        const h0 = r, h1 = r + 1, h2 = r + 2;
        sheet.mergeCells(h0, 1, h2, 1);
        sheet.getCell(h0, 1).value = 'Cell';
        dates.forEach((d, di) => {
            const dateCol = 2 + di * 12;
            sheet.mergeCells(h0, dateCol, h0, dateCol + 11);
            sheet.getCell(h0, dateCol).value = cylinderHeadFormatDateLabel(d);
            shifts.forEach((s, si) => {
                const shiftCol = dateCol + si * 4;
                sheet.mergeCells(h1, shiftCol, h1, shiftCol + 3);
                sheet.getCell(h1, shiftCol).value = `Shift ${s}`;
                metrics.forEach((m, mi) => { sheet.getCell(h2, shiftCol + mi).value = m.label; });
            });
        });
        const totalCol = 2 + dates.length * 12;
        sheet.mergeCells(h0, totalCol, h1, totalCol + 3);
        sheet.getCell(h0, totalCol).value = 'Total';
        metrics.forEach((m, mi) => { sheet.getCell(h2, totalCol + mi).value = m.label; });
        for (let row = h0; row <= h2; row++) {
            for (let col = 1; col <= lastCol; col++) styleHeader(sheet.getCell(row, col));
        }

        r = h2 + 1;
        const grand = {};
        cellOrder.forEach(cell => {
            const row = sheet.getRow(r++);
            row.getCell(1).value = cell;
            row.getCell(1).font = { bold: true };
            row.getCell(1).border = border;
            const totals = { ok: 0, nok: 0, actual: 0 };
            dates.forEach((d, di) => {
                shifts.forEach((s, si) => {
                    const b = pivot[cell]?.[d]?.[s] || { ok: 0, nok: 0, actual: 0 };
                    totals.ok += b.ok; totals.nok += b.nok; totals.actual += b.actual;
                    const g = grand[`${d}|${s}`] = grand[`${d}|${s}`] || { ok: 0, nok: 0, actual: 0 };
                    g.ok += b.ok; g.nok += b.nok; g.actual += b.actual;
                    writeMetrics(row, 2 + di * 12 + si * 4, b, true);
                });
            });
            writeMetrics(row, totalCol, totals, false);
            for (let col = totalCol; col <= lastCol; col++) {
                row.getCell(col).fill = totalFill;
                row.getCell(col).font = { bold: true };
            }
        });

        const grandRow = sheet.getRow(r);
        grandRow.getCell(1).value = 'Total';
        const grandTotal = { ok: 0, nok: 0, actual: 0 };
        dates.forEach((d, di) => {
            shifts.forEach((s, si) => {
                const g = grand[`${d}|${s}`] || { ok: 0, nok: 0, actual: 0 };
                grandTotal.ok += g.ok; grandTotal.nok += g.nok; grandTotal.actual += g.actual;
                writeMetrics(grandRow, 2 + di * 12 + si * 4, g, true);
            });
        });
        writeMetrics(grandRow, totalCol, grandTotal, false);
        for (let col = 1; col <= lastCol; col++) {
            grandRow.getCell(col).font = { bold: true };
            grandRow.getCell(col).border = border;
            if (col >= totalCol || col === 1) grandRow.getCell(col).fill = gold;
        }

        sheet.getColumn(1).width = 18;
        for (let col = 2; col <= lastCol; col++) sheet.getColumn(col).width = 12;
        sheet.views = [{ state: 'frozen', xSplit: 1 }];

        // Sheet 2: rejection % per cell per day (pooled across shifts) = the Cellwise rej trend chart.
        const trendSheet = workbook.addWorksheet('Cellwise Rej Trend');
        addTitle(trendSheet, 'CELLWISE REJECTION TREND (Rej%)', dates.length + 1);
        trendSheet.getRow(5).getCell(1).value = 'Cell';
        dates.forEach((d, di) => { trendSheet.getRow(5).getCell(2 + di).value = cylinderHeadFormatDateLabel(d); });
        for (let col = 1; col <= dates.length + 1; col++) styleHeader(trendSheet.getRow(5).getCell(col));
        cellOrder.forEach((cell, ci) => {
            const row = trendSheet.getRow(6 + ci);
            row.getCell(1).value = cell;
            row.getCell(1).border = border;
            dates.forEach((d, di) => {
                const b = cylinderHeadDayBucket(pivot, cell, d);
                const c = row.getCell(2 + di);
                c.value = b && b.actual > 0 ? b.nok / b.actual : null;
                c.numFmt = '0%';
                c.border = border;
                c.alignment = { horizontal: 'center' };
            });
        });
        trendSheet.getColumn(1).width = 18;
        for (let col = 2; col <= dates.length + 1; col++) trendSheet.getColumn(col).width = 10;

        // Sheet 3: the rows returned by the report, unpivoted.
        const dataSheet = workbook.addWorksheet('Data');
        addTitle(dataSheet, 'CYLINDER HEAD LEAK REJECTION - DATA', 9);
        const dataHeaders = ['Location', 'Assembly Line', 'Date', 'Shift', 'Station', 'Cell', 'OK', 'NOK', 'Consumption'];
        dataHeaders.forEach((h, i) => { dataSheet.getRow(5).getCell(1 + i).value = h; styleHeader(dataSheet.getRow(5).getCell(1 + i)); });
        cylinderHeadData.forEach((row, i) => {
            const out = dataSheet.getRow(6 + i);
            [row.location, row.assemblyLine, cylinderHeadFormatDateLabel(cylinderHeadDateKey(row.date)), row.shift, row.stationNumber, row.cell, row.okQty, row.notOkQty, row.actualQty]
                .forEach((v, ci) => { out.getCell(1 + ci).value = v ?? null; out.getCell(1 + ci).border = border; });
        });
        [12, 14, 11, 8, 10, 14, 8, 8, 13].forEach((w, i) => { dataSheet.getColumn(1 + i).width = w; });
        dataSheet.views = [{ state: 'frozen', ySplit: 5 }];

        await downloadWorkbook(workbook, `Cylinder_Head_Leak_Rejection_${cylinderHeadFileStamp()}.xlsx`);
    } catch (err) {
        console.error('Cylinder Head Leak Excel export failed', err);
        alert('Excel export failed');
    }
}

function cylinderHeadEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

// Opens a print-friendly copy (white paper, landscape, table scaled to the page width) of the view currently shown
// (Summary = line cards + table, Cellwise rej trend = line cards + chart) and starts the browser print -> "Save as PDF".
function exportCylinderHeadPdf() {
    if (!cylinderHeadData || cylinderHeadData.length === 0) {
        alert('No data to export');
        return;
    }

    const { dates, cellOrder, pivot } = cylinderHeadBuildPivot();
    const shifts = CYLINDER_HEAD_SHIFTS;
    const metrics = CYLINDER_HEAD_METRICS;
    const metricText = (b, key, blankIfEmpty) => {
        if (blankIfEmpty && !b.actual) return '';
        return key === 'rej' ? `${cylinderHeadRejPct(b.nok, b.actual)}%` : b[key];
    };

    const cards = cylinderHeadLineTotals().map(c => `
        <div class="card">
            <div class="card-title">${cylinderHeadEsc(c.label)}</div>
            <div class="card-body">
                <div><b>${c.actual}</b><span>Total</span></div>
                <div class="ok"><b>${c.ok}</b><span>OK</span></div>
                <div class="nok"><b>${c.nok}</b><span>NOK</span></div>
                <div class="rej"><b>${cylinderHeadRejPct(c.nok, c.actual)}%</b><span>Rej%</span></div>
            </div>
        </div>`).join('');

    let body;
    if (cylinderHeadView === 'trend') {
        const image = cylinderHeadChart ? cylinderHeadChart.toBase64Image('image/png', 1) : '';
        body = image ? `<h2>Cellwise rejection trend</h2><div class="chart"><img src="${image}" alt="Cellwise rejection trend"></div>` : '';
    } else {
        // Totals over the whole range: per cell, per date+shift (Total row) and overall.
        const add = (t, b) => { t.ok += b.ok; t.nok += b.nok; t.actual += b.actual; };
        const empty = () => ({ ok: 0, nok: 0, actual: 0 });
        const cellTotals = {}, grand = {}, grandTotal = empty();
        cellOrder.forEach(cell => {
            cellTotals[cell] = empty();
            dates.forEach(d => shifts.forEach(s => {
                const b = pivot[cell]?.[d]?.[s] || empty();
                add(cellTotals[cell], b);
                add(grand[`${d}|${s}`] = grand[`${d}|${s}`] || empty(), b);
                add(grandTotal, b);
            }));
        });

        // 12 columns per day: more than 2 days per table gets too small to read on A4, so long ranges are split into
        // blocks of CYLINDER_HEAD_PDF_DAYS days, each repeating the Cell column; the Total columns go on the last block.
        const blocks = [];
        for (let i = 0; i < dates.length; i += CYLINDER_HEAD_PDF_DAYS) blocks.push(dates.slice(i, i + CYLINDER_HEAD_PDF_DAYS));
        body = blocks.map((blockDates, bi) => {
            const withTotal = bi === blocks.length - 1;
            const head0 = `<tr><th rowspan="3" class="cell">Cell</th>${blockDates.map(d => `<th colspan="12">${cylinderHeadFormatDateLabel(d)}</th>`).join('')}${withTotal ? '<th colspan="4" rowspan="2" class="total">Total</th>' : ''}</tr>`;
            const head1 = `<tr>${blockDates.map(() => shifts.map(s => `<th colspan="4">Shift ${s}</th>`).join('')).join('')}</tr>`;
            const head2 = `<tr>${blockDates.map(() => shifts.map(() => metrics.map(m => `<th>${m.label}</th>`).join('')).join('')).join('')}${withTotal ? metrics.map(m => `<th class="total">${m.label}</th>`).join('') : ''}</tr>`;
            const rows = cellOrder.map(cell => {
                let html = `<td class="cell">${cylinderHeadEsc(cell)}</td>`;
                blockDates.forEach(d => shifts.forEach(s => {
                    const b = pivot[cell]?.[d]?.[s] || empty();
                    html += metrics.map(m => `<td>${metricText(b, m.key, true)}</td>`).join('');
                }));
                if (withTotal) html += metrics.map(m => `<td class="total">${metricText(cellTotals[cell], m.key, false)}</td>`).join('');
                return `<tr>${html}</tr>`;
            }).join('');
            let grandHtml = '<td class="cell">Total</td>';
            blockDates.forEach(d => shifts.forEach(s => {
                grandHtml += metrics.map(m => `<td>${metricText(grand[`${d}|${s}`] || empty(), m.key, true)}</td>`).join('');
            }));
            if (withTotal) grandHtml += metrics.map(m => `<td class="total">${metricText(grandTotal, m.key, false)}</td>`).join('');
            return `<table class="pivot"><thead>${head0}${head1}${head2}</thead><tbody>${rows}<tr class="grand">${grandHtml}</tr></tbody></table>`;
        }).join('');
    }

    const html = `<!doctype html><html><head><meta charset="utf-8">
<title>Cylinder Head Leak Rejection ${cylinderHeadFileStamp()}</title>
<style>
    @page { size: A4 landscape; margin: 8mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; font-family: Arial, sans-serif; color: #1d1d1f; background: #fff; }
    h1 { font-size: 16px; color: #d71920; margin: 0 0 4px; }
    h2 { font-size: 13px; margin: 12px 0 6px; }
    .meta { font-size: 10px; color: #555; margin-bottom: 10px; }
    .cards { display: flex; gap: 8px; margin-bottom: 10px; }
    .card { flex: 1; border: 1px solid #ccc; border-radius: 6px; overflow: hidden; }
    .card-title { background: #d71920; color: #fff; font-size: 11px; font-weight: 700; text-align: center; padding: 4px; }
    .card-body { display: flex; padding: 6px 4px; }
    .card-body div { flex: 1; text-align: center; }
    .card-body b { display: block; font-size: 15px; }
    .card-body span { font-size: 9px; color: #666; }
    .ok b { color: #15803d; } .nok b { color: #dc2626; } .rej b { color: #d97706; }
    table { border-collapse: collapse; font-size: 9px; }
    table.pivot { margin-bottom: 10px; page-break-inside: avoid; }
    th, td { border: 1px solid #bbb; padding: 3px 5px; text-align: center; white-space: nowrap; }
    th { background: #f7cd4f; font-weight: 700; }
    td.cell, th.cell { text-align: left; font-weight: 700; }
    .total { background: #fbe3e1; font-weight: 700; }
    tr.grand td { font-weight: 700; background: #f3f3f3; }
    tr.grand td.total { background: #f7cd4f; }
    thead { display: table-header-group; }
    tr { page-break-inside: avoid; }
    .chart img { width: 100%; max-height: 150mm; object-fit: contain; }
</style></head><body>
<h1>CYLINDER HEAD LEAK REJECTION REPORT</h1>
<div class="meta">${cylinderHeadEsc(cylinderHeadFilterText())}<br>Printed on ${cylinderHeadEsc(new Date().toLocaleString())} · first attempt per barcode at SA-30E · Rej% = NOK / Consumption</div>
<div class="cards">${cards}</div>
${body}
</body></html>`;

    const win = window.open('', '_blank');
    if (!win) {
        alert('Allow pop-ups for this site to export the PDF.');
        return;
    }
    win.document.open();
    win.document.write(html);
    win.document.close();

    const printNow = () => {
        // A wide date range would be cut off at the page edge: scale the table down to the printable width
        // (A4 landscape minus margins = 281 mm, about 1060 px).
        win.document.querySelectorAll('table.pivot').forEach(table => {
            if (table.scrollWidth > 1060) table.style.zoom = String(1060 / table.scrollWidth);
        });
        win.onafterprint = () => win.close();
        win.focus();
        win.print();
    };
    if (win.document.readyState === 'complete') setTimeout(printNow, 100);
    else win.addEventListener('load', printNow);
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

// Cell dropdown: the known cells in display order plus any other cell found in the loaded data; keeps the selection.
function cylinderHeadFillCellOptions() {
    const select = document.getElementById('cylinderHeadCell');
    if (!select) return;
    const current = select.value || 'ALL';
    const found = new Set((cylinderHeadAllData || []).map(r => r.cell || 'Unknown'));
    const cells = [...CYLINDER_HEAD_CELL_ORDER, ...Array.from(found).filter(c => !CYLINDER_HEAD_CELL_ORDER.includes(c)).sort()];
    select.innerHTML = '<option value="ALL">All</option>' + cells.map(c => `<option value="${cylinderHeadEsc(c)}">${cylinderHeadEsc(c)}</option>`).join('');
    select.value = cells.includes(current) ? current : 'ALL';
}

// Filters the loaded rows by the Cell dropdown and redraws the cards, the Summary table and the Cellwise rej trend chart
// (no reload: the API rows already carry the cell). Excel / PDF export the filtered rows too.
function applyCylinderHeadCellFilter() {
    const cell = document.getElementById('cylinderHeadCell')?.value || 'ALL';
    cylinderHeadData = cell === 'ALL'
        ? (cylinderHeadAllData || [])
        : (cylinderHeadAllData || []).filter(r => (r.cell || 'Unknown') === cell);
    renderCylinderHeadCards();
    renderCylinderHeadPivotTable();
    renderCylinderHeadTrendChart();
}

function clearCylinderHeadFilters() {
    const plantSelect = document.getElementById('cylinderHeadPlant');
    const lineSelect = document.getElementById('cylinderHeadLine');
    const shiftSelect = document.getElementById('cylinderHeadShift');
    const cellSelect = document.getElementById('cylinderHeadCell');
    if (plantSelect) plantSelect.value = 'ALL';
    if (lineSelect) lineSelect.value = 'ALL';
    if (shiftSelect) shiftSelect.value = 'ALL';
    if (cellSelect) cellSelect.value = 'ALL';

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
    cylinderHeadFillCellOptions();
    renderCylinderHeadPivotTable();
});

