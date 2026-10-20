// --- PROCESS / PRODUCT PARAMETER REPORT EA2 ---
// Port of Process_Product_Parameter_Report_1.pbix (pages "Vallam - MainLine", "Vallam - QHold",
// "Duplicate of Vallam - MainLine"). Raw station rows, so the server pages them:
//   GET /api/reports/process-parameter/columns -> the Dynamic Columns lists (Power BI field parameters)
//   GET /api/reports/process-parameter/data    -> rows per station/status (Rows card, pie, Station list) + one page
//   GET /api/reports/process-parameter/export  -> CSV of the filtered rows (up to ExportMaxRows)
// Dropdown filters apply at once; From / To and Engine Number apply with Apply (or Enter).

const PPR_SECTIONS = {
    ML: { label: 'Vallam - MainLine', columnsKey: 'mainline' },
    QH: { label: 'Vallam - QHold', columnsKey: 'qhold' },
    DUP: { label: 'Duplicate of Vallam - MainLine', columnsKey: null }
};
// Power BI "Time Range Table" order
const PPR_TIME_RANGES = ['01-02', '02-03', '03-04', '04-05', '05-06', '06-07', '07-08', '08-09', '09-10', '10-11', '11-12', '12-13',
    '13-14', '14-15', '15-16', '16-17', '17-18', '18-19', '19-20', '20-21', '21-22', '22-23', '23-24', '24-01'];
const PPR_STATUS_COLORS = { OK: '#22c55e', REJECTED: '#f59e0b', NOK: '#f59e0b', BYPASSED: '#3b82f6' };

let pprSection = 'ML';
let pprMeta = null;              // /columns response
let pprData = null;              // last /data response
let pprPage = 1;
let pprFilters = { station: '', shift: '', timeRange: '', status: '', engine: '' };
let pprSelectedColumns = null;   // null = All of the current list, else Set of source column names
let pprChart = null;
let pprInitialLoadDone = false;
let pprFetchSeq = 0;

function pprEsc(value) {
    // Some barcode fields hold raw scanner bytes - drop control characters before display.
    return String(value ?? '').replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
        .replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function pprFormatDate(value) {
    if (!value) return '';
    const dt = new Date(value);
    if (isNaN(dt)) return value;
    const p = n => String(n).padStart(2, '0');
    return `${dt.getFullYear()}-${p(dt.getMonth() + 1)}-${p(dt.getDate())} ${p(dt.getHours())}:${p(dt.getMinutes())}:${p(dt.getSeconds())}`;
}

function pprSortNat(a, b) {
    return String(a).localeCompare(String(b), undefined, { numeric: true });
}

async function loadPprDefaultView() {
    if (pprInitialLoadDone) return;
    pprInitialLoadDone = true;
    try {
        const res = await fetch('/api/reports/process-parameter/columns');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        pprMeta = await res.json();
    } catch (err) {
        console.error('Error loading Process Parameter columns', err);
        alert('Error connecting to server');
        pprInitialLoadDone = false;
        return;
    }
    fetchPprReport();
}

// Dynamic Columns of the section: the selected station's entries, or (All / a station Power BI didn't
// list) the union of all entries - like the field parameter. Sorted by Power BI's order value, one
// entry per source column.
function pprColumnList() {
    const key = PPR_SECTIONS[pprSection].columnsKey;
    if (!key || !pprMeta) return [];
    const all = pprMeta[key];
    const forStation = all.filter(c => c.station === pprFilters.station);
    const list = forStation.length ? forStation : all;
    const seen = new Set();
    return list
        .map((c, i) => ({ ...c, i }))
        .sort((a, b) => a.order - b.order || a.i - b.i)
        .filter(c => (seen.has(c.column) ? false : seen.add(c.column)));
}

function pprActiveColumns() {
    const list = pprColumnList();
    return pprSelectedColumns ? list.filter(c => pprSelectedColumns.has(c.column)) : list;
}

function pprParams(includePage) {
    const params = new URLSearchParams({
        section: pprSection,
        startDate: document.getElementById('pprStart')?.value || '',
        endDate: document.getElementById('pprEnd')?.value || ''
    });
    Object.entries(pprFilters).forEach(([k, v]) => { if (v) params.set(k, v); });
    pprActiveColumns().forEach(c => params.append('columns', c.column));
    if (includePage) params.set('page', pprPage);
    return params;
}

function setPprSection(section) {
    if (section === pprSection) return;
    pprSection = section;
    pprFilters = { station: '', shift: pprFilters.shift, timeRange: pprFilters.timeRange, status: '', engine: pprFilters.engine };
    pprSelectedColumns = null;
    pprPage = 1;
    pprData = null;
    fetchPprReport();
}

function setPprFilter(key, value) {
    pprFilters[key] = value;
    if (key === 'station') pprSelectedColumns = null;
    pprPage = 1;
    fetchPprReport();
}

function applyPprFilters() {
    pprFilters.engine = (document.getElementById('pprEngine')?.value || '').trim();
    pprPage = 1;
    fetchPprReport();
}

async function fetchPprReport() {
    if (!pprMeta) { loadPprDefaultView(); return; }
    const start = document.getElementById('pprStart')?.value || '';
    const end = document.getElementById('pprEnd')?.value || '';
    if (!start || !end) { alert('Please select From and To dates.'); return; }
    if (start > end) { alert('From must be on or before To.'); return; }

    const seq = ++pprFetchSeq;
    const loading = document.getElementById('pprLoading');
    if (loading) loading.hidden = false;
    renderPprHeader();

    let data = null;
    try {
        const res = await fetch(`/api/reports/process-parameter/data?${pprParams(true).toString()}`);
        if (seq !== pprFetchSeq) return;
        if (res.ok) data = await res.json();
        else alert(`Failed to load Process Parameter report: ${(await res.text()).slice(0, 200)}`);
    } catch (err) {
        if (seq !== pprFetchSeq) return;
        console.error('Error fetching Process Parameter report', err);
        alert('Error connecting to server');
    }
    if (seq !== pprFetchSeq) return;

    if (loading) loading.hidden = true;
    pprData = data || { groups: [], rows: [], page: 1, pageSize: pprMeta.pageSize };
    renderPpr();
}

function renderPprHeader() {
    document.querySelectorAll('#pprSections .ppr-section-btn').forEach(b => b.classList.toggle('active', b.dataset.section === pprSection));
    // Duplicate page: always ML-01, no Dynamic Columns
    const dup = pprSection === 'DUP';
    document.getElementById('pprStationField').hidden = dup;
    document.getElementById('pprColumnsField').hidden = dup;
}

function renderPpr() {
    renderPprHeader();
    if (!pprData) return;
    renderPprFilters();
    renderPprSummary();
    renderPprTable();
}

function pprGroupsForStation() {
    const st = pprFilters.station;
    return pprData.groups.filter(g => !st || pprSection === 'DUP' || g.station === st);
}

function pprTotal() {
    return pprGroupsForStation().reduce((s, g) => s + g.rows, 0);
}

function renderPprFilters() {
    const opt = (v, cur, label) => `<option value="${pprEsc(v)}"${v === cur ? ' selected' : ''}>${pprEsc(label ?? v)}</option>`;

    const stations = [...new Set(pprData.groups.map(g => g.station).filter(Boolean))].sort(pprSortNat);
    if (pprFilters.station && !stations.includes(pprFilters.station)) stations.unshift(pprFilters.station);
    document.getElementById('pprStation').innerHTML = opt('', pprFilters.station, 'All') + stations.map(s => opt(s, pprFilters.station)).join('');

    document.getElementById('pprShift').innerHTML = opt('', pprFilters.shift, 'All') + ['A', 'B', 'C'].map(s => opt(s, pprFilters.shift)).join('');
    document.getElementById('pprTimeRange').innerHTML = opt('', pprFilters.timeRange, 'All') + PPR_TIME_RANGES.map(t => opt(t, pprFilters.timeRange)).join('');

    const statuses = [...new Set(pprData.groups.map(g => g.status).filter(Boolean))].sort(pprSortNat);
    if (pprFilters.status && !statuses.includes(pprFilters.status)) statuses.unshift(pprFilters.status);
    document.getElementById('pprStatus').innerHTML = opt('', pprFilters.status, 'All') + statuses.map(s => opt(s, pprFilters.status)).join('');

    const engine = document.getElementById('pprEngine');
    if (engine && document.activeElement !== engine) engine.value = pprFilters.engine;
    renderPprColumnsPicker();
}

// Dynamic Columns: checkbox list (All + each column of the current list)
function renderPprColumnsPicker() {
    const list = pprColumnList();
    const btn = document.getElementById('pprColumnsBtn');
    const panel = document.getElementById('pprColumnsPanel');
    if (!btn || !panel) return;
    const active = pprActiveColumns();
    btn.textContent = !pprSelectedColumns ? 'All' : `${active.length} of ${list.length}`;
    const allChecked = !pprSelectedColumns;
    panel.innerHTML = `<label class="ppr-check"><input type="checkbox" ${allChecked ? 'checked' : ''} onchange="setPprColumn(null, this.checked)"><b>All</b></label>` +
        list.map(c => `<label class="ppr-check"><input type="checkbox" ${allChecked || pprSelectedColumns.has(c.column) ? 'checked' : ''}
            data-col="${pprEsc(c.column)}" onchange="setPprColumn(this.dataset.col, this.checked)">${pprEsc(c.name)}</label>`).join('');
}

function togglePprColumns(force) {
    const panel = document.getElementById('pprColumnsPanel');
    if (panel) panel.hidden = force === undefined ? !panel.hidden : !force;
}

function setPprColumn(column, checked) {
    const list = pprColumnList();
    if (column === null) {
        pprSelectedColumns = checked ? null : new Set();
    } else {
        const set = pprSelectedColumns ? new Set(pprSelectedColumns) : new Set(list.map(c => c.column));
        if (checked) set.add(column); else set.delete(column);
        pprSelectedColumns = set.size === list.length ? null : set;
    }
    renderPprColumnsPicker();
    fetchPprReport();   // same page, new columns
}

function renderPprSummary() {
    const groups = pprGroupsForStation();
    const total = pprTotal();
    document.getElementById('pprRows').textContent = total.toLocaleString('en-IN');

    const byStatus = new Map();
    groups.forEach(g => byStatus.set(g.status || '(Blank)', (byStatus.get(g.status || '(Blank)') || 0) + g.rows));
    const buckets = [...byStatus.entries()].sort((a, b) => b[1] - a[1]).map(([label, count]) => ({ label, count, color: PPR_STATUS_COLORS[label] || '#9ca3af' }));

    const canvas = document.getElementById('pprDonut');
    if (pprChart) { pprChart.destroy(); pprChart = null; }
    if (canvas && typeof Chart !== 'undefined' && total) {
        const surface = getComputedStyle(document.body).getPropertyValue('--white').trim() || '#121212';
        pprChart = new Chart(canvas, {
            type: 'doughnut',
            data: { labels: buckets.map(b => b.label), datasets: [{ data: buckets.map(b => b.count), backgroundColor: buckets.map(b => b.color), borderColor: surface, borderWidth: 2 }] },
            options: { cutout: '60%', maintainAspectRatio: false, plugins: { legend: { display: false } } }
        });
    }
    document.getElementById('pprDonutLegend').innerHTML = total
        ? buckets.map(b => `<span><i style="background:${b.color}"></i>${pprEsc(b.label)}: ${b.count.toLocaleString('en-IN')} (${(b.count / total * 100).toFixed(2)}%)</span>`).join('')
        : '';
}

function pprTableColumns() {
    if (pprSection === 'DUP') {
        return [
            { key: 'Date_Time', label: 'Date_Time', date: true }, { key: 'Shift', label: 'Shift' },
            { key: 'Engine_Number', label: 'Engine_Number' }, { key: 'Barcode_2', label: 'Barcode_2' },
            { key: 'DuplicateCount', label: 'DuplicateCount', num: true }
        ];
    }
    return [
        { key: 'Date_Time', label: 'Date_Time', date: true }, { key: 'Shift', label: 'Shift' },
        { key: 'Engine_Number', label: 'Engine_Number' }, { key: 'Station', label: 'Station' },
        ...pprActiveColumns().map(c => ({ key: c.column, label: c.name }))
    ];
}

function renderPprTable() {
    const table = document.getElementById('pprTable');
    const empty = document.getElementById('pprEmpty');
    const pager = document.getElementById('pprPagination');
    const rows = pprData.rows || [];
    const total = pprTotal();

    if (!rows.length) {
        table.hidden = true;
        pager.hidden = true;
        empty.hidden = false;
        return;
    }
    table.hidden = false;
    pager.hidden = false;
    empty.hidden = true;

    const cols = pprTableColumns();
    const start = (pprData.page - 1) * pprData.pageSize;
    table.innerHTML = `<thead><tr>${cols.map(c => `<th>${pprEsc(c.label)}</th>`).join('')}</tr></thead><tbody>` +
        rows.map(r => `<tr>${cols.map(c => `<td${c.num ? ' class="ppr-num"' : ''}>${pprEsc(c.date ? pprFormatDate(r[c.key]) : r[c.key])}</td>`).join('')}</tr>`).join('') +
        '</tbody>';

    const pages = Math.max(1, Math.ceil(total / pprData.pageSize));
    document.getElementById('pprTotalCount').textContent =
        `Rows ${(start + 1).toLocaleString('en-IN')}-${(start + rows.length).toLocaleString('en-IN')} of ${total.toLocaleString('en-IN')}`;
    document.getElementById('pprPageLabel').textContent = `Page ${pprData.page.toLocaleString('en-IN')} of ${pages.toLocaleString('en-IN')}`;
    document.getElementById('pprPrev').disabled = pprData.page <= 1;
    document.getElementById('pprNext').disabled = pprData.page >= pages;
    document.getElementById('pprFirst').disabled = pprData.page <= 1;
    document.getElementById('pprLast').disabled = pprData.page >= pages;
}

function changePprPage(direction) {
    if (!pprData) return;
    const pages = Math.max(1, Math.ceil(pprTotal() / pprData.pageSize));
    pprPage = direction === 'first' ? 1 : direction === 'last' ? pages : Math.min(Math.max(pprPage + direction, 1), pages);
    fetchPprReport();
}

function clearPprFilters() {
    pprFilters = { station: '', shift: '', timeRange: '', status: '', engine: '' };
    pprSelectedColumns = null;
    pprPage = 1;
    const today = new Date();
    document.getElementById('pprStart')?._flatpickr?.setDate(today);
    document.getElementById('pprEnd')?._flatpickr?.setDate(today);
    const engine = document.getElementById('pprEngine');
    if (engine) engine.value = '';
    fetchPprReport();
}

// CSV (opens in Excel) of all filtered rows, up to the server's ExportMaxRows.
function exportPprCsv() {
    if (!pprData || !pprTotal()) { alert('No data to export'); return; }
    const max = pprMeta?.exportMaxRows || 150000;
    if (pprTotal() > max && !confirm(`${pprTotal().toLocaleString('en-IN')} rows match - only the first ${max.toLocaleString('en-IN')} will be exported. Continue?`)) return;
    const link = document.createElement('a');
    link.href = `/api/reports/process-parameter/export?${pprParams(false).toString()}`;
    link.download = '';
    document.body.appendChild(link);
    link.click();
    link.remove();
}

document.addEventListener('DOMContentLoaded', () => {
    if (typeof flatpickr !== 'undefined') {
        const config = { dateFormat: 'Y-m-d', altInput: true, altFormat: 'd M Y', defaultDate: new Date() };
        flatpickr('#pprStart', config);
        flatpickr('#pprEnd', config);
    }
    document.getElementById('pprEngine')?.addEventListener('keydown', e => { if (e.key === 'Enter') applyPprFilters(); });
    document.addEventListener('click', e => {
        const panel = document.getElementById('pprColumnsPanel');
        if (panel && !panel.hidden && !e.target.closest('#pprColumnsField')) panel.hidden = true;
    });
});
