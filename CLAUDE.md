# CLAUDE.md — Control Tower (Vallam)

Read this first. It is the shared working agreement for everyone (and every Claude session) on this repo. `README.md` has the full functional/API/config documentation; this file is the short version plus the rules.

## What this project is
ASP.NET Core (.NET 10) web app + vanilla JS frontend for the Royal Enfield **Vallam** plant: live **dashboards** (fed by Kepware → MQTT) and **reports** (read from plant SQL Servers). It replaces PTC **ThingWorx** mashups and **Power BI** reports. Dashboards are rebuilt from ThingWorx Mashup/Thing XML exports + screenshots: replicate the layout and port the Thing service logic (thresholds, bands, calculations) and cite it in code comments.

Three developers work on it in parallel. Remote: `github.com/prasanavenkatesh-hub/ThingworxMigrationVLM` (`main`; personal branches such as `SriDev`, `PrasannaDev`, `PowerBI-reports`).

## Rules
1. **Never commit, push, merge or rebase unless the user explicitly asks.** Developers take their own backups and decide what goes into git.
2. **Stay inside your module.** Each dashboard/report is self-contained (backend folder, JS file, CSS file, config section). Don't edit another module to make yours work; shared code goes in `Modules/Shared/` or `wwwroot/js/core.js`, and only if it's genuinely shared.
3. **All settings live in `appsettings.json`.** No hardcoded hosts, topics, database names, limits or intervals in code. Add a section/key for your module and document it in README → Configuration. Connection strings go in `ConnectionStrings`; reuse `SharedDataConnection` for cross-database (`[db].[dbo].[table]`) work on 10.130.1.73 instead of adding a duplicate.
4. **Build after every C# change:** `dotnet build ControlTower.csproj`. New controllers/endpoints need a **full stop + restart** of the app; Hot Reload does not register them (a 404 on a new endpoint almost always means a stale build).
5. **Bump the `?v=N` query** on the `<script>`/`<link>` tag in `wwwroot/index.html` whenever you change that JS/CSS file.
6. **Keep docs current in the same change:** README (feature description, API Details, Configuration) and, if you change a rule/pattern/open item here, this file.
7. **Don't break other screens.** After frontend changes check: every sidebar item opens, the browser console has no errors, and light/dark theme switching still works on your screen.
8. **Reports are read-only.** Only dashboards (loggers/monitors) and explicit user actions (alert snooze, EMS "Other Source" Update, Gas Leak valve command) write to databases / MQTT.
9. **Ask before guessing plant-specific values** (tag ids, thresholds, table schemas). If you must use a placeholder, mark it as provisional in code and in "Open items" below.

## Build & run
```bash
dotnet build ControlTower.csproj
dotnet run --launch-profile http        # http://localhost:5059  (https profile: https://localhost:7015)
```
- Swagger UI at `/swagger` in Development.
- Plant dependencies: SQL Server `10.130.1.73`, MQTT broker `10.117.1.115:1883` (anonymous). Off the plant network the app still starts; dashboards show no data and the header pill shows "MQTT No Data".
- On some machines `dotnet` / PowerShell have been blocked by group policy. If you (Claude) can't build, say so explicitly and ask the developer to build; never claim a C# change compiles without a build.

## Layout
```
Program.cs                    calls AddXxxModule() for each module - nothing else module-specific
appsettings.json              single config file (App, ConnectionStrings, ShiftConfiguration,
                              DashboardDropdownValues, PokeYokeReports, SubAssemblyReport, ProcessParameterReport,
                              Mqtt, FireHydrant, GasLeak, Ems, EbRtm, PokaYoke, MachineShop)
Modules/
  Shared/                     ConfigurationController, MqttStatusController (header MQTT pill),
                              ApiDateTime.ToLocal(), KepwareValueParser
  FireHydrant/ GasLeak/ Ems/ EbRtm/      live dashboards (one folder each, incl. <Name>Module.cs)
  PokaYoke/                   live PokaYoke station status (read-only, ThingWorx VallamPokaYoke port)
  MachineShop/                Machine Shop screens (PDI Dashboard: MachineShopPdiService; History Card: MachineShopHistoryCardService, layouts in ControlTowerVLM tables; read-only)
  Reports/ReportsModule.cs    registers all report services
  Reports/LineReports/        Biometric, Main Line Cycle Time, Poke Yoke (shared ReportsService)
  Reports/QHold/ CylinderHeadLeak/ CategorywiseRework/ SummaryReport/ RejectionSummary/ SubAssemblyReport/   Power BI ports (1 stored proc each)
  Reports/ProcessParameter/   Power BI port without a proc (whitelisted-column parameterised SELECTs, server-side paging)
  Reports/EbRtmReports/       EB-RTM Reports (ThingWorx RE_EMSRTMReports_MU port) - reads the EB-RTM logging tables
wwwroot/
  index.html                  shell: header, sidebar, one <div id="tab-<name>" class="tab-pane"> per screen
  js/core.js                  switchTab(), logout, header (version, MQTT pill, line dropdown), shared helpers
  js/dashboards/*.js          fire-hydrant, gas-leak, ems-renewable, eb-rtm
  js/reports/*.js             biometric, main-line, poke-yoke, qhold, cylinder-head-leak,
                              categorywise-rework, summary-report, rejection-summary, sub-assembly-report,
                              process-parameter, ebrtm-reports
  js/pokayoke/*.js            pokayoke.js (shared plant-layout renderer + screen controller), overview.js (PokaYoke > Overview cards) + one layout file per screen (jea1-line.js, jea2-line.js, jea1-crankshaft.js)
  css/style.v2.css            shared shell styles (also used by login.html)
  js/machineshop/*.js         pdi-dashboard.js (PDI Dashboard), history-card.js + history-card-page.js (History Card list / card page wwwroot/ms-history-card.html)
  css/dashboards/*.css, css/reports/*.css, css/pokayoke/*.css, css/machineshop/*.css   one stylesheet per module
```
C# namespaces are **flat and unchanged** regardless of folder: `ControlTower.Controllers`, `ControlTower.Services`, `ControlTower.Models`. Folders only group files.

Frontend scripts are **classic `<script>` tags sharing one global scope** (no bundler/modules), loaded in `index.html` order: `core.js` → dashboards → reports. Prefix every top-level name with your module (`eb…`, `ems…`, `gasleak…`, `scada…`/`fireHydrant…`, `qHold…`, `cylinderHead…`, `cwr…`, `sr…`, `pky…`, `msPdi…`) — a duplicate name silently overrides another module.

## Adding a live dashboard (MQTT)
Backend (`Modules/<Name>/`, mirror `EbRtm` or `GasLeak`):
- `<Name>MqttBackgroundService` — own MQTT client/connection, reconnect loop every 5s, `Host`/`Port` from `<Name>:Mqtt` falling back to the shared `Mqtt` section.
- `<Name>StateStore` (singleton, `lock`) — maps Kepware tag ids → status DTO; skips `q:false` values; parse `v` with `KepwareValueParser` (bad-quality tags can arrive as `"v":""`); records `LastReceivedUtc` on every payload.
- Loggers/monitors that write to the DB act on **transitions** (debounced), and seed their state from the DB on first use so a restart doesn't write duplicates.
- Repositories (Dapper): `SharedDataConnection` + database name from `<Name>:Database`, SQL as `$@"... [{_database}].[dbo].[Table] ..."` (no `{`/`}` inside SQL), parameterised values only. Many legacy tables have no identity column → `MAX(id)+1` inside the INSERT.
- Controller: `[Route("api/[controller]")]`; convert incoming JS `toISOString()` datetimes with `ApiDateTime.ToLocal()` (all stored times are server-local `DateTime.Now`).
- `<Name>Module.cs` with `AddXxxModule()`; call it from `Program.cs`. Add the feed to `MqttStatusController`.

Frontend:
- `tab-<name>` pane in `index.html`, sidebar button under Dashboards with `id="nav-<name>"` and `data-menu="<name>"` (+ a `"<name>": true` key in `App:Menu`), `js/dashboards/<name>.js`, `css/dashboards/<name>.css` (prefixed classes), tags in `index.html`.
- In `core.js` `switchTab()`: stop your polling in the "stop all" block, start it in your `tabId` branch. Poll only while the tab is active.
- Theme: if you draw Chart.js charts, re-render them from the `applyTheme()` hook in `index.html`'s `<head>` script.

## Adding a report
- Backend `Modules/Reports/<Name>/`: model, `<Name>ReportService` (one stored procedure or parameterised SELECT; read-only), `<Name>ReportController` with `[Route("api/reports")]` + `[HttpGet("<name>/data")]`. Register in `ReportsModule.cs`. Connection string named `<Name>Connection`.
- Keep the stored procedure's `CREATE` script with the project (ask the author) — today's procs exist only in their databases.
- Frontend: pane + sidebar entry (with `data-menu="<name>"` + an `App:Menu` key) under the right Reports sub-group (Biometric / Production / Quality / Energy), `js/reports/<name>.js`, `css/reports/<name>.css`, `switchTab()` hook. Use `currentProductionDayRange()` (00:15 → 00:15) for default dates and `downloadWorkbook(workbook, filename)` for Excel export (both in `core.js`).

## Merging a teammate's copy of the project
Teammates sometimes develop in a full copy of the repo (e.g. `D:\RE\PowerBI_Reports`, `D:\RE\EMS_Renewable`). Merge with this procedure:
1. Diff their copy against the **commit it was based on** (usually `HEAD`) — not against the working tree — to isolate exactly what they changed. Expect old monolithic paths (`Controllers/`, `Services/`, `Models/`, `wwwroot/js/app.js`).
   For a **follow-up version** of a copy you already merged (e.g. `D:\RE\PowerBI_Reports_v2` after `D:\RE\PowerBI_Reports`), diff **v2 against v1**: that isolates just the new changes. Then confirm our merged files still equal v1 apart from our own later edits (e.g. the `downloadWorkbook()` helper) before replacing them, and re-apply those edits.
2. Take **only their additions**; never copy whole shared files over ours (their `index.html`/`app.js` contain stale versions of other modules).
3. Map their code into the module layout (folder, `<Name>Module.cs`, own JS/CSS file, config section, `SharedDataConnection`, `[{_database}]`), check for global JS name clashes, and keep their API routes unchanged.
4. Verify: every config key/value from both sides is retained (renamed keys mapped), every config key the code reads exists, `dotnet build` passes, all screens open.
5. Update README (their feature docs + Structure/Config/API sections) and this file.

## Data the app writes (everything else is read-only)
**Every running copy writes** (the TEMPORARY `App:WritesEnabled` view-only mode was removed 2026-10-30): two copies on the plant network log duplicate rows, so only one copy may run against the plant (stop it on other developer machines; `EbRtm:Alerts:Enabled: false` also stops the EB-RTM alert monitor).
**`ControlTowerVLM` is the app's only database for its own records** (each module's `<Name>:Database`). Don't write to the old `FireHydrant` / `LPGGasLeak` databases (moved 2026-10-26); new tables get a module prefix (`FH_`, `GasLeak_`, `EbC`) and their CREATE script in `Modules/<Name>/Sql/`. Exception: the History Card layout tables `RE_MSConfiguration` / `SPCMSconfiguration` keep their ThingWorx names; the app only reads them.

| Module | Writes to | When |
|---|---|---|
| Fire Hydrant | `[ControlTowerVLM].dbo.FH_Alerts`, `FH_PumpRunningCount`, `FH_Duration` | alert open/close/snooze, pump count change, pump run start/stop |
| Gas Leak | `[ControlTowerVLM].dbo.GasLeak_Alerts`; MQTT valve command topics | alert band change/snooze; Lot 1/2 valve button |
| EB-RTM | `[ControlTowerVLM].dbo.EbCMonitoring`, `EbCPowerFailureEvents`, `EbCAlerts` | one snapshot per `EbRtm:LogIntervalMinutes` slot; failure start/end; alert transitions (`EbRtmAlertMonitor`) |
| EMS | `[ControlTowerVLM].dbo.SolarData`, `SolarLiveGraph`, `OtherPowerSource` | daily 00:15 baseline, hourly :15 point, "Other Source" Update |

## Open items / known issues (keep this list current)
Questions that need an answer from the business team, report owners or IT / DBA are collected in `OPEN-QUESTIONS.md` (what the app does today + a blank answer per question). Add new questions there; when one is answered and applied, delete it there and update the item here.
- **EMS Today/Yesterday/MTD** treat missing data as 0 → large negative/positive nonsense values when MQTT data or a daily `SolarData` row is missing; should show `--`. The daily baseline is only written if a message arrives during the 00:15 minute.
- **EMS date badge** is a month picker (`#emsDateBadge`, `GET /api/ems/othersource/summary?month=yyyy-MM`): it only changes the Green Energy card (source table, donut, totals, month toggle); the Roof Top Solar figures, its month label and the Green Power Contributions bars always use the real current month (`fetchEmsContribBars()`).
- **EMS VOC panel** and the FY bars of Green Power Contributions are sample data; the "VOC Inputs" and "Green Power Contribution Input" pop-up tabs don't save. EMS/Fire Hydrant payload models use `double V` (a `"v":""` tag drops the whole message) — switch to `JsonElement` + `KepwareValueParser`.
- **EB-RTM gauge low limits** for Current (<20 / 20-40 A) and Active Power (<900 / 900-1800 kW) are provisional placeholders.
- **Stored procedures** for QHold, Cylinder Head Leak, Categorywise Rework, Summary Report and Rejection Summary are not in the repo. `summary-report.js`'s header comment names `usp_GetSummaryReportLeak/PDI/Testing`, but the API calls `dbo.usp_GetSummaryReport` with `@Stage` — confirm which exists.
- **Rejection Summary (prefix `rjs`)**: EA02 only. EA01 has no data source yet - add `RejectionSummaryEA01Connection` and the proc in the EA01 database when it exists. The proc runs under the `Test` login (`factreread` has no EXECUTE on it). Main Line keeps each engine's latest rejection and drops engines rejected again after To, matching Power BI's whole-table Remove Duplicates.
- **StraightPass & Rework Sub Assembly (prefix `sar`)**: EA2 only, `dbo.usp_GetSubAssemblyReport` (one proc, one branch per sub-assembly; CREATE script in `Modules/Reports/SubAssemblyReport/Sql/` - keep it in sync with the database). Runs under the `Test` login. De-duplicates over ±30 days around the range (Power BI de-duplicated the whole table). Source tables have no `Date_Time` index, so each call full-scans (3-45 s per month); a date index on the source tables would fix that. SA-22, the Machine Shop crankshaft data and OP-60 stopped logging in 2025/2026.
- **Process/Product Parameter (prefix `ppr`)**: EA2 only. Column lists are a port of the Power BI field parameters (`ProcessParameterColumns.cs`) and double as the SQL column whitelist - never build column names from request text. STN_data has 82M+ rows: keep the date filter mandatory and paging on the server. The Duplicate rule (repeat loads at ML-01) was inferred from the Power BI example because that page never loaded - confirm with the report owner.
- **EXECUTE denied (seen 20 Oct 2026)**: `factreread` gets "EXECUTE permission was denied" on `usp_GetCylinderHeadLeakRejectionReport`, `usp_GetSummaryReport` and `usp_GetQHoldReport`, so Cylinder Head Leak, Summary and Engine QHold return HTTP 500. Grant EXECUTE to `factreread` or switch those connection strings to a login that has it.
- **Dashboards > Overview** (`dashboard-1`) has no page yet.
- **Fire Hydrant pump pictures** (`SCADA_PUMP_ART` in `fire-hydrant.js`): pipe cuts, label positions, the diesel feed line and the pump-to-controller line are all computed from per-picture pixel coordinates (`ports`, `icon`, `fuelIn`, `body`, measured from the PNGs); the Diesel Pump's labels are placed from `fuelIn` too. Fixed canvas positions (gauges, shopfloor schematic `left:1135px`, Diesel branch `translateX(-20px)`) are documented in README → Fire Hydrant. Replacing a picture in `assets/firehydrant/` means re-measuring those numbers. The Main Pumps have no `ports` yet (their pipe still runs straight behind the picture).
- **Machine Shop > PDI Dashboard** (`tab-ms-pdi`, prefix `msPdi` / `ms-`, `MachineShop` config section): **Hourly Screen, Crankcase, Cover LH, Cover RH, Crankshaft, Cyl Head, Cyl Barrel and PDI Summary tabs live** (all 8 tabs) (grids, pies, Rejection Details pop-ups; `GET /api/machineshop/pdi/...`, source `RE_VL_MachineShop.MachineShopData`; a part tab = `Title` + `Cells` on its `MachineShop:Pdi:Parts` entry + `part` on its `MS_PDI_TABS` entry). Uses the `ShiftConfiguration` windows everywhere and merges duplicate rejection reasons - deliberate differences from ThingWorx (C-shift numbers can differ slightly). The Crankshaft tab reads station 42 with LH / RH per cell (`TabStation`, `Sides`; as ThingWorx `MS_PDI_Crankshaft_TH`); the Hourly Screen still reads station 38 as ThingWorx `MS_PDI_HourlyData_TH` does, which has not logged since 2025-08-18 (row shows 0) - switching it to 42 is `"Station": "42"` on the crankshaft part, if wanted. Colours are our own light / dark palette (`--ms-pdi-*` tokens in `machine-shop.css`; OK green / NOK red instead of ThingWorx purple / cyan), not ThingWorx's (its style definitions were not exported). Cover LH's Report pop-up is ported (`GET /api/machineshop/pdi/report`, `MachineShop:Pdi:Report`). The Hourly Screen and PDI Summary count Crankshaft on `Station` 38 (as ThingWorx); only the Crankshaft tab uses 42.
- **Machine Shop > History Card** (`tab-ms-hc`, prefixes `msHc` / `msHcp` / `ms-hc-`, `MachineShop:HistoryCard`): barcode list + card page in a new browser tab (`ms-history-card.html`). Card layouts = the ThingWorx data tables `RE_MSConfigurationDT` / `SPCMSconfiguration_DT` copied to `[ControlTowerVLM].[dbo].[RE_MSConfiguration]` / `[SPCMSconfiguration]` (ThingWorx names, chosen by the user instead of an `MS_` prefix; scripts `Modules/MachineShop/Sql/HistoryCard_*.sql`, cached `LayoutCacheMinutes`). The seed loads only rows with ID >= 1000; the 2022 copy of every card, which ThingWorx also listed, is left out - confirm against a ThingWorx screenshot. Built without screenshots (look = PDI screens); README lists the ThingWorx bugs that were fixed on purpose. Cover RH SPC readings stopped 2024-02-14. Crank Case stations 44 / 45 / 1 / 2 match on the Barcode_3 / _4 of the station 4 row, which is often missing, so those stations are often empty. `factreread` read access to `REAllLineData_J1-CoverLH` / `-CoverRH` granted 2026-10-29; never use the `Test` login for new work.
- **PokaYoke** (prefix `pky`): JEA1 Line and JEA2 Line counts are **live** (`PokaYokeStatusService`, `PokaYoke:Lines:jea1` / `jea2`, tag masters `HISTORYCARDLINE01` (line `JEA1`) / `HISTORYCARDLINE02` (line `JEA2`); `factreread` read access to all source databases confirmed 2026-10-20). JEA1's `RE_VL_J1_Magneto Cover.QualityData_1` (8 SA-22 checkpoints) has no source rule (none in ThingWorx either) - not counted, listed in the badge tooltip. Not yet ported: the summary service `getpokeyokevalueOverall` (the donut / HC table use the sum of the station counts without the auto stations), (the station and HC-table click pop-ups are done: `GET /api/pokayoke/{line}/stations/{station}`, `GET /api/pokayoke/{line}/checkpoints?status=`). **Overview** (`overview.js`) shows JEA1 / JEA2 / Crank Shaft live. **JEA1 Crankshaft** (`jea1-crankshaft.js`, `PokaYoke:Lines:jea1crank`) is live but its value source is **provisional**: the ThingWorx query without its `DateTime < 2025-05-22` filter = the latest `RE_VL_MachineShop.MachineShopData` row per cell, not filtered by `Station_Number`; the Crankshaft stations 33..38/61/62 last wrote to that table in 2025, so the values come from other machine-shop stations of the cell. Revisit: station filter and the current Crankshaft data source (`RE_VL_J1_CrankShaft`? - `factreread` has no access). Its MI buttons open the JEA1 reports with HC `01B Crankcase SA` selected. JEA2's ThingWorx screen shows two stray `0` values beside ET-L4 / ET-L3 that were not reproduced, and its decorative green chain graphic on the main line is not drawn. The donut centre shows `wwwroot/assets/pky-bike.png`. Not to be confused with the existing Reports > Quality > Poke Yoke reports (the MI buttons open those).
- **EB-RTM, multiple meters**: `EbRtm:Meters` drives the EB-RTM Reports dropdown, but the dashboard still hardcodes Source_7's tags (`EbRtmStateStore`) and `EbCMonitoring` / `EbCPowerFailureEvents` have no meter column. Adding a meter needs: a `MeterId` column in both tables, per-meter state/logging, `?meter=` on the dashboard API, and a dropdown on the dashboard.
- **EB-RTM alerts** (`EbRtmAlertMonitor`, ported from the ThingWorx `RE_EnergyMeterRealTimeMonitoring_TS` subscriptions) need the table `[ControlTowerVLM].dbo.EbCAlerts` - script `Modules/EbRtm/Sql/EbCAlerts.sql`, to be created by the developer. The ThingWorx alert/report e-mails are not ported. Every running copy of the app on the plant network writes alerts (and the other loggers' rows): set `EbRtm:Alerts:Enabled: false` on developer machines.
- **EB-RTM dashboard energy table** (`EbRtmEnergyCalculator`) still uses the reading at-or-before each boundary however old it is, so energy used during a logging gap lands in one shift (e.g. "A=0, B=0, C=464781"). The EB-RTM Reports only use a boundary reading logged near the boundary (otherwise the first reading inside the window) and mark incomplete values as partial; port that rule to the dashboard.
- **Poke Yoke reports, JEA1 data**: the HC / station / tag lists come from the line's history-card database (`PokeYokeReports:Lines`; JEA1 -> `HISTORYCARDLINE01`), but the report-data queries (`ReportsService.GetPokeYokeReportAsync` / `...SummaryReportAsync`) assume `Stn_Number` / `Engine_Number` / `Date_Time`. JEA1 `REJILINE.STN_data` has `Stn_number` / `date1` and no engine-number column, and the Crankcase OP tables (both lines) have no station column - those tables are skipped, so the JEA1 reports (and Crankcase on JEA2) show no rows. Needs a per-table column mapping; ask which column holds the JEA1 engine number.
- **Credentials** are plain text in `appsettings.json` (`factreread`, `Test`); move to user-secrets/environment variables before production.
- `css/style.v2.css` contains two older, overlapping `@media (min-width: 769px)` sidebar blocks; the "Sidebar navigation: compact spacing + scrollable menu" block at the end of the file must stay last (it overrides their `!important` rules).
- The four MQTT background services (Fire Hydrant, Gas Leak, EB-RTM, EMS) share near-identical connect/reconnect code; a common base class would remove the duplication.
