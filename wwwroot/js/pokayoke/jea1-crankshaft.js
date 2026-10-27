// --- POKAYOKE - JEA1 CRANKSHAFT ---
// "Crank Shaft Pokayoke Screen" (ThingWorx): the Crankshaft SA cells, drawn by the shared renderer
// in pokayoke.js (helpers, show/fit, pop-ups and the MI buttons are shared too). Layout as on the
// ThingWorx screen: CELL 3 above the "CRANK SHAFT SA POKAYOKE STATUS" band (counts above the
// stations), CELL 1 (OP-70 .. OP-10) and CELL 2 (OP-10 .. OP-70) below it (counts below).
// Counts are live: GET /api/pokayoke/jea1crank/stations (PokaYokeStatusService, appsettings
// PokaYoke:Lines:jea1crank; port of the ThingWorx service
// getPokeYokeLiveStatusForIndivisualStationForJEA1_CrankSaft). Station ids "C<cell> OP-xx" map to
// the API's "C<cell>-OP-xx" (pkyStationKey); the stations show only "OP-xx" (label).

const PKY_CRANK_SIZE = { w: 40, h: 38 };
const PKY_CRANK_OPS = ['OP-10', 'OP-20', 'OP-30A', 'OP-30', 'OP-40', 'OP-50', 'OP-60', 'OP-70'];

const PKY_CRANK_LAYOUT = (() => {
    const cellRow = (cell, ops, x0, step, y, side) => ops.map((op, i) => ({
        id: `C${cell} ${op}`, label: op, title: `Cell ${cell} ${op}`,
        x: Math.round(x0 + i * step), y, side, ...PKY_CRANK_SIZE
    }));
    const cell3 = cellRow(3, PKY_CRANK_OPS, 467, 49, 46, 'above');
    const cell1 = cellRow(1, [...PKY_CRANK_OPS].reverse(), 35, 50, 134, 'below');
    const cell2 = cellRow(2, PKY_CRANK_OPS, 467, 49, 134, 'below');
    return {
        width: 900,
        height: 222,
        maxYScale: 1.4,
        shapes: [{ type: 'band', x: 4, y: 96, w: 892, h: 26, title: 'CRANK SHAFT SA POKAYOKE STATUS' }],
        labels: [
            { text: 'CELL 3', x: 467, y: 0, w: 383, h: 14, plain: true },
            { text: 'CELL 1', x: 35, y: 204, w: 390, h: 14, plain: true },
            { text: 'CELL 2', x: 467, y: 204, w: 383, h: 14, plain: true }
        ],
        stations: [...cell3, ...cell1, ...cell2]
    };
})();

pkyRegisterScreen('pky-jea1-crankshaft', {
    layout: PKY_CRANK_LAYOUT, prefix: 'pkyCrank', line: 'JEA1', api: 'jea1crank',
    summaryName: 'JEA1 Crank Shaft',
    // MI - Overall / MI - Summary: JEA1 reports with the HC dropdown on this history card.
    reportHc: '01B Crankcase SA'
});
