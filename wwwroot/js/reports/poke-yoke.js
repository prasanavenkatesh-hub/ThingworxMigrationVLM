// --- POKE YOKE MANUAL INSPECTION OVERALL ---
let pokeYokeData = [];
let pokeYokePage = 1;
const POKE_YOKE_ITEMS_PER_PAGE = 10;

let pokeYokeSummaryData = [];
let pokeYokeSummaryPage = 1;
const POKE_YOKE_SUMMARY_ITEMS_PER_PAGE = 10;

async function fetchPokeYokeHistoryCards() {
    const lineDropdown = document.getElementById('mainDashboardDropdown');
    const line = lineDropdown ? lineDropdown.value : '';
    if (!line) return;

    try {
        const res = await fetch(`/api/reports/poke-yoke/history-cards?line=${encodeURIComponent(line)}`);
        const selectElement = document.getElementById('pokeYokeModel');
        if (!selectElement) return;

        if (res.ok) {
            const hcs = await res.json();
            
            selectElement.innerHTML = '<option value="">Select HC</option>';
            hcs.forEach(hc => {
                const opt = document.createElement('option');
                opt.value = hc;
                opt.textContent = hc;
                selectElement.appendChild(opt);
            });
            
            const summarySelectElement = document.getElementById('pokeYokeSummaryModel');
            if (summarySelectElement) {
                summarySelectElement.innerHTML = '<option value="">Select HC</option>';
                hcs.forEach(hc => {
                    const opt = document.createElement('option');
                    opt.value = hc;
                    opt.textContent = hc;
                    summarySelectElement.appendChild(opt);
                });
            }

            const biometricSelectElement = document.getElementById('reportsHcDropdown');
            if (biometricSelectElement) {
                biometricSelectElement.innerHTML = '<option value="">Select HC</option><option value="ALL">ALL</option>';
                hcs.forEach(hc => {
                    const opt = document.createElement('option');
                    opt.value = hc;
                    opt.textContent = hc;
                    biometricSelectElement.appendChild(opt);
                });
            }

            const engineBarcodeSelectElement = document.getElementById('engineBarcodeHcDropdown');
            if (engineBarcodeSelectElement) {
                engineBarcodeSelectElement.innerHTML = '<option value="">Select HC</option>';
                hcs.forEach(hc => {
                    const opt = document.createElement('option');
                    opt.value = hc;
                    opt.textContent = hc;
                    engineBarcodeSelectElement.appendChild(opt);
                });
            }
        } else {
            selectElement.innerHTML = '<option value="">Error Loading</option>';
            const summarySelectElement = document.getElementById('pokeYokeSummaryModel');
            if (summarySelectElement) summarySelectElement.innerHTML = '<option value="">Error Loading</option>';
            const biometricSelectElement = document.getElementById('reportsHcDropdown');
            if (biometricSelectElement) biometricSelectElement.innerHTML = '<option value="">Error Loading</option>';
            const engineBarcodeSelectElement = document.getElementById('engineBarcodeHcDropdown');
            if (engineBarcodeSelectElement) engineBarcodeSelectElement.innerHTML = '<option value="">Error Loading</option>';
        }
    } catch (e) {
        console.error("Failed to load HC filter", e);
    }
}

async function fetchPokeYokeStations() {
    const lineDropdown = document.getElementById('mainDashboardDropdown');
    const modelDropdown = document.getElementById('pokeYokeModel');
    
    const line = lineDropdown ? lineDropdown.value : '';
    const hc = modelDropdown ? modelDropdown.value : '';
    
    const cbContainer = document.getElementById('pokeYokeStationCheckboxes');
    const btn = document.getElementById('pokeYokeStationBtn');
    
    if (!line || !hc) {
        if (cbContainer) cbContainer.innerHTML = '';
        if (btn) btn.textContent = 'Select Stations';
        return;
    }

    try {
        const res = await fetch(`/api/reports/poke-yoke/stations?line=${encodeURIComponent(line)}&historyCard=${encodeURIComponent(hc)}`);
        if (!cbContainer) return;

        if (res.ok) {
            const stations = await res.json();
            cbContainer.innerHTML = '';
            stations.forEach(st => {
                const lbl = document.createElement('label');
                lbl.style.cursor = 'pointer';
                lbl.style.display = 'block';
                lbl.innerHTML = `<input type="checkbox" class="pokeYokeStationCb" value="${st}" onclick="updateStationBtnText()"> <span>${st}</span>`;
                cbContainer.appendChild(lbl);
            });
            updateStationBtnText();
        } else {
            cbContainer.innerHTML = '<span style="color:red;">Error Loading</span>';
        }
    } catch (e) {
        console.error("Failed to load Station filter", e);
    }
}

async function fetchPokeYokeSummaryStations() {
    const lineDropdown = document.getElementById('mainDashboardDropdown');
    const modelDropdown = document.getElementById('pokeYokeSummaryModel');
    
    const line = lineDropdown ? lineDropdown.value : '';
    const hc = modelDropdown ? modelDropdown.value : '';
    
    const cbContainer = document.getElementById('pokeYokeSummaryStationCheckboxes');
    const btn = document.getElementById('pokeYokeSummaryStationBtn');
    
    if (!line || !hc) {
        if (cbContainer) cbContainer.innerHTML = '';
        if (btn) btn.textContent = 'Select Stations';
        return;
    }

    try {
        const res = await fetch(`/api/reports/poke-yoke/stations?line=${encodeURIComponent(line)}&historyCard=${encodeURIComponent(hc)}`);
        if (!cbContainer) return;

        if (res.ok) {
            const stations = await res.json();
            cbContainer.innerHTML = '';
            stations.forEach(st => {
                const lbl = document.createElement('label');
                lbl.style.cursor = 'pointer';
                lbl.style.display = 'block';
                lbl.innerHTML = `<input type="checkbox" class="pokeYokeSummaryStationCb" value="${st}" onclick="updateSummaryStationBtnText()"> <span>${st}</span>`;
                cbContainer.appendChild(lbl);
            });
            updateSummaryStationBtnText();
        } else {
            cbContainer.innerHTML = '<span style="color:red;">Error Loading</span>';
        }
    } catch (e) {
        console.error("Failed to load Summary Station filter", e);
    }
}

function toggleAllSummaryStations(selectAllCb) {
    const checkboxes = document.querySelectorAll('.pokeYokeSummaryStationCb');
    checkboxes.forEach(cb => cb.checked = selectAllCb.checked);
    updateSummaryStationBtnText();
}

function updateSummaryStationBtnText() {
    const checkboxes = document.querySelectorAll('.pokeYokeSummaryStationCb');
    const checked = Array.from(checkboxes).filter(cb => cb.checked);
    const btn = document.getElementById('pokeYokeSummaryStationBtn');
    if(btn) {
        if(checked.length === 0) btn.textContent = "Select Stations";
        else if (checked.length === checkboxes.length) btn.textContent = "All Selected";
        else btn.textContent = `${checked.length} Selected`;
    }
}

function togglePokeYokeMode() {
    const isEngMode = document.getElementById('pokeYokeModeToggle').checked;
    const mode = isEngMode ? 'eng' : 'hc';
    const hcElements = document.querySelectorAll('.poke-yoke-hc-mode-elements');
    const engElements = document.querySelectorAll('.poke-yoke-eng-mode-elements');

    // Update labels styling based on toggle
    const lblHC = document.getElementById('modeLabelHC');
    const lblEng = document.getElementById('modeLabelEng');
    if (isEngMode) {
        lblHC.classList.remove('active');
        lblEng.classList.add('active');
    } else {
        lblHC.classList.add('active');
        lblEng.classList.remove('active');
    }

    if (mode === 'hc') {
        hcElements.forEach(el => {
            // Restore display: contents for the specific inline wrappers or block for the div container
            if(el.tagName === 'SPAN') el.style.display = 'contents';
            else if (el.tagName === 'INPUT') el.style.display = 'inline-block';
            else el.style.display = 'block';
        });
        engElements.forEach(el => el.style.display = 'none');
    } else {
        hcElements.forEach(el => el.style.display = 'none');
        engElements.forEach(el => {
            if (el.tagName === 'INPUT') el.style.display = 'inline-block';
            else el.style.display = 'block';
        });
    }
}

function toggleAllStations(selectAllCb) {
    const checkboxes = document.querySelectorAll('.pokeYokeStationCb');
    checkboxes.forEach(cb => cb.checked = selectAllCb.checked);
    updateStationBtnText();
}

function updateStationBtnText() {
    const checkboxes = document.querySelectorAll('.pokeYokeStationCb');
    const checked = Array.from(checkboxes).filter(cb => cb.checked);
    const btn = document.getElementById('pokeYokeStationBtn');
    if(btn) {
        if(checked.length === 0) btn.textContent = "Select Stations";
        else if (checked.length === checkboxes.length) btn.textContent = "All Selected";
        else btn.textContent = `${checked.length} Selected`;
    }
}

async function fetchPokeYokeReport() {
    const toggleElement = document.getElementById('pokeYokeModeToggle');
    const mode = (toggleElement && toggleElement.checked) ? 'eng' : 'hc';
    const lineDropdown = document.getElementById('mainDashboardDropdown');
    const modelDropdown = document.getElementById('pokeYokeModel');
    const line = lineDropdown ? lineDropdown.value : '';
    const hc = modelDropdown ? modelDropdown.value : '';

    let url = '';

    if (mode === 'hc') {
        const startInput = document.getElementById('pokeYokeStart');
        const endInput = document.getElementById('pokeYokeEnd');
        const start = startInput ? startInput.value : '';
        const end = endInput ? endInput.value : '';
        
        const checkedStations = Array.from(document.querySelectorAll('.pokeYokeStationCb:checked')).map(cb => cb.value);
        const station = checkedStations.join(',');

        if (!line || !hc || !station || !start || !end) {
            alert("Please fill all filters (Line, HC, Station, Start Date, End Date)");
            return;
        }
        url = `/api/reports/poke-yoke/data?line=${encodeURIComponent(line)}&historyCard=${encodeURIComponent(hc)}&station=${encodeURIComponent(station)}&startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`;
    } else {
        const engNoInput = document.getElementById('pokeYokeEngNo');
        const engNo = engNoInput ? engNoInput.value.trim() : '';

        if (!line || !hc || !engNo) {
            alert("Please select Line, HC and enter an Engine Number");
            return;
        }
        url = `/api/reports/poke-yoke/data?line=${encodeURIComponent(line)}&historyCard=${encodeURIComponent(hc)}&engineNo=${encodeURIComponent(engNo)}`;
    }

    try {
        const btn = document.getElementById('pokeYokeApplyBtn');
        if (btn) btn.innerHTML = '<span class="material-symbols-outlined">refresh</span> Loading...';

        // Close dropdown if open
        const dropdown = document.getElementById('pokeYokeStationDropdown');
        if (dropdown) dropdown.style.display = 'none';

        const res = await fetch(url);
        
        if (res.ok) {
            pokeYokeData = await res.json();
            pokeYokePage = 1;
            renderPokeYokeTable();
        } else {
            alert("Failed to load report data.");
            pokeYokeData = [];
            renderPokeYokeTable();
        }
    } catch (e) {
        console.error("Fetch Error", e);
        alert("Error fetching report data.");
    } finally {
        const btn = document.getElementById('pokeYokeApplyBtn');
        if (btn) btn.innerHTML = 'Apply';
    }
}

function renderPokeYokeTable() {
    const tbody = document.getElementById('pokeYokeBody');
    const emptyState = document.getElementById('pokeYokeEmpty');
    const pContainer = document.getElementById('pokeYokePagination');

    tbody.innerHTML = '';

    if (pokeYokeData.length === 0) {
        emptyState.style.display = 'flex';
        document.getElementById('pokeYokeTable').style.display = 'none';
        if (pContainer) pContainer.style.display = 'none';
    } else {
        emptyState.style.display = 'none';
        document.getElementById('pokeYokeTable').style.display = 'table';
        if (pContainer) pContainer.style.display = 'flex';

        // Calculate pagination slices
        const startIndex = (pokeYokePage - 1) * POKE_YOKE_ITEMS_PER_PAGE;
        const endIndex = startIndex + POKE_YOKE_ITEMS_PER_PAGE;
        const pageData = pokeYokeData.slice(startIndex, endIndex);

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
            const maxStnName = row.stn_Number || '-';
            const maxCycleTime = row.engine_Number || '-';
            const desc = row.description || '';
            
            html += `<td style="padding: 10px;">${desc}</td>`;
            html += `<td style="padding: 10px;">${maxStnName}</td>`;
            html += `<td style="padding: 10px;">${maxCycleTime}</td>`;
            html += `<td style="padding: 10px; white-space: nowrap;">${dateStr}</td>`;

            tr.innerHTML = html;
            tbody.appendChild(tr);
        });

        // Update Pagination Controls
        const totalEl = document.getElementById('pokeYokeTotalCount');
        const pageLabelEl = document.getElementById('pokeYokePageLabel');
        const btnPrev = document.getElementById('btnPrevPokeYoke');
        const btnNext = document.getElementById('btnNextPokeYoke');

        if (totalEl) totalEl.textContent = `Total Count: ${pokeYokeData.length}`;
        if (pageLabelEl) pageLabelEl.textContent = `Page ${pokeYokePage}`;

        if (btnPrev) {
            btnPrev.disabled = (pokeYokePage <= 1);
            btnPrev.style.opacity = (pokeYokePage <= 1) ? 0.5 : 1;
        }

        if (btnNext) {
            const hasNext = endIndex < pokeYokeData.length;
            btnNext.disabled = !hasNext;
            btnNext.style.opacity = !hasNext ? 0.5 : 1;
        }
    }
}

function changePokeYokePage(direction) {
    pokeYokePage += direction;
    renderPokeYokeTable();
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
                fetchPokeYokeReport();
            }
        };

        flatpickr("#pokeYokeStart", { ...config, defaultDate: start });
        flatpickr("#pokeYokeEnd", { ...config, defaultDate: end });
        
        flatpickr("#pokeYokeSummaryStart", { ...config, defaultDate: start, onClose: function() { /* fetchPokeYokeSummaryReport(); */ } });
        flatpickr("#pokeYokeSummaryEnd", { ...config, defaultDate: end, onClose: function() { /* fetchPokeYokeSummaryReport(); */ } });
    }

    const modelSelect = document.getElementById('pokeYokeModel');
    if (modelSelect) {
        modelSelect.addEventListener('change', fetchPokeYokeStations);
    }
    
    const summaryModelSelect = document.getElementById('pokeYokeSummaryModel');
    if (summaryModelSelect) {
        summaryModelSelect.addEventListener('change', fetchPokeYokeSummaryStations);
    }

    const btn = document.getElementById('pokeYokeApplyBtn');
    if (btn) {
        btn.addEventListener('click', fetchPokeYokeReport);
    }
    
    const summaryBtn = document.getElementById('pokeYokeSummaryApplyBtn');
    if (summaryBtn) {
        summaryBtn.addEventListener('click', fetchPokeYokeSummaryReport);
    }
});

async function exportPokeYokeToExcel() {
    if (!pokeYokeData || pokeYokeData.length === 0) {
        alert("No data to export");
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Poke Yoke Manual Inspection');

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
        titleCell.value = 'POKE YOKE MANUAL INSPECTION OVERALL';
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
        pokeYokeData.forEach(row => {
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

        await downloadWorkbook(workbook, `PokeYokeCycleTime_${new Date().getTime()}.xlsx`);

    } catch (e) {
        console.error("Export Error", e);
        alert("Export failed. See console.");
    }
}


let paretoChartInstance = null;
let currentParetoTab = 'stoppage';

function switchParetoTab(tab) {
    currentParetoTab = tab;

    document.getElementById('tabLineStoppage').classList.toggle('active', tab === 'stoppage');
    document.getElementById('tabEngineLoss').classList.toggle('active', tab === 'engineLoss');

    document.getElementById('paretoLoading').innerHTML = `
        <span class="material-symbols-outlined" style="animation: spin 1s linear infinite; font-size:40px; color:var(--primary);">autorenew</span>
        <p style="margin-top:10px; font-weight: bold;">Processing Pareto Chart...</p>
    `;
    document.getElementById('paretoLoading').style.display = 'flex';
    document.getElementById('paretoChart').style.display = 'none';

    setTimeout(renderParetoData, 50);
}

function closeParetoView() {
    const modal = document.getElementById('paretoModal');
    modal.classList.remove('active');
    setTimeout(() => {
        if (paretoChartInstance) {
            paretoChartInstance.destroy();
            paretoChartInstance = null;
        }
    }, 300); // Wait for transition to finish
}

function openParetoView() {
    if (!mainLineData || mainLineData.length === 0) {
        alert("No data available to generate Pareto chart.");
        return;
    }

    currentParetoTab = 'stoppage';
    document.getElementById('tabLineStoppage').classList.add('active');
    document.getElementById('tabEngineLoss').classList.remove('active');

    const modal = document.getElementById('paretoModal');
    modal.style.display = '';
    modal.classList.add('active');

    document.getElementById('paretoLoading').innerHTML = `
        <span class="material-symbols-outlined" style="animation: spin 1s linear infinite; font-size:40px; color:var(--primary);">autorenew</span>
        <p style="margin-top:10px; font-weight: bold;">Processing Pareto Chart...</p>
    `;
    document.getElementById('paretoLoading').style.display = 'flex';
    document.getElementById('paretoChart').style.display = 'none';

    setTimeout(renderParetoData, 100);
}

function renderParetoData() {
    if (paretoChartInstance) {
        paretoChartInstance.destroy();
        paretoChartInstance = null;
    }

    try {
        let sortedStations = [];
        let yAxisLabel = 'Count';

        if (currentParetoTab === 'stoppage') {
            yAxisLabel = 'Count';
            const occurrences = {};
            mainLineData.forEach(row => {
                const stn = row.max_STN_Name ? String(row.max_STN_Name).trim() : null;
                if (stn && stn !== '' && stn !== '-') {
                    occurrences[stn] = (occurrences[stn] || 0) + 1;
                }
            });

            sortedStations = Object.keys(occurrences).map(stn => {
                return { station: stn, count: occurrences[stn] };
            });
        } else if (currentParetoTab === 'engineLoss') {
            yAxisLabel = 'Calculated Engine Loss';
            const groupedCycleTimes = {};

            mainLineData.forEach(row => {
                const stn = row.max_STN_Name ? String(row.max_STN_Name).trim() : null;
                const cycleTime = parseFloat(row.max_CycleTime);

                if (stn && stn !== '' && stn !== '-' && !isNaN(cycleTime) && cycleTime > 40.5) {
                    groupedCycleTimes[stn] = (groupedCycleTimes[stn] || 0) + cycleTime;
                }
            });

            sortedStations = Object.keys(groupedCycleTimes).map(stn => {
                const loss = groupedCycleTimes[stn] / 40.5;
                return { station: stn, count: Math.round(loss) };
            });
        }

        if (sortedStations.length === 0) {
            document.getElementById('paretoLoading').innerHTML = "<p>No data found for the current selection.</p>";
            return;
        }

        sortedStations.sort((a, b) => b.count - a.count);

        const totalOccurrences = sortedStations.reduce((sum, item) => sum + item.count, 0);
        let runningTotal = 0;

        const categories = [];
        const countData = [];
        const percentageData = [];

        sortedStations.forEach(item => {
            runningTotal += item.count;
            const cumPct = totalOccurrences > 0 ? (runningTotal / totalOccurrences) * 100 : 0;

            categories.push(item.station);
            countData.push(item.count);
            percentageData.push(parseFloat(cumPct.toFixed(2)));
        });

        const ctx = document.getElementById('paretoChart').getContext('2d');
        const isLightMode = document.body.classList.contains('light-mode');
        const textColor = isLightMode ? '#333333' : '#ffffff';
        const gridColor = isLightMode ? '#e5e7eb' : '#374151';

        document.getElementById('paretoLoading').style.display = 'none';
        document.getElementById('paretoChart').style.display = 'block';

        paretoChartInstance = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: categories,
                datasets: [{
                    type: 'bar',
                    label: yAxisLabel,
                    data: countData,
                    backgroundColor: '#f43f5e',
                    yAxisID: 'y'
                }, {
                    type: 'line',
                    label: 'Cumulative Percentage',
                    data: percentageData,
                    borderColor: '#eab308',
                    backgroundColor: '#eab308',
                    borderWidth: 3,
                    yAxisID: 'y1'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: { color: textColor }
                    }
                },
                scales: {
                    x: {
                        ticks: { color: textColor, maxRotation: 90, minRotation: 90 },
                        grid: { color: gridColor }
                    },
                    y: {
                        type: 'linear',
                        display: true,
                        position: 'left',
                        title: { display: true, text: yAxisLabel, color: textColor },
                        ticks: { color: textColor, precision: currentParetoTab === 'stoppage' ? 0 : undefined },
                        grid: { color: gridColor },
                        beginAtZero: true
                    },
                    y1: {
                        type: 'linear',
                        display: true,
                        position: 'right',
                        title: { display: true, text: 'Percentage', color: textColor },
                        ticks: {
                            color: textColor,
                            callback: function (value) { return value + '%'; }
                        },
                        grid: { drawOnChartArea: false },
                        min: 0,
                        max: 100
                    }
                }
            }
        });
    } catch (e) {
        console.error("Error generating Pareto chart:", e);
        document.getElementById('paretoLoading').innerHTML = `<p style="color:red;">Error generating chart: ${e.message}</p>`;
    }
}
// --- POKE YOKE SUMMARY LOGIC ---
async function fetchPokeYokeSummaryReport() {
    const lineDropdown = document.getElementById('mainDashboardDropdown');
    const modelDropdown = document.getElementById('pokeYokeSummaryModel');
    const line = lineDropdown ? lineDropdown.value : '';
    const hc = modelDropdown ? modelDropdown.value : '';

    const startInput = document.getElementById('pokeYokeSummaryStart');
    const endInput = document.getElementById('pokeYokeSummaryEnd');
    const start = startInput ? startInput.value : '';
    const end = endInput ? endInput.value : '';
    
    const checkedStations = Array.from(document.querySelectorAll('.pokeYokeSummaryStationCb:checked')).map(cb => cb.value);
    const station = checkedStations.join(',');

    if (!line || !hc || !station || !start || !end) {
        alert("Please fill all filters (Line, HC, Station, Start Date, End Date)");
        return;
    }

    const url = `/api/reports/poke-yoke/summary/data?line=${encodeURIComponent(line)}&historyCard=${encodeURIComponent(hc)}&station=${encodeURIComponent(station)}&startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`;

    const btn = document.getElementById('pokeYokeSummaryApplyBtn');
    if (btn) btn.innerHTML = '<span class="material-symbols-outlined">refresh</span> Loading...';

    // Close dropdown if open
    const dropdown = document.getElementById('pokeYokeSummaryStationDropdown');
    if (dropdown) dropdown.style.display = 'none';

    try {
        const res = await fetch(url);
        
        if (res.ok) {
            pokeYokeSummaryData = await res.json();
            pokeYokeSummaryPage = 1;
            renderPokeYokeSummaryTable();
        } else {
            alert("Failed to load summary report data.");
            pokeYokeSummaryData = [];
            renderPokeYokeSummaryTable();
        }
    } catch (err) {
        console.error('Error fetching poke yoke summary data', err);
        alert("Error connecting to server");
    } finally {
        if (btn) btn.innerHTML = 'Apply';
    }
}

function renderPokeYokeSummaryTable() {
    const tbody = document.getElementById('pokeYokeSummaryBody');
    const emptyState = document.getElementById('pokeYokeSummaryEmpty');
    
    if (!tbody || !emptyState) return;

    tbody.innerHTML = '';

    if (pokeYokeSummaryData.length === 0) {
        emptyState.style.display = 'flex';
        document.getElementById('pokeYokeSummaryTable').style.display = 'none';
        document.getElementById('pokeYokeSummaryPagination').style.display = 'none';
    } else {
        emptyState.style.display = 'none';
        document.getElementById('pokeYokeSummaryTable').style.display = 'table';
        document.getElementById('pokeYokeSummaryPagination').style.display = 'flex';

        const startIndex = (pokeYokeSummaryPage - 1) * POKE_YOKE_SUMMARY_ITEMS_PER_PAGE;
        const endIndex = startIndex + POKE_YOKE_SUMMARY_ITEMS_PER_PAGE;
        const pageData = pokeYokeSummaryData.slice(startIndex, endIndex);

        pageData.forEach((row, index) => {
            const tr = document.createElement('tr');
            
            const startDt = new Date(row.startingDatetime);
            const startDtStr = isNaN(startDt) ? row.startingDatetime : `${startDt.getFullYear()}-${String(startDt.getMonth()+1).padStart(2,'0')}-${String(startDt.getDate()).padStart(2,'0')} ${String(startDt.getHours()).padStart(2,'0')}:${String(startDt.getMinutes()).padStart(2,'0')}:${String(startDt.getSeconds()).padStart(2,'0')}`;
            const endDt = new Date(row.endingDatetime);
            const endDtStr = isNaN(endDt) ? row.endingDatetime : `${endDt.getFullYear()}-${String(endDt.getMonth()+1).padStart(2,'0')}-${String(endDt.getDate()).padStart(2,'0')} ${String(endDt.getHours()).padStart(2,'0')}:${String(endDt.getMinutes()).padStart(2,'0')}:${String(endDt.getSeconds()).padStart(2,'0')}`;

            tr.innerHTML = `
                <td>${startIndex + index + 1}</td>
                <td>All</td>
                <td>${row.noOfEngines}</td>
                <td>${row.stationDescription}</td>
                <td>${row.stationNumber}</td>
                <td>MI</td>
                <td>${row.startingEngineNumber}</td>
                <td>${row.endingEngineNumber}</td>
                <td>${startDtStr}</td>
                <td>${endDtStr}</td>
                <td>${row.durationSeconds} sec</td>
            `;
            tbody.appendChild(tr);
        });

        // Update Pagination Controls
        const totalEl = document.getElementById('pokeYokeSummaryTotalCount');
        const pageLabelEl = document.getElementById('pokeYokeSummaryPageLabel');
        const btnPrev = document.getElementById('btnPrevPokeYokeSummary');
        const btnNext = document.getElementById('btnNextPokeYokeSummary');

        if (totalEl) totalEl.textContent = `Total Count: ${pokeYokeSummaryData.length}`;
        if (pageLabelEl) pageLabelEl.textContent = `Page ${pokeYokeSummaryPage}`;

        if (btnPrev) {
            btnPrev.disabled = pokeYokeSummaryPage === 1;
            btnPrev.style.opacity = pokeYokeSummaryPage === 1 ? 0.5 : 1;
        }

        if (btnNext) {
            const hasNext = endIndex < pokeYokeSummaryData.length;
            btnNext.disabled = !hasNext;
            btnNext.style.opacity = !hasNext ? 0.5 : 1;
        }
    }
}

function changePokeYokeSummaryPage(direction) {
    pokeYokeSummaryPage += direction;
    renderPokeYokeSummaryTable();
}

async function exportPokeYokeSummaryToExcel() {
    if (!pokeYokeSummaryData || pokeYokeSummaryData.length === 0) {
        alert("No data to export");
        return;
    }

    try {
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet('Poke Yoke Summary');

        const logoRes = await fetch('assets/logo-small.png');
        const logoBlob = await logoRes.blob();
        const logoBuffer = await logoBlob.arrayBuffer();
        const logoId = workbook.addImage({
            buffer: logoBuffer,
            extension: 'png',
        });

        sheet.addImage(logoId, {
            tl: { col: 0, row: 0 },
            ext: { width: 80, height: 80 }
        });

        sheet.mergeCells('B2:F2');
        const titleCell = sheet.getCell('B2');
        titleCell.value = 'POKE YOKE MANUAL INSPECTION SUMMARY';
        titleCell.font = { name: 'Arial', size: 18, bold: true, color: { argb: 'FFD71920' } };

        sheet.getCell('B3').value = 'Exported On:';
        sheet.getCell('C3').value = new Date().toLocaleString();

        const headerRow = sheet.getRow(6);
        const headers = ['S.No', 'Shift', 'No Of Engines', 'Station Description', 'Station Number', 'Status', 'Starting Engine Number', 'Ending Engine Number', 'Starting Date time', 'Ending Date time', 'Duration'];
        
        headers.forEach((h, idx) => {
            headerRow.getCell(idx + 1).value = h;
            headerRow.getCell(idx + 1).font = { bold: true };
            headerRow.getCell(idx + 1).fill = {
                type: 'pattern',
                pattern: 'solid',
                fgColor: { argb: 'FFE0E0E0' }
            };
            headerRow.getCell(idx + 1).border = {
                top: {style:'thin'},
                left: {style:'thin'},
                bottom: {style:'thin'},
                right: {style:'thin'}
            };
        });

        let currentRow = 7;
        let serialNo = 1;
        pokeYokeSummaryData.forEach(row => {
            const excelRow = sheet.getRow(currentRow++);
            const startDt = new Date(row.startingDatetime);
            const startDtStr = isNaN(startDt) ? row.startingDatetime : `${startDt.getFullYear()}-${String(startDt.getMonth()+1).padStart(2,'0')}-${String(startDt.getDate()).padStart(2,'0')} ${String(startDt.getHours()).padStart(2,'0')}:${String(startDt.getMinutes()).padStart(2,'0')}:${String(startDt.getSeconds()).padStart(2,'0')}`;
            const endDt = new Date(row.endingDatetime);
            const endDtStr = isNaN(endDt) ? row.endingDatetime : `${endDt.getFullYear()}-${String(endDt.getMonth()+1).padStart(2,'0')}-${String(endDt.getDate()).padStart(2,'0')} ${String(endDt.getHours()).padStart(2,'0')}:${String(endDt.getMinutes()).padStart(2,'0')}:${String(endDt.getSeconds()).padStart(2,'0')}`;

            excelRow.getCell(1).value = serialNo++;
            excelRow.getCell(2).value = 'All';
            excelRow.getCell(3).value = row.noOfEngines;
            excelRow.getCell(4).value = row.stationDescription;
            excelRow.getCell(5).value = row.stationNumber;
            excelRow.getCell(6).value = 'MI';
            excelRow.getCell(7).value = row.startingEngineNumber;
            excelRow.getCell(8).value = row.endingEngineNumber;
            excelRow.getCell(9).value = startDtStr;
            excelRow.getCell(10).value = endDtStr;
            excelRow.getCell(11).value = `${row.durationSeconds} sec`;
            
            for(let i=1; i<=11; i++) {
                excelRow.getCell(i).border = {
                    top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'}
                };
            }
        });

        for (let i = 1; i <= 11; i++) {
            sheet.getColumn(i).width = 20;
        }

        await downloadWorkbook(workbook, `Poke_Yoke_Summary_${new Date().getTime()}.xlsx`);
    } catch (err) {
        console.error('Error generating excel:', err);
        alert("Error generating Excel file");
    }
}
