// =============================================================================================
// Machine Shop history card page (ms-history-card.html?card=&barcode=&cell=) - port of the ThingWorx
// mashup QF_MachineShop_HistoryCardMU: header (Barcode / Date & Time / Shift), Table 1 = station lines
// (getHistoryCardDataTable1), Table 2 = SPC lines of Cover LH / RH (getHistoryCardDataTable2).
// Export - CSV: both tables (ThingWorx exported Table 1 only). Export - PDF: the browser's print dialog
// (Save as PDF) on a print layout (ThingWorx generated the PDF on the server). Globals prefixed msHcp.
// =============================================================================================

let msHcpData = null;

function msHcpEsc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// OK / NOK values coloured; empty values on data rows shown as a muted dash.
function msHcpValueCell(value, heading) {
    const v = String(value ?? '').trim();
    if (!v) return `<td class="ms-hc-value ${heading ? '' : 'ms-hc-missing'}">${heading ? '' : '-'}</td>`;
    const cls = /^ok$/i.test(v) ? 'ms-hc-ok' : /^nok$/i.test(v) ? 'ms-hc-nok' : '';
    return `<td class="ms-hc-value ${cls}">${msHcpEsc(v)}</td>`;
}

function msHcpRender(d) {
    const when = d.dateTime ? String(d.dateTime).replace('T', ' ').slice(0, 19) : '-';
    document.title = `${d.card} ${d.barcode} | History Card`;
    document.getElementById('msHcpTitle').textContent = `${d.card} - History Card`;
    document.getElementById('msHcpSub').textContent = `Updated ${String(d.updatedAt).replace('T', ' ').slice(0, 19)}`;
    const info = [
        ['Barcode Number', d.barcode], ['Date & Time', when], ['Shift', d.shift || '-'],
        ['Cell', d.cell || '-'], ['PDI Status', d.pdiStatus || '-']
    ].map(([k, v]) => `<div><span>${k}</span><b>${msHcpEsc(v)}</b></div>`).join('');

    const lines = d.lines.map(l => `<tr class="${l.heading ? 'ms-hc-station' : ''}">
        <td class="ms-hc-sno">${msHcpEsc(l.serialNo)}</td>
        <td>${msHcpEsc(l.description)}</td>
        <td>${msHcpEsc(l.specification)}</td>
        ${msHcpValueCell(l.value, l.heading)}
        <td>${msHcpEsc(l.remarks)}</td></tr>`).join('');

    let spc = '';
    if (d.spc) {
        const rows = d.spc.map(l => l.heading
            ? `<tr class="ms-hc-station"><td class="ms-hc-sno"></td><td colspan="4">${msHcpEsc(l.description)}</td>
                 <td>${msHcpEsc(l.current)}</td><td>${msHcpEsc(l.previous)}</td><td>${msHcpEsc(l.next)}</td></tr>`
            : `<tr><td class="ms-hc-sno">${msHcpEsc(l.serialNo)}</td><td>${msHcpEsc(l.description)}</td>
                 <td>${msHcpEsc(l.specification)}</td><td>${msHcpEsc(l.gauge)}</td><td>${msHcpEsc(l.method)}</td>
                 ${msHcpValueCell(l.current)}${msHcpValueCell(l.previous)}${msHcpValueCell(l.next)}</tr>`).join('');
        spc = `<div class="ms-hc-section">
            <div class="ms-hc-section-title">Online SPC</div>
            <table class="ms-pdi-table"><thead><tr><th>S.No</th><th>Parameter Description</th><th>Specification</th>
                <th>Gauge Number</th><th>Checking Method</th><th>Current Barcode Reading</th>
                <th>Previous Barcode Reading</th><th>Next Barcode Reading</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="8">No SPC lines.</td></tr>'}</tbody></table></div>`;
    }

    document.getElementById('msHcpBody').innerHTML = `
        <div class="ms-hc-section" style="margin-bottom:10px"><div class="ms-hc-info">${info}</div></div>
        <div class="ms-hc-section" style="margin-bottom:10px">
            <div class="ms-hc-section-title">${msHcpEsc(d.card)} - Station data</div>
            <table class="ms-pdi-table"><thead><tr><th>Serial No</th><th>Parameters Description</th><th>Specification</th>
                <th>Tag Value</th><th>Remarks</th></tr></thead><tbody>${lines}</tbody></table>
        </div>${spc}`;
}

// CSV: header rows, Table 1, then Table 2 (Cover LH / RH). File MachineShop_<barcode>.csv.
function msHcpCsv() {
    const d = msHcpData;
    if (!d) return;
    const q = v => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const out = [
        ['BARCODE Number :', d.barcode], ['DATE & TIME :', d.dateTime ? String(d.dateTime).replace('T', ' ').slice(0, 19) : ''],
        ['SHIFT :', d.shift], ['CELL :', d.cell], [],
        ['SERIAL NO', 'PARAMETERS DESCRIPTION', 'SPECIFICATION', 'TAG VALUE', 'REMARKS'],
        ...d.lines.map(l => [l.serialNo, l.description, l.specification, l.value, l.remarks])
    ];
    if (d.spc) {
        out.push([], ['S.No', 'Parameter Description', 'Specification', 'Gauge Number', 'Checking Method',
            'Current Barcode Reading', 'Previous Barcode Reading', 'Next Barcode Reading']);
        d.spc.forEach(l => out.push([l.serialNo, l.description, l.specification, l.gauge, l.method, l.current, l.previous, l.next]));
    }
    const blob = new Blob(['﻿' + out.map(r => r.map(q).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `MachineShop_${d.barcode.replace(/[^A-Za-z0-9_-]+/g, '_')}.csv`;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 0);
}

async function msHcpLoad() {
    const p = new URLSearchParams(location.search);
    const card = p.get('card') || '', barcode = p.get('barcode') || '';
    const body = document.getElementById('msHcpBody');
    if (!card || !barcode) {
        body.innerHTML = '<div class="ms-hc-message error">Open a history card from Machine Shop > History Card.</div>';
        return;
    }
    document.getElementById('msHcpTitle').textContent = `${card} - History Card`;
    try {
        const r = await fetch(`/api/machineshop/historycard/card?${new URLSearchParams({ card, barcode, cell: p.get('cell') || '' })}`);
        if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
        msHcpData = await r.json();
        msHcpRender(msHcpData);
        document.getElementById('msHcpCsv').disabled = false;
        document.getElementById('msHcpPdf').disabled = false;
    } catch (e) {
        body.innerHTML = `<div class="ms-hc-message error">Could not load the history card (${msHcpEsc(e.message)}).</div>`;
    }
}

document.getElementById('msHcpCsv').addEventListener('click', msHcpCsv);
document.getElementById('msHcpPdf').addEventListener('click', () => window.print());
msHcpLoad();
