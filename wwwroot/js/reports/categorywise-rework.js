// --- CATEGORYWISE REWORK REPORT (Leak / PDI / Testing) ---
// Backed by dbo.usp_GetCategorywiseReworkReport, which returns row-level defects for all three
// stations for the chosen date-time range. Every quantity is DISTINCTCOUNT(engineNumber),
// matching the Power BI measure, so cells, row/column totals and pareto bars are Set sizes - never
// sums of cells. Like QHold/Cylinder Head, the filters (line, dates, dropdowns) only take effect
// when a station button (Leak / PDI / Testing) is clicked; Rows/Columns/Pareto toggles are view-only.

let cwrData = [];
let cwrLine = 'EA01';              // line of the currently loaded data
let cwrApplied = {};               // dropdown filter values snapshotted at the last station click
let cwrStation = 'Leak';
let cwrRows = 'defect-category';   // 'defect-category' | 'defect' | 'category'
let cwrCols = 'shift';             // 'shift' | 'day'
let cwrParetoBy = 'description';   // 'description' | 'category'
let cwrTop = 20;                   // 0 = all
let cwrChart = null;
let cwrMatrix = null;              // last rendered matrix, reused by the Excel export
let cwrParetoItems = [];
let cwrInitialLoadDone = false;
let cwrFetchSeq = 0;               // only the latest request may apply its data (line switch mid-load)

const CWR_FILTERS = [
    { id: 'cwrShift', key: 'shift' },
    { id: 'cwrModel', key: 'modelCode' },
    { id: 'cwrDefect', key: 'description' },
    { id: 'cwrCategory', key: 'category' },
    { id: 'cwrCorrection', key: 'correction' }
];

const CWR_STATION_LABELS = {
    EA01: { Leak: 'Leak (ML-47)', PDI: 'PDI (PDI1)', Testing: 'Testing (Test Beds 1-7)' },
    EA02: { Leak: 'Leak (ML-47)', PDI: 'PDI (ML-52)', Testing: 'Testing (Test Beds 1-7)' }
};

function cwrStationLabel() {
    return CWR_STATION_LABELS[cwrLine][cwrStation];
}

function cwrEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function cwrDayKey(value) {
    return value ? String(value).slice(0, 10) : '';
}

// '2024-06-21' -> '21.6.24' (same label style as the Power BI matrix)
function cwrDayLabel(dayKey) {
    const [y, m, d] = dayKey.split('-');
    return y ? `${parseInt(d, 10)}.${parseInt(m, 10)}.${y.slice(2)}` : dayKey;
}

// Current production day, 00:15 -> next day 00:15 (same default as QHold / Cylinder Head).

function cwrDistinctEngines(rows) {
    return new Set(rows.map(r => r.engineNumber ?? '')).size;
}

function loadCwrDefaultView() {
    if (cwrInitialLoadDone) return;
    cwrInitialLoadDone = true;
    fetchCwrReport();
}

async function fetchCwrReport() {
    const start = document.getElementById('cwrStart')?.value || '';
    const end = document.getElementById('cwrEnd')?.value || '';
    if (!start || !end) {
        alert('Please select From and To date/time.');
        return;
    }
    if (start >= end) {
        alert('From must be before To.');
        return;
    }

    const line = document.getElementById('cwrLine')?.value || 'EA01';
    cwrApplied = cwrFilterValues();
    const stationButtons = document.querySelectorAll('#cwrStations .cwr-station-btn');
    const loading = document.getElementById('cwrLoading');
    stationButtons.forEach(b => { b.disabled = true; });
    if (loading) loading.hidden = false;

    const seq = ++cwrFetchSeq;
    let data = [];
    try {
        const params = new URLSearchParams({ line, startDate: start, endDate: end });
        const res = await fetch(`/api/reports/categorywise-rework/data?${params.toString()}`);
        if (seq !== cwrFetchSeq) return;
        if (res.ok) {
            data = await res.json();
        } else {
            alert('Failed to load Categorywise Rework report data.');
        }
    } catch (err) {
        if (seq !== cwrFetchSeq) return;
        console.error('Error fetching Categorywise Rework report', err);
        alert('Error connecting to server');
    }
    if (seq !== cwrFetchSeq) return;

    cwrData = data;
    cwrLine = line;
    stationButtons.forEach(b => { b.disabled = false; });
    if (loading) loading.hidden = true;
    renderCwr(true);
}

function cwrFilterValues() {
    const values = {};
    CWR_FILTERS.forEach(f => {
        const el = document.getElementById(f.id);
        values[f.key] = el && el.value !== 'ALL' ? el.value : '';
    });
    values.engine = (document.getElementById('cwrEngine')?.value || '').trim().toUpperCase();
    return values;
}

// skipKey lets a dropdown compute its own options from rows matching every *other* filter, so
// the dropdowns cascade without ever filtering themselves down to their current selection.
function cwrRowMatches(row, filters, skipKey, ignoreStation) {
    if (!ignoreStation && row.station !== cwrStation) return false;
    for (const f of CWR_FILTERS) {
        if (f.key === skipKey || !filters[f.key]) continue;
        if ((row[f.key] ?? '') !== filters[f.key]) return false;
    }
    if (skipKey !== 'engine' && filters.engine && !(row.engineNumber || '').toUpperCase().includes(filters.engine)) return false;
    return true;
}

// repopulate: rebuild the dropdown options from freshly loaded data. View toggles pass false so
// they never overwrite dropdown selections the user hasn't applied yet.
function renderCwr(repopulate = false) {
    const filters = cwrApplied;
    const rows = cwrData.filter(r => cwrRowMatches(r, filters));

    if (repopulate) populateCwrFilters(filters);
    renderCwrStationBadges(filters);
    renderCwrHeaderText();
    renderCwrMatrix(rows);
    renderCwrPareto(rows);
}

function populateCwrFilters(filters) {
    CWR_FILTERS.forEach(f => {
        const select = document.getElementById(f.id);
        if (!select) return;

        const labels = new Map();
        cwrData.forEach(r => {
            if (!cwrRowMatches(r, filters, f.key)) return;
            const v = (r[f.key] ?? '').toString();
            if (!v || labels.has(v)) return;
            labels.set(v, f.key === 'modelCode' && r.modelCodeDescription ? `${v} - ${r.modelCodeDescription}` : v);
        });
        // Keep the current selection listed even if the other filters leave it with no rows.
        const current = filters[f.key];
        if (current && !labels.has(current)) labels.set(current, current);

        const values = [...labels.keys()].sort((a, b) => a.localeCompare(b));
        select.innerHTML = '<option value="ALL">All</option>' +
            values.map(v => `<option value="${cwrEsc(v)}">${cwrEsc(labels.get(v))}</option>`).join('');
        select.value = current || 'ALL';
        select.closest('.cwr-field')?.classList.toggle('is-filtered', !!current);
    });

    const engineList = document.getElementById('cwrEngineList');
    if (engineList) {
        const engines = [...new Set(cwrData.filter(r => cwrRowMatches(r, filters, 'engine')).map(r => r.engineNumber).filter(Boolean))].sort();
        engineList.innerHTML = engines.slice(0, 500).map(e => `<option value="${cwrEsc(e)}"></option>`).join('');
    }
    document.getElementById('cwrEngine')?.closest('.cwr-field')?.classList.toggle('is-filtered', !!filters.engine);
}

function renderCwrStationBadges(filters) {
    const scoped = cwrData.filter(r => cwrRowMatches(r, filters, null, true));
    document.querySelectorAll('#cwrStations [data-badge]').forEach(badge => {
        const station = badge.dataset.badge;
        badge.textContent = cwrDistinctEngines(scoped.filter(r => r.station === station));
    });
    document.querySelectorAll('#cwrStations .cwr-station-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.station === cwrStation);
    });
}

function renderCwrHeaderText() {
    const title = document.getElementById('cwrTitle');
    if (title) title.textContent = `${cwrLine} Categorywise Rework Report`;

    const rowsLabel = { 'defect-category': 'Defect vs Category', defect: 'Defect wise', category: 'Category wise' }[cwrRows];
    const matrixTitle = document.getElementById('cwrMatrixTitle');
    if (matrixTitle) {
        matrixTitle.innerHTML = `NOK Qty - ${rowsLabel}<small>${cwrCols === 'shift' ? 'Day &amp; shiftwise' : 'Daywise'}</small>`;
    }
    const paretoTitle = document.getElementById('cwrParetoTitle');
    if (paretoTitle) {
        paretoTitle.innerHTML = `Rejection Pareto - ${cwrParetoBy === 'category' ? 'Category wise' : 'Defect wise'}<small>% of NOK engines · click a bar to filter</small>`;
    }
}

function cwrTopBy(rows, key) {
    const groups = new Map();
    rows.forEach(r => {
        const name = r[key] || '(Blank)';
        if (!groups.has(name)) groups.set(name, new Set());
        groups.get(name).add(r.engineNumber ?? '');
    });
    return [...groups.entries()]
        .map(([name, engines]) => ({ name, qty: engines.size }))
        .sort((a, b) => b.qty - a.qty || a.name.localeCompare(b.name));
}

function buildCwrMatrix(rows) {
    const colKey = r => cwrCols === 'shift' ? `${cwrDayKey(r.productionDate)}|${r.shift || ''}` : cwrDayKey(r.productionDate);
    const groupField = cwrRows === 'category' ? 'category' : 'description';
    const add = (cells, key, engine) => {
        if (!cells.has(key)) cells.set(key, new Set());
        cells.get(key).add(engine);
    };

    const columns = new Map();
    const groups = new Map();
    const colTotals = new Map();
    const allEngines = new Set();

    rows.forEach(r => {
        const engine = r.engineNumber ?? '';
        const key = colKey(r);
        if (!columns.has(key)) {
            columns.set(key, { key, day: cwrDayKey(r.productionDate), shift: cwrCols === 'shift' ? (r.shift || '') : '' });
        }

        const groupName = r[groupField] || '(Blank)';
        if (!groups.has(groupName)) groups.set(groupName, { name: groupName, engines: new Set(), cells: new Map(), subs: new Map() });
        const group = groups.get(groupName);
        group.engines.add(engine);
        add(group.cells, key, engine);

        if (cwrRows === 'defect-category') {
            const subName = r.category || '(Blank)';
            if (!group.subs.has(subName)) group.subs.set(subName, { name: subName, engines: new Set(), cells: new Map() });
            const sub = group.subs.get(subName);
            sub.engines.add(engine);
            add(sub.cells, key, engine);
        }

        add(colTotals, key, engine);
        allEngines.add(engine);
    });

    const byQty = (a, b) => b.engines.size - a.engines.size || a.name.localeCompare(b.name);
    const groupList = [...groups.values()].sort(byQty);
    let max = 0;
    groupList.forEach(g => {
        g.subList = [...g.subs.values()].sort(byQty);
        (cwrRows === 'defect-category' ? g.subList : [g]).forEach(leaf => {
            leaf.cells.forEach(set => { if (set.size > max) max = set.size; });
        });
    });

    return {
        columns: [...columns.values()].sort((a, b) => a.day.localeCompare(b.day) || a.shift.localeCompare(b.shift)),
        groups: groupList,
        colTotals,
        total: allEngines.size,
        max
    };
}

function renderCwrMatrix(rows) {
    const table = document.getElementById('cwrTable');
    const empty = document.getElementById('cwrEmpty');
    if (!table || !empty) return;

    const m = buildCwrMatrix(rows);
    cwrMatrix = m;

    if (m.groups.length === 0) {
        table.innerHTML = '';
        table.hidden = true;
        empty.hidden = false;
        return;
    }
    table.hidden = false;
    empty.hidden = true;

    const combined = cwrRows === 'defect-category';
    const byShift = cwrCols === 'shift';
    table.classList.toggle('cwr-single', !combined);

    // Day header spans: consecutive columns sharing a production date.
    const days = [];
    m.columns.forEach(c => {
        const last = days[days.length - 1];
        if (last && last.day === c.day) last.span++;
        else days.push({ day: c.day, span: 1 });
    });
    const dayStart = new Set(days.map(d => m.columns.find(c => c.day === d.day).key));

    const firstLabel = cwrRows === 'category' ? 'Category' : 'Defect';
    const hdrSpan = byShift ? ' rowspan="2"' : '';
    let head = `<tr><th class="cwr-sticky-1"${hdrSpan}>${firstLabel}</th>` +
        (combined ? `<th class="cwr-sticky-2"${hdrSpan}>Category</th>` : '') +
        days.map(d => `<th class="cwr-date" colspan="${d.span}">${cwrDayLabel(d.day)}</th>`).join('') +
        `<th class="cwr-total"${hdrSpan}>Overall Qty</th></tr>`;
    if (byShift) {
        head += '<tr>' + m.columns.map(c => `<th class="${dayStart.has(c.key) ? 'cwr-date' : ''}">${cwrEsc(c.shift)}</th>`).join('') + '</tr>';
    }

    const cellHtml = (cells) => m.columns.map(c => {
        const qty = cells.get(c.key)?.size || 0;
        const cls = `cwr-num${dayStart.has(c.key) ? ' cwr-day-start' : ''}`;
        if (!qty) return `<td class="${cls}"></td>`;
        const alpha = (0.12 + 0.5 * (qty / (m.max || 1))).toFixed(2);
        return `<td class="${cls}" style="background: rgba(var(--cwr-heat), ${alpha});">${qty}</td>`;
    }).join('');

    let body = '';
    m.groups.forEach((g, gi) => {
        const alt = gi % 2 === 1 ? ' class="cwr-alt"' : '';
        if (combined) {
            g.subList.forEach((s, si) => {
                body += `<tr${alt}>` +
                    (si === 0 ? `<td class="cwr-sticky-1 cwr-group" rowspan="${g.subList.length}">${cwrEsc(g.name)}</td>` : '') +
                    `<td class="cwr-sticky-2">${cwrEsc(s.name)}</td>` +
                    cellHtml(s.cells) +
                    `<td class="cwr-total">${s.engines.size}</td></tr>`;
            });
        } else {
            body += `<tr${alt}><td class="cwr-sticky-1">${cwrEsc(g.name)}</td>` + cellHtml(g.cells) + `<td class="cwr-total">${g.engines.size}</td></tr>`;
        }
    });

    const foot = `<tr><td class="cwr-sticky-1"${combined ? ' colspan="2"' : ''}>Total</td>` +
        m.columns.map(c => `<td class="cwr-num${dayStart.has(c.key) ? ' cwr-day-start' : ''}">${m.colTotals.get(c.key)?.size || ''}</td>`).join('') +
        `<td class="cwr-total">${m.total}</td></tr>`;

    table.innerHTML = `<thead>${head}</thead><tbody>${body}</tbody><tfoot>${foot}</tfoot>`;

    // Second header row sticks directly under the first, whatever its rendered height.
    if (byShift) {
        const firstRowHeight = table.tHead.rows[0].offsetHeight;
        table.tHead.rows[1].querySelectorAll('th').forEach(th => { th.style.top = `${firstRowHeight}px`; });
    }
}

// Splits a long axis label into lines of ~14 chars so pareto bars can stay narrow.
function cwrWrapLabel(text, width = 12) {
    const lines = [];
    let line = '';
    String(text).split(/\s+/).forEach(word => {
        if (line && (line + ' ' + word).length > width) {
            lines.push(line);
            line = word;
        } else {
            line = line ? `${line} ${word}` : word;
        }
    });
    if (line) lines.push(line);
    return lines.slice(0, 4);
}

function renderCwrPareto(rows) {
    const canvas = document.getElementById('cwrParetoChart');
    const box = document.getElementById('cwrParetoBox');
    if (!canvas || !box || typeof Chart === 'undefined') return;

    const total = cwrDistinctEngines(rows);
    const all = cwrTopBy(rows, cwrParetoBy);
    const items = cwrTop > 0 ? all.slice(0, cwrTop) : all;
    cwrParetoItems = all.map(i => ({ ...i, pct: total > 0 ? (i.qty / total) * 100 : 0 }));

    box.style.minWidth = `${Math.max(items.length * 82, 300)}px`;
    if (cwrChart) {
        cwrChart.destroy();
        cwrChart = null;
    }

    const isLight = document.body.classList.contains('light-mode');
    const textColor = isLight ? '#1d1d1f' : '#e5e5e5';
    const mutedColor = isLight ? '#6b6b70' : '#9ca3af';
    const gridColor = isLight ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.06)';
    const pctColor = isLight ? '#15803d' : '#4ade80';

    // Count + share-of-NOK-engines labels above each bar (inline stand-in for chartjs-plugin-datalabels).
    const labelPlugin = {
        id: 'cwrParetoLabels',
        afterDatasetsDraw(chart) {
            const { ctx } = chart;
            const meta = chart.getDatasetMeta(0);
            ctx.save();
            ctx.textAlign = 'center';
            meta.data.forEach((bar, i) => {
                const item = items[i];
                if (!item) return;
                ctx.fillStyle = textColor;
                ctx.font = '700 12px Inter, sans-serif';
                ctx.fillText(item.qty, bar.x, bar.y - 20);
                ctx.fillStyle = pctColor;
                ctx.font = '600 11px Inter, sans-serif';
                ctx.fillText(`${(total > 0 ? (item.qty / total) * 100 : 0).toFixed(2)}%`, bar.x, bar.y - 6);
            });
            ctx.restore();
        }
    };

    cwrChart = new Chart(canvas.getContext('2d'), {
        type: 'bar',
        data: {
            labels: items.map(i => cwrWrapLabel(i.name)),
            datasets: [{
                data: items.map(i => i.qty),
                backgroundColor: items.map(i => {
                    const selected = cwrApplied[cwrParetoBy];
                    return selected && selected !== i.name ? 'rgba(66,165,255,0.35)' : '#42a5ff';
                }),
                hoverBackgroundColor: '#f5b301',
                borderRadius: 4,
                maxBarThickness: 48
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: { duration: 250 },
            layout: { padding: { top: 34 } },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        title: ctx => items[ctx[0].dataIndex]?.name || '',
                        label: ctx => ` ${ctx.parsed.y} NOK engines (${(total > 0 ? (ctx.parsed.y / total) * 100 : 0).toFixed(2)}%)`
                    }
                }
            },
            scales: {
                x: { ticks: { color: mutedColor, font: { size: 11 }, autoSkip: false, maxRotation: 0 }, grid: { display: false } },
                y: { beginAtZero: true, ticks: { color: mutedColor, precision: 0 }, grid: { color: gridColor } }
            },
            onClick: (evt, elements) => {
                if (!elements.length) return;
                const item = items[elements[0].index];
                const select = document.getElementById(cwrParetoBy === 'category' ? 'cwrCategory' : 'cwrDefect');
                if (!item || !select) return;
                // A bar click is an explicit apply of that one filter, on the data already loaded.
                const next = cwrApplied[cwrParetoBy] === item.name ? '' : item.name;
                cwrApplied = { ...cwrApplied, [cwrParetoBy]: next };
                select.value = next || 'ALL';
                renderCwr(true);
            },
            onHover: (evt, elements) => {
                evt.native.target.style.cursor = elements.length ? 'pointer' : 'default';
            }
        },
        plugins: [labelPlugin]
    });
}

function cwrSetSegActive(segId, value) {
    document.querySelectorAll(`#${segId} button`).forEach(b => b.classList.toggle('active', b.dataset.value === String(value)));
}

// Station buttons are the "search" action (like QHold's Overall/Distinct/Duplicate): they apply the
// current line, date-time range and dropdowns, then show that station.
function setCwrStation(station) {
    cwrStation = station;
    fetchCwrReport();
}

// Value filters (defect, category, correction, model, engine) are line-specific, so they reset
// when the line changes; the new line loads on the next station click.
function setCwrLine() {
    CWR_FILTERS.forEach(f => {
        const el = document.getElementById(f.id);
        if (el && f.key !== 'shift') el.value = 'ALL';
    });
    const engine = document.getElementById('cwrEngine');
    if (engine) engine.value = '';
}

function setCwrRows(mode) {
    cwrRows = mode;
    cwrSetSegActive('cwrRowsSeg', mode);
    renderCwr();
}

function setCwrCols(mode) {
    cwrCols = mode;
    cwrSetSegActive('cwrColsSeg', mode);
    renderCwr();
}

function setCwrParetoBy(mode) {
    cwrParetoBy = mode;
    cwrSetSegActive('cwrParetoSeg', mode);
    renderCwr();
}

function setCwrTop(top) {
    cwrTop = top;
    cwrSetSegActive('cwrTopSeg', top);
    renderCwr();
}

function clearCwrFilters() {
    CWR_FILTERS.forEach(f => {
        const el = document.getElementById(f.id);
        if (el) el.value = 'ALL';
    });
    const engine = document.getElementById('cwrEngine');
    if (engine) engine.value = '';

    const { start, end } = currentProductionDayRange();
    const startInput = document.getElementById('cwrStart');
    const endInput = document.getElementById('cwrEnd');
    if (startInput && startInput._flatpickr) startInput._flatpickr.setDate(start);
    if (endInput && endInput._flatpickr) endInput._flatpickr.setDate(end);

    fetchCwrReport();
}

async function exportCwrToExcel() {
    if (!cwrMatrix || cwrMatrix.groups.length === 0) {
        alert('No data to export');
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        const border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        const gold = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7CD4F' } };
        const filters = cwrApplied;
        const filterText = [
            `Line: ${cwrLine}`,
            `Station: ${cwrStationLabel()}`,
            `From: ${document.getElementById('cwrStart')?.value || ''}`,
            `To: ${document.getElementById('cwrEnd')?.value || ''}`,
            ...CWR_FILTERS.filter(f => filters[f.key]).map(f => `${f.key}: ${filters[f.key]}`),
            ...(filters.engine ? [`engine: ${filters.engine}`] : [])
        ].join('   |   ');

        const addTitle = (sheet, title, lastCol) => {
            sheet.mergeCells(1, 1, 1, Math.max(lastCol, 4));
            sheet.getCell(1, 1).value = title;
            sheet.getCell(1, 1).font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFD71920' } };
            sheet.mergeCells(2, 1, 2, Math.max(lastCol, 4));
            sheet.getCell(2, 1).value = filterText;
            sheet.getCell(2, 1).font = { italic: true, size: 10 };
            sheet.getCell(3, 1).value = `Exported On: ${new Date().toLocaleString()} · NOK qty = distinct engine numbers`;
            sheet.getCell(3, 1).font = { size: 10 };
        };
        const styleHeader = cell => {
            cell.font = { bold: true };
            cell.fill = gold;
            cell.border = border;
            cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        };

        // Sheet 1: the matrix exactly as currently shown.
        const m = cwrMatrix;
        const combined = cwrRows === 'defect-category';
        const byShift = cwrCols === 'shift';
        const lead = combined ? 2 : 1;
        const lastCol = lead + m.columns.length + 1;
        const matrixSheet = workbook.addWorksheet('Matrix');
        addTitle(matrixSheet, `${cwrLine} CATEGORYWISE REWORK REPORT - ${cwrStationLabel().toUpperCase()}`, lastCol);

        const h1 = matrixSheet.getRow(5);
        const h2 = matrixSheet.getRow(6);
        h1.getCell(1).value = cwrRows === 'category' ? 'Category' : 'Defect';
        if (combined) h1.getCell(2).value = 'Category';
        m.columns.forEach((c, i) => {
            h1.getCell(lead + 1 + i).value = cwrDayLabel(c.day);
            h2.getCell(lead + 1 + i).value = byShift ? c.shift : '';
        });
        h1.getCell(lastCol).value = 'Overall Qty';
        for (let col = 1; col <= lastCol; col++) {
            styleHeader(h1.getCell(col));
            styleHeader(h2.getCell(col));
        }

        let r = 7;
        const writeRow = (labels, cells, total) => {
            const row = matrixSheet.getRow(r++);
            labels.forEach((l, i) => { row.getCell(i + 1).value = l; });
            m.columns.forEach((c, i) => { row.getCell(lead + 1 + i).value = cells.get(c.key)?.size || null; });
            row.getCell(lastCol).value = total;
            for (let col = 1; col <= lastCol; col++) row.getCell(col).border = border;
            row.getCell(lastCol).font = { bold: true };
        };
        m.groups.forEach(g => {
            if (combined) g.subList.forEach((s, si) => writeRow([si === 0 ? g.name : '', s.name], s.cells, s.engines.size));
            else writeRow([g.name], g.cells, g.engines.size);
        });
        const totalRow = matrixSheet.getRow(r);
        totalRow.getCell(1).value = 'Total';
        m.columns.forEach((c, i) => { totalRow.getCell(lead + 1 + i).value = m.colTotals.get(c.key)?.size || null; });
        totalRow.getCell(lastCol).value = m.total;
        for (let col = 1; col <= lastCol; col++) styleHeader(totalRow.getCell(col));

        matrixSheet.getColumn(1).width = 34;
        if (combined) matrixSheet.getColumn(2).width = 18;
        for (let col = lead + 1; col < lastCol; col++) matrixSheet.getColumn(col).width = 7;
        matrixSheet.getColumn(lastCol).width = 13;
        matrixSheet.views = [{ state: 'frozen', xSplit: lead, ySplit: 6 }];

        // Sheet 2: pareto (full list, not just the Top-N shown on screen).
        const paretoSheet = workbook.addWorksheet('Pareto');
        addTitle(paretoSheet, `REJECTION PARETO - ${cwrParetoBy === 'category' ? 'CATEGORY WISE' : 'DEFECT WISE'}`, 4);
        ['Rank', cwrParetoBy === 'category' ? 'Category' : 'Defect', 'NOK Engines', '% of NOK Engines'].forEach((h, i) => {
            const cell = paretoSheet.getRow(5).getCell(i + 1);
            cell.value = h;
            styleHeader(cell);
        });
        cwrParetoItems.forEach((item, i) => {
            const row = paretoSheet.getRow(6 + i);
            [i + 1, item.name, item.qty, Number(item.pct.toFixed(2))].forEach((v, ci) => {
                row.getCell(ci + 1).value = v;
                row.getCell(ci + 1).border = border;
            });
        });
        [8, 40, 14, 18].forEach((w, i) => { paretoSheet.getColumn(i + 1).width = w; });

        // Sheet 3: filtered raw rows behind both views.
        const dataSheet = workbook.addWorksheet('Data');
        addTitle(dataSheet, 'REWORK DETAIL', 10);
        const dataHeaders = ['Station', 'Production Date', 'Shift', 'Date Time', 'Engine Number', 'Rejected Station', 'Model Code', 'Model', 'Defect', 'Category', 'Correction'];
        dataHeaders.forEach((h, i) => {
            const cell = dataSheet.getRow(5).getCell(i + 1);
            cell.value = h;
            styleHeader(cell);
        });
        cwrData.filter(row => cwrRowMatches(row, filters)).forEach((row, i) => {
            const excelRow = dataSheet.getRow(6 + i);
            [row.station, cwrDayKey(row.productionDate), row.shift, row.dateTime ? String(row.dateTime).replace('T', ' ').slice(0, 19) : '',
                row.engineNumber, row.rejectedStation, row.modelCode, row.modelCodeDescription, row.description, row.category, row.correction]
                .forEach((v, ci) => {
                    excelRow.getCell(ci + 1).value = v ?? '';
                    excelRow.getCell(ci + 1).border = border;
                });
        });
        [10, 14, 7, 20, 18, 15, 11, 16, 40, 16, 36].forEach((w, i) => { dataSheet.getColumn(i + 1).width = w; });

        await downloadWorkbook(workbook, `Categorywise_Rework_${cwrLine}_${cwrStation}_${new Date().getTime()}.xlsx`);
    } catch (err) {
        console.error('Error generating excel:', err);
        alert('Error generating Excel file');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const { start, end } = currentProductionDayRange();
    const startInput = document.getElementById('cwrStart');
    const endInput = document.getElementById('cwrEnd');
    if (!startInput || !endInput) return;

    // Same picker setup as QHold / Cylinder Head.
    if (typeof flatpickr !== 'undefined') {
        const config = {
            enableTime: true,
            dateFormat: "Y-m-d\\TH:i",
            altInput: true,
            altFormat: "d M Y, h:i K",
            time_24hr: false,
            theme: "dark"
        };
        flatpickr(startInput, { ...config, defaultDate: start });
        flatpickr(endInput, { ...config, defaultDate: end });
    }
});

