// =============================================================================================
// Machine Shop > History Card (tab-ms-hc) - port of the ThingWorx mashup QF_MachineShopBarcode_MU.
// Barcode Number / Station Name (= history card) / Cell / From / To + Submit -> barcodes of the card's PDI station
// (GET /api/machineshop/historycard/barcodes). A barcode searches that barcode (cell and dates do not
// apply, as in ThingWorx). Grid DateTime | Barcode; click selects a row, double-click (or Open) -> the history card in a new browser tab
// (ms-history-card.html, ThingWorx QF_MachineShop_HistoryCardMU). Globals prefixed msHc.
// =============================================================================================

let msHcOptions = null;     // { cards: [{ name, pdiStation, spc }], cells, maxRows }
let msHcLoaded = false;     // first open loads the list once (ThingWorx ran getBarcodeList on load)
let msHcLastList = null;

function msHcEsc(v) {
    return String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// yyyy-MM-ddTHH:mm in local time (datetime-local value and API format).
function msHcLocal(d) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

function msHcFormatTime(iso) {
    return iso ? String(iso).replace('T', ' ').slice(0, 19) : '';
}

async function msHcShow() {
    if (!msHcOptions) {
        try {
            const r = await fetch('/api/machineshop/historycard/options');
            if (!r.ok) throw new Error(`HTTP ${r.status}`);
            msHcOptions = await r.json();
        } catch (e) {
            document.getElementById('msHcNote').textContent = `Could not load the history cards (${e.message}).`;
            return;
        }
        const card = document.getElementById('msHcCard');
        card.innerHTML = msHcOptions.cards.map(c => `<option value="${msHcEsc(c.name)}">${msHcEsc(c.name)}</option>`).join('');
        const cell = document.getElementById('msHcCell');
        cell.innerHTML = msHcOptions.cells.map(c => `<option value="${msHcEsc(c)}">${msHcEsc(c)}</option>`).join('');
        // Default range: today 00:00 -> now (ThingWorx getInitialDateTime / current time).
        const now = new Date();
        const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        document.getElementById('msHcFrom').value = msHcLocal(midnight);
        document.getElementById('msHcTo').value = msHcLocal(now);
        document.getElementById('msHcBarcode').addEventListener('keydown', e => { if (e.key === 'Enter') msHcSubmit(); });
        document.getElementById('msHcBarcode').addEventListener('input', msHcSearchMode);
    }
    if (!msHcLoaded) {
        msHcLoaded = true;
        msHcSubmit();
    }
}

function msHcSearchMode() {
    const searching = document.getElementById('msHcBarcode').value.trim().length > 0;
    document.querySelector('#tab-ms-hc .ms-hc-bar').classList.toggle('searching', searching);
}

async function msHcSubmit() {
    if (!msHcOptions) return;
    const note = document.getElementById('msHcNote');
    const grid = document.getElementById('msHcGrid');
    const card = document.getElementById('msHcCard').value;
    const cell = document.getElementById('msHcCell').value;
    const barcode = document.getElementById('msHcBarcode').value.trim();
    const from = document.getElementById('msHcFrom').value;
    const to = document.getElementById('msHcTo').value;
    msHcSearchMode();
    const q = new URLSearchParams({ card });
    if (barcode) {
        q.set('barcode', barcode);
    } else {
        if (!from || !to) { note.textContent = 'Pick a From and a To date / time.'; return; }
        if (to < from) { note.textContent = 'To is before From.'; return; }
        q.set('cell', cell); q.set('from', from); q.set('to', to);
    }
    note.textContent = 'Loading...';
    try {
        const r = await fetch(`/api/machineshop/historycard/barcodes?${q}`);
        if (!r.ok) throw new Error((await r.text()) || `HTTP ${r.status}`);
        const d = await r.json();
        msHcLastList = { ...d, cell };
        msHcRenderList(d, cell);
    } catch (e) {
        note.textContent = `Could not load the barcodes (${e.message}).`;
        grid.innerHTML = '';
    }
}

function msHcRenderList(d, cell) {
    const note = document.getElementById('msHcNote');
    const grid = document.getElementById('msHcGrid');
    const where = d.search ? `search at PDI station ${d.pdiStation}` : `cell ${cell}, PDI station ${d.pdiStation}`;
    note.textContent = `${d.card} - ${where} - ${d.rows.length} barcode${d.rows.length === 1 ? '' : 's'}`
        + (d.truncated ? ` (first ${d.maxRows} shown - narrow the time range)` : '')
        + ' - double-click a row to open its history card';
    if (!d.rows.length) {
        grid.innerHTML = `<div class="ms-hc-empty">No barcodes found.</div>`;
        return;
    }
    // ThingWorx grid: DateTime | Barcode (single row selection, double-click opens the card).
    grid.innerHTML = `<table class="ms-pdi-table">
        <thead><tr><th>DateTime</th><th>Barcode</th><th class="ms-hc-open-col"></th></tr></thead>
        <tbody>${d.rows.map((r, i) => `<tr data-i="${i}">
            <td>${msHcEsc(msHcFormatTime(r.dateTime))}</td>
            <td class="ms-hc-barcode-cell">${msHcEsc(r.barcode)}</td>
            <td class="ms-hc-open-col"><button class="ms-hc-open" type="button" data-i="${i}">Open</button></td>
        </tr>`).join('')}</tbody></table>`;
    const open = e => {
        const tr = e.target.closest('tr[data-i]');
        if (tr) msHcOpenCard(d.card, d.rows[+tr.dataset.i]);
    };
    const body = grid.querySelector('tbody');
    body.addEventListener('click', e => {
        const tr = e.target.closest('tr[data-i]');
        if (!tr) return;
        body.querySelectorAll('tr.selected').forEach(r => r.classList.remove('selected'));
        tr.classList.add('selected');
    });
    body.addEventListener('dblclick', open);
    grid.querySelectorAll('.ms-hc-open').forEach(b => b.addEventListener('click', open));
}

// New browser tab, as ThingWorx (navigation TargetWindow "new").
function msHcOpenCard(card, row) {
    const q = new URLSearchParams({ card, barcode: row.barcode, cell: row.cell || '' });
    window.open(`ms-history-card.html?${q}`, '_blank');
}
