# Engine Station report procedures (FACTREPRDETL @ 10.130.1.73)

Read-only copies of the 24 stored procedures behind Reports > Quality > Leak Station, PDI Station and
Engine Test Bed (+ Bed Wise). They were copied from the database on **2026-11-12** for reference. The procedures belong to the old "ThingWorx Migration Quality Reports
Merge" app and live only in `FACTREPRDETL`; the app never creates or alters them, it only `EXECUTE`s them
(`EngineStationReportService`, connection `EngineStationConnection`).

**Keep these files in sync with the database.** When the DBA changes a procedure, copy the new definition
here, and check its column aliases still match the row classes in `../EngineStationReports.cs` and its
parameters still match `../EngineStationReportDefinitions.cs`.

## Files

3 reports x 2 lines (EA01, EA02) x 4 procedures:

| Report | Procedures | Master table |
|---|---|---|
| Engine Test Bed | `Get_EngineTestBed_EA0x_{OverAll, Distinct, Duplicates, FilterData}` | `Engine_TestBed_Master_EA0x` |
| Leak Station | `Get_EngineLeak_Report_EA0x_{OverAll, Distinct, Duplicates, FilterData}` | `Engine_Leak_Master_EA0x` |
| PDI Station | `Get_PDI_Report_EA0x_{OverAll, Distinct, Duplicates, FilterData}` | `PDI_Report_Master_EA0x` |

- `OverAll` / `Distinct` / `Duplicates` = the report's three mode buttons. Parameters: `@FromDate`, `@ToDate`
  (DATETIME) + one per filter; multi-select values arrive comma-joined (NULL = no filter) and are split with
  `STRING_SPLIT`.
- `FilterData` = the rows the filter dropdowns are built from (`@FromDate`, `@ToDate` only).
- Bed Wise has no procedure of its own: it uses `Get_EngineTestBed_EA02_OverAll`.
- `dbo.Get_EngineBedWise_EA02_FilterData` also exists in the database but is **not used** (the old app never
  called it), so it is not copied here.
- The engine-number dropdown is not a procedure: a `SELECT TOP 500 ... WITH (NOLOCK)` on the master table
  (`EngineStationReportService.GetEngineNumbersAsync`), which needs only `db_datareader`.

## Permissions

The `factreread` login (used by `EngineStationConnection`) needs, in `FACTREPRDETL`:

- `db_datareader` (engine-number list) - it has this;
- **`EXECUTE`** on the 24 procedures (to run the reports) and **`VIEW DEFINITION`** on them (to read their
  definitions, e.g. when refreshing these copies) - granted 2026-11-12.

Per procedure, e.g.:

```sql
USE FACTREPRDETL;
GRANT EXECUTE, VIEW DEFINITION ON OBJECT::dbo.Get_EngineTestBed_EA02_OverAll TO factreread;
```

Without `EXECUTE` the API returns HTTP 503 naming the procedure (SQL error 229 / 2812).

## Known issues in these procedures (same in the old app)

- `Get_EngineLeak_Report_EA0x_FilterData`: `SELECT TOP 500` without `ORDER BY`, so the Leak filter lists can
  miss values (OPEN-QUESTIONS C6).
- `Get_EngineTestBed_EA0x_*`: compare the NVARCHAR `DATE` column with DATETIME parameters (implicit
  conversion, no index seek).
- `Get_PDI_Report_EA01_Distinct` / `_Duplicates`: `ROOT_CAUSE` is not selected.
- `Get_EngineTestBed_EA0x_OverAll`: `REWORK_COUNT` is not selected.
