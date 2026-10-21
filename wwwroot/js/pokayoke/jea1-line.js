// --- POKAYOKE - JEA1 LINE ---
// "Poka Yoke Station Status JEA1" (ThingWorx screen): J1 Engine Assembly Main Line 1 and its
// sub-assembly stations, drawn by the shared renderer in pokayoke.js. Coordinates are design
// pixels taken from the ThingWorx screen (origin subtracted by the renderer); row/column helpers,
// show/fit and the MI buttons are shared (pokayoke.js).
// Counts are live: GET /api/pokayoke/jea1/stations (PokaYokeStatusService, appsettings PokaYoke:Lines:jea1).

// ET and TB QA stations: a little larger than the standard station.
const PKY_JEA1_TEST_SIZE = { w: 30, h: 28 };

const PKY_JEA1_LAYOUT = (() => {
    const mainTop = pkyRow(pkyRange('ML-', 54, 28), 200, 28, 172, 'above');
    const mainBottom = pkyRow(pkyRange('ML-', 1, 27), 200, 28, 233, 'below');
    pkyMark(mainTop, ['ML-54', 'ML-53', 'ML-51'], { auto: true, noCounts: true });
    pkyMark(mainBottom, ['ML-05', 'ML-19', 'ML-26'], { auto: true, noCounts: true });

    const clutch = pkyRow(['SA 42I', 'SA 42H', 'SA 42G', 'SA 42F', 'SA 42E', 'SA 42D', 'SA 42C', 'SA 42B', 'SA 42A'], 368, 28, 57, 'below');
    pkyMark(clutch, ['SA 42H', 'SA 42B'], { auto: true });
    const gearTrain = pkyCol(['SA 21F', 'SA 21E', 'SA 21D', 'SA 21C', 'SA 21B', 'SA 21A'], 346, 308, 28.8, 'left');
    pkyMark(gearTrain, ['SA 21E'], { auto: true });
    const cylHead = pkyCol(['SA 30F', 'SA 30E', 'SA 30D', 'SA 30C', 'SA 30B', 'SA 30A'], 652, 314, 28, 'left');
    pkyMark(cylHead, ['SA 30E', 'SA 30D', 'SA 30C'], { auto: true });
    const caseTop = pkyRow(['SA 07', 'SA 06', 'SA 05', 'SA 04', 'SA 03', 'SA 02', 'SA 01'], 751, 29.6, 346, 'above');
    const caseBottom = pkyRow(['SA 08', 'SA 09', 'SA 10', 'SA 11', 'SA 12', 'SA 13', 'SA 14'], 751, 29.6, 392, 'below');
    pkyMark(caseTop, ['SA 06', 'SA 02'], { auto: true });
    pkyMark(caseBottom, ['SA 10', 'SA 11', 'SA 12', 'SA 13'], { auto: true });
    // Main-line track: from the top edge of the upper station row to the bottom edge of the lower row.
    const trackTop = mainTop[0].y;
    const trackHeight = mainBottom[0].y + PKY_STATION_H - trackTop;
    const et = pkyCol(pkyRange('ET-', 7, 1), 52, 83, 35.6, 'right', PKY_JEA1_TEST_SIZE);

    return {
        origin: [10, 35],
        width: 995,
        height: 445,
        maxYScale: 1.5,   // pkyFitLayout stretches vertically up to this into spare panel height
        shapes: [
            { type: 'track', x: 150, y: trackTop, w: 850, h: trackHeight, title: 'J1 ENGINE ASSEMBLY MAIN LINE 1' },
            { type: 'loop', x: 730, y: 357, w: 238, h: 42 }
        ],
        labels: [
            { text: 'Rework Station', x: 168, y: 40, w: 112, h: 13 },
            { text: 'Cover Gasket', x: 288, y: 40, w: 74, h: 13 },
            { text: 'Clutch Cover SA', x: 366, y: 40, w: 255, h: 13 },
            { text: 'Magneto Cover SA', x: 778, y: 40, w: 148, h: 13 },
            { text: 'Rotor SA', x: 654, y: 46, w: 13, h: 55, vertical: true },
            { text: 'QF', x: 18, y: 330, w: 24, h: 12 },
            { text: 'OPQ', x: 46, y: 330, w: 30, h: 12 },
            { text: 'Balancer Shaft SA', x: 212, y: 345, w: 13, h: 105, vertical: true },
            { text: 'Cyl. Barrel, Piston & CC', x: 227, y: 338, w: 13, h: 115, vertical: true },
            { text: 'Gear Train SA', x: 375, y: 326, w: 13, h: 120, vertical: true },
            { text: 'CC LGA', x: 392, y: 372, w: 40, h: 12 },
            { text: 'Gear Shift Shaft', x: 436, y: 372, w: 90, h: 12 },
            { text: 'Cyl. Head Leak & SAI - Stem Seal SA', x: 393, y: 391, w: 86, h: 19, wrap: true },
            { text: 'Cyl. Head Autocell', x: 482, y: 391, w: 42, h: 19, wrap: true },
            { text: 'Cam Ladder', x: 543, y: 325, w: 13, h: 75, vertical: true },
            { text: 'Efi', x: 543, y: 430, w: 13, h: 40, vertical: true },
            { text: 'Cylinder Head SA', x: 681, y: 310, w: 13, h: 120, vertical: true },
            { text: 'C.C Q Hold', x: 696, y: 399, w: 54, h: 12 },
            { text: 'C.Case Autocell', x: 798, y: 373, w: 84, h: 12 }
        ],
        stations: [
            ...mainTop, ...mainBottom,
            { id: 'RW 04', x: 196, y: 57, side: 'left' }, { id: 'RW 03', x: 224, y: 57, side: 'right' },
            { id: 'RW 02', x: 196, y: 88, side: 'left' }, { id: 'RW 01', x: 224, y: 88, side: 'right' },
            { id: 'SA 43', x: 318, y: 57, side: 'below' },
            ...clutch,
            ...pkyCol(['SA 35', 'SA 36'], 670, 50, 28, 'right'),
            ...pkyRow(['SA 41', 'SA 40', 'SA 39', 'SA 38', 'SA 37'], 786, 28.25, 57, 'below'),
            ...et,
            { id: 'TB QA2', x: 16, y: 193, side: 'above', ...PKY_JEA1_TEST_SIZE },
            { id: 'TB QA1', x: 16, y: 281, side: 'above', ...PKY_JEA1_TEST_SIZE },
            ...pkyCol(['SA 15C', 'SA 15B', 'SA 15A'], 184, 371, 28.5, 'left'),
            ...pkyCol(['SA 20', 'SA 19', 'SA 18', 'SA 17'], 240, 345, 28, 'right'),
            ...gearTrain,
            { id: 'SA 22', x: 398, y: 347, side: 'above' },
            ...pkyRow(['SA 23', 'SA 24', 'SA 25'], 441, 28.5, 347, 'above'),
            ...pkyRow(['SA 26A', 'SA 26B'], 396, 28, 412, 'below'),
            { id: 'SA 27', x: 460, y: 412, side: 'below' },
            { id: 'SA 28', x: 491, y: 412, side: 'below' },
            ...pkyCol(['SA 33', 'SA 32', 'SA 31'], 556, 318, 28, 'right'),
            ...pkyCol(['SA 29A', 'SA 29B'], 556, 420, 28, 'right'),
            ...cylHead,
            { id: 'SA 14A', x: 698, y: 414, side: 'below' },
            ...caseTop, ...caseBottom
        ]
    };
})();

pkyRegisterScreen('pky-jea1-line', { layout: PKY_JEA1_LAYOUT, prefix: 'pkyJea1', line: 'JEA1', api: 'jea1' });
