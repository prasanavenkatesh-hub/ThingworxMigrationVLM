// --- MAIN LINE CYCLE TIME REPORT ---
let mainLineData = [];
let mainLinePage = 1;
const MAIN_LINE_ITEMS_PER_PAGE = 10;

async function fetchMainLineReport() {
    try {
        const start = document.getElementById('mainLineStart').value;
        const end = document.getElementById('mainLineEnd').value;
        if (!start || !end) {
            return;
        }

        const res = await fetch(`/api/reports/mainline?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`);
        if (!res.ok) throw new Error('Failed to fetch Main Line Cycle Time data');

        mainLineData = await res.json();
        mainLinePage = 1; // Reset to page 1 on new fetch
        renderMainLineTable();

    } catch (e) {
        console.error(e);
        alert('Error loading Main Line report.');
    }
}

function renderMainLineTable() {
    const tbody = document.getElementById('mainLineBody');
    const emptyState = document.getElementById('mainLineEmpty');
    const pContainer = document.getElementById('mainLinePagination');

    tbody.innerHTML = '';

    if (mainLineData.length === 0) {
        emptyState.style.display = 'flex';
        document.getElementById('mainLineTable').style.display = 'none';
        if (pContainer) pContainer.style.display = 'none';
    } else {
        emptyState.style.display = 'none';
        document.getElementById('mainLineTable').style.display = 'table';
        if (pContainer) pContainer.style.display = 'flex';

        // Calculate pagination slices
        const startIndex = (mainLinePage - 1) * MAIN_LINE_ITEMS_PER_PAGE;
        const endIndex = startIndex + MAIN_LINE_ITEMS_PER_PAGE;
        const pageData = mainLineData.slice(startIndex, endIndex);

        pageData.forEach((row, index) => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid #333';

            const serialNo = startIndex + index + 1;
            let html = `<td style="padding: 10px;">${serialNo}</td>`;

            // Format Date (e.g., "06 May 2026, 12:58:54 PM")
            let dateStr = '-';
            if (row.date_Time) {
                const d = new Date(row.date_Time);
                dateStr = d.toLocaleDateString('en-GB', {
                    day: '2-digit',
                    month: 'short',
                    year: 'numeric'
                }) + ', ' + d.toLocaleTimeString('en-US', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
            }
            html += `<td style="padding: 10px; white-space: nowrap;">${dateStr}</td>`;

            // Add Max columns
            const maxStnName = row.max_STN_Name || '-';
            const maxCycleTime = row.max_CycleTime !== null && row.max_CycleTime !== undefined ? row.max_CycleTime : '-';
            html += `<td style="padding: 10px; font-weight: bold; color: #d8232a;">${maxStnName}</td>`;
            html += `<td style="padding: 10px; font-weight: bold; color: #d8232a;">${maxCycleTime}</td>`;

            // 54 Stations
            for (let i = 1; i <= 54; i++) {
                let val = row[`sT${i}_CycleTime`];
                html += `<td style="padding: 10px;">${val !== null && val !== undefined ? val : '-'}</td>`;
            }

            tr.innerHTML = html;
            tbody.appendChild(tr);
        });

        // Update Pagination Controls
        const totalEl = document.getElementById('mainLineTotalCount');
        const pageLabelEl = document.getElementById('mainLinePageLabel');
        const btnPrev = document.getElementById('btnPrevMainLine');
        const btnNext = document.getElementById('btnNextMainLine');

        if (totalEl) totalEl.textContent = `Total Count: ${mainLineData.length}`;
        if (pageLabelEl) pageLabelEl.textContent = `Page ${mainLinePage}`;

        if (btnPrev) {
            btnPrev.disabled = (mainLinePage <= 1);
            btnPrev.style.opacity = (mainLinePage <= 1) ? 0.5 : 1;
        }

        if (btnNext) {
            const hasNext = endIndex < mainLineData.length;
            btnNext.disabled = !hasNext;
            btnNext.style.opacity = !hasNext ? 0.5 : 1;
        }
    }
}

function changeMainLinePage(direction) {
    mainLinePage += direction;
    renderMainLineTable();
}

document.addEventListener('DOMContentLoaded', () => {
    // 1. Default range: the current production day (00:15 -> 00:15)
    const { start, end } = currentProductionDayRange();

    // 2. Initialize Flatpickr matching reports tab config
    if (typeof flatpickr !== 'undefined') {
        const config = {
            enableTime: true,
            dateFormat: "Y-m-d\\TH:i",
            altInput: true,
            altFormat: "d M Y, h:i K",
            time_24hr: false,
            theme: "dark",
            onClose: function () {
                // Auto-fetch on close
                fetchMainLineReport();
            }
        };

        flatpickr("#mainLineStart", { ...config, defaultDate: start });
        flatpickr("#mainLineEnd", { ...config, defaultDate: end });
    }

    const btn = document.getElementById('mainLineApplyBtn');
    if (btn) {
        btn.addEventListener('click', fetchMainLineReport);
    }
});

async function exportMainLineToExcel() {
    if (!mainLineData || mainLineData.length === 0) {
        alert("No data to export");
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Main Line Cycle Time');

        // Fetch Logo
        const logoRes = await fetch('assets/logo-small.png');
        const logoBlob = await logoRes.blob();
        const logoBuffer = await logoBlob.arrayBuffer();
        const logoId = workbook.addImage({
            buffer: logoBuffer,
            extension: 'png',
        });

        // Add Logo (Top Left)
        sheet.addImage(logoId, {
            tl: { col: 0, row: 0 },
            ext: { width: 80, height: 80 }
        });

        sheet.mergeCells('B2:F2');
        const titleCell = sheet.getCell('B2');
        titleCell.value = 'MAIN LINE CYCLE TIME REPORT';
        titleCell.font = { name: 'Arial', size: 18, bold: true, color: { argb: 'FFD71920' } };

        sheet.getCell('B3').value = 'Exported On:';
        sheet.getCell('C3').value = new Date().toLocaleString();

        const headerRow = sheet.getRow(6);
        let colIndex = 1;
        headerRow.getCell(colIndex++).value = 'S.No';
        headerRow.getCell(colIndex++).value = 'DATE/TIME';
        headerRow.getCell(colIndex++).value = 'MAX STN NAME';
        headerRow.getCell(colIndex++).value = 'MAX CYCLE TIME';

        for (let i = 1; i <= 54; i++) {
            headerRow.getCell(colIndex++).value = 'ST' + i;
        }

        headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
        headerRow.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: 'FF333333' }
        };

        let currentRow = 7;
        let serialNo = 1;
        mainLineData.forEach(row => {
            const excelRow = sheet.getRow(currentRow++);
            let cIdx = 1;

            excelRow.getCell(cIdx++).value = serialNo++;

            let dateStr = '-';
            if (row.date_Time) {
                const d = new Date(row.date_Time);
                dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) + ', ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true });
            }

            excelRow.getCell(cIdx++).value = dateStr;
            excelRow.getCell(cIdx++).value = row.max_STN_Name || '-';
            excelRow.getCell(cIdx++).value = row.max_CycleTime !== null && row.max_CycleTime !== undefined ? row.max_CycleTime : '-';

            for (let i = 1; i <= 54; i++) {
                excelRow.getCell(cIdx++).value = row[`sT${i}_CycleTime`] !== null ? row[`sT${i}_CycleTime`] : '-';
            }
        });

        // Adjust column widths
        sheet.getColumn(1).width = 8; // S.No
        sheet.getColumn(2).width = 25; // Date
        sheet.getColumn(3).width = 15; // Max STN Name
        sheet.getColumn(4).width = 15; // Max Cycle Time
        for (let i = 5; i <= 58; i++) {
            sheet.getColumn(i).width = 8;
        }

        await downloadWorkbook(workbook, `MainLineCycleTime_${new Date().getTime()}.xlsx`);

    } catch (e) {
        console.error("Export Error", e);
        alert("Export failed. See console.");
    }
}
