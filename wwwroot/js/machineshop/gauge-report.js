// Machine Shop > Gauge Inspection Report (tab-ms-gir; prefix msGir / ms-gir-). Port of the ThingWorx mashup
// RE_Gauging_Report_MU (Thing RE_GaugingReport_DB_TH). Read-only.
// Machine tabs, Cell, OPERATOR / INSPECTOR, Critical / Non Critical, Conformance / Non Conformance, Process Code (multi),
// THIS SHIFT / TODAY / CUSTOM (one production day) and SUBMIT -> GET /api/machineshop/gaugereport/data: one row per
// parameter of the report layout, one column per part (QR code, operator, first reading time), cell = the latest
// reading; out of LSL / USL and Not OK in red. Rows are paged (options.pageSize); Excel = the whole report.
// Options: .../options, process codes: .../processcodes?machine=&role=&critical=&nonCritical=.

let msGirOptions = null;     // { machines: [{ name, hasSource }], cells, pageSize }
let msGirMachine = '';
let msGirRole = 'OPERATOR';
let msGirRange = 'shift';
let msGirPicker = null;
let msGirSeq = 0;            // drops answers of an older data request
let msGirCodeSeq = 0;        // drops answers of an older process-code request
let msGirData = null;
let msGirPage = 0;
const msGirSel = { cell: '', codes: [] };

function msGirEsc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function msGirFetch(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
}

function msGirIsoDay(d) {
    const pad = v => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "2026-11-17T08:45:29" -> "2026/11/17 08:45:29" (ThingWorx header format)
function msGirFmt(s, seconds = true) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):?(\d{2})?/.exec(s || '');
    return m ? `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}${seconds ? ':' + (m[6] || '00') : ''}` : '';
}

function msGirMachineInfo() {
    return msGirOptions?.machines.find(m => m.name === msGirMachine) || null;
}

function msGirChecked(id) { return document.getElementById(id).checked; }

async function msGirShow() {
    if (msGirOptions) return;
    try {
        msGirOptions = await msGirFetch('/api/machineshop/gaugereport/options');
    } catch (e) {
        msGirMessage(`Could not load the machines (${e.message}).`);
        return;
    }
    // Open on the first machine with data (ThingWorx opened on CRANK CASE LH, which has no source here).
    msGirMachine = (msGirOptions.machines.find(m => m.hasSource) || msGirOptions.machines[0] || {}).name || '';
    msGirSel.cell = msGirOptions.cells[0] || '';
    msGirBuildControls();
    msGirSelectMachine(msGirMachine);
}

function msGirBuildControls() {
    const tabs = document.getElementById('msGirTabs');
    tabs.innerHTML = msGirOptions.machines.map(m =>
        `<button type="button" class="ms-pdi-tab${m.hasSource ? '' : ' ms-gid-tab-empty'}" data-machine="${msGirEsc(m.name)}"
            title="${m.hasSource ? '' : 'No data source for this machine'}">${msGirEsc(m.name)}</button>`).join('');
    tabs.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.machine !== msGirMachine) msGirSelectMachine(b.dataset.machine);
    }));

    const cell = document.getElementById('msGirCell');
    cell.innerHTML = msGirOptions.cells.map(c => `<option value="${msGirEsc(c)}">${msGirEsc(c)}</option>`).join('');
    cell.value = msGirSel.cell;
    cell.addEventListener('change', () => { msGirSel.cell = cell.value; });

    document.querySelectorAll('#msGirRoles button').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.role === msGirRole) return;
        msGirRole = b.dataset.role;
        msGirSyncSegs();
        msGirLoadCodes(false);
    }));
    // The process code list depends on the role and Critical / Non Critical (ThingWorx getAllProcessCode).
    ['msGirCritical', 'msGirNonCritical'].forEach(id =>
        document.getElementById(id).addEventListener('change', () => msGirLoadCodes(false)));

    document.querySelectorAll('#msGirRanges button').forEach(b => b.addEventListener('click', () => {
        msGirRange = b.dataset.range;
        msGirSyncSegs();
    }));

    const today = currentProductionDayRange().start;
    msGirPicker = flatpickr('#msGirDate', { dateFormat: 'd-m-Y', defaultDate: today, maxDate: today, disableMobile: true });

    document.getElementById('msGirSubmit').addEventListener('click', msGirLoad);
    document.getElementById('msGirExcel').addEventListener('click', msGirDownload);
    document.addEventListener('click', e => {
        document.querySelectorAll('.ms-gir-multi').forEach(m => {
            if (!m.contains(e.target)) m.querySelector('.ms-gid-multi-menu').hidden = true;
        });
    });
    msGirSyncSegs();
}

function msGirSyncSegs() {
    document.querySelectorAll('#msGirRoles button').forEach(b => b.classList.toggle('active', b.dataset.role === msGirRole));
    document.querySelectorAll('#msGirRanges button').forEach(b => b.classList.toggle('active', b.dataset.range === msGirRange));
    document.getElementById('msGirDates').hidden = msGirRange !== 'custom';
}

// Multi-select drop-down (same look as Gauge Inspection Data: "All Selected" / "n Selected").
function msGirBuildMulti(items, selected, onChange) {
    const box = document.getElementById('msGirCodes');
    box.innerHTML = `
        <button type="button" class="ms-gid-multi-btn"><span class="ms-gid-multi-text"></span><span class="material-symbols-outlined">expand_more</span></button>
        <div class="ms-gid-multi-menu" hidden>
            <label class="ms-gid-multi-all"><input type="checkbox" data-all="1"> Select all</label>
            ${items.map(v => `<label><input type="checkbox" value="${msGirEsc(v)}"> ${msGirEsc(v)}</label>`).join('')}
        </div>`;
    const menu = box.querySelector('.ms-gid-multi-menu');
    const boxes = [...menu.querySelectorAll('input[value]')];
    const all = menu.querySelector('input[data-all]');
    const sync = () => {
        const values = boxes.filter(b => b.checked).map(b => b.value);
        all.checked = values.length === boxes.length && boxes.length > 0;
        all.indeterminate = values.length > 0 && values.length < boxes.length;
        box.querySelector('.ms-gid-multi-text').textContent = !boxes.length ? 'None available'
            : values.length === 0 ? 'Select Process Code' : values.length === boxes.length ? 'All Selected' : `${values.length} Selected`;
        box.querySelector('.ms-gid-multi-btn').disabled = !boxes.length;
        onChange(values);
    };
    boxes.forEach(b => { b.checked = selected.includes(b.value); b.addEventListener('change', sync); });
    all.addEventListener('change', () => { boxes.forEach(b => { b.checked = all.checked; }); sync(); });
    box.querySelector('.ms-gid-multi-btn').addEventListener('click', () => { menu.hidden = !menu.hidden; });
    sync();
}

function msGirSelectMachine(name) {
    msGirMachine = name;
    document.querySelectorAll('#msGirTabs button').forEach(b => b.classList.toggle('active', b.dataset.machine === name));
    msGirLoadCodes(true);
}

// Reloads the Process Code list (all selected); autoLoad = run the report afterwards (machine change).
async function msGirLoadCodes(autoLoad) {
    const info = msGirMachineInfo();
    const seq = ++msGirCodeSeq;
    msGirSeq++;                 // a pending report answer belongs to the old selection
    msGirRender(null);
    if (!info?.hasSource) {
        msGirBuildMulti([], [], v => { msGirSel.codes = v; });
        msGirMessage('No data source for this machine (none in ThingWorx either).');
        return;
    }
    const critical = msGirChecked('msGirCritical'), nonCritical = msGirChecked('msGirNonCritical');
    if (!critical && !nonCritical) {
        msGirBuildMulti([], [], v => { msGirSel.codes = v; });
        msGirMessage('Select Critical and / or Non Critical.');
        return;
    }
    msGirMessage('Loading process codes…');
    let codes;
    try {
        const p = new URLSearchParams({ machine: msGirMachine, role: msGirRole, critical, nonCritical });
        codes = await msGirFetch(`/api/machineshop/gaugereport/processcodes?${p}`);
    } catch (e) {
        if (seq === msGirCodeSeq) msGirMessage(`Could not load the process codes (${e.message}).`);
        return;
    }
    if (seq !== msGirCodeSeq) return;
    msGirBuildMulti(codes, codes, v => { msGirSel.codes = v; });
    msGirMessage(codes.length ? 'Press SUBMIT to load the report.' : 'No process codes for this selection.');
    if (autoLoad && codes.length) msGirLoad();
}

function msGirMessage(text) {
    document.getElementById('msGirNote').textContent = text || '';
}

async function msGirLoad() {
    const info = msGirMachineInfo();
    if (!info) return;
    if (!info.hasSource) { msGirMessage('No data source for this machine (none in ThingWorx either).'); return; }
    const critical = msGirChecked('msGirCritical'), nonCritical = msGirChecked('msGirNonCritical');
    const conforming = msGirChecked('msGirConforming'), nonConforming = msGirChecked('msGirNonConforming');
    if (!critical && !nonCritical) { msGirMessage('Select Critical and / or Non Critical.'); return; }
    if (!conforming && !nonConforming) { msGirMessage('Select Conformance and / or Non Conformance.'); return; }
    if (!msGirSel.codes.length) { msGirMessage('Select at least one process code.'); return; }
    const params = new URLSearchParams({
        machine: msGirMachine, cell: msGirSel.cell, role: msGirRole, processCodes: msGirSel.codes.join(','), range: msGirRange,
        critical, nonCritical, conforming, nonConforming
    });
    if (msGirRange === 'custom') {
        const d = msGirPicker.selectedDates[0];
        if (!d) { msGirMessage('Pick a date.'); return; }
        params.set('date', msGirIsoDay(d));
    }
    const seq = ++msGirSeq;
    msGirMessage('Loading…');
    let d;
    try {
        d = await msGirFetch(`/api/machineshop/gaugereport/data?${params}`);
    } catch (e) {
        if (seq === msGirSeq) msGirMessage(`Could not load the data (${e.message}).`);
        return;
    }
    if (seq !== msGirSeq) return;
    msGirPage = 0;
    msGirMessage(!d.components.length ? 'No readings for this selection.'
        : d.componentsTotal > d.components.length ? `Showing the first ${d.components.length} of ${d.componentsTotal} parts (MachineShop:GaugeReport:MaxComponents).` : '');
    msGirRender(d);
}

function msGirRender(d) {
    msGirData = d;
    document.getElementById('msGirMachineName').textContent = msGirMachine + (d ? ` - ${d.cell} - ${d.role}` : '');
    document.getElementById('msGirStart').textContent = d ? msGirFmt(d.from) : '-';
    document.getElementById('msGirEnd').textContent = d ? msGirFmt(d.to) : '-';
    document.getElementById('msGirShift').textContent = d ? d.shift : '-';
    document.getElementById('msGirCount').textContent = `${d ? d.componentsTotal : 0} Component`;
    document.getElementById('msGirExcel').disabled = !d || !d.rows.length;
    const grid = document.getElementById('msGirGrid');
    if (!d) { grid.innerHTML = ''; document.getElementById('msGirPager').innerHTML = ''; return; }
    msGirRenderPage();
}

function msGirRenderPage() {
    const d = msGirData;
    const size = msGirOptions.pageSize || 10;
    const pages = Math.max(1, Math.ceil(d.rows.length / size));
    msGirPage = Math.min(Math.max(0, msGirPage), pages - 1);
    const rows = d.rows.slice(msGirPage * size, (msGirPage + 1) * size);
    const parts = d.components.map(c => `<th class="ms-gir-part">
            <span class="ms-gir-qr">${msGirEsc(c.qrCode)}</span>
            <span class="ms-gir-op">${msGirEsc(c.operator)}${c.userName ? ' - ' + msGirEsc(c.userName) : ''}</span>
            <span class="ms-gir-time">${msGirFmt(c.firstReading)}</span></th>`).join('');
    const body = rows.map(r => `<tr>
        <td class="ms-gir-fix ms-gir-c0">${r.sNo}</td>
        <td class="ms-gir-fix ms-gir-c1">${msGirEsc(r.processCode)}</td>
        <td class="ms-gir-fix ms-gir-c2">${msGirEsc(r.description)}${r.critical ? '<span class="ms-gir-crit" title="Critical parameter">*</span>' : ''}</td>
        <td class="ms-gir-fix ms-gir-c3">${msGirEsc(r.specification)}</td>
        <td class="ms-gir-fix ms-gir-c4">${msGirEsc(r.gaugeNumber)}</td>
        ${r.values.map(v => v ? `<td class="ms-gir-val${v.nok ? ' ms-gir-nok' : ''}">${msGirEsc(v.text)}</td>`
            : '<td class="ms-gir-val"><span class="ms-gir-blank">-</span></td>').join('')}
    </tr>`).join('');
    const span = 5 + d.components.length;
    document.getElementById('msGirGrid').innerHTML = `<table class="ms-gir-table">
        <thead><tr>
            <th class="ms-gir-fix ms-gir-c0">S.No</th><th class="ms-gir-fix ms-gir-c1">Process Code</th>
            <th class="ms-gir-fix ms-gir-c2">Part Parameter Description</th><th class="ms-gir-fix ms-gir-c3">Specification</th>
            <th class="ms-gir-fix ms-gir-c4">Gauge No</th>${parts}
        </tr></thead>
        <tbody>${body || `<tr><td colspan="${span}" class="ms-gir-empty">No parameters for this selection</td></tr>`}</tbody>
    </table>`;
    msGirRenderPager(pages, d.rows.length);
}

// Page buttons: first, previous, a window of page numbers, next, last.
function msGirRenderPager(pages, total) {
    const pager = document.getElementById('msGirPager');
    const p = msGirPage;
    const nums = [];
    for (let i = 0; i < pages; i++) {
        if (i === 0 || i === pages - 1 || Math.abs(i - p) <= 2) nums.push(i);
        else if (nums[nums.length - 1] !== '…') nums.push('…');
    }
    pager.innerHTML = `<span class="ms-gir-total">Total Row Count: ${total}</span>
        <button type="button" data-page="${p - 1}" ${p === 0 ? 'disabled' : ''} title="Previous page">‹</button>
        ${nums.map(n => n === '…' ? '<span class="ms-gir-gap">…</span>'
            : `<button type="button" data-page="${n}" class="${n === p ? 'active' : ''}">${n + 1}</button>`).join('')}
        <button type="button" data-page="${p + 1}" ${p >= pages - 1 ? 'disabled' : ''} title="Next page">›</button>`;
    pager.querySelectorAll('button[data-page]').forEach(b => b.addEventListener('click', () => {
        msGirPage = Number(b.dataset.page);
        msGirRenderPage();
        document.getElementById('msGirGrid').scrollTop = 0;
    }));
}

// Excel: the whole report (all rows, all parts) laid out as on screen; red cells for out of limit / Not OK.
async function msGirDownload() {
    const d = msGirData;
    if (!d || !d.rows.length) return;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Gauge Inspection Report');
    sheet.addRow([`Gauge Inspection Report - ${d.machine} - ${d.cell} - ${d.role}`]).font = { bold: true, size: 13 };
    sheet.addRow([`Start Time: ${msGirFmt(d.from)}`, '', `End Time: ${msGirFmt(d.to)}`, '', `Current Shift: ${d.shift}`, `${d.componentsTotal} Component`]);
    sheet.addRow([]);
    const fixed = ['S.No', 'Process Code', 'Part Parameter Description', 'Specification', 'Gauge No'];
    const head = [
        sheet.addRow([...fixed, ...d.components.map(c => c.qrCode)]),
        sheet.addRow(['', '', '', '', '', ...d.components.map(c => c.operator + (c.userName ? ` - ${c.userName}` : ''))]),
        sheet.addRow(['', '', '', '', '', ...d.components.map(c => msGirFmt(c.firstReading))])
    ];
    const headFill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEF2F7' } };
    head.forEach(r => {
        r.font = { bold: true };
        r.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
        r.eachCell({ includeEmpty: true }, c => { c.fill = headFill; });
    });
    const first = head[0].number;
    for (let col = 1; col <= fixed.length; col++) sheet.mergeCells(first, col, first + 2, col);
    d.rows.forEach(r => {
        const row = sheet.addRow([r.sNo, r.processCode, r.description + (r.critical ? ' *' : ''), r.specification || '', r.gaugeNumber || '',
            ...r.values.map(v => {
                if (!v) return '-';
                const n = Number(v.text);
                return v.text !== '' && Number.isFinite(n) ? n : v.text;
            })]);
        row.alignment = { vertical: 'middle', wrapText: true };
        r.values.forEach((v, i) => {
            const cell = row.getCell(fixed.length + 1 + i);
            cell.alignment = { horizontal: 'center', vertical: 'middle' };
            if (v?.nok) {
                cell.font = { bold: true, color: { argb: 'FFDC2626' } };
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFDE8E8' } };
            }
        });
    });
    [7, 14, 45, 26, 14].forEach((w, i) => { sheet.getColumn(i + 1).width = w; });
    d.components.forEach((c, i) => { sheet.getColumn(fixed.length + 1 + i).width = 22; });
    sheet.views = [{ state: 'frozen', xSplit: fixed.length, ySplit: first + 2 }];
    const day = (d.from || '').slice(0, 10);
    const name = `Gauge_Inspection_Report_${d.machine}_${d.cell}_${d.role}_${day}`.replace(/\s+/g, '');
    await downloadWorkbook(workbook, `${name}.xlsx`);
}
