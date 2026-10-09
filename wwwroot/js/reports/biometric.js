// =============================================================================================
// Biometric reports: Biometric Shiftwise (#tab-reports) and Biometric Engine NO & Barcode
// (#tab-biometric-engine-barcode). Both use the header's Line dropdown.
// =============================================================================================

// Last Biometric Shiftwise result, for the Excel export.
let biometricData = [];

document.addEventListener('DOMContentLoaded', () => {
    const { start, end } = currentProductionDayRange();
    const config = {
        enableTime: true,
        dateFormat: "Y-m-d\\TH:i",
        altInput: true,
        altFormat: "d M Y, h:i K", // Display: 27 Dec 2025, 12:15 AM
        time_24hr: false,
        theme: "dark"
    };
    flatpickr('#reportsStart', { ...config, defaultDate: start });
    flatpickr('#reportsEnd', { ...config, defaultDate: end });

    const btn = document.getElementById('reportsApplyBtn');
    if (btn) btn.onclick = fetchBiometricReport;
});

async function exportBiometricToExcel() {
    if (!biometricData || biometricData.length === 0) {
        alert("No data to export.");
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Biometric Shiftwise');

        const headers = ['S.No', 'Station ID', 'Station Number', 'Station Name', 'Station Type', 'Punch DateTime', 'Shift', 'Emp ID', 'Emp Name'];
        sheet.addRow(headers).font = { bold: true };

        biometricData.forEach((item, index) => {
            const punchDate = item.punchDateTime ? new Date(item.punchDateTime).toLocaleString() : '';
            sheet.addRow([
                index + 1,
                item.stationID || '',
                item.stationNumber || '',
                item.stationName || '',
                item.stationType || '',
                punchDate,
                item.shift || '',
                item.employeeID || '',
                item.employeeName || ''
            ]);
        });

        headers.forEach((_, i) => sheet.getColumn(i + 1).width = 22);

        await downloadWorkbook(workbook, `Biometric_Shiftwise_${new Date().getTime()}.xlsx`);
    } catch (err) {
        console.error('Error generating excel:', err);
        alert("Error generating Excel file");
    }
}

// --- BIOMETRIC SHIFTWISE REPORT DATA ---

async function fetchBiometricReport() {
    const lineDropdown = document.getElementById('mainDashboardDropdown');
    const line = lineDropdown ? lineDropdown.value : '';
    if (!line) return;

    const sInput = document.getElementById('reportsStart');
    const eInput = document.getElementById('reportsEnd');
    const hcDropdown = document.getElementById('reportsHcDropdown');

    if (!sInput || !sInput.value || !eInput || !eInput.value) {
        return; // Date is required
    }

    let url = `/api/reports/biometric-shiftwise?line=${encodeURIComponent(line)}&startDate=${encodeURIComponent(sInput.value)}&endDate=${encodeURIComponent(eInput.value)}`;
    
    if (hcDropdown && hcDropdown.value) {
        url += `&historyCard=${encodeURIComponent(hcDropdown.value)}`;
    }

    try {
        const res = await fetch(url);
        if (!res.ok) throw new Error('Failed to fetch Biometric Shiftwise data');

        const data = await res.json();
        renderBiometricTable(data);
    } catch (e) {
        console.error("Failed to load Biometric Data", e);
        renderBiometricTable([]);
    }
}

function renderBiometricTable(data) {
    biometricData = data || [];
    const tbody = document.getElementById('reportsBody');
    const emptyState = document.getElementById('reportsEmpty');
    
    if (!tbody || !emptyState) return;

    tbody.innerHTML = '';

    if (!data || data.length === 0) {
        tbody.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    tbody.style.display = 'table-row-group';
    emptyState.style.display = 'none';

    data.forEach(item => {
        const tr = document.createElement('tr');

        // Parse Date safely
        let punchDate = item.punchDateTime;
        if (punchDate) {
            const d = new Date(punchDate);
            punchDate = !isNaN(d) ? d.toLocaleString() : punchDate;
        } else {
            punchDate = '';
        }

        tr.innerHTML = `
            <td>${item.stationID || ''}</td>
            <td>${item.stationNumber || ''}</td>
            <td>${item.stationName || ''}</td>
            <td>${item.stationType || ''}</td>
            <td>${punchDate}</td>
            <td>${item.shift || ''}</td>
            <td>${item.employeeID || ''}</td>
            <td>${item.employeeName || ''}</td>
        `;
        tbody.appendChild(tr);
    });

    // We removed pagination for biometric (or we can add it back later if needed,
    // for now we just render all rows or let them scroll)
    const pContainer = document.getElementById('reportsPagination');
    if (pContainer) pContainer.style.display = 'none';
}

// --- BIOMETRIC ENGINE NO AND BARCODE REPORT ---

let engineBarcodeData = [];

function toggleEngineBarcodeMode() {
    const toggleElement = document.getElementById('engineBarcodeModeToggle');
    const isBarcodeMode = toggleElement && toggleElement.checked;

    const engineNoInput = document.getElementById('engineBarcodeEngineNo');
    const barcodeInput = document.getElementById('engineBarcodeBarcode');
    const labelEngine = document.getElementById('engineBarcodeLabelEngine');
    const labelBarcode = document.getElementById('engineBarcodeLabelBarcode');

    if (engineNoInput) { engineNoInput.disabled = isBarcodeMode; engineNoInput.style.opacity = isBarcodeMode ? '0.4' : '1'; }
    if (barcodeInput) { barcodeInput.disabled = !isBarcodeMode; barcodeInput.style.opacity = isBarcodeMode ? '1' : '0.4'; }

    if (labelEngine) labelEngine.classList.toggle('active', !isBarcodeMode);
    if (labelBarcode) labelBarcode.classList.toggle('active', isBarcodeMode);
}

async function fetchEngineBarcodeReport() {
    const lineDropdown = document.getElementById('mainDashboardDropdown');
    const hcDropdown = document.getElementById('engineBarcodeHcDropdown');
    const toggleElement = document.getElementById('engineBarcodeModeToggle');

    const line = lineDropdown ? lineDropdown.value : '';
    const hc = hcDropdown ? hcDropdown.value : '';
    const isBarcodeMode = toggleElement && toggleElement.checked;

    const engineNoInput = document.getElementById('engineBarcodeEngineNo');
    const barcodeInput = document.getElementById('engineBarcodeBarcode');
    const engineNo = engineNoInput ? engineNoInput.value.trim() : '';
    const barcode = barcodeInput ? barcodeInput.value.trim() : '';

    if (!line) {
        alert("Please select a Line.");
        return;
    }
    if (!hc) {
        alert("Please select a History Card.");
        return;
    }
    if (isBarcodeMode && !barcode) {
        alert("Please enter a Barcode Number.");
        return;
    }
    if (!isBarcodeMode && !engineNo) {
        alert("Please enter an Engine Number.");
        return;
    }

    let url = `/api/reports/biometric-engine-barcode?line=${encodeURIComponent(line)}`;
    if (hc) url += `&historyCard=${encodeURIComponent(hc)}`;
    url += isBarcodeMode ? `&barcode=${encodeURIComponent(barcode)}` : `&engineNo=${encodeURIComponent(engineNo)}`;

    const btn = document.getElementById('engineBarcodeApplyBtn');
    try {
        if (btn) btn.innerHTML = '<span class="material-symbols-outlined">refresh</span> Loading...';

        const res = await fetch(url);
        engineBarcodeData = res.ok ? await res.json() : [];
        if (!res.ok) console.error("Failed to load Biometric Engine No/Barcode data:", res.status);
    } catch (e) {
        console.error("Failed to load Biometric Engine No/Barcode data", e);
        engineBarcodeData = [];
    } finally {
        if (btn) btn.innerHTML = 'Apply';
        renderEngineBarcodeTable();
    }
}

function renderEngineBarcodeTable() {
    const tbody = document.getElementById('engineBarcodeBody');
    const emptyState = document.getElementById('engineBarcodeEmpty');
    const table = document.getElementById('engineBarcodeTable');
    if (!tbody || !emptyState || !table) return;

    tbody.innerHTML = '';

    if (!engineBarcodeData || engineBarcodeData.length === 0) {
        table.style.display = 'none';
        emptyState.style.display = 'block';
        return;
    }

    table.style.display = 'table';
    emptyState.style.display = 'none';

    engineBarcodeData.forEach(item => {
        const tr = document.createElement('tr');

        let punchDate = item.punchDateTime;
        if (punchDate) {
            const d = new Date(punchDate);
            punchDate = !isNaN(d) ? d.toLocaleString() : punchDate;
        } else {
            punchDate = '';
        }

        tr.innerHTML = `
            <td>${item.stationID || ''}</td>
            <td>${item.engineNoOrBarcode || ''}</td>
            <td>${item.stationNumber || ''}</td>
            <td>${item.stationName || ''}</td>
            <td>${item.stationType || ''}</td>
            <td>${punchDate}</td>
            <td>${item.shift || ''}</td>
            <td>${item.employeeID || ''}</td>
            <td>${item.employeeName || ''}</td>
        `;
        tbody.appendChild(tr);
    });
}

async function exportEngineBarcodeToExcel() {
    if (!engineBarcodeData || engineBarcodeData.length === 0) {
        alert("No data to export.");
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Biometric Engine-Barcode');

        const headers = ['S.No', 'Station ID', 'Engine Number / Barcode', 'Station Number', 'Station Name', 'Station Type', 'Punch DateTime', 'Shift', 'Emp ID', 'Emp Name'];
        sheet.addRow(headers).font = { bold: true };

        engineBarcodeData.forEach((item, index) => {
            let punchDate = item.punchDateTime ? new Date(item.punchDateTime).toLocaleString() : '';
            sheet.addRow([
                index + 1,
                item.stationID || '',
                item.engineNoOrBarcode || '',
                item.stationNumber || '',
                item.stationName || '',
                item.stationType || '',
                punchDate,
                item.shift || '',
                item.employeeID || '',
                item.employeeName || ''
            ]);
        });

        headers.forEach((_, i) => sheet.getColumn(i + 1).width = 22);

        await downloadWorkbook(workbook, `Biometric_Engine_Barcode_${new Date().getTime()}.xlsx`);
    } catch (err) {
        console.error('Error generating excel:', err);
        alert("Error generating Excel file");
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const btn = document.getElementById('engineBarcodeApplyBtn');
    if (btn) btn.onclick = fetchEngineBarcodeReport;
});
