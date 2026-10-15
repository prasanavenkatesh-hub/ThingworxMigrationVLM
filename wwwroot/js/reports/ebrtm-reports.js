// --- EB-RTM REPORTS (Reports > Energy) ---
// Port of the ThingWorx RE_EMSRTMReports_MU mashup: meter dropdown, "Vallam RTM Reports - <meter>"
// title, a From / To date range (production days, 00:15 -> 00:15) and one grid per tab with a
// Download (CSV) button. Data: GET /api/reports/ebrtm/* - read-only views of what the EB-RTM
// dashboard logs. Like the mashup, changing the meter or the dates reloads the open tab.
// A tab with ownCols: true lists all its columns itself instead of starting with EBR_COMMON_COLS.

const EBR_COMMON_COLS = [
    { key: 'date', title: 'Date', type: 'date' },
    { key: 'sourceId', title: 'Source ID' },
    { key: 'meterId', title: 'Meter ID' },
    { key: 'device', title: 'Device' },
    { key: 'meterModel', title: 'Meter Model' }
];
const ebrMmaCols = (name, unit) => {
    const u = unit ? ` (${unit})` : '';
    return [
        { key: 'min', title: `${name} Min${u}`, decimals: 2 },
        { key: 'max', title: `${name} Max${u}`, decimals: 2 },
        { key: 'avg', title: `${name} Avg${u}`, decimals: 2 }
    ];
};
const EBR_TABS = [
    {
        key: 'energy', label: 'Energy Consumption', path: 'energy-consumption', file: 'EnergyConsumptionReport',
        cols: [
            { key: 'dayConsumption', title: 'Day Consumption (kWh)', decimals: 2 },
            { key: 'shiftAConsumption', title: 'Shift A Consumption (kWh)', decimals: 2 },
            { key: 'shiftBConsumption', title: 'Shift B Consumption (kWh)', decimals: 2 },
            { key: 'shiftCConsumption', title: 'Shift C Consumption (kWh)', decimals: 2 }
        ],
        partialNote: '* = partial: only part of the shift / day was logged (hover for the time span)'
    },
    {
        key: 'powerfailure', label: 'Power Failure', path: 'power-failure', file: 'PowerFailureReport',
        cols: [
            { key: 'powerOffFrom', title: 'Power Off From', type: 'datetime' },
            { key: 'powerOffTo', title: 'Power Off To', type: 'datetime', empty: 'Ongoing' },
            { key: 'powerOffDurationMinutes', title: 'Power Off Duration (Minutes)', decimals: 2 }
        ]
    },
    { key: 'maxdemand', label: 'Max Demand', path: 'mma', parameter: 'maxdemand', file: 'MaxDemandMMAReport', cols: ebrMmaCols('Max Demand', 'kVA') },
    { key: 'voltage', label: 'Voltage', path: 'mma', parameter: 'voltage', file: 'VoltageMMAReport', cols: ebrMmaCols('Voltage', 'kV') },
    { key: 'powerfactor', label: 'Power Factor', path: 'mma', parameter: 'powerfactor', file: 'PowerFactorMMAReport', cols: ebrMmaCols('Power Factor', '') },
    { key: 'frequency', label: 'Frequency', path: 'mma', parameter: 'frequency', file: 'FrequencyMMAReport', cols: ebrMmaCols('Frequency', 'Hz') },
    {
        // Alerts raised by EbRtmAlertMonitor (port of the ThingWorx RE_EMRTMAlerts_ST grid).
        key: 'alerts', label: 'Alerts', path: 'alerts', file: 'AlertsReport', ownCols: true,
        cols: [
            { key: 'timestamp', title: 'Timestamp', type: 'datetime' },
            { key: 'sourceId', title: 'Source ID' },
            { key: 'meterId', title: 'Meter ID' },
            { key: 'device', title: 'Device' },
            { key: 'meterModel', title: 'Meter Model' },
            { key: 'title', title: 'Title', wrap: true },
            // ThingWorx descriptions are "<text>;Actual Reading: <value>".
            { key: 'description', title: 'Description', wrap: true, format: v => String(v).replace(/;s*/g, '; ') },
            { key: 'type', title: 'Type' },
            { key: 'priority', title: 'Priority', cls: r => `ebr-pri-${String(r.priority).toLowerCase()}` }
        ]
    }
];
const EBR_DEFAULT_DAYS = 7;

let ebrInitialised = false;
let ebrMeters = [];
let ebrMeter = '';
let ebrTab = 'energy';
let ebrFrom = '';   // yyyy-mm-dd (production day)
let ebrTo = '';
let ebrRows = [];   // rows of the open tab, for the CSV download
let ebrSeq = 0;     // only the latest request may render (meter / date / tab changed mid-load)

function ebrEsc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

function ebrIso(d) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function ebrTabDef(key = ebrTab) {
    return EBR_TABS.find(t => t.key === key) || EBR_TABS[0];
}

function ebrCols(def) {
    return def.ownCols ? def.cols : [...EBR_COMMON_COLS, ...def.cols];
}

async function loadEbrDefaultView() {
    if (ebrInitialised) { ebrLoad(); return; }
    ebrInitialised = true;

    // Default range: the last 7 production days, ending with the current one.
    const today = currentProductionDayRange().start;
    const first = new Date(today); first.setDate(first.getDate() - (EBR_DEFAULT_DAYS - 1));
    ebrFrom = ebrIso(first);
    ebrTo = ebrIso(today);
    const config = { dateFormat: 'Y-m-d', altInput: true, altFormat: 'd-m-Y', maxDate: 'today', disableMobile: true };
    flatpickr('#ebrFrom', { ...config, defaultDate: ebrFrom, onChange: (_, str) => { if (str) { ebrFrom = str; ebrLoad(); } } });
    flatpickr('#ebrTo', { ...config, defaultDate: ebrTo, onChange: (_, str) => { if (str) { ebrTo = str; ebrLoad(); } } });

    document.getElementById('ebrTabs').innerHTML = EBR_TABS.map(t =>
        `<button class="ebr-tab${t.key === ebrTab ? ' active' : ''}" data-key="${t.key}" onclick="ebrSelectTab('${t.key}')">${t.label}</button>`
    ).join('');

    try {
        const res = await fetch('/api/reports/ebrtm/meters');
        ebrMeters = res.ok ? await res.json() : [];
    } catch (e) {
        ebrMeters = [];
    }
    const select = document.getElementById('ebrMeter');
    select.innerHTML = ebrMeters.map(m => `<option value="${ebrEsc(m.id)}">${ebrEsc(m.name)}</option>`).join('');
    ebrMeter = ebrMeters.length ? ebrMeters[0].id : '';
    ebrUpdateTitle();
    ebrLoad();
}

function ebrSetMeter(id) {
    ebrMeter = id;
    ebrUpdateTitle();
    ebrLoad();
}

function ebrSelectTab(key) {
    ebrTab = ebrTabDef(key).key;
    document.querySelectorAll('#ebrTabs .ebr-tab').forEach(b => b.classList.toggle('active', b.dataset.key === ebrTab));
    ebrLoad();
}

function ebrUpdateTitle() {
    const meter = ebrMeters.find(m => m.id === ebrMeter);
    document.getElementById('ebrMeterName').textContent = meter ? meter.name : '';
}

function ebrStatus(text) {
    document.getElementById('ebrStatus').textContent = text || '';
}

async function ebrLoad() {
    const def = ebrTabDef();
    const seq = ++ebrSeq;
    ebrRows = [];
    ebrRender(def);
    if (!ebrMeter) { ebrStatus('No meter configured (appsettings EbRtm:Meters).'); return; }
    if (ebrFrom > ebrTo) { ebrStatus('From must not be after To.'); return; }

    ebrStatus('Loading...');
    const params = new URLSearchParams({ meter: ebrMeter, from: ebrFrom, to: ebrTo });
    if (def.parameter) params.set('parameter', def.parameter);
    try {
        const res = await fetch(`/api/reports/ebrtm/${def.path}?${params.toString()}`);
        if (seq !== ebrSeq) return;
        if (!res.ok) {
            const msg = await res.text();
            ebrStatus(`Could not load data (HTTP ${res.status}) ${msg}`.trim());
            return;
        }
        const rows = await res.json();
        if (seq !== ebrSeq) return;
        ebrRows = rows;
        ebrRender(def);
        const anyPartial = rows.some(r => r.partial && Object.keys(r.partial).length);
        ebrStatus(`${rows.length} row${rows.length === 1 ? '' : 's'}${anyPartial && def.partialNote ? ' · ' + def.partialNote : ''}`);
    } catch (e) {
        if (seq === ebrSeq) ebrStatus('Could not reach the server.');
    }
}

// Display text for one cell (also used for the CSV, so the download matches the screen).
function ebrCell(col, row) {
    const v = row[col.key];
    if (v === null || v === undefined || v === '') return col.empty || '--';
    if (col.type === 'date') {
        const [y, m, d] = String(v).split('-');
        return `${d}-${m}-${y}`;
    }
    if (col.type === 'datetime') {
        const d = new Date(v);
        return isNaN(d) ? String(v) : `${d.toLocaleDateString('en-GB').replace(/\//g, '-')} ${d.toLocaleTimeString('en-GB')}`;
    }
    if (typeof col.decimals === 'number' && typeof v === 'number') return v.toFixed(col.decimals) + (ebrPartial(col, row) ? '*' : '');
    if (col.format) return col.format(v);
    return String(v);
}

// Covered time span of a partial Energy Consumption value ("09:33-11:32"), or undefined if complete.
function ebrPartial(col, row) {
    return row.partial ? row.partial[col.key] : undefined;
}

function ebrRender(def = ebrTabDef()) {
    const cols = ebrCols(def);
    document.getElementById('ebrHead').innerHTML = `<tr>${cols.map(c => `<th>${ebrEsc(c.title)}</th>`).join('')}</tr>`;
    document.getElementById('ebrBody').innerHTML = ebrRows.length
        ? ebrRows.map(r => `<tr>${cols.map(c => {
            const span = ebrPartial(c, r);
            const cls = [typeof c.decimals === 'number' ? 'num' : '', span ? 'partial' : '', c.wrap ? 'wrap' : '', c.cls ? c.cls(r) : ''].join(' ').trim();
            const title = span ? ` title="Partial: only ${ebrEsc(span)} was logged"` : '';
            return `<td class="${cls}"${title}>${ebrEsc(ebrCell(c, r))}</td>`;
        }).join('')}</tr>`).join('')
        : `<tr><td class="ebr-empty" colspan="${cols.length}">No data for the selected range.</td></tr>`;
}

function ebrDownload() {
    const def = ebrTabDef();
    if (!ebrRows.length) { alert('No data to download.'); return; }
    const cols = ebrCols(def);
    const header = cols.map(c => c.title);
    const rows = ebrRows.map(r => cols.map(c => ebrCell(c, r)));
    if (def.partialNote) {
        // Energy Consumption: say which values are partial and what span they cover.
        header.push('Partial (logged span)');
        ebrRows.forEach((r, i) => rows[i].push(def.cols.filter(c => ebrPartial(c, r)).map(c => `${c.title.replace(' (kWh)', '')}: ${ebrPartial(c, r)}`).join('; ')));
    }
    downloadCsvBlob(`${def.file}_${ebrMeter}_${ebrFrom}_${ebrTo}`, header, rows);
}
