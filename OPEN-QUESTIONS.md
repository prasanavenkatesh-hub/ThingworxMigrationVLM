# Open questions and decisions - Control Tower (Vallam)

Questions that need an answer from the business team, report owners, or IT / DBA before the screens can be called final.
Each entry says what the app does **today**, so nothing is blocked while waiting for an answer.

Write the answer under each question and the date. A developer then applies it, deletes the entry,
and updates `README.md` / `CLAUDE.md` (Open items).

Status: `OPEN` = waiting for an answer, `ANSWERED` = answer given, not yet applied in the code.

---

## A. Business team

### Machine Shop > PDI Dashboard

**A1. Crankshaft count on the Hourly Screen and PDI Summary: station 38 or 42?** - `OPEN`
- Today: the Hourly Screen and PDI Summary count Crankshaft on station 38, as ThingWorx does. Station 38 has not logged anything since 18 Aug 2025, so the Crankshaft row is always 0.
- The Crankshaft tab already reads station 42 (as the ThingWorx Crankshaft screen does), and it has live data: 3124 LH / 3135 RH on 26 Oct 2026.
- Options: (a) switch to 42, so all three screens show the same Crankshaft numbers; (b) keep 38, as in ThingWorx.
- Answer:

**A2. Shift boundaries** - `OPEN`
- Today: every PDI screen uses the plant shift times from the app config: A 00:15-07:14:59, B 07:15-15:44:59, C 15:45-00:14:59.
- ThingWorx ended each shift one minute early (07:14:00, 15:44:00, 00:14:00), so rows logged in that last minute were not counted. Shift C on the ThingWorx pies also started at 15:44.
- So our shift numbers can be slightly higher than the old ThingWorx screens. Is that acceptable?
- Answer:

**A3. Duplicate rejection reasons are merged** - `OPEN`
- Today: in the Rejection Details pop-up, a reason that appears more than once (the same text in several rows) is shown once, with the counts added together. ThingWorx listed each occurrence separately.
- Is merging correct?
- Answer:

**A4. Colours** - `OPEN`
- Today: OK is green and NOK red on all pies; the screens use a new palette that works in light and dark themes. ThingWorx used purple (OK) and cyan (NOK).
- Keep the new colours, or go back to the ThingWorx ones?
- Answer:

**A5. Current-shift highlight** - `OPEN`
- Today: the rows of the shift that is running now are highlighted, but only when you look at today's date. ThingWorx highlighted that shift on any date you picked, which can be misleading for past days.
- Keep the new behaviour?
- Answer:

**A6. Crankshaft tab pies** - `OPEN`
- Today: the Crankshaft pies use the same counts as the grid (cells 1-4, LH + RH).
- ThingWorx's Crankshaft pies used an older calculation: cells 1-3 only, every row. So its pies did not match its own grid.
- We also corrected the Total OK % / NOK % (ThingWorx divided by the wrong row) and show 2 decimals. Agree?
- Answer:

**A7. Cover LH Report pop-up** - `OPEN`
- a) **Limits:** at most 31 days per request and 5000 rows. When the list is cut, the pop-up says so; ThingWorx cut it silently. Are these limits OK?
- b) **Operator ID:** the report has the Operator ID but, as in ThingWorx, does not show it. Should it be a column, on screen and in the .csv?
- c) **Shift filter:** it uses the shift times from A2 on every day. ThingWorx dropped the first day's 00:00-00:15 rows when not all shifts were picked. Agree?
- d) **Other parts:** only Cover LH had a Report button in ThingWorx. Should other parts get one too?
- Answer:

**A8. PDI grid colours** - `OPEN`
- The ThingWorx style definitions were not exported, so the grid colours (current shift, totals band, peach rows) were recreated from screenshots.
- If the exact ThingWorx colours matter, export the style definitions; otherwise A4 covers this.
- Answer:

### PokaYoke

**A9. JEA1 Magneto Cover checkpoints (8 SA-22 checkpoints in `RE_VL_J1_Magneto Cover.QualityData_1`)** - `OPEN`
- Today: not counted, because there is no rule for which column holds their result (ThingWorx had none either). They are listed in the badge tooltip.
- How should they be counted?
- Answer:

**A10. JEA1 Crankshaft screen data source** - `OPEN`
- Today (**provisional**): each cell's value is the latest row of that cell in `RE_VL_MachineShop.MachineShopData`, from any station.
- The Crankshaft stations 33-38 / 61 / 62 stopped writing to that table in 2025, so the values come from other machine-shop stations.
- Where does Crankshaft PokaYoke data live now (`RE_VL_J1_CrankShaft`?), and which stations should be used? See also C5 (database access).
- Answer:

**A11. PokaYoke overall summary** - `OPEN`
- Today: the donut and the HC table add up the station counts, without the auto stations. The ThingWorx overall service `getpokeyokevalueOverall` is not ported yet.
- Is the station-count sum acceptable, or must it match `getpokeyokevalueOverall`? If the latter, please share its export.
- Answer:

**A12. JEA2 screen details** - `OPEN`
- Two stray `0` values next to ET-L4 / ET-L3 and the decorative green chain on the main line were not reproduced. Are they needed?
- Answer:

### EB-Real Time Monitoring

**A13. Gauge low limits** - `OPEN`
- Today (**provisional**):
  - Current: red below 20 A, orange 20-40 A.
  - Active Power: red below 900 kW, orange 900-1800 kW.
- What are the plant's real limits?
- Answer:

**A14. More than one meter on the dashboard?** - `OPEN`
- Today: the dashboard shows only Source_7 (Meter4_SID7). The EB-RTM Reports already have a meter dropdown.
- Should the dashboard show other meters too? If yes, which ones? This also needs a database change, so it is a bigger piece of work.
- Answer:

**A15. Alert and report e-mails** - `OPEN`
- ThingWorx sent e-mails for EB-RTM alerts and reports; these are not ported. Are they still needed? If yes, to whom, and which mail server should be used?
- Answer:

**A16. Shift energy during a logging gap** - `OPEN`
- Today: on the dashboard's energy table, energy used while logging was down is put into a single shift, e.g. "A=0, B=0, C=464781".
- The EB-RTM Reports instead mark such values as partial.
- Should the dashboard work the same way as the reports?
- Answer:

### EMS Renewable

**A17. Missing data** - `OPEN`
- Today: Today / Yesterday / MTD treat missing data as 0, which can show large nonsense values.
- Proposal: show `--` when the data is missing. Agree?
- Answer:

**A18. Fixed labels** - `OPEN`
- The date badge (`31/03/2026`) and the Roof Top Solar "March - 2026" label are fixed text, and the screen always shows today.
- Should the screen get a date picker, or should the labels just show the current date / month?
- Answer:

**A19. Sample data** - `OPEN`
- The VOC panel and the FY bars of Green Power Contributions show sample data. The "VOC Inputs" and "Green Power Contribution Input" pop-up tabs do not save.
- Where does this data come from (a table, a system, or manual entry), and who enters it?
- Answer:

### Other screens

**A20. Dashboards > Overview** - `OPEN`
- The Overview menu item has no page yet. What should it show (a ThingWorx mashup to port, or a new design)?
- Answer:

---

## B. Report owners

**B1. Summary Report stored procedure name** - `OPEN`
- The app calls `dbo.usp_GetSummaryReport` with `@Stage`, but older code mentions `usp_GetSummaryReportLeak` / `PDI` / `Testing`. Which one exists and is correct?
- Answer:

**B2. Stored procedure scripts** - `OPEN`
- Please share the `CREATE` scripts of the procedures behind QHold, Cylinder Head Leak, Categorywise Rework, Summary Report and Rejection Summary, so they can be kept with the project. Today they exist only in the databases.
- Answer:

**B3. Rejection Summary for EA01** - `OPEN`
- Today: EA02 only. Is there an EA01 data source (database and procedure)? If yes, where?
- Answer:

**B4. Process / Product Parameter: "Duplicate" rule** - `OPEN`
- Today: repeat loads at ML-01 are treated as duplicates. This was inferred from a Power BI example, because that Power BI page never loaded. Is the rule correct?
- Answer:

**B5. Poke Yoke reports for JEA1** - `OPEN`
- The JEA1 tables use different column names (`REJILINE.STN_data` has `Stn_number` / `date1` and no engine-number column). The Crankcase OP tables (both lines) have no station column. So the JEA1 reports, and Crankcase on JEA2, show no rows.
- Which column holds the JEA1 engine number? How should the Crankcase OP tables be matched to a station?
- Answer:

**B6. Sub-assemblies that stopped logging** - `OPEN`
- SA-22, the Machine Shop crankshaft data and OP-60 stopped logging in 2025 / 2026. Is this expected (the line changed), or is logging broken?
- Answer:

---

## C. IT / DBA

**C1. EXECUTE permission** - `OPEN`
- The `factreread` login cannot run `usp_GetCylinderHeadLeakRejectionReport`, `usp_GetSummaryReport` and `usp_GetQHoldReport`, so Cylinder Head Leak, Summary and Engine QHold fail with an error.
- Grant EXECUTE to `factreread`, or tell us which login to use.
- Answer:

**C2. Indexes for the Sub-Assembly report** - `OPEN`
- The sub-assembly source tables have no index on `Date_Time`, so each report call scans the whole table (3-45 s per month). Can a date index be added?
- Answer:

**C3. Passwords in the config file** - `OPEN`
- The database logins are stored in plain text in `appsettings.json`. Before production they should move to environment variables or a secret store. Which one does IT want?
- Answer:

**C4. Production machine and new table** - `OPEN`
- Which machine will run the live copy that keeps the records (`App:WritesEnabled = true`)? Every other copy stays view-only.
- Also, the table `[ControlTowerVLM].dbo.EbCAlerts` still has to be created (script `Modules/EbRtm/Sql/EbCAlerts.sql`). Who will create it?
- Answer:

**C5. Database access for JEA1 Crankshaft** - `OPEN`
- If A10's answer is `RE_VL_J1_CrankShaft`, `factreread` needs read access to it (it has none today).
- Answer:
