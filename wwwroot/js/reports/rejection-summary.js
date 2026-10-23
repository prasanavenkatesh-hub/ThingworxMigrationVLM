// --- REJECTION SUMMARY REPORT (Main Line / Sub Assembly) ---
// Port of the "ML-Rejection Summary Report EA L2" and "EA2 SA-Rejection Summary Report" Power BI
// files. GET /api/reports/rejection-summary/data -> dbo.usp_GetRejectionSummaryReport.
// Line + From / To are applied by the Main Line / Sub Assembly buttons (like the Categorywise Rework
// report); the column dropdowns then filter the loaded rows in the browser and narrow each other.

const RJS_PAGE_SIZE = 50;

// Per section: table columns and the dropdown filters (same set as the Power BI pages).
const RJS_SECTIONS = {
    ML: {
        label: 'Main Line',
        countLabel: 'Engines',
        countKey: 'engineNumber',
        donutKey: 'rejectionStation',
        donutLabel: 'Rejection station',
        columns: [
            { key: 'date', label: 'Date', date: true },
            { key: 'shift', label: 'Shift' },
            { key: 'engineNumber', label: 'Engine Number' },
            { key: 'model', label: 'Model' },
            { key: 'rejectionStation', label: 'Rejection Station' },
            { key: 'rejectionDetails', label: 'Rejection Details' },
            { key: 'reloadStation', label: 'Reload Station' },
            { key: 'rootCause', label: 'Root Cause' },
            { key: 'reworkDetails', label: 'Rework Details' },
            { key: 'category', label: 'Category' },
            { key: 'supplier', label: 'Supplier' },
            { key: 'reworkDate', label: 'Rework Date', date: true },
            { key: 'reworkedBy', label: 'Reworked By' },
            { key: 'verifiedBy', label: 'Verified By' }
        ],
        filters: ['shift', 'engineNumber', 'rejectionStation', 'model', 'reloadStation', 'rejectionDetails', 'reworkDetails', 'category']
    },
    SA: {
        label: 'Sub Assembly',
        countLabel: 'SA serials',
        countKey: 'saSerialNo',
        donutKey: 'stationNo',
        donutLabel: 'Station',
        columns: [
            { key: 'date', label: 'Date', date: true },
            { key: 'shift', label: 'Shift' },
            { key: 'stationNo', label: 'Station No' },
            { key: 'saSerialNo', label: 'SA Serial No' },
            { key: 'defect', label: 'Defect' },
            { key: 'reworkDetails', label: 'Rework Details' },
            { key: 'noOfTime', label: 'No. of Time' },
            { key: 'torqueStatus', label: 'Torque Status' },
            { key: 'prodEmpId', label: 'Prod - Emp ID' },
            { key: 'qcEmpId', label: 'QC - Emp ID' }
        ],
        filters: ['shift', 'saSerialNo', 'stationNo', 'defect', 'reworkDetails', 'noOfTime']
    }
};

// Free-text (type-ahead) filters - too many values for a dropdown.
const RJS_TEXT_FILTERS = ['engineNumber', 'saSerialNo'];
const RJS_DONUT_COLORS = ['#ef4444', '#f59e0b', '#3b82f6', '#22c55e', '#a855f7', '#06b6d4', '#9ca3af'];

let rjsSection = 'ML';
let rjsLine = 'EA02';
let rjsData = [];            // rows of the last load
let rjsAvailable = true;     // false = line has no data source yet (EA01)
let rjsFilters = {};         // key -> value ('' = all)
let rjsPage = 1;
let rjsChart = null;
let rjsInitialLoadDone = false;
let rjsFetchSeq = 0;

function rjsEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function rjsFormatDate(value) {
    if (!value) return '';
    const dt = new Date(value);
    if (isNaN(dt)) return value;
    const p = n => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
}

function rjsColumn(key) {
    return RJS_SECTIONS[rjsSection].columns.find(c => c.key === key);
}

function loadRjsDefaultView() {
    if (rjsInitialLoadDone) return;
    rjsInitialLoadDone = true;
    fetchRjsReport();
}

// Main Line / Sub Assembly buttons: apply line + dates, load that section.
function setRjsSection(section) {
    if (section !== rjsSection) rjsFilters = {};
    rjsSection = section;
    fetchRjsReport();
}

async function fetchRjsReport() {
    const start = document.getElementById('rjsStart')?.value || '';
    const end = document.getElementById('rjsEnd')?.value || '';
    if (!start || !end) { alert('Please select From and To date/time.'); return; }
    if (start >= end) { alert('From must be before To.'); return; }

    rjsLine = document.getElementById('rjsLine')?.value || 'EA02';
    const seq = ++rjsFetchSeq;
    const loading = document.getElementById('rjsLoading');
    const buttons = document.querySelectorAll('#rjsSections .rjs-section-btn');
    buttons.forEach(b => { b.disabled = true; b.classList.toggle('active', b.dataset.section === rjsSection); });
    if (loading) loading.hidden = false;

    let data = { available: true, rows: [] };
    try {
        const params = new URLSearchParams({ line: rjsLine, section: rjsSection, startDate: start, endDate: end });
        const res = await fetch(`/api/reports/rejection-summary/data?${params.toString()}`);
        if (seq !== rjsFetchSeq) return;
        if (res.ok) data = await res.json();
        else alert(`Failed to load Rejection Summary report: ${(await res.text()).slice(0, 200)}`);
    } catch (err) {
        if (seq !== rjsFetchSeq) return;
        console.error('Error fetching Rejection Summary report', err);
        alert('Error connecting to server');
    }
    if (seq !== rjsFetchSeq) return;

    rjsData = data.rows || [];
    rjsAvailable = data.available !== false;
    rjsPage = 1;
    buttons.forEach(b => { b.disabled = false; });
    if (loading) loading.hidden = true;
    renderRjs();
}

function rjsRowMatches(row, skipKey) {
    for (const [key, value] of Object.entries(rjsFilters)) {
        if (!value || key === skipKey) continue;
        const cell = String(row[key] ?? '');
        if (RJS_TEXT_FILTERS.includes(key)) {
            if (!cell.toUpperCase().includes(value.toUpperCase())) return false;
        } else if (cell !== value) {
            return false;
        }
    }
    return true;
}

function rjsFilteredRows() {
    return rjsData.filter(r => rjsRowMatches(r));
}

function renderRjs() {
    const cfg = RJS_SECTIONS[rjsSection];
    const title = document.getElementById('rjsTitle');
    if (title) title.textContent = `${rjsLine} ${cfg.label} Rejection Summary Report`;
    document.querySelectorAll('#rjsSections .rjs-section-btn').forEach(b => b.classList.toggle('active', b.dataset.section === rjsSection));

    renderRjsFilters();
    const rows = rjsFilteredRows();
    renderRjsKpis(rows);
    renderRjsDonut(rows);
    renderRjsTable(rows);
}

// Dropdowns are rebuilt from the loaded rows matching every *other* filter, so they cascade.
function renderRjsFilters() {
    const box = document.getElementById('rjsColumnFilters');
    if (!box) return;
    const cfg = RJS_SECTIONS[rjsSection];

    box.innerHTML = cfg.filters.map(key => {
        const col = rjsColumn(key);
        const id = `rjsFilter_${key}`;
        const current = rjsFilters[key] || '';
        const values = [...new Set(rjsData.filter(r => rjsRowMatches(r, key)).map(r => String(r[key] ?? '').trim()).filter(Boolean))]
            .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
        const cls = `rjs-field${current ? ' is-filtered' : ''}`;
        if (RJS_TEXT_FILTERS.includes(key)) {
            return `<div class="${cls}"><label for="${id}">${col.label}</label>
                <input type="text" id="${id}" class="rjs-input" list="${id}_list" placeholder="All" autocomplete="off" value="${rjsEsc(current)}"
                    onchange="setRjsFilter('${key}', this.value.trim())">
                <datalist id="${id}_list">${values.slice(0, 500).map(v => `<option value="${rjsEsc(v)}"></option>`).join('')}</datalist></div>`;
        }
        if (current && !values.includes(current)) values.unshift(current);
        return `<div class="${cls}"><label for="${id}">${col.label}</label>
            <select id="${id}" class="select-royal" onchange="setRjsFilter('${key}', this.value)">
                <option value="">All</option>${values.map(v => `<option value="${rjsEsc(v)}"${v === current ? ' selected' : ''}>${rjsEsc(v)}</option>`).join('')}
            </select></div>`;
    }).join('');
}

function setRjsFilter(key, value) {
    rjsFilters[key] = value;
    rjsPage = 1;
    renderRjs();
}

function renderRjsKpis(rows) {
    const el = document.getElementById('rjsKpis');
    if (!el) return;
    const cfg = RJS_SECTIONS[rjsSection];
    const distinct = key => new Set(rows.map(r => r[key]).filter(Boolean)).size;
    const cards = [
        { label: 'Rows', value: rows.length },
        { label: cfg.countLabel, value: distinct(cfg.countKey) },
        { label: rjsSection === 'ML' ? 'Rejection stations' : 'Stations', value: distinct(cfg.donutKey) },
        { label: rjsSection === 'ML' ? 'Reworked' : 'Defects', value: rjsSection === 'ML' ? rows.filter(r => r.reworkDate).length : distinct('defect') }
    ];
    el.innerHTML = cards.map(c => `<div class="rjs-kpi"><span>${c.label}</span><b>${c.value.toLocaleString('en-IN')}</b></div>`).join('');
}

function renderRjsDonut(rows) {
    const cfg = RJS_SECTIONS[rjsSection];
    const head = document.getElementById('rjsDonutTitle');
    if (head) head.textContent = `Rows by ${cfg.donutLabel.toLowerCase()}`;

    const counts = new Map();
    rows.forEach(r => {
        const k = r[cfg.donutKey] || '(Blank)';
        counts.set(k, (counts.get(k) || 0) + 1);
    });
    const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const buckets = sorted.slice(0, 6).map(([label, count]) => ({ label, count }));
    const other = sorted.slice(6).reduce((s, [, c]) => s + c, 0);
    if (other) buckets.push({ label: 'Other', count: other });
    buckets.forEach((b, i) => { b.color = RJS_DONUT_COLORS[i % RJS_DONUT_COLORS.length]; });

    const canvas = document.getElementById('rjsDonut');
    if (rjsChart) { rjsChart.destroy(); rjsChart = null; }
    if (canvas && typeof Chart !== 'undefined' && rows.length) {
        const surface = getComputedStyle(document.body).getPropertyValue('--white').trim() || '#121212';
        rjsChart = new Chart(canvas, {
            type: 'doughnut',
            data: { labels: buckets.map(b => b.label), datasets: [{ data: buckets.map(b => b.count), backgroundColor: buckets.map(b => b.color), borderColor: surface, borderWidth: 2 }] },
            options: { cutout: '65%', maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }
    const legend = document.getElementById('rjsDonutLegend');
    if (legend) {
        legend.innerHTML = rows.length
            ? buckets.map(b => `<span><i style="background:${b.color}"></i>${rjsEsc(b.label)}: ${b.count} (${Math.round(b.count / rows.length * 100)}%)</span>`).join('')
            : '';
    }
}

function renderRjsTable(rows) {
    const cfg = RJS_SECTIONS[rjsSection];
    const table = document.getElementById('rjsTable');
    const empty = document.getElementById('rjsEmpty');
    const pager = document.getElementById('rjsPagination');
    if (!table || !empty || !pager) return;

    if (!rows.length) {
        table.hidden = true;
        pager.hidden = true;
        empty.hidden = false;
        empty.querySelector('span:last-child').textContent = !rjsAvailable
            ? `No data source for ${rjsLine} yet - only EA02 data is available`
            : 'No rejections for the selected filters';
        return;
    }
    table.hidden = false;
    pager.hidden = false;
    empty.hidden = true;

    const pages = Math.max(1, Math.ceil(rows.length / RJS_PAGE_SIZE));
    rjsPage = Math.min(Math.max(rjsPage, 1), pages);
    const startIndex = (rjsPage - 1) * RJS_PAGE_SIZE;
    const pageRows = rows.slice(startIndex, startIndex + RJS_PAGE_SIZE);

    table.innerHTML = `<thead><tr><th>S.No</th>${cfg.columns.map(c => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>` +
        pageRows.map((r, i) => `<tr><td class="rjs-num">${startIndex + i + 1}</td>` +
            cfg.columns.map(c => `<td>${rjsEsc(c.date ? rjsFormatDate(r[c.key]) : (r[c.key] ?? ''))}</td>`).join('') + '</tr>').join('') +
        '</tbody>';

    document.getElementById('rjsTotalCount').textContent = `Total: ${rows.length.toLocaleString('en-IN')} rows`;
    document.getElementById('rjsPageLabel').textContent = `Page ${rjsPage} of ${pages}`;
    document.getElementById('rjsPrev').disabled = rjsPage <= 1;
    document.getElementById('rjsNext').disabled = rjsPage >= pages;
}

function changeRjsPage(direction) {
    rjsPage += direction;
    renderRjsTable(rjsFilteredRows());
}

// Clear resets the column filters and the date range, then reloads the current section.
function clearRjsFilters() {
    rjsFilters = {};
    const { start, end } = currentProductionDayRange();
    document.getElementById('rjsStart')?._flatpickr?.setDate(start);
    document.getElementById('rjsEnd')?._flatpickr?.setDate(end);
    fetchRjsReport();
}

async function exportRjsToExcel() {
    const rows = rjsFilteredRows();
    if (!rows.length) { alert('No data to export'); return; }
    const cfg = RJS_SECTIONS[rjsSection];
    try {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet(`${cfg.label} Rejections`);
        const border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        const lastCol = cfg.columns.length + 1;

        sheet.mergeCells(1, 1, 1, lastCol);
        sheet.getCell(1, 1).value = `${rjsLine} ${cfg.label.toUpperCase()} REJECTION SUMMARY REPORT`;
        sheet.getCell(1, 1).font = { name: 'Arial', size: 16, bold: true, color: { argb: 'FFD71920' } };
        const filterText = Object.entries(rjsFilters).filter(([, v]) => v).map(([k, v]) => `${rjsColumn(k)?.label}: ${v}`);
        sheet.mergeCells(2, 1, 2, lastCol);
        sheet.getCell(2, 1).value = [`From: ${document.getElementById('rjsStart')?.value || ''}`, `To: ${document.getElementById('rjsEnd')?.value || ''}`, ...filterText].join('   |   ');
        sheet.getCell(2, 1).font = { italic: true, size: 10 };
        sheet.getCell(3, 1).value = `Exported on: ${new Date().toLocaleString()}`;

        const header = sheet.getRow(5);
        ['S.No', ...cfg.columns.map(c => c.label)].forEach((h, i) => {
            const cell = header.getCell(i + 1);
            cell.value = h;
            cell.font = { bold: true };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF7CD4F' } };
            cell.border = border;
        });
        rows.forEach((r, i) => {
            const row = sheet.getRow(6 + i);
            [i + 1, ...cfg.columns.map(c => c.date ? rjsFormatDate(r[c.key]) : (r[c.key] ?? ''))].forEach((v, ci) => {
                row.getCell(ci + 1).value = v;
                row.getCell(ci + 1).border = border;
            });
        });
        for (let c = 1; c <= lastCol; c++) sheet.getColumn(c).width = c === 1 ? 7 : 20;
        sheet.views = [{ state: 'frozen', ySplit: 5 }];

        await downloadWorkbook(workbook, `Rejection_Summary_${rjsLine}_${rjsSection}_${Date.now()}.xlsx`);
    } catch (err) {
        console.error('Error generating excel:', err);
        alert('Error generating Excel file');
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const { start, end } = currentProductionDayRange();
    if (typeof flatpickr !== 'undefined') {
        const config = { enableTime: true, dateFormat: 'Y-m-d\\TH:i', altInput: true, altFormat: 'd M Y, h:i K', time_24hr: false };
        flatpickr('#rjsStart', { ...config, defaultDate: start });
        flatpickr('#rjsEnd', { ...config, defaultDate: end });
    }
});
