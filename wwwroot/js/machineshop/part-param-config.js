// =============================================================================================
// Machine Shop > Part Parameter Config (tab-ms-ppc) - port of the ThingWorx mashup RE_PartParameter_Configuration_MU
// ("PART PARAMETER-CONFIGURATION PAGE"). Machine tabs (ThingWorx RE_Machine_name_DT) -> the machine's critical part
// parameters (GET /api/machineshop/partparam/parameters). Click selects a row (double-click = Edit).
//   Create (partParam_create_popup_MU)  -> POST   /api/machineshop/partparam/parameter
//   Edit   (RE_partParam_Edit_popup_MU) -> PUT    /api/machineshop/partparam/parameter
//   Delete (deleteParameter)            -> DELETE /api/machineshop/partparam/parameter (asks first; ThingWorx did not)
// Non Critical toggle and Sample Size dropdown are saved as soon as they change (PUT .../partparam/settings,
// ControlTowerVLM). Every change is disabled in a view-only copy. Auto Refresh reloads the grid, as in ThingWorx.
// Report Configuration (RE_Gauging_ReportConfi_MU): the machine's Gauging Report layout with a Show tick box per
// row, Select All, Save (GET / PUT /api/machineshop/partparam/report-config); only machines with a layout.
// Globals prefixed msPpc.
// =============================================================================================

let msPpcOptions = null;    // { machines: [{ name, hasSource }], settings, settingsError, sampleSizes, writesEnabled, reportMachines }
let msPpcReportRows = null; // rows of the open Report Configuration pop-up (show = stored value)
let msPpcMachine = '';
let msPpcSeq = 0;           // drops answers of an older request when tabs are clicked quickly
let msPpcList = null;       // last list of the current machine
let msPpcSelected = null;   // PartParaCode of the selected row
let msPpcModalSave = null;  // Save / Update / Delete handler of the open pop-up

function msPpcEsc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function msPpcFormatTime(iso) {
    return iso ? String(iso).replace('T', ' ').slice(0, 19) : '';
}

// yyyy-MM-dd in local time (date input value and API format).
function msPpcDay(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

async function msPpcShow() {
    if (!msPpcOptions) {
        try {
            const r = await fetch('/api/machineshop/partparam/options');
            if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
            msPpcOptions = await r.json();
        } catch (e) {
            document.getElementById('msPpcNote').textContent = `Could not load the machines (${e.message}).`;
            return;
        }
        msPpcRenderTabs();
        msPpcRenderSettings();
        msPpcMachine = msPpcOptions.machines.length ? msPpcOptions.machines[0].name : '';
    }
    msPpcLoad();
}

function msPpcRenderTabs() {
    const tabs = document.getElementById('msPpcTabs');
    tabs.innerHTML = msPpcOptions.machines.map(m =>
        `<button type="button" class="ms-pdi-tab${m.hasSource ? '' : ' ms-ppc-tab-empty'}" data-machine="${msPpcEsc(m.name)}"
            title="${m.hasSource ? '' : 'No parameter table for this machine'}">${msPpcEsc(m.name)}</button>`).join('');
    tabs.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
        if (b.dataset.machine === msPpcMachine) return;
        msPpcMachine = b.dataset.machine;
        msPpcSelected = null;
        msPpcList = null;
        msPpcLoad();
    }));
}

function msPpcRenderSettings() {
    const toggle = document.getElementById('msPpcNonCritical');
    const size = document.getElementById('msPpcSampleSize');
    const o = msPpcOptions;
    size.innerHTML = o.sampleSizes.map(n => `<option value="${n}">${n}</option>`).join('');
    if (o.settings) {
        toggle.checked = o.settings.nonCritical;
        if (o.sampleSizes.includes(o.settings.sampleSize)) size.value = String(o.settings.sampleSize);
    }
    msPpcToggleLabel();
    const editable = !!o.settings && o.writesEnabled;
    toggle.disabled = !editable;
    size.disabled = !editable;
    const why = !o.settings ? `Settings not available: ${o.settingsError}`
        : !o.writesEnabled ? 'View-only copy of the app (App:WritesEnabled = false): the settings cannot be changed here.' : '';
    document.getElementById('msPpcSettings').title = why;
    document.getElementById('msPpcSettingsNote').textContent = o.settings ? '' : 'Settings not available';
    if (!document.getElementById('msPpcSettings').dataset.bound) {
        document.getElementById('msPpcSettings').dataset.bound = '1';
        toggle.addEventListener('change', () => { msPpcToggleLabel(); msPpcSave({ nonCritical: toggle.checked }); });
        size.addEventListener('change', () => msPpcSave({ sampleSize: +size.value }));
    }
}

// ThingWorx expression CriticalValuechange: the toggle reads Yes / No.
function msPpcToggleLabel() {
    document.getElementById('msPpcNonCriticalText').textContent = document.getElementById('msPpcNonCritical').checked ? 'Yes' : 'No';
}

async function msPpcSave(change) {
    const note = document.getElementById('msPpcSettingsNote');
    note.textContent = 'Saving...';
    note.title = '';
    try {
        const r = await fetch('/api/machineshop/partparam/settings', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(change)
        });
        if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
        msPpcOptions.settings = await r.json();
        note.textContent = 'Saved';
        setTimeout(() => { if (note.textContent === 'Saved') note.textContent = ''; }, 2000);
    } catch (e) {
        note.textContent = 'Not saved';
        note.title = e.message;
    }
    msPpcRenderSettings();  // shows what is stored (reverts a failed change)
}

async function msPpcLoad() {
    if (!msPpcMachine) return;
    document.querySelectorAll('#msPpcTabs .ms-pdi-tab').forEach(b => b.classList.toggle('active', b.dataset.machine === msPpcMachine));
    const note = document.getElementById('msPpcNote');
    const grid = document.getElementById('msPpcGrid');
    const seq = ++msPpcSeq;
    note.textContent = 'Loading...';
    try {
        const r = await fetch(`/api/machineshop/partparam/parameters?${new URLSearchParams({ machine: msPpcMachine })}`);
        if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
        const d = await r.json();
        if (seq !== msPpcSeq) return;
        msPpcList = d;
        if (!d.rows.some(r => r.partParaCode === msPpcSelected)) msPpcSelected = null;
        msPpcRender(d);
    } catch (e) {
        if (seq !== msPpcSeq) return;
        msPpcList = null;
        note.textContent = `Could not load the part parameters (${e.message}).`;
        grid.innerHTML = '';
    }
    msPpcUpdateButtons();
}

function msPpcCheck(v) {
    const icon = v ? 'check_box' : 'check_box_outline_blank';
    return `<span class="material-symbols-outlined ms-ppc-check${v ? ' on' : ''}"${v == null ? ' title="Not set"' : ''}>${icon}</span>`;
}

function msPpcRender(d) {
    const note = document.getElementById('msPpcNote');
    const grid = document.getElementById('msPpcGrid');
    if (!d.hasSource) {
        note.textContent = '';
        grid.innerHTML = `<div class="ms-pdi-grid-empty"><span class="material-symbols-outlined">info</span>No parameter table configured for ${msPpcEsc(d.machine)}.</div>`;
        return;
    }
    const critical = d.rows.filter(r => r.criticalParameter).length;
    note.textContent = `${d.machine} - ${d.rows.length} part parameter${d.rows.length === 1 ? '' : 's'}, ${critical} critical - refreshed ${msPpcFormatTime(d.updatedAt)}`
        + (msPpcOptions.writesEnabled ? ' - click a row to select it, double-click to edit' : ' - view-only copy, no changes possible');
    if (!d.rows.length) {
        grid.innerHTML = `<div class="ms-pdi-grid-empty">No part parameters.</div>`;
        return;
    }
    // ThingWorx grid columns, same order (single row selection).
    grid.innerHTML = `<table class="ms-pdi-table ms-ppc-table">
        <thead><tr><th>PartPara Code</th><th>PartPara Description</th><th>Critical Parameter</th><th>Updated Date</th>
            <th>Operator</th><th>SPC</th><th>Inspector</th><th>ProductParameter</th></tr></thead>
        <tbody>${d.rows.map((r, i) => `<tr data-i="${i}"${r.partParaCode === msPpcSelected ? ' class="selected"' : ''}>
            <td class="ms-ppc-code">${msPpcEsc(r.partParaCode)}</td>
            <td class="ms-ppc-desc">${msPpcEsc(r.partParaDescription)}</td>
            <td>${msPpcCheck(r.criticalParameter)}</td>
            <td class="ms-ppc-date">${msPpcEsc(msPpcFormatTime(r.updatedDate))}</td>
            <td>${msPpcCheck(r.operator)}</td>
            <td>${msPpcCheck(r.spc)}</td>
            <td>${msPpcCheck(r.inspector)}</td>
            <td>${msPpcCheck(r.productParameter)}</td>
        </tr>`).join('')}</tbody></table>`;
    const body = grid.querySelector('tbody');
    body.addEventListener('click', e => {
        const tr = e.target.closest('tr[data-i]');
        if (!tr) return;
        body.querySelectorAll('tr.selected').forEach(x => x.classList.remove('selected'));
        tr.classList.add('selected');
        msPpcSelected = d.rows[+tr.dataset.i].partParaCode;
        msPpcUpdateButtons();
    });
    body.addEventListener('dblclick', e => { if (e.target.closest('tr[data-i]')) msPpcEdit(); });
}

function msPpcSelectedRow() {
    return msPpcList?.rows.find(r => r.partParaCode === msPpcSelected) || null;
}

// Create needs a machine with a table; Edit / Delete also a selected row; none of them in a view-only copy.
function msPpcUpdateButtons() {
    const canWrite = !!msPpcOptions?.writesEnabled && !!msPpcList?.hasSource;
    const why = !msPpcOptions?.writesEnabled ? 'View-only copy of the app (App:WritesEnabled = false)'
        : !msPpcList?.hasSource ? 'No parameter table for this machine' : '';
    const set = (id, enabled, hint) => {
        const b = document.getElementById(id);
        b.disabled = !enabled;
        b.title = enabled ? '' : hint;
    };
    set('msPpcCreateBtn', canWrite, why);
    set('msPpcEditBtn', canWrite && !!msPpcSelectedRow(), why || 'Select a row first');
    set('msPpcDeleteBtn', canWrite && !!msPpcSelectedRow(), why || 'Select a row first');
    // Report Configuration also opens in a view-only copy (read-only there).
    set('msPpcReportBtn', !!msPpcOptions?.reportMachines?.includes(msPpcMachine), 'No Gauging Report layout for this machine');
}

// ---- Pop-ups (look of the PDI pop-ups) ----
function msPpcModal() {
    let modal = document.getElementById('msPpcModal');
    if (modal) return modal;
    modal = document.createElement('div');
    modal.id = 'msPpcModal';
    modal.className = 'ms-pdi-modal ms-ppc-modal';
    modal.innerHTML = `
        <div class="ms-pdi-modal-box ms-ppc-modal-box" role="dialog" aria-modal="true" aria-labelledby="msPpcModalTitle">
            <div class="ms-pdi-modal-head">
                <div>
                    <div class="ms-pdi-modal-title" id="msPpcModalTitle"></div>
                    <div class="ms-pdi-modal-sub" id="msPpcModalSub"></div>
                </div>
                <button class="ms-pdi-modal-close" type="button" title="Close" aria-label="Close">&times;</button>
            </div>
            <div class="ms-ppc-form" id="msPpcModalBody"></div>
            <div class="ms-ppc-modal-msg" id="msPpcModalMsg"></div>
            <div class="ms-ppc-modal-actions">
                <button type="button" class="ms-pdi-submit" id="msPpcModalOk"></button>
                <button type="button" class="ms-pdi-modal-download" id="msPpcModalCancel">Cancel</button>
            </div>
        </div>`;
    document.body.appendChild(modal);
    modal.addEventListener('click', e => {
        if (e.target === modal || e.target.closest('.ms-pdi-modal-close') || e.target.id === 'msPpcModalCancel') msPpcCloseModal();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && modal.classList.contains('open')) msPpcCloseModal(); });
    document.getElementById('msPpcModalOk').addEventListener('click', () => { if (msPpcModalSave) msPpcModalSave(); });
    return modal;
}

function msPpcOpenModal(title, okLabel, bodyHtml, onOk, danger, wide) {
    const modal = msPpcModal();
    modal.querySelector('.ms-ppc-modal-box').classList.toggle('ms-ppc-modal-wide', !!wide);
    document.getElementById('msPpcModalTitle').textContent = title;
    document.getElementById('msPpcModalSub').textContent = msPpcMachine;
    document.getElementById('msPpcModalBody').innerHTML = bodyHtml;
    document.getElementById('msPpcModalMsg').textContent = '';
    const ok = document.getElementById('msPpcModalOk');
    ok.textContent = okLabel;
    ok.disabled = false;
    ok.classList.toggle('ms-ppc-danger', !!danger);
    msPpcModalSave = onOk;
    modal.classList.add('open');
    if (!wide) modal.querySelector('input:not([readonly]), textarea')?.focus();
}

function msPpcCloseModal() {
    document.getElementById('msPpcModal')?.classList.remove('open');
    msPpcModalSave = null;
}

// Create / Edit form. Create: code, description, Critical Parameter, Updated Date (ThingWorx partParam_create_popup_MU);
// Edit adds Operator / Inspector / SPC and shows the code read-only (RE_partParam_Edit_popup_MU).
function msPpcForm(row) {
    const check = (id, label, v) => `<label class="ms-ppc-check-field"><input type="checkbox" id="${id}"${v ? ' checked' : ''}> ${label}</label>`;
    const date = row?.updatedDate ? String(row.updatedDate).slice(0, 10) : msPpcDay(new Date());
    return `
        <label class="ms-ppc-field">${row ? '' : '* '}PartPara Code
            <input type="text" id="msPpcFCode" maxlength="100" autocomplete="off" value="${msPpcEsc(row?.partParaCode)}"${row ? ' readonly' : ''}>
        </label>
        <label class="ms-ppc-field">* PartPara Description
            <textarea id="msPpcFDesc" maxlength="500" rows="3">${msPpcEsc(row?.partParaDescription)}</textarea>
        </label>
        <div class="ms-ppc-checks">
            ${check('msPpcFCritical', 'Critical Parameter', row?.criticalParameter)}
            ${row ? check('msPpcFOperator', 'Operator', row.operator) + check('msPpcFInspector', 'Inspector', row.inspector) + check('msPpcFSpc', 'SPC', row.spc) : ''}
        </div>
        <label class="ms-ppc-field ms-ppc-field-date">Updated Date
            <input type="date" id="msPpcFDate" value="${msPpcEsc(date)}">
        </label>`;
}

function msPpcCreate() {
    if (document.getElementById('msPpcCreateBtn').disabled) return;
    msPpcOpenModal('Part Parameter Create screen', 'Save', msPpcForm(null), () => msPpcSubmit('POST'));
}

function msPpcEdit() {
    const row = msPpcSelectedRow();
    if (!row || document.getElementById('msPpcEditBtn').disabled) return;
    msPpcOpenModal('Part Parameter Edit screen', 'Update', msPpcForm(row), () => msPpcSubmit('PUT'));
}

function msPpcDelete() {
    const row = msPpcSelectedRow();
    if (!row || document.getElementById('msPpcDeleteBtn').disabled) return;
    msPpcOpenModal('Delete Part Parameter', 'Delete', `
        <div class="ms-ppc-confirm">Delete <b>${msPpcEsc(row.partParaCode)}</b> - ${msPpcEsc(row.partParaDescription)}?<br>
        This removes it from the plant table and cannot be undone.</div>`,
        () => msPpcSend('DELETE', `/api/machineshop/partparam/parameter?${new URLSearchParams({ machine: msPpcMachine, code: row.partParaCode })}`, null, null), true);
}

function msPpcSubmit(method) {
    const v = id => document.getElementById(id);
    const code = v('msPpcFCode').value;
    const body = {
        machine: msPpcMachine,
        partParaCode: method === 'POST' ? code.trim() : code,
        partParaDescription: v('msPpcFDesc').value.trim(),
        criticalParameter: v('msPpcFCritical').checked,
        operator: v('msPpcFOperator')?.checked ?? false,
        inspector: v('msPpcFInspector')?.checked ?? false,
        spc: v('msPpcFSpc')?.checked ?? false,
        updatedDate: v('msPpcFDate').value
    };
    // Same checks as the ThingWorx service (CreateCriricalParameter).
    const msg = document.getElementById('msPpcModalMsg');
    if (!body.partParaCode) { msg.textContent = 'Please give input for PartPara Code.'; return; }
    if (!body.partParaDescription) { msg.textContent = 'Please give input for PartPara Description.'; return; }
    msPpcSend(method, '/api/machineshop/partparam/parameter', body, body.partParaCode);
}

// ---- Report Configuration (ThingWorx RE_Gauging_ReportConfi_MU -> getConfigurationData / updateConfTable) ----
async function msPpcReportConfig() {
    if (document.getElementById('msPpcReportBtn').disabled) return;
    const note = document.getElementById('msPpcNote');
    let rows;
    try {
        const r = await fetch(`/api/machineshop/partparam/report-config?${new URLSearchParams({ machine: msPpcMachine })}`);
        if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
        rows = await r.json();
    } catch (e) {
        note.textContent = `Could not load the report configuration (${e.message}).`;
        return;
    }
    msPpcReportRows = rows;
    const canWrite = !!msPpcOptions.writesEnabled;
    const dis = canWrite ? '' : ' disabled';
    // ThingWorx grid columns (SNo, ProcessCode, PartParaDescription, Specification, GaugeNumber, Show).
    const body = `
        <div class="ms-ppc-report-bar">
            <button type="button" class="ms-pdi-modal-download" id="msPpcRcAll"${dis}>Select All</button>
            <span class="ms-ppc-report-count" id="msPpcRcCount"></span>
        </div>
        <div class="ms-ppc-report-grid">
            <table class="ms-pdi-table ms-ppc-table ms-ppc-report-table">
                <thead><tr><th>S.No</th><th>Process Code</th><th>PartPara Description</th><th>Specification</th><th>Gauge Number</th><th>Show</th></tr></thead>
                <tbody>${rows.map((r, i) => `<tr>
                    <td>${msPpcEsc(r.sNo)}</td>
                    <td class="ms-ppc-code">${msPpcEsc(r.processCode)}</td>
                    <td class="ms-ppc-desc">${msPpcEsc(r.partParaDescription)}</td>
                    <td class="ms-ppc-code">${msPpcEsc(r.specification)}</td>
                    <td class="ms-ppc-code">${msPpcEsc(r.gaugeNumber)}</td>
                    <td><input type="checkbox" class="ms-ppc-rc-show" data-i="${i}"${r.show ? ' checked' : ''}${dis}></td>
                </tr>`).join('')}</tbody>
            </table>
        </div>`;
    msPpcOpenModal('Report Configuration', 'Save', body, msPpcReportSave, false, true);
    const box = document.getElementById('msPpcModalBody');
    const count = () => {
        const shown = box.querySelectorAll('.ms-ppc-rc-show:checked').length;
        document.getElementById('msPpcRcCount').textContent = `${shown} of ${rows.length} shown in the Gauging Report`;
        if (canWrite) document.getElementById('msPpcModalMsg').textContent = '';
    };
    box.addEventListener('change', e => { if (e.target.classList.contains('ms-ppc-rc-show')) count(); });
    // ThingWorx Select All (getConfigurationData selectAll = true) ticks every row; Save stores it.
    document.getElementById('msPpcRcAll').addEventListener('click', () => {
        box.querySelectorAll('.ms-ppc-rc-show').forEach(c => { c.checked = true; });
        count();
    });
    count();
    const ok = document.getElementById('msPpcModalOk');
    ok.disabled = !canWrite;
    if (!canWrite) document.getElementById('msPpcModalMsg').textContent = 'View-only copy of the app (App:WritesEnabled = false): changes cannot be saved here.';
}

function msPpcReportSave() {
    const changed = [...document.querySelectorAll('#msPpcModalBody .ms-ppc-rc-show')]
        .map(c => ({ row: msPpcReportRows[+c.dataset.i], show: c.checked }))
        .filter(x => x.row.show !== x.show)
        .map(x => ({ id: x.row.id, show: x.show }));
    if (!changed.length) { document.getElementById('msPpcModalMsg').textContent = 'No changes to save.'; return; }
    msPpcSend('PUT', '/api/machineshop/partparam/report-config', { machine: msPpcMachine, rows: changed }, msPpcSelected);
}

// Sends the change; closes the pop-up and reloads the grid on success, otherwise shows the server's message.
async function msPpcSend(method, url, body, selectCode) {
    const msg = document.getElementById('msPpcModalMsg');
    const ok = document.getElementById('msPpcModalOk');
    ok.disabled = true;
    msg.textContent = 'Saving...';
    try {
        const r = await fetch(url, {
            method,
            headers: body ? { 'Content-Type': 'application/json' } : {},
            body: body ? JSON.stringify(body) : undefined
        });
        const text = await r.text();
        let message = text;
        try { const j = JSON.parse(text); message = j.message || j.error || j.detail || j.title || text; } catch { /* plain text */ }
        if (!r.ok) throw new Error(message || `HTTP ${r.status}`);
        msPpcCloseModal();
        msPpcSelected = selectCode;
        await msPpcLoad();
        const note = document.getElementById('msPpcNote');
        note.textContent = `${message} ${note.textContent}`;
    } catch (e) {
        msg.textContent = e.message;
        ok.disabled = false;
    }
}
