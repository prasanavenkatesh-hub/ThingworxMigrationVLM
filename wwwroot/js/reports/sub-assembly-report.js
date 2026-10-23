// --- STRAIGHTPASS & REWORK SUB ASSEMBLY REPORT (EA2) ---
// Port of the "StraightPass & Rework subassemblyReport" Power BI file (14 sub-assembly pages + the
// Crankshaft OP-60 page). GET /api/reports/sub-assembly/data -> dbo.usp_GetSubAssemblyReport, which
// returns per production day / shift / station:
//   assy         - each part's latest result per status   -> Straight Pass table rows
//   straightPass - each part's first attempt              -> Straight Pass % / Rejection %
//   bypassed     - barcode 'BYPASSED' rows                -> Bypassed table
//   rework       - Rework_DB entries                      -> Rework table, Rework OK % / NOK %
// From / To are applied with Apply (or by picking a sub-assembly); Shift / Station / Cell filter the
// loaded rows in the browser. Station is single-select, as in Power BI.

// panels: which Power BI panels the page has. extraRow: the 4th Straight Pass row (IC = Incomplete
// Cycle on the SA_PTL stations, NA = Not Accepted on Crankcase). reworkByStation: rework rows carry
// the page's station numbers (Crankcase rework is all 'CC-REWORK', so it isn't filtered by station).
const SAR_SUB_ASSEMBLIES = [
    { id: 'BALANCER_SHAFT', label: 'Balancer Shaft', panels: ['sp', 'rework', 'bypass'], extraRow: 'IC' },
    { id: 'CRANKSHAFT_PISTON_BARREL', label: 'Crankshaft Piston Barrel', panels: ['sp', 'rework', 'bypass'], extraRow: 'IC' },
    { id: 'GEAR_TRAIN', label: 'Gear Train', panels: ['sp'] },
    { id: 'GEAR_SHIFT_SHAFT', label: 'Gear Shift Shaft', panels: ['sp'], extraRow: 'IC' },
    { id: 'EFI', label: 'EFI', panels: ['sp'], extraRow: 'IC' },
    { id: 'CAM_LADDER', label: 'Cam Ladder', panels: ['sp', 'rework', 'bypass'], extraRow: 'IC' },
    { id: 'CYLINDER_HEAD', label: 'Cylinder Head', panels: ['sp', 'rework', 'bypass'], extraRow: 'IC' },
    { id: 'CRANKCASE', label: 'Crankcase', panels: ['sp', 'rework'], extraRow: 'NA', reworkByStation: false },
    { id: 'CRANKCASE_RH_LGA', label: 'Crankcase RH LGA', panels: ['sp', 'rework', 'bypass'], extraRow: 'IC' },
    { id: 'MAGNETO_COVER', label: 'Magneto Cover', panels: ['sp', 'rework', 'bypass'], extraRow: 'IC' },
    { id: 'ROTOR', label: 'Rotor', panels: ['sp', 'rework', 'bypass'], extraRow: 'IC' },
    { id: 'ENGINE_TESTBED', label: 'Engine Testbed', title: 'Engine Test Bed Report', panels: ['sp', 'rework'] },
    { id: 'CLUTCH_COVER', label: 'Clutch Cover', panels: ['sp', 'rework', 'bypass'], extraRow: 'IC' },
    { id: 'CRANKSHAFT', label: 'Crankshaft', panels: ['sp', 'bypass'], subGroupLabel: 'Cell' },
    // Separate page (not in the sub-assembly menu) - opened from the Crankshaft page.
    { id: 'CRANKSHAFT_OP60', label: 'Crankshaft OP-60', title: 'Crankshaft OP-60 Report', panels: ['sp', 'bypass'], subGroupLabel: 'DIPV_10 Status', hidden: true }
];

let sarSubAssembly = 'BALANCER_SHAFT';
let sarData = null;          // last API response
let sarStation = '';
let sarShift = '';
let sarSubGroup = '';
let sarInitialLoadDone = false;
let sarFetchSeq = 0;
let sarLoading = false;      // true while a load runs - filter changes must not redraw the previous range's rows

function sarEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function sarConfig() {
    return SAR_SUB_ASSEMBLIES.find(s => s.id === sarSubAssembly) || SAR_SUB_ASSEMBLIES[0];
}

function sarTitle(cfg) {
    return `EA2 ${cfg.title || `${cfg.label} Sub Assembly Report`}`;
}

// "2024-02-01T00:00:00" -> "1.2.24" (Power BI's column header format)
function sarDateLabel(iso) {
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return `${Number(d)}.${Number(m)}.${y.slice(2)}`;
}

function sarPct(part, whole) {
    return whole ? `${(part / whole * 100).toFixed(2)}%` : '--';
}

function loadSarDefaultView() {
    if (sarInitialLoadDone) return;
    sarInitialLoadDone = true;
    renderSarMenu();
    fetchSarReport();
}

function renderSarMenu() {
    const menu = document.getElementById('sarMenu');
    if (!menu) return;
    menu.innerHTML = SAR_SUB_ASSEMBLIES.filter(s => !s.hidden).map(s =>
        `<button class="sar-menu-btn${s.id === sarSubAssembly ? ' active' : ''}" onclick="selectSarSubAssembly('${s.id}')">${sarEsc(s.label)}</button>`).join('');
}

function toggleSarMenu(force) {
    const menu = document.getElementById('sarMenu');
    if (!menu) return;
    menu.hidden = force === undefined ? !menu.hidden : !force;
}

function selectSarSubAssembly(id) {
    toggleSarMenu(false);
    if (id !== sarSubAssembly) {
        sarSubAssembly = id;
        sarStation = '';
        sarSubGroup = '';
        sarData = null;
    }
    renderSarMenu();
    fetchSarReport();
}

async function fetchSarReport() {
    const start = document.getElementById('sarStart')?.value || '';
    const end = document.getElementById('sarEnd')?.value || '';
    if (!start || !end) { alert('Please select From and To date/time.'); return; }
    if (start >= end) { alert('From must be before To.'); return; }

    const cfg = sarConfig();
    const seq = ++sarFetchSeq;
    const loading = document.getElementById('sarLoading');
    const apply = document.getElementById('sarApply');
    sarLoading = true;
    if (loading) loading.hidden = false;
    if (apply) apply.disabled = true;
    renderSarHeader();
    sarClearPanels();

    let data = null;
    try {
        const params = new URLSearchParams({ subAssembly: cfg.id, startDate: start, endDate: end });
        const res = await fetch(`/api/reports/sub-assembly/data?${params.toString()}`);
        if (seq !== sarFetchSeq) return;
        if (res.ok) data = await res.json();
        else alert(`Failed to load Sub Assembly report: ${(await res.text()).slice(0, 200)}`);
    } catch (err) {
        if (seq !== sarFetchSeq) return;
        console.error('Error fetching Sub Assembly report', err);
        alert('Error connecting to server');
    }
    if (seq !== sarFetchSeq) return;

    sarData = data || { assy: [], straightPass: [], bypassed: [], rework: [] };
    sarLoading = false;
    if (loading) loading.hidden = true;
    if (apply) apply.disabled = false;
    renderSar();
}

function renderSarHeader() {
    const cfg = sarConfig();
    const title = document.getElementById('sarTitle');
    if (title) title.textContent = sarTitle(cfg).toUpperCase();
    const op60 = document.getElementById('sarOp60Btn');
    if (op60) op60.hidden = cfg.id !== 'CRANKSHAFT';
    const back = document.getElementById('sarBackBtn');
    if (back) back.hidden = cfg.id !== 'CRANKSHAFT_OP60';
    const subField = document.getElementById('sarSubGroupField');
    if (subField) subField.hidden = !cfg.subGroupLabel;
    document.querySelectorAll('#tab-sub-assembly-report [data-sar-panel]').forEach(p => {
        p.hidden = !cfg.panels.includes(p.dataset.sarPanel);
    });
}

// While a load runs, don't leave the previous range's / sub-assembly's numbers on screen.
function sarClearPanels() {
    ['sarSpTable', 'sarRwTable', 'sarBpTable'].forEach(id => {
        const t = document.getElementById(id);
        if (t) { t.innerHTML = ''; t.hidden = true; }
    });
    ['sarSpEmpty', 'sarRwEmpty', 'sarBpEmpty'].forEach(id => {
        const e = document.getElementById(id);
        if (e) { e.hidden = false; e.textContent = 'Loading...'; }
    });
    const stationSel = document.getElementById('sarStation');
    if (stationSel && !sarData) stationSel.innerHTML = '<option value="">Loading...</option>';
    ['sarSpPct', 'sarRejPct', 'sarRwOkPct', 'sarRwNokPct'].forEach(id => {
        const e = document.getElementById(id);
        if (e) e.textContent = '--';
    });
}

function renderSar() {
    renderSarHeader();
    if (!sarData || sarLoading) return;
    renderSarFilters();
    renderSarStraightPass();
    renderSarRework();
    renderSarBypassed();
}

// Station and SubGroup options come from the loaded rows (all four sets).
function renderSarFilters() {
    const cfg = sarConfig();
    const all = [...sarData.assy, ...sarData.straightPass, ...sarData.bypassed];
    const sortNat = (a, b) => a.localeCompare(b, undefined, { numeric: true });
    const stations = [...new Set(all.map(r => r.station).filter(Boolean))].sort(sortNat);
    if (cfg.reworkByStation !== false) {
        sarData.rework.forEach(r => { if (r.station && !stations.includes(r.station)) stations.push(r.station); });
        stations.sort(sortNat);
    }
    // Default to the first station; keep a chosen station even if the new range has no rows for it.
    if (!sarStation) sarStation = stations[0] || '';
    else if (!stations.includes(sarStation)) stations.push(sarStation);
    stations.sort(sortNat);

    const stationSel = document.getElementById('sarStation');
    if (stationSel) {
        stationSel.innerHTML = stations.length
            ? stations.map(s => `<option value="${sarEsc(s)}"${s === sarStation ? ' selected' : ''}>${sarEsc(s)}</option>`).join('')
            : '<option value="">No data</option>';
    }
    const shiftSel = document.getElementById('sarShift');
    if (shiftSel) shiftSel.value = sarShift;

    const subField = document.getElementById('sarSubGroupField');
    const subSel = document.getElementById('sarSubGroup');
    if (subField && subSel) {
        subField.hidden = !cfg.subGroupLabel;
        if (cfg.subGroupLabel) {
            document.getElementById('sarSubGroupLabel').textContent = cfg.subGroupLabel;
            const groups = [...new Set(all.filter(r => r.station === sarStation).map(r => r.subGroup).filter(v => v !== null && v !== ''))]
                .map(String).sort(sortNat);
            if (sarSubGroup && !groups.includes(sarSubGroup)) groups.unshift(sarSubGroup);
            subSel.innerHTML = `<option value="">All</option>` +
                groups.map(g => `<option value="${sarEsc(g)}"${g === sarSubGroup ? ' selected' : ''}>${sarEsc(g)}</option>`).join('');
        }
    }
}

function setSarFilter(key, value) {
    if (key === 'station') { sarStation = value; sarSubGroup = ''; }
    else if (key === 'shift') sarShift = value;
    else if (key === 'subGroup') sarSubGroup = value;
    renderSar();
}

function sarMatches(row, useStation = true) {
    if (useStation && row.station !== sarStation) return false;
    if (sarShift && row.shift !== sarShift) return false;
    if (sarSubGroup && String(row.subGroup ?? '') !== sarSubGroup) return false;
    return true;
}

// Groups rows into date / shift columns (sorted) and sums each metric. totalOverrides replaces a
// metric's Total (distinct counts can't be summed across columns).
function sarPivot(rows, metrics, totalOverrides = {}) {
    const cols = new Map();
    rows.forEach(r => {
        const key = `${String(r.productionDate).slice(0, 10)}|${r.shift}`;
        if (!cols.has(key)) cols.set(key, { date: String(r.productionDate).slice(0, 10), shift: r.shift, values: {} });
        const col = cols.get(key);
        metrics.forEach(m => { col.values[m.key] = (col.values[m.key] || 0) + (r[m.key] || 0); });
    });
    const columns = [...cols.values()].sort((a, b) => a.date.localeCompare(b.date) || a.shift.localeCompare(b.shift));
    const totals = {};
    metrics.forEach(m => { totals[m.key] = columns.reduce((s, c) => s + (c.values[m.key] || 0), 0); });
    Object.assign(totals, totalOverrides);
    return { columns, totals };
}

function sarMatrixHtml(pivot, metrics) {
    const { columns, totals } = pivot;
    const dates = [];
    columns.forEach(c => {
        const last = dates[dates.length - 1];
        if (last && last.date === c.date) last.span++;
        else dates.push({ date: c.date, span: 1 });
    });
    return `<thead>
            <tr><th class="sar-row-head" rowspan="2">Date</th>${dates.map(d => `<th colspan="${d.span}">${sarDateLabel(d.date)}</th>`).join('')}<th class="sar-total" rowspan="2">Total</th></tr>
            <tr>${columns.map(c => `<th>${sarEsc(c.shift)}</th>`).join('')}</tr>
        </thead><tbody>` +
        metrics.map(m => `<tr><th class="sar-row-head">${m.label}</th>${columns.map(c => `<td>${(c.values[m.key] || 0).toLocaleString('en-IN')}</td>`).join('')}<td class="sar-total">${(totals[m.key] || 0).toLocaleString('en-IN')}</td></tr>`).join('') +
        '</tbody>';
}

function sarSpMetrics() {
    const cfg = sarConfig();
    const metrics = [
        { key: 'actualQty', label: 'Assy Actual Qty' },
        { key: 'okQty', label: 'Assy OK Qty' },
        { key: 'nokQty', label: 'Assy NOK Qty' }
    ];
    if (cfg.extraRow === 'IC') metrics.push({ key: 'incompleteQty', label: 'Incomplete Cycle Qty' });
    if (cfg.extraRow === 'NA') metrics.push({ key: 'notAcceptedQty', label: 'Not Accepted Qty' });
    return metrics;
}

const SAR_REWORK_METRICS = [
    { key: 'distinctEngines', label: 'Total Distinct Qty' },
    { key: 'okQty', label: 'Rework OK Qty' },
    { key: 'nokQty', label: 'Rework NOK Qty' }
];
const SAR_BYPASS_METRICS = [
    { key: 'actualQty', label: 'Actual Qty' },
    { key: 'okQty', label: 'OK Qty' },
    { key: 'nokQty', label: 'NOK Qty' }
];

function sarRenderTable(tableId, emptyId, rows, metrics, emptyText, totalOverrides) {
    const table = document.getElementById(tableId);
    const empty = document.getElementById(emptyId);
    if (!table || !empty) return;
    if (!rows.length) {
        table.hidden = true;
        empty.hidden = false;
        empty.textContent = emptyText;
        return;
    }
    table.hidden = false;
    empty.hidden = true;
    table.innerHTML = sarMatrixHtml(sarPivot(rows, metrics, totalOverrides), metrics);
}

function sarNoDataText() {
    return sarStation ? `No data for ${sarStation} in the selected range` : 'No data in the selected range';
}

function renderSarStraightPass() {
    sarRenderTable('sarSpTable', 'sarSpEmpty', sarData.assy.filter(r => sarMatches(r)), sarSpMetrics(), sarNoDataText());

    // Straight Pass % = first-attempt OK / first-attempt parts; Rejection % = first-attempt NOK / parts.
    const sp = sarData.straightPass.filter(r => sarMatches(r));
    const actual = sp.reduce((s, r) => s + r.actualQty, 0);
    document.getElementById('sarSpPct').textContent = sarPct(sp.reduce((s, r) => s + r.okQty, 0), actual);
    document.getElementById('sarRejPct').textContent = sarPct(sp.reduce((s, r) => s + r.nokQty, 0), actual);
}

function sarReworkRows() {
    const byStation = sarConfig().reworkByStation !== false;
    return sarData.rework.filter(r => sarMatches(r, byStation));
}

// Total of "Total Distinct Qty": engines reworked anywhere in the range (result set 5). Without it
// (proc not updated yet) the Total falls back to the sum of the per-shift counts.
function sarReworkTotals() {
    if (!Array.isArray(sarData.reworkEngines)) return {};
    const byStation = sarConfig().reworkByStation !== false;
    const engines = new Set(sarData.reworkEngines.filter(r => sarMatches(r, byStation)).map(r => r.engine));
    return { distinctEngines: engines.size };
}

function renderSarRework() {
    if (!sarConfig().panels.includes('rework')) return;
    const rows = sarReworkRows();
    sarRenderTable('sarRwTable', 'sarRwEmpty', rows, SAR_REWORK_METRICS, 'No rework entries in the selected range', sarReworkTotals());

    // Rework OK % = OK / (OK + NOK), as in Power BI.
    const ok = rows.reduce((s, r) => s + r.okQty, 0);
    const nok = rows.reduce((s, r) => s + r.nokQty, 0);
    document.getElementById('sarRwOkPct').textContent = sarPct(ok, ok + nok);
    document.getElementById('sarRwNokPct').textContent = sarPct(nok, ok + nok);
}

function renderSarBypassed() {
    if (!sarConfig().panels.includes('bypass')) return;
    sarRenderTable('sarBpTable', 'sarBpEmpty', sarData.bypassed.filter(r => sarMatches(r)), SAR_BYPASS_METRICS, 'No bypassed parts in the selected range');
}

function resetSarFilters() {
    sarShift = '';
    sarSubGroup = '';
    sarStation = '';
    const { start, end } = currentProductionDayRange();
    document.getElementById('sarStart')?._flatpickr?.setDate(start);
    document.getElementById('sarEnd')?._flatpickr?.setDate(end);
    fetchSarReport();
}

async function exportSarToExcel() {
    if (!sarData || sarLoading) { alert('No data to export'); return; }
    const cfg = sarConfig();
    const blocks = [{ title: 'STRAIGHT PASS REPORT', rows: sarData.assy.filter(r => sarMatches(r)), metrics: sarSpMetrics() }];
    if (cfg.panels.includes('rework')) blocks.push({ title: 'REWORK REPORT', rows: sarReworkRows(), metrics: SAR_REWORK_METRICS, totals: sarReworkTotals() });
    if (cfg.panels.includes('bypass')) blocks.push({ title: 'BYPASSED DATA REPORT', rows: sarData.bypassed.filter(r => sarMatches(r)), metrics: SAR_BYPASS_METRICS });
    if (!blocks.some(b => b.rows.length)) { alert('No data to export'); return; }

    try {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet(cfg.label.slice(0, 31));
        const border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        const fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7CD4F' } };

        sheet.getCell(1, 1).value = sarTitle(cfg).toUpperCase();
        sheet.getCell(1, 1).font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFD71920' } };
        const filters = [`From: ${document.getElementById('sarStart')?.value || ''}`, `To: ${document.getElementById('sarEnd')?.value || ''}`,
            `Station: ${sarStation || '-'}`, `Shift: ${sarShift || 'All'}`];
        if (cfg.subGroupLabel) filters.push(`${cfg.subGroupLabel}: ${sarSubGroup || 'All'}`);
        sheet.getCell(2, 1).value = filters.join('   |   ');
        sheet.getCell(2, 1).font = { italic: true, size: 10 };
        sheet.getCell(3, 1).value = `Straight Pass %: ${document.getElementById('sarSpPct').textContent}   |   Rejection %: ${document.getElementById('sarRejPct').textContent}` +
            (cfg.panels.includes('rework') ? `   |   Rework OK %: ${document.getElementById('sarRwOkPct').textContent}   |   Rework NOK %: ${document.getElementById('sarRwNokPct').textContent}` : '');
        sheet.getCell(4, 1).value = `Exported on: ${new Date().toLocaleString()}`;

        let rowNo = 6;
        let maxCols = 2;
        blocks.forEach(block => {
            sheet.getCell(rowNo, 1).value = block.title;
            sheet.getCell(rowNo, 1).font = { bold: true, size: 12 };
            rowNo++;
            if (!block.rows.length) {
                sheet.getCell(rowNo, 1).value = 'No data';
                rowNo += 2;
                return;
            }
            const { columns, totals } = sarPivot(block.rows, block.metrics, block.totals);
            const head1 = sheet.getRow(rowNo);
            const head2 = sheet.getRow(rowNo + 1);
            const headCells = [['Date', ''], ...columns.map(c => [sarDateLabel(c.date), c.shift]), ['Total', '']];
            headCells.forEach(([d, s], i) => {
                [[head1, d], [head2, s]].forEach(([row, v]) => {
                    const cell = row.getCell(i + 1);
                    cell.value = v;
                    cell.font = { bold: true };
                    cell.fill = fill;
                    cell.border = border;
                    cell.alignment = { horizontal: 'center' };
                });
            });
            rowNo += 2;
            block.metrics.forEach(m => {
                const row = sheet.getRow(rowNo++);
                [m.label, ...columns.map(c => c.values[m.key] || 0), totals[m.key] || 0].forEach((v, i) => {
                    row.getCell(i + 1).value = v;
                    row.getCell(i + 1).border = border;
                    if (i === 0) row.getCell(i + 1).font = { bold: true };
                });
            });
            maxCols = Math.max(maxCols, columns.length + 2);
            rowNo++;
        });
        sheet.getColumn(1).width = 24;
        for (let c = 2; c <= maxCols; c++) sheet.getColumn(c).width = 9;

        await downloadWorkbook(workbook, `SubAssembly_${cfg.id}_${sarStation || 'All'}_${Date.now()}.xlsx`);
    } catch (err) {
        console.error('Error generating excel:', err);
        alert('Error generating Excel file');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const { start, end } = currentProductionDayRange();
    if (typeof flatpickr !== 'undefined') {
        const config = { enableTime: true, dateFormat: 'Y-m-d\\TH:i', altInput: true, altFormat: 'd M Y, h:i K', time_24hr: false };
        flatpickr('#sarStart', { ...config, defaultDate: start });
        flatpickr('#sarEnd', { ...config, defaultDate: end });
    }
    // Close the sub-assembly menu on an outside click.
    document.addEventListener('click', e => {
        const menu = document.getElementById('sarMenu');
        if (menu && !menu.hidden && !e.target.closest('#sarMenu') && !e.target.closest('#sarMenuBtn')) menu.hidden = true;
    });
});
