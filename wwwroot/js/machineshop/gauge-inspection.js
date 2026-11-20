// Machine Shop > Gauge Inspection Data (tab-ms-gid; prefix msGid / ms-gid-). Port of the ThingWorx mashup
// QF_OnlineInspection_MU (Thing "QF_Online _Inspection _DB_TH"). Read-only.
// Machine tabs, Cell, Shift (multi), Process Code (multi), TODAY / CUSTOM (From - To) and SUBMIT ->
// GET /api/machineshop/gaugeinspection/data: one row per day x process code x shift with Operator / Inspector Plan
// and Actual (parts checked) + a Cumulative row. Options: .../options, process codes: .../processcodes?machine=.

let msGidOptions = null;     // { machines: [{ name, hasSource, hasCells }], cells, shifts, maxRangeDays, customDefaultDaysBack }
let msGidMachine = '';
let msGidRange = 'today';
let msGidPickers = {};       // from, to
let msGidSeq = 0;            // drops answers of an older request
const msGidCodes = {};       // machine -> process codes
const msGidSel = { cell: '', shifts: [], codes: [] };

function msGidEsc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function msGidFetch(url) {
    const r = await fetch(url);
    if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
    return r.json();
}

function msGidIsoDay(d) {
    const pad = v => String(v).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// "2026-11-12T00:15:00" -> "2026/11/12 00:15" (ThingWorx grid format YYYY/MM/DD HH:mm)
function msGidFmtDate(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s || '');
    return m ? `${m[1]}/${m[2]}/${m[3]} ${m[4]}:${m[5]}` : '';
}

function msGidMachineInfo() {
    return msGidOptions?.machines.find(m => m.name === msGidMachine) || null;
}

async function msGidShow() {
    if (!msGidOptions) {
        try {
            msGidOptions = await msGidFetch('/api/machineshop/gaugeinspection/options');
        } catch (e) {
            msGidMessage(`Could not load the machines (${e.message}).`);
            return;
        }
        msGidMachine = msGidOptions.machines.length ? msGidOptions.machines[0].name : '';
        msGidSel.cell = msGidOptions.cells[0] || '';
        msGidSel.shifts = msGidOptions.shifts.slice();
        msGidBuildControls();
        await msGidSelectMachine(msGidMachine);
    }
}

function msGidBuildControls() {
    const tabs = document.getElementById('msGidTabs');
    tabs.innerHTML = msGidOptions.machines.map(m =>
        `<button type="button" class="ms-pdi-tab${m.hasSource ? '' : ' ms-gid-tab-empty'}" data-machine="${msGidEsc(m.name)}"
            title="${m.hasSource ? '' : 'No data source for this machine'}">${msGidEsc(m.name)}</button>`).join('');
    tabs.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.machine !== msGidMachine) msGidSelectMachine(b.dataset.machine);
    }));

    const cell = document.getElementById('msGidCell');
    cell.innerHTML = msGidOptions.cells.map(c => `<option value="${msGidEsc(c)}">${msGidEsc(c)}</option>`).join('');
    cell.value = msGidSel.cell;
    cell.addEventListener('change', () => { msGidSel.cell = cell.value; });

    msGidBuildMulti('msGidShifts', msGidOptions.shifts.map(s => [s, `Shift ${s}`]), msGidSel.shifts, 'Select Shift',
        values => { msGidSel.shifts = values; });

    document.querySelectorAll('#msGidRanges button').forEach(b => b.addEventListener('click', () => {
        msGidRange = b.dataset.range;
        msGidSyncRange();
    }));

    const today = currentProductionDayRange().start;
    const from = new Date(today);
    from.setDate(from.getDate() - (msGidOptions.customDefaultDaysBack || 0));
    const pick = (id, def) => flatpickr(id, { dateFormat: 'd-m-Y', defaultDate: def, maxDate: today, disableMobile: true });
    msGidPickers.from = pick('#msGidFrom', from);
    msGidPickers.to = pick('#msGidTo', today);

    document.getElementById('msGidSubmit').addEventListener('click', msGidLoad);
    document.addEventListener('click', e => {
        document.querySelectorAll('.ms-gid-multi').forEach(m => {
            if (!m.contains(e.target)) m.querySelector('.ms-gid-multi-menu').hidden = true;
        });
    });
    msGidSyncRange();
}

function msGidSyncRange() {
    document.querySelectorAll('#msGidRanges button').forEach(b => b.classList.toggle('active', b.dataset.range === msGidRange));
    document.getElementById('msGidDates').hidden = msGidRange !== 'custom';
}

// Multi-select drop-down (ThingWorx ptcs-dropdown MultiSelect: "All Selected" / "n Selected").
function msGidBuildMulti(id, items, selected, hint, onChange) {
    const box = document.getElementById(id);
    box.innerHTML = `
        <button type="button" class="ms-gid-multi-btn"><span class="ms-gid-multi-text"></span><span class="material-symbols-outlined">expand_more</span></button>
        <div class="ms-gid-multi-menu" hidden>
            <label class="ms-gid-multi-all"><input type="checkbox" data-all="1"> Select all</label>
            ${items.map(([v, label]) => `<label><input type="checkbox" value="${msGidEsc(v)}"> ${msGidEsc(label)}</label>`).join('')}
        </div>`;
    const menu = box.querySelector('.ms-gid-multi-menu');
    const boxes = [...menu.querySelectorAll('input[value]')];
    const all = menu.querySelector('input[data-all]');
    const sync = () => {
        const values = boxes.filter(b => b.checked).map(b => b.value);
        all.checked = values.length === boxes.length && boxes.length > 0;
        all.indeterminate = values.length > 0 && values.length < boxes.length;
        box.querySelector('.ms-gid-multi-text').textContent = !boxes.length ? 'None available'
            : values.length === 0 ? hint : values.length === boxes.length ? 'All Selected' : `${values.length} Selected`;
        box.querySelector('.ms-gid-multi-btn').disabled = !boxes.length;
        onChange(values);
    };
    boxes.forEach(b => { b.checked = selected.includes(b.value); b.addEventListener('change', sync); });
    all.addEventListener('change', () => { boxes.forEach(b => { b.checked = all.checked; }); sync(); });
    box.querySelector('.ms-gid-multi-btn').addEventListener('click', () => { menu.hidden = !menu.hidden; });
    sync();
}

async function msGidSelectMachine(name) {
    msGidMachine = name;
    document.querySelectorAll('#msGidTabs button').forEach(b => b.classList.toggle('active', b.dataset.machine === name));
    const info = msGidMachineInfo();
    const cell = document.getElementById('msGidCell');
    cell.disabled = !info?.hasCells;
    cell.title = info?.hasCells ? '' : 'This machine has no cell data - all cells are counted';
    msGidRender(null);
    if (!info?.hasSource) {
        msGidBuildMulti('msGidCodes', [], [], 'Select Process Code', v => { msGidSel.codes = v; });
        msGidMessage('No data source for this machine (none in ThingWorx either).');
        return;
    }
    msGidMessage('Loading process codes…');
    let codes = msGidCodes[name];
    if (!codes) {
        try {
            codes = await msGidFetch(`/api/machineshop/gaugeinspection/processcodes?machine=${encodeURIComponent(name)}`);
            msGidCodes[name] = codes;
        } catch (e) {
            if (name === msGidMachine) msGidMessage(`Could not load the process codes (${e.message}).`);
            return;
        }
    }
    if (name !== msGidMachine) return;
    msGidBuildMulti('msGidCodes', codes.map(c => [c, c]), codes, 'Select Process Code', v => { msGidSel.codes = v; });
    msGidLoad();
}

function msGidMessage(text) {
    const note = document.getElementById('msGidNote');
    note.textContent = text || '';
}

async function msGidLoad() {
    const info = msGidMachineInfo();
    if (!info) return;
    if (!info.hasSource) { msGidMessage('No data source for this machine (none in ThingWorx either).'); return; }
    if (!msGidSel.shifts.length) { msGidMessage('Select at least one shift.'); return; }
    if (!msGidSel.codes.length) { msGidMessage('Select at least one process code.'); return; }
    const params = new URLSearchParams({
        machine: msGidMachine, cell: msGidSel.cell, shifts: msGidSel.shifts.join(','), processCodes: msGidSel.codes.join(','), range: msGidRange
    });
    if (msGidRange === 'custom') {
        const f = msGidPickers.from.selectedDates[0], t = msGidPickers.to.selectedDates[0];
        if (!f || !t) { msGidMessage('Pick From and To.'); return; }
        if (t < f) { msGidMessage('From must not be after To.'); return; }
        if ((t - f) / 86400000 >= msGidOptions.maxRangeDays) { msGidMessage(`Select at most ${msGidOptions.maxRangeDays} days.`); return; }
        params.set('from', msGidIsoDay(f));
        params.set('to', msGidIsoDay(t));
    }
    const seq = ++msGidSeq;
    msGidMessage('Loading…');
    let d;
    try {
        d = await msGidFetch(`/api/machineshop/gaugeinspection/data?${params}`);
    } catch (e) {
        if (seq === msGidSeq) msGidMessage(`Could not load the data (${e.message}).`);
        return;
    }
    if (seq !== msGidSeq) return;
    msGidMessage(d.hasCells ? '' : 'This machine has no cell data - every cell is counted.');
    msGidRender(d);
}

function msGidRender(d) {
    const head = document.getElementById('msGidWindow');
    const grid = document.getElementById('msGidGrid');
    document.getElementById('msGidMachineName').textContent = msGidMachine + (d?.cell ? ` - ${d.cell}` : '');
    head.textContent = d ? `${msGidFmtDate(d.from)} - ${msGidFmtDate(d.to)}` : '';
    if (!d) { grid.innerHTML = ''; return; }
    const num = v => (v == null ? '<span class="ms-gid-blank" title="Shift not started yet">-</span>' : String(v));
    // Green = plan met, red = short; only for finished shifts (a running shift is still filling up).
    const actualClass = (r, plan, actual) => (!r.finished || actual == null || plan === 0 ? '' : actual >= plan ? ' ms-gid-ok' : ' ms-gid-short');
    const rows = d.rows.map(r => `<tr>
        <td>${msGidFmtDate(r.date)}</td><td>${msGidEsc(r.shift)}</td><td>${msGidEsc(r.operation)}</td>
        <td class="ms-gid-num">${r.operatorPlan}</td><td class="ms-gid-num${actualClass(r, r.operatorPlan, r.operatorActual)}">${num(r.operatorActual)}</td>
        <td class="ms-gid-num">${r.inspectorPlan}</td><td class="ms-gid-num${actualClass(r, r.inspectorPlan, r.inspectorActual)}">${num(r.inspectorActual)}</td>
    </tr>`).join('');
    const c = d.cumulative;
    grid.innerHTML = `<table class="ms-gid-table">
        <thead><tr><th>Date</th><th>Shift</th><th>Operation</th><th class="ms-gid-num">Operator Plan</th><th class="ms-gid-num">Operator Actual</th>
            <th class="ms-gid-num">Inspector Plan</th><th class="ms-gid-num">Inspector Actual</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="ms-gid-empty">No rows</td></tr>'}</tbody>
        ${c ? `<tfoot><tr><td></td><td></td><td>Cumulative</td><td class="ms-gid-num">${c.operatorPlan}</td><td class="ms-gid-num">${c.operatorActual}</td>
            <td class="ms-gid-num">${c.inspectorPlan}</td><td class="ms-gid-num">${c.inspectorActual}</td></tr></tfoot>` : ''}
    </table>`;
}
