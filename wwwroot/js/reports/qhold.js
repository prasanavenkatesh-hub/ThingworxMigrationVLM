// --- ENGINE QHOLD REPORT LOGIC ---
let qHoldData = [];
let qHoldPage = 1;
let qHoldMode = 'Overall';
let qHoldChart = null;
let qHoldInitialLoadDone = false;
const QHOLD_ITEMS_PER_PAGE = 10;

function getCurrentQHoldShift() {
    const time = new Date();
    const minutes = time.getHours() * 60 + time.getMinutes();
    if (minutes > 15 && minutes <= 435) return 'A';   // 00:15 - 07:15
    if (minutes > 435 && minutes <= 945) return 'B';  // 07:15 - 15:45
    return 'C';                                        // 15:45 - 00:15
}

function loadQHoldDefaultView() {
    if (qHoldInitialLoadDone) return;
    qHoldInitialLoadDone = true;

    const currentShift = getCurrentQHoldShift();
    const shiftSelect = document.getElementById('qHoldShift');
    if (shiftSelect) {
        if (!Array.from(shiftSelect.options).some(o => o.value === currentShift)) {
            const opt = document.createElement('option');
            opt.value = currentShift;
            opt.textContent = currentShift;
            shiftSelect.appendChild(opt);
        }
        shiftSelect.value = currentShift;
    }

    fetchQHoldReport('Overall');
}

function formatQHoldDateTime(value) {
    if (!value) return '-';
    const dt = new Date(value);
    if (isNaN(dt)) return value;
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')} ${String(dt.getHours()).padStart(2, '0')}:${String(dt.getMinutes()).padStart(2, '0')}:${String(dt.getSeconds()).padStart(2, '0')}`;
}


async function fetchQHoldReport(mode) {
    qHoldMode = mode || qHoldMode || 'Overall';

    const start = document.getElementById('qHoldStart')?.value || '';
    const end = document.getElementById('qHoldEnd')?.value || '';
    const model = document.getElementById('qHoldModel')?.value || '';
    const engineNumber = document.getElementById('qHoldEngineNumber')?.value || '';
    const rejectionDetails = document.getElementById('qHoldRejectionDetails')?.value || '';
    const reworkDetails = document.getElementById('qHoldReworkDetails')?.value || '';
    const category = document.getElementById('qHoldCategory')?.value || '';
    const result = document.getElementById('qHoldResult')?.value || '';
    const station = document.getElementById('qHoldStation')?.value || '';
    const shift = document.getElementById('qHoldShift')?.value || '';

    const params = new URLSearchParams({
        mode: qHoldMode,
        startDate: start,
        endDate: end,
        model, engineNumber, qHoldStation: station, result, category,
        rejectionDetails, reworkDetails, shift
    });

    const btnMap = { Overall: 'qHoldOverallBtn', Distinct: 'qHoldDistinctBtn', Duplicate: 'qHoldDuplicateBtn' };
    const actionButtons = Object.values(btnMap).map(id => document.getElementById(id)).filter(Boolean);
    const activeBtn = document.getElementById(btnMap[qHoldMode]);
    const originalLabel = activeBtn ? activeBtn.textContent : '';

    actionButtons.forEach(b => b.disabled = true);
    if (activeBtn) activeBtn.textContent = 'Loading...';

    try {
        const res = await fetch(`/api/reports/qhold/data?${params.toString()}`);
        if (res.ok) {
            qHoldData = await res.json();
        } else {
            alert('Failed to load QHold report data.');
            qHoldData = [];
        }
    } catch (err) {
        console.error('Error fetching QHold report', err);
        alert('Error connecting to server');
        qHoldData = [];
    } finally {
        qHoldPage = 1;
        renderQHoldTable();
        updateQHoldDonut();
        populateQHoldFilterDropdowns();
        actionButtons.forEach(b => b.disabled = false);
        if (activeBtn) activeBtn.textContent = originalLabel;
    }
}

const QHOLD_DROPDOWN_FIELDS = [
    { id: 'qHoldModel', prop: 'model' },
    { id: 'qHoldEngineNumber', prop: 'engineNumber' },
    { id: 'qHoldRejectionDetails', prop: 'rejectionDetails' },
    { id: 'qHoldReworkDetails', prop: 'reworkDetails' },
    { id: 'qHoldCategory', prop: 'category' },
    { id: 'qHoldResult', prop: 'result' },
    { id: 'qHoldStation', prop: 'qHoldStation' },
    { id: 'qHoldShift', prop: 'shift' }
];

function populateQHoldFilterDropdowns() {
    QHOLD_DROPDOWN_FIELDS.forEach(field => {
        const select = document.getElementById(field.id);
        if (!select) return;

        const previousValue = select.value || 'ALL';
        const values = Array.from(new Set(
            (qHoldData || [])
                .map(row => (row[field.prop] ?? '').toString().trim())
                .filter(v => v.length > 0)
        )).sort();

        select.innerHTML = '<option value="ALL">ALL</option>' + values.map(v => `<option value="${v}">${v}</option>`).join('');
        select.value = values.includes(previousValue) ? previousValue : 'ALL';
    });
}

function renderQHoldTable() {
    const tbody = document.getElementById('qHoldBody');
    const emptyState = document.getElementById('qHoldEmpty');
    if (!tbody || !emptyState) return;

    tbody.innerHTML = '';

    if (qHoldData.length === 0) {
        emptyState.style.display = 'flex';
        document.getElementById('qHoldTable').style.display = 'none';
        document.getElementById('qHoldPagination').style.display = 'none';
        return;
    }

    emptyState.style.display = 'none';
    document.getElementById('qHoldTable').style.display = 'table';
    document.getElementById('qHoldPagination').style.display = 'flex';

    const startIndex = (qHoldPage - 1) * QHOLD_ITEMS_PER_PAGE;
    const endIndex = startIndex + QHOLD_ITEMS_PER_PAGE;
    const pageData = qHoldData.slice(startIndex, endIndex);

    pageData.forEach((row, index) => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${startIndex + index + 1}</td>
            <td>${formatQHoldDateTime(row.date)}</td>
            <td>${row.shift ?? '-'}</td>
            <td>${row.engineNumber ?? '-'}</td>
            <td>${row.model ?? '-'}</td>
            <td>${row.qHoldStation ?? '-'}</td>
            <td>${row.userId ?? '-'}</td>
            <td>${row.result ?? '-'}</td>
            <td>${row.rejectionDetails ?? '-'}</td>
            <td>${row.rootCause ?? '-'}</td>
            <td>${row.reworkDetails ?? '-'}</td>
            <td>${row.category ?? '-'}</td>
            <td>${row.supplier ?? '-'}</td>
            <td>${formatQHoldDateTime(row.reworkDate)}</td>
            <td>${row.recheckStatus ?? '-'}</td>
            <td>${row.reworkedBy ?? '-'}</td>
            <td>${row.verifiedBy ?? '-'}</td>
            <td>${row.barcode1 ?? '-'}</td>
        `;
        tbody.appendChild(tr);
    });

    const totalEl = document.getElementById('qHoldTotalCount');
    const pageLabelEl = document.getElementById('qHoldPageLabel');
    const btnPrev = document.getElementById('btnPrevQHold');
    const btnNext = document.getElementById('btnNextQHold');

    if (totalEl) totalEl.textContent = `Total Count: ${qHoldData.length}`;
    if (pageLabelEl) pageLabelEl.textContent = `Page ${qHoldPage}`;

    if (btnPrev) {
        btnPrev.disabled = qHoldPage === 1;
        btnPrev.style.opacity = qHoldPage === 1 ? 0.5 : 1;
    }
    if (btnNext) {
        const hasNext = endIndex < qHoldData.length;
        btnNext.disabled = !hasNext;
        btnNext.style.opacity = !hasNext ? 0.5 : 1;
    }
}

function changeQHoldPage(direction) {
    qHoldPage += direction;
    renderQHoldTable();
}

function updateQHoldDonut() {
    const counts = { OK: 0, NOK: 0, BYPASSED: 0, OTHER: 0 };
    (qHoldData || []).forEach(r => {
        const res = (r.result || '').toString().trim().toUpperCase();
        if (Object.prototype.hasOwnProperty.call(counts, res)) counts[res]++;
        else counts.OTHER++;
    });

    const total = qHoldData.length;
    const buckets = [
        { label: 'OK', color: '#22c55e', count: counts.OK },
        { label: 'NOK', color: '#ef4444', count: counts.NOK },
        { label: 'BYPASSED', color: '#3b82f6', count: counts.BYPASSED }
    ];
    if (counts.OTHER > 0) buckets.push({ label: 'OTHER', color: '#9ca3af', count: counts.OTHER });

    const ctx = document.getElementById('qHoldStatusChart');
    if (ctx && typeof Chart !== 'undefined') {
        if (qHoldChart) {
            qHoldChart.destroy();
            qHoldChart = null;
        }
        qHoldChart = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: buckets.map(b => b.label),
                datasets: [{ data: buckets.map(b => b.count), backgroundColor: buckets.map(b => b.color), borderWidth: 0 }]
            },
            options: {
                cutout: '65%',
                maintainAspectRatio: false,
                plugins: { legend: { display: false } }
            }
        });
    }

    const legendEl = document.getElementById('qHoldStatusLegend');
    if (legendEl) {
        legendEl.innerHTML = buckets.map(b => {
            const pct = total > 0 ? Math.round((b.count / total) * 100) : 0;
            return `<span style="display:flex; align-items:center; gap:4px;"><span style="width:8px;height:8px;border-radius:50%;background:${b.color};display:inline-block;"></span>${b.label}: ${b.count} (${pct}%)</span>`;
        }).join('');
    }
}

function clearQHoldFilters() {
    QHOLD_DROPDOWN_FIELDS.forEach(field => {
        const select = document.getElementById(field.id);
        if (select) select.value = 'ALL';
    });

    const { start, end } = currentProductionDayRange();
    const startInput = document.getElementById('qHoldStart');
    const endInput = document.getElementById('qHoldEnd');
    if (startInput && startInput._flatpickr) startInput._flatpickr.setDate(start);
    if (endInput && endInput._flatpickr) endInput._flatpickr.setDate(end);

    qHoldData = [];
    qHoldPage = 1;
    renderQHoldTable();
    updateQHoldDonut();
}

async function exportQHoldToExcel() {
    if (!qHoldData || qHoldData.length === 0) {
        alert("No data to export");
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('QHold Report');

        const logoRes = await fetch('assets/logo-small.png');
        const logoBlob = await logoRes.blob();
        const logoBuffer = await logoBlob.arrayBuffer();
        const logoId = workbook.addImage({ buffer: logoBuffer, extension: 'png' });

        sheet.addImage(logoId, { tl: { col: 0, row: 0 }, ext: { width: 80, height: 80 } });

        sheet.mergeCells('B2:F2');
        const titleCell = sheet.getCell('B2');
        titleCell.value = 'ENGINE QHOLD REPORT';
        titleCell.font = { name: 'Arial', size: 18, bold: true, color: { argb: 'FFD71920' } };

        sheet.getCell('B3').value = 'Exported On:';
        sheet.getCell('C3').value = new Date().toLocaleString();

        const headers = ['S.No', 'Date', 'Shift', 'Engine Number', 'Model Code', 'Qhold Station', 'User ID', 'Qhold Result', 'Rejection Details', 'Root Cause', 'Rework Details', 'Category', 'Supplier', 'Rework Date', 'Recheck Status', 'Reworked By', 'Verified By', 'Barcode 1'];
        const headerRow = sheet.getRow(6);
        headers.forEach((h, idx) => {
            const cell = headerRow.getCell(idx + 1);
            cell.value = h;
            cell.font = { bold: true };
            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E0E0' } };
            cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
        });

        let currentRow = 7;
        let serialNo = 1;
        qHoldData.forEach(row => {
            const excelRow = sheet.getRow(currentRow++);
            const values = [
                serialNo++, formatQHoldDateTime(row.date), row.shift, row.engineNumber, row.model,
                row.qHoldStation, row.userId, row.result, row.rejectionDetails, row.rootCause,
                row.reworkDetails, row.category, row.supplier, formatQHoldDateTime(row.reworkDate),
                row.recheckStatus, row.reworkedBy, row.verifiedBy, row.barcode1
            ];
            values.forEach((v, idx) => {
                const cell = excelRow.getCell(idx + 1);
                cell.value = v ?? '-';
                cell.border = { top: { style: 'thin' }, left: { style: 'thin' }, bottom: { style: 'thin' }, right: { style: 'thin' } };
            });
        });

        for (let i = 1; i <= headers.length; i++) {
            sheet.getColumn(i).width = 18;
        }

        await downloadWorkbook(workbook, `QHold_Report_${qHoldMode}_${new Date().getTime()}.xlsx`);
    } catch (err) {
        console.error('Error generating excel:', err);
        alert("Error generating Excel file");
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const { start, end } = currentProductionDayRange();
    if (typeof flatpickr !== 'undefined') {
        const config = {
            enableTime: true,
            dateFormat: "Y-m-d\\TH:i",
            altInput: true,
            altFormat: "d M Y, h:i K",
            time_24hr: false,
            theme: "dark"
        };
        flatpickr("#qHoldStart", { ...config, defaultDate: start });
        flatpickr("#qHoldEnd", { ...config, defaultDate: end });
    }
    renderQHoldTable();
    updateQHoldDonut();
});

