// ---------------------------------------------
// EMS Renewable Dashboard - live solar via GET /api/ems/solar/status (5s) + /solar/graph (60s),
// monthly "Other Power Source" figures via /api/ems/othersource/*. VOC panel is still mock data.
// ---------------------------------------------
const EMS_GREEN = { pctGreen: 94, co2Prev: 0, co2Curr: 0, totalGreenPrev: 15.00, totalGreenCurr: 0, totalUnitsPrev: 15.84, totalUnitsCurr: 0, monthPrev: 'February - 2026', monthCurr: 'March - 2026' };
const EMS_SOURCES = [
    { name: 'GCP Solar', icon: 'solar', prev: 2.89, prevPct: 19, curr: 0, currPct: 0 },
    { name: '3rd party Solar', icon: 'solar', prev: 5.17, prevPct: 34, curr: 0, currPct: 0 },
    { name: '3rd party Wind', icon: 'wind', prev: 0.00, prevPct: 0, curr: 0, currPct: 0 },
    { name: 'IEX Renewable', icon: 'recycle', prev: 6.56, prevPct: 44, curr: 0, currPct: 0 },
    { name: 'Roof Top Solar', icon: 'solar', prev: 0.38, prevPct: 3, curr: 0, currPct: 0 }
];
const EMS_VOC = {
    totalStation: 12, liveStation: 12, monitoringPct: 100, spec: '0 - 100 ppm',
    labels: ['STA-1', 'STA-2', 'STA-3', 'STA-4', 'STA-5', 'STA-6', 'STA-7', 'STA-8', 'STA-9', 'STA-10', 'STA-11', 'STA-12'],
    values: [0, 3, 4, 8, 0, 7, 6, 5, 1, 0, 0, 0],
    gaugeValue: 12, gaugeMax: 110
};
const EMS_SOLAR = {
    live: 0, today: 4378, yesterday: 4009, mtd: 109335,
    labels: ['03:00', '04:00', '05:00', '06:00', '07:00', '08:00', '09:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00', '20:00', '21:00', '22:00', '23:00'],
    values: [0, 0, 0, 5, 60, 180, 320, 430, 610, 560, 480, 640, 560, 430, 330, 190, 70, 10, 0, 0, 0]
};
const EMS_CONTRIB = { labels: ['FY 25-26', 'FY 26-27', 'Jul - 2026', 'Aug - 2026'], values: [54, 87, 94, 0] };

let emsCharts = {};
let emsSolarPollTimer = null;

let emsSolarGraphPollTimer = null;
let emsSolarGraphDate = null; // tracks the calendar day the chart currently shows, so a
                               // midnight rollover is detected and the chart resets to empty

function startEmsSolarPolling() {
    fetchEmsSolarStatus();
    fetchEmsSolarGraph();
    stopEmsSolarPolling();
    emsSolarPollTimer = setInterval(fetchEmsSolarStatus, 5000);
    emsSolarGraphPollTimer = setInterval(fetchEmsSolarGraph, 60000);
}

function stopEmsSolarPolling() {
    if (emsSolarPollTimer) {
        clearInterval(emsSolarPollTimer);
        emsSolarPollTimer = null;
    }
    if (emsSolarGraphPollTimer) {
        clearInterval(emsSolarGraphPollTimer);
        emsSolarGraphPollTimer = null;
    }
}

async function fetchEmsSolarGraph() {
    try {
        const res = await fetch('/api/ems/solar/graph');
        if (!res.ok) return;
        const points = await res.json();
        const today = new Date().toDateString();
        if (emsSolarGraphDate !== today) {
            emsSolarGraphDate = today; // new day - chart shows only today's points, per spec
        }
        EMS_SOLAR.labels = points.map(p => new Date(p.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }));
        EMS_SOLAR.values = points.map(p => p.solar);
        if (emsCharts.solar) {
            emsCharts.solar.data.labels = EMS_SOLAR.labels;
            emsCharts.solar.data.datasets[0].data = EMS_SOLAR.values;
            emsCharts.solar.update();
        }
    } catch (e) {
        // API unreachable - keep showing the last known chart.
    }
}

async function fetchEmsSolarStatus() {
    try {
        const res = await fetch('/api/ems/solar/status');
        if (!res.ok) return;
        const data = await res.json();
        EMS_SOLAR.live = data.live;
        EMS_SOLAR.today = data.today;
        EMS_SOLAR.yesterday = data.yesterday;
        EMS_SOLAR.mtd = data.mtd;
        const liveEl = document.getElementById('emsLive');
        if (!liveEl) return;
        liveEl.textContent = EMS_SOLAR.live;
        liveEl.className = 'ems-stat-value ' + emsValClass(EMS_SOLAR.live);
        document.getElementById('emsToday').textContent = EMS_SOLAR.today;
        document.getElementById('emsYesterday').textContent = EMS_SOLAR.yesterday;
        document.getElementById('emsMtd').textContent = EMS_SOLAR.mtd;
    } catch (e) {
        // API/broker unreachable - keep showing the last known values.
    }
}

function emsValClass(v) {
    return (v > 0) ? 'neon' : 'muted';
}

// Indian fiscal year (Apr-Mar) label for the given date, e.g. Oct 2026 -> "FY 26-27".
function emsFiscalYearLabel(date) {
    const startYear = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
    const yy = n => String(n % 100).padStart(2, '0');
    return `FY ${yy(startYear)}-${yy(startYear + 1)}`;
}

// e.g. Oct 2026 -> "Oct - 2026".
function emsShortMonthLabel(date) {
    return `${date.toLocaleString('en-US', { month: 'short' })} - ${date.getFullYear()}`;
}

// EMS Other Source popup - Green Power Contribution / VOC / Other Power manual inputs.
// Green Power Contribution Input tab is backed by OtherPowerSource; VOC/Other Power tabs
// have no backend yet, so their Update just logs the payload for now.
function openEmsOtherSourceModal() {
    const modal = document.getElementById('emsOtherSourceModal');
    if (!modal) return;
    if (!document.getElementById('emsOsVocStagGrid').children.length) emsBuildVocStagFields();
    fetchEmsOtherSourceHistory();
    modal.classList.add('active');
}

function closeEmsOtherSourceModal() {
    const modal = document.getElementById('emsOtherSourceModal');
    if (modal) modal.classList.remove('active');
}

function switchEmsOtherSourceTab(tab) {
    document.querySelectorAll('.ems-os-tab').forEach(el => el.classList.toggle('active', el.dataset.emstab === tab));
    document.querySelectorAll('.ems-os-pane').forEach(el => el.classList.remove('active'));
    const paneId = { green: 'emsOsPaneGreen', voc: 'emsOsPaneVoc', other: 'emsOsPaneOther' }[tab];
    const pane = document.getElementById(paneId);
    if (pane) pane.classList.add('active');
}

function emsBuildVocStagFields() {
    const grid = document.getElementById('emsOsVocStagGrid');
    let html = '';
    for (let i = 1; i <= 12; i++) {
        html += `<div class="ems-os-field"><label>Stag ${i}</label><input type="number" id="emsOsVocStag${i}"></div>`;
    }
    grid.innerHTML = html;
}

async function emsSaveGreenPower() {
    const month = document.getElementById('emsOsGreenMonth').value;
    if (!month) { alert('Select a month first.'); return; }
    const payload = {
        month: month,
        thirdPartyWind: document.getElementById('emsOsThirdPartyWind').value || 0,
        thirdPartySolar: document.getElementById('emsOsThirdPartySolar').value || 0,
        tneb: document.getElementById('emsOsTneb').value || 0,
        dg: document.getElementById('emsOsDg').value || 0,
        solar: document.getElementById('emsOsSolar').value || 0,
        gcpSolar: document.getElementById('emsOsGcpSolar').value || 0,
        iexRenewable: document.getElementById('emsOsIexRenewable').value || 0,
        iexNonRenewable: document.getElementById('emsOsIexNonRenewable').value || 0
    };
    try {
        const res = await fetch('/api/ems/othersource', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        if (!res.ok) throw new Error('save failed');
        fetchEmsOtherSourceSummary();
        fetchEmsOtherSourceHistory();
        closeEmsOtherSourceModal();
    } catch (e) {
        alert('Failed to save Other Power Source data.');
    }
}

// History grid on the Green Power Contribution Input pane (the popup tab currently labeled
// "Other Power Source"), newest entry first.
async function fetchEmsOtherSourceHistory() {
    const tbody = document.getElementById('emsOsGreenTbody');
    const empty = document.getElementById('emsOsGreenEmpty');
    if (!tbody) return;
    try {
        const res = await fetch('/api/ems/othersource/history');
        if (!res.ok) return;
        const rows = await res.json();
        if (!rows.length) {
            tbody.innerHTML = '';
            empty.style.display = '';
            return;
        }
        empty.style.display = 'none';
        tbody.innerHTML = rows.map(r => `
            <tr>
                <td>${new Date(r.timestamp).toLocaleDateString('en-GB', { month: '2-digit', year: 'numeric' })}</td>
                <td>${r.thirdPartyWind}</td>
                <td>${r.thirdPartySolar}</td>
                <td>${r.tneb}</td>
                <td>${r.dg}</td>
                <td>${r.solar}</td>
                <td>${r.gcpSolar}</td>
                <td>${r.iexRenewable}</td>
                <td>${r.iexNonRenewable}</td>
            </tr>
        `).join('');
    } catch (e) {
        // API unreachable - keep showing the last known rows.
    }
}

// Previous/current month values for the 5 "Other Sources" (GCP Solar, 3rd party Solar,
// 3rd party Wind, IEX Renewable, Roof Top Solar -> OtherPowerSource.Solar), with each
// source's % share of that month's total, rendered into ems-source-table.
async function fetchEmsOtherSourceSummary() {
    try {
        const res = await fetch('/api/ems/othersource/summary');
        if (!res.ok) return;
        const data = await res.json();
        EMS_GREEN.monthPrev = data.previous.month;
        EMS_GREEN.monthCurr = data.current.month;
        EMS_GREEN.co2Prev = data.previous.co2;
        EMS_GREEN.co2Curr = data.current.co2;
        EMS_GREEN.totalGreenPrev = data.previous.totalGreen;
        EMS_GREEN.totalGreenCurr = data.current.totalGreen;
        EMS_GREEN.totalUnitsPrev = data.previous.totalUnits;
        EMS_GREEN.totalUnitsCurr = data.current.totalUnits;
        EMS_GREEN.pctGreen = data.current.pctGreen;
        const bySourceKey = {
            'GCP Solar': ['gcpSolar', 'pctGcpSolar'],
            '3rd party Solar': ['thirdPartySolar', 'pctThirdPartySolar'],
            '3rd party Wind': ['thirdPartyWind', 'pctThirdPartyWind'],
            'IEX Renewable': ['iexRenewable', 'pctIexRenewable'],
            'Roof Top Solar': ['solar', 'pctSolar']
        };
        EMS_SOURCES.forEach(s => {
            const [valKey, pctKey] = bySourceKey[s.name] || [];
            if (!valKey) return;
            s.prev = data.previous[valKey];
            s.prevPct = data.previous[pctKey];
            s.curr = data.current[valKey];
            s.currPct = data.current[pctKey];
        });
        EMS_CONTRIB.values[2] = EMS_SOURCES.reduce((sum, s) => sum + s.prevPct, 0);
        EMS_CONTRIB.values[3] = EMS_SOURCES.reduce((sum, s) => sum + s.currPct, 0);
        if (document.getElementById('emsSourceTableBody')) renderEmsRenewable();
    } catch (e) {
        // API unreachable - keep showing the last known values.
    }
}

function emsSaveVoc() {
    const payload = {
        totalStation: document.getElementById('emsOsVocTotalStation').value,
        liveStation: document.getElementById('emsOsVocLiveStation').value,
        actualStatus: document.getElementById('emsOsVocActualStatus').value,
        stag: Array.from({ length: 12 }, (_, i) => document.getElementById('emsOsVocStag' + (i + 1)).value)
    };
    console.log('VOC Inputs (backend pending):', payload);
}

function emsSaveOtherPower() {
    const payload = {
        month: document.getElementById('emsOsOtherMonth').value,
        graphVal1: document.getElementById('emsOsGraphVal1').value,
        graphVal2: document.getElementById('emsOsGraphVal2').value,
        graphVal3: document.getElementById('emsOsGraphVal3').value,
        maxDemand: document.getElementById('emsOsMaxDemand').value
    };
    console.log('Green Power Contribution Input (backend pending):', payload);

    EMS_CONTRIB.values[0] = parseFloat(payload.graphVal1) || 0;
    EMS_CONTRIB.values[1] = parseFloat(payload.graphVal2) || 0;
    if (document.getElementById('emsContribChart')) renderEmsRenewable();
}

function emsIconSvg(kind) {
    if (kind === 'wind') return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#60a5fa" stroke-width="1.5"><path d="M3 12h10a3 3 0 1 0-3-3"/><path d="M3 17h13a3 3 0 1 1-3 3"/><path d="M3 7h7a2 2 0 1 0-2-2"/></svg>';
    if (kind === 'recycle') return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#22c55e" stroke-width="1.5"><path d="M7 19l-2-3 2-3M17 5l2 3-2 3M12 3v4M12 21v-4M5 8l3-3M19 16l-3 3"/></svg>';
    return '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#facc15" stroke-width="1.5"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4 12H2M22 12h-2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
}

function emsGaugeSvg(value, max) {
    const pct = Math.max(0, Math.min(1, value / max));
    const deg = pct * 180 - 90;
    return `
        <svg viewBox="0 0 120 65" class="ems-gauge-svg">
            <path d="M10,60 A50,50 0 0 1 44.55,12.45" class="ems-gauge-zone ok"></path>
            <path d="M44.55,12.45 A50,50 0 0 1 75.45,12.45" class="ems-gauge-zone warn"></path>
            <path d="M75.45,12.45 A50,50 0 0 1 110,60" class="ems-gauge-zone fault"></path>
            <line x1="60" y1="60" x2="60" y2="22" class="ems-needle" transform="rotate(${deg} 60 60)"></line>
            <circle cx="60" cy="60" r="4" class="ems-needle-hub"></circle>
        </svg>
        <div class="ems-gauge-value">${value} <span>Values in PPM</span></div>
        <div class="ems-gauge-title">Actual Status</div>
    `;
}

function emsValueLabelPlugin(color) {
    return {
        id: 'emsValueLabels',
        afterDatasetsDraw(chart) {
            const ctx = chart.ctx;
            chart.data.datasets.forEach((ds, i) => {
                chart.getDatasetMeta(i).data.forEach((bar, idx) => {
                    const val = ds.data[idx];
                    ctx.save();
                    ctx.fillStyle = color;
                    ctx.font = '11px Inter, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.fillText(val, bar.x, bar.y - 6);
                    ctx.restore();
                });
            });
        }
    };
}

// Draws each donut slice's source name directly on the slice (at its mid-angle/mid-radius),
// so identifying a slice doesn't require hovering for the tooltip. Skipped for 0%-value
// slices (no visible arc to label) and for slices too thin to fit the text without
// overflowing into a neighboring slice.
function emsDonutLabelPlugin() {
    return {
        id: 'emsDonutLabels',
        afterDatasetsDraw(chart) {
            const ctx = chart.ctx;
            const meta = chart.getDatasetMeta(0);
            const data = chart.data.datasets[0].data;
            const labels = chart.data.labels;
            meta.data.forEach((arc, i) => {
                if (!data[i]) return;
                const props = arc.getProps(['startAngle', 'endAngle', 'innerRadius', 'outerRadius', 'x', 'y'], true);
                const sweep = props.endAngle - props.startAngle;
                const midRadius = (props.innerRadius + props.outerRadius) / 2;
                if (sweep * midRadius < 24) return; // arc too thin for legible text
                const midAngle = (props.startAngle + props.endAngle) / 2;
                const lx = props.x + Math.cos(midAngle) * midRadius;
                const ly = props.y + Math.sin(midAngle) * midRadius;
                ctx.save();
                ctx.fillStyle = '#fff';
                ctx.font = 'bold 10px Inter, sans-serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.shadowColor = 'rgba(0,0,0,0.6)';
                ctx.shadowBlur = 3;
                ctx.fillText(labels[i], lx, ly);
                ctx.restore();
            });
        }
    };
}

function renderEmsRenewable() {
    document.getElementById('emsMonthToggle').textContent = `${EMS_GREEN.monthPrev} | ${EMS_GREEN.monthCurr}`;
    document.getElementById('emsPctGreen').textContent = EMS_GREEN.pctGreen + '%';
    document.getElementById('emsCo2').innerHTML = `${EMS_GREEN.co2Prev} <span class="unit">Tons</span> | <span class="${emsValClass(EMS_GREEN.co2Curr)}">${EMS_GREEN.co2Curr}</span> <span class="unit">Tons</span>`;
    document.getElementById('emsTotalGreen').innerHTML = `Total Green Power : <b>${EMS_GREEN.totalGreenPrev.toFixed(2)} Lakhs kWh</b> | <b class="${emsValClass(EMS_GREEN.totalGreenCurr)}">${EMS_GREEN.totalGreenCurr.toFixed(2)} Lakhs kWh</b>`;
    document.getElementById('emsTotalUnits').innerHTML = `Total Units : <b>${EMS_GREEN.totalUnitsPrev.toFixed(2)} Lakhs kWh</b> | <b class="${emsValClass(EMS_GREEN.totalUnitsCurr)}">${EMS_GREEN.totalUnitsCurr.toFixed(2)} Lakhs kWh</b>`;

    document.getElementById('emsSourceTableBody').innerHTML = EMS_SOURCES.map(s => `
        <tr>
            <td class="ems-source-name">${emsIconSvg(s.icon)} <span>${s.name}</span></td>
            <td>${s.prev.toFixed(2)}</td>
            <td class="${emsValClass(s.prevPct)}">${s.prevPct} %</td>
            <td>${s.curr.toFixed(2)}</td>
            <td class="${emsValClass(s.currPct)}">${s.currPct} %</td>
        </tr>
    `).join('');
    const footerPct = document.getElementById('emsSourceFooterPct');
    const totalCurrPct = EMS_SOURCES.reduce((sum, s) => sum + s.currPct, 0);
    footerPct.textContent = totalCurrPct + ' %';
    footerPct.className = emsValClass(totalCurrPct);

    document.getElementById('emsTotalStation').textContent = EMS_VOC.totalStation;
    document.getElementById('emsLiveStation').textContent = EMS_VOC.liveStation;
    document.getElementById('emsMonitoringStage').textContent = EMS_VOC.monitoringPct + ' %';
    document.getElementById('emsSpec').textContent = EMS_VOC.spec;
    document.getElementById('emsGauge').innerHTML = emsGaugeSvg(EMS_VOC.gaugeValue, EMS_VOC.gaugeMax);

    const liveEl = document.getElementById('emsLive');
    liveEl.textContent = EMS_SOLAR.live;
    liveEl.className = 'ems-stat-value ' + emsValClass(EMS_SOLAR.live);
    document.getElementById('emsToday').textContent = EMS_SOLAR.today;
    document.getElementById('emsYesterday').textContent = EMS_SOLAR.yesterday;
    document.getElementById('emsMtd').textContent = EMS_SOLAR.mtd;

    const now = new Date();
    const prevFYDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
    const prevMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    EMS_CONTRIB.labels = [
        emsFiscalYearLabel(prevFYDate), emsFiscalYearLabel(now),
        emsShortMonthLabel(prevMonthDate), emsShortMonthLabel(now)
    ];

    emsRenderCharts();
}

function emsRenderCharts() {
    Object.values(emsCharts).forEach(c => c.destroy());
    emsCharts = {};

    const isLightMode = document.body.classList.contains('light-mode');
    const textColor = isLightMode ? '#57606f' : '#9ca3af';
    const gridColor = isLightMode ? '#e5e5ea' : '#1a1a1a';
    const labelColor = isLightMode ? '#1d1d1f' : '#e5e7eb';

    const emsDonutColors = { 'GCP Solar': '#a855f7', '3rd party Solar': '#3b82f6', '3rd party Wind': '#60a5fa', 'IEX Renewable': '#1e3a8a', 'Roof Top Solar': '#22c55e' };
    emsCharts.donut = new Chart(document.getElementById('emsDonutChart'), {
        type: 'doughnut',
        data: {
            labels: EMS_SOURCES.map(s => s.name),
            datasets: [{ data: EMS_SOURCES.map(s => s.currPct), backgroundColor: EMS_SOURCES.map(s => emsDonutColors[s.name]), borderWidth: 0 }]
        },
        plugins: [emsDonutLabelPlugin()],
        options: {
            cutout: '55%',
            maintainAspectRatio: false,
            plugins: { legend: { display: false } }
        }
    });

    emsCharts.voc = new Chart(document.getElementById('emsVocChart'), {
        type: 'bar',
        data: { labels: EMS_VOC.labels, datasets: [{ data: EMS_VOC.values, backgroundColor: '#ec4899', borderRadius: 3, maxBarThickness: 28 }] },
        options: {
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: textColor, font: { size: 9 }, minRotation: 90, maxRotation: 90 }, grid: { display: false } },
                y: { ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor }, title: { display: true, text: 'ppm in %', color: textColor, font: { size: 10 } } }
            }
        }
    });

    const solarCtx = document.getElementById('emsSolarChart').getContext('2d');
    const solarGrad = solarCtx.createLinearGradient(0, 0, 0, 220);
    solarGrad.addColorStop(0, 'rgba(57,255,20,0.45)');
    solarGrad.addColorStop(1, 'rgba(57,255,20,0)');
    emsCharts.solar = new Chart(solarCtx, {
        type: 'line',
        data: {
            labels: EMS_SOLAR.labels,
            datasets: [{ data: EMS_SOLAR.values, borderColor: '#39ff14', backgroundColor: solarGrad, fill: true, tension: 0.4, pointRadius: 2, pointBackgroundColor: isLightMode ? '#ffffff' : '#0a0a0a' }]
        },
        options: {
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor }, title: { display: true, text: 'Time', color: textColor, font: { size: 10 } } },
                y: { ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor }, title: { display: true, text: 'KW', color: textColor, font: { size: 10 } } }
            }
        }
    });

    emsCharts.contrib = new Chart(document.getElementById('emsContribChart'), {
        type: 'bar',
        data: { labels: EMS_CONTRIB.labels, datasets: [{ data: EMS_CONTRIB.values, backgroundColor: '#22c55e', borderRadius: 3, maxBarThickness: 60 }] },
        options: {
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            layout: { padding: { top: 20 } },
            scales: {
                x: { ticks: { color: textColor, font: { size: 10 } }, grid: { display: false } },
                y: { ticks: { color: textColor, font: { size: 9 } }, grid: { color: gridColor } }
            }
        },
        plugins: [emsValueLabelPlugin(labelColor)]
    });
}
