USE [RE_Vallam_J1EA2_SA_PTL_IPV_DB];
GO
/* StraightPass & Rework Sub Assembly Report (EA2) - port of "StraightPass & Rework subassemblyReport.pbix".
   Read-only. One call returns four result sets for one sub-assembly:
     1. Assy         - each part's latest row per status (Power BI "<X>_SA" tables)          -> table rows
     2. StraightPass - each part's first attempt (Power BI "<X>_StraightPass" tables)        -> Straight Pass % / Rejection %
     3. Bypassed     - rows with barcode 'BYPASSED' (Power BI "<X>_Bypassed" tables)
     4. Rework       - Rework_DB entries for the sub-assembly's stations ("<X>_Rework" tables)
     5. ReworkEngines - Shift, Station, Engine: distinct reworked engines (range-wide Total Distinct)
   Columns of 1-3: ProductionDate, Shift, Station, SubGroup (crankshaft cell / OP-60 DIPV_10_Status),
                   OkQty, NokQty, IncompleteQty, NotAcceptedQty, ActualQty
   Columns of 4  : ProductionDate, Shift, Station, OkQty, NokQty, DistinctEngines
   Rows with time > @StartDate and <= @EndDate are counted; duplicates are removed using 30 days either side.
   Production day: after 00:15 = same day; shifts A 00:15-07:15, B 07:15-15:45, C otherwise.
   @SubAssembly: BALANCER_SHAFT | CRANKSHAFT_PISTON_BARREL | GEAR_TRAIN | GEAR_SHIFT_SHAFT | EFI | CAM_LADDER |
                 CYLINDER_HEAD | CRANKCASE | CRANKCASE_RH_LGA | MAGNETO_COVER | ROTOR | ENGINE_TESTBED |
                 CLUTCH_COVER | CRANKSHAFT | CRANKSHAFT_OP60 */
CREATE OR ALTER PROCEDURE dbo.usp_GetSubAssemblyReport
    @SubAssembly VARCHAR(30),
    @StartDate   DATETIME,
    @EndDate     DATETIME
AS
BEGIN
    SET NOCOUNT ON;

    -- Raw station rows. RawStatus is the source value (used for de-duplication, as in Power BI);
    -- Status is normalised: OK / NOK / IC (incomplete cycle) / NA (not accepted) / other.
    CREATE TABLE #R (Ts DATETIME, Unit NVARCHAR(100), Station VARCHAR(30), SubGroup VARCHAR(30),
                     RawStatus VARCHAR(40), Status VARCHAR(40), InSp BIT, NoDedup BIT);
    CREATE TABLE #B (Ts DATETIME, Station VARCHAR(30), SubGroup VARCHAR(30), Status VARCHAR(40));
    -- Rework detail rows (one per counted Rework_DB entry); result sets 4 and 5 are built from it.
    CREATE TABLE #RWD (ProductionDate DATE, Shift CHAR(1), Station VARCHAR(30), Engine NVARCHAR(100), IsOk INT, IsNok INT);

    -- Stations of the SA_PTL_IPV / SA_PTL_IPV_NR based sub-assemblies, with each source query's filters:
    --   SaBypassStatus / SpBypassStatus : Station_Status 'BYPASSED' counted in the Assy / Straight Pass query
    --   SkipBypassedBarcode             : rows with Barcode_1 = 'BYPASSED' excluded (all but Cylinder Head)
    DECLARE @S TABLE (Station VARCHAR(30) PRIMARY KEY, Src VARCHAR(5), SaBypassStatus BIT, SpBypassStatus BIT, SkipBypassedBarcode BIT);
    DECLARE @ReworkNok VARCHAR(20) = 'REJECTED', @BypassAsMain BIT = 0;

    -- Power BI removed duplicates over each table's whole history. The source tables have no date index (full scan
    -- either way), so station rows are read 30 days either side of the range for de-duplication, and only rows
    -- inside the range are counted. This reproduces Power BI's first-attempt / latest-result logic.
    DECLARE @LoadFrom DATETIME = DATEADD(DAY, -30, @StartDate), @LoadTo DATETIME = DATEADD(DAY, 30, @EndDate);

    IF @SubAssembly = 'BALANCER_SHAFT'
    BEGIN
        INSERT @S VALUES ('SA-15A','IPV',1,0,1), ('SA-15B','IPV',1,0,1), ('SA-15C','IPV',1,0,1);
        SET @ReworkNok = 'REJECT';
    END
    ELSE IF @SubAssembly = 'CRANKSHAFT_PISTON_BARREL'
        INSERT @S VALUES ('SA-17','IPV',1,0,1), ('SA-18','IPV',1,0,1), ('SA-19','IPV',1,0,1), ('SA-20','IPV',1,0,1);
    ELSE IF @SubAssembly = 'GEAR_SHIFT_SHAFT'
    BEGIN
        INSERT @S VALUES ('SA-23','IPV',0,0,1), ('SA-24','IPV',0,0,1), ('SA-25','IPV',0,0,1);
        SET @BypassAsMain = 1;   -- these stations only log bypassed barcodes; Power BI used GearShiftShaft_SA_Bypassed
    END
    ELSE IF @SubAssembly = 'EFI'
    BEGIN
        INSERT @S VALUES ('SA-29A','IPV',0,0,1), ('SA-29B','IPV',0,0,1);
        SET @BypassAsMain = 1;   -- Power BI used EFI_SA_BYPASSED
    END
    ELSE IF @SubAssembly = 'CAM_LADDER'
        INSERT @S VALUES ('SA-31','IPV',1,1,1), ('SA-32','IPV',1,1,1), ('SA-33','IPV',1,1,1);
    ELSE IF @SubAssembly = 'CYLINDER_HEAD'
        INSERT @S VALUES ('SA-27','IPV',0,0,0), ('SA-28','IPV',0,0,0),
                         ('SA-26A','NR',1,1,0), ('SA-26B','NR',1,1,0), ('SA-30A','NR',1,1,0), ('SA-30B','NR',1,1,0),
                         ('SA-30C','NR',1,1,0), ('SA-30D','NR',1,1,0), ('SA-30E','NR',1,1,0), ('SA-30F','NR',1,1,0);
    ELSE IF @SubAssembly = 'CRANKCASE_RH_LGA'
        INSERT @S VALUES ('SA-22','IPV',1,1,1);
    ELSE IF @SubAssembly = 'MAGNETO_COVER'
    BEGIN
        INSERT @S VALUES ('SA-37A','NR',0,0,1), ('SA-37B','NR',0,0,1), ('SA-38','NR',0,0,1),
                         ('SA-39','NR',0,0,1), ('SA-40','NR',0,0,1), ('SA-41','NR',0,0,1);
        SET @ReworkNok = 'REJECT';
    END
    ELSE IF @SubAssembly = 'ROTOR'
        INSERT @S VALUES ('SA-35','NR',0,0,1), ('SA-36','NR',0,0,1);
    ELSE IF @SubAssembly = 'CLUTCH_COVER'
        INSERT @S VALUES ('SA-42A','NR',0,0,1), ('SA-42B','NR',0,0,1), ('SA-42C','NR',0,0,1), ('SA-42D','NR',0,0,1),
                         ('SA-42E','NR',0,0,1), ('SA-42F','NR',0,0,1), ('SA-42G','NR',0,0,1), ('SA-42H','NR',0,0,1),
                         ('SA-42I','NR',0,0,1);

    /* ---------- SA_PTL_IPV / SA_PTL_IPV_NR sub-assemblies ---------- */
    IF EXISTS (SELECT 1 FROM @S)
    BEGIN
        IF @BypassAsMain = 0
        BEGIN
            INSERT #R
            SELECT p.Date_Time, p.Barcode_1, p.Station_Number, NULL, p.Station_Status,
                   CASE WHEN p.Station_Status LIKE 'INCOMPLETE CYCLE%' THEN 'IC' ELSE p.Station_Status END,
                   CASE WHEN p.Station_Status = 'BYPASSED' AND s.SpBypassStatus = 0 THEN 0 ELSE 1 END, 0
            FROM [RE_Vallam_J1EA2_SA_PTL_IPV_DB].dbo.SA_PTL_IPV p
            JOIN @S s ON s.Station = p.Station_Number AND s.Src = 'IPV'
            WHERE p.Date_Time > @LoadFrom AND p.Date_Time <= @LoadTo
              AND p.Barcode_1 <> ' ' AND (s.SkipBypassedBarcode = 0 OR p.Barcode_1 <> 'BYPASSED')
              AND (p.Station_Status IN ('OK', 'NOK') OR p.Station_Status LIKE 'INCOMPLETE CYCLE%'
                   OR (p.Station_Status = 'BYPASSED' AND (s.SaBypassStatus = 1 OR s.SpBypassStatus = 1)));

            INSERT #R
            SELECT p.Date_Time, p.Barcode_1, p.Station_Number, NULL, p.Station_Status,
                   CASE WHEN p.Station_Status LIKE 'INCOMPLETE CYCLE%' THEN 'IC' ELSE p.Station_Status END,
                   CASE WHEN p.Station_Status = 'BYPASSED' AND s.SpBypassStatus = 0 THEN 0 ELSE 1 END, 0
            FROM [RE_Vallam_J1EA2_SA_PTL_IPV_NR_DB].dbo.SA_PTL_IPV_NR p
            JOIN @S s ON s.Station = p.Station_Number AND s.Src = 'NR'
            WHERE p.Date_Time > @LoadFrom AND p.Date_Time <= @LoadTo
              AND p.Barcode_1 <> ' ' AND (s.SkipBypassedBarcode = 0 OR p.Barcode_1 <> 'BYPASSED')
              AND (p.Station_Status IN ('OK', 'NOK') OR p.Station_Status LIKE 'INCOMPLETE CYCLE%'
                   OR (p.Station_Status = 'BYPASSED' AND (s.SaBypassStatus = 1 OR s.SpBypassStatus = 1)));

            -- Bypassed panel: Barcode_1 = 'BYPASSED', status OK / NOK, every row
            INSERT #B
            SELECT p.Date_Time, p.Station_Number, NULL, p.Station_Status
            FROM [RE_Vallam_J1EA2_SA_PTL_IPV_DB].dbo.SA_PTL_IPV p JOIN @S s ON s.Station = p.Station_Number AND s.Src = 'IPV'
            WHERE p.Date_Time > @StartDate AND p.Date_Time <= @EndDate AND p.Barcode_1 = 'BYPASSED' AND p.Station_Status IN ('OK', 'NOK');
            INSERT #B
            SELECT p.Date_Time, p.Station_Number, NULL, p.Station_Status
            FROM [RE_Vallam_J1EA2_SA_PTL_IPV_NR_DB].dbo.SA_PTL_IPV_NR p JOIN @S s ON s.Station = p.Station_Number AND s.Src = 'NR'
            WHERE p.Date_Time > @StartDate AND p.Date_Time <= @EndDate AND p.Barcode_1 = 'BYPASSED' AND p.Station_Status IN ('OK', 'NOK');

            -- Rework: Rework_DB rows for these stations, latest per production day / engine / result / station
            INSERT #RWD
            SELECT ProductionDate, Shift, Rejected_Station, Engine_Number,
                   CASE WHEN Rework_PDI = 'OK' THEN 1 ELSE 0 END,
                   CASE WHEN Rework_PDI = @ReworkNok THEN 1 ELSE 0 END
            FROM (
                SELECT w.Engine_Number, w.Rework_PDI, w.Rejected_Station, d.ProductionDate, d.Shift,
                       ROW_NUMBER() OVER (PARTITION BY d.ProductionDate, w.Engine_Number, w.Rework_PDI, w.Rejected_Station ORDER BY w.Date_Time DESC) AS Rn
                FROM [RE_Vallam_J1EA2_Rework_DB].dbo.Rework_DB w
                CROSS APPLY (SELECT CASE WHEN CAST(w.Date_Time AS TIME) > '00:15:00' THEN CAST(w.Date_Time AS DATE) ELSE DATEADD(DAY, -1, CAST(w.Date_Time AS DATE)) END AS ProductionDate,
                                    CASE WHEN CAST(w.Date_Time AS TIME) > '00:15:00' AND CAST(w.Date_Time AS TIME) <= '07:15:00' THEN 'A'
                                         WHEN CAST(w.Date_Time AS TIME) > '07:15:00' AND CAST(w.Date_Time AS TIME) <= '15:45:00' THEN 'B' ELSE 'C' END AS Shift) d
                WHERE w.Rejected_Station IN (SELECT Station FROM @S) AND w.Rework_PDI IS NOT NULL
                  AND w.Date_Time > @StartDate AND w.Date_Time <= @EndDate
            ) x
            WHERE Rn = 1;
        END
        ELSE
        BEGIN
            -- Gear Shift Shaft / EFI: the bypassed-barcode rows are the report (no de-duplication)
            INSERT #R
            SELECT p.Date_Time, NULL, p.Station_Number, NULL, p.Station_Status,
                   CASE WHEN p.Station_Status LIKE 'INCOMPLETE CYCLE%' THEN 'IC' ELSE p.Station_Status END, 1, 1
            FROM [RE_Vallam_J1EA2_SA_PTL_IPV_DB].dbo.SA_PTL_IPV p JOIN @S s ON s.Station = p.Station_Number
            WHERE p.Date_Time > @LoadFrom AND p.Date_Time <= @LoadTo AND p.Barcode_1 = 'BYPASSED'
              AND (p.Station_Status IN ('OK', 'NOK', 'BYPASSED') OR p.Station_Status LIKE 'INCOMPLETE CYCLE%');
        END
    END

    /* ---------- Gear Train (one table per station in the Gear Train conveyor DB) ---------- */
    ELSE IF @SubAssembly = 'GEAR_TRAIN'
    BEGIN
        INSERT #R SELECT Date_Time, BARCODE, Station_Number, NULL, Station_Status, CASE WHEN Station_Status = 'REJECT' THEN 'NOK' ELSE Station_Status END, 1, 0
            FROM [RE_Vallam_J1EA2_Gear_Train_Conveyor_DB].dbo.[SA-21A] WHERE Station_Number = 'SA-21A' AND BARCODE <> ' ' AND Station_Status IN ('OK', 'REJECT') AND Date_Time > @LoadFrom AND Date_Time <= @LoadTo;
        INSERT #R SELECT Date_Time, BARCODE, Station_Number, NULL, Station_Status, CASE WHEN Station_Status = 'REJECT' THEN 'NOK' ELSE Station_Status END, 1, 0
            FROM [RE_Vallam_J1EA2_Gear_Train_Conveyor_DB].dbo.[SA-21B] WHERE Station_Number = 'SA-21B' AND BARCODE <> ' ' AND Station_Status IN ('OK', 'REJECT') AND Date_Time > @LoadFrom AND Date_Time <= @LoadTo;
        INSERT #R SELECT Date_Time, BARCODE, Station_Number, NULL, Station_Status, CASE WHEN Station_Status = 'REJECT' THEN 'NOK' ELSE Station_Status END, 1, 0
            FROM [RE_Vallam_J1EA2_Gear_Train_Conveyor_DB].dbo.[SA-21C] WHERE Station_Number = 'SA-21C' AND BARCODE <> ' ' AND Station_Status IN ('OK', 'REJECT') AND Date_Time > @LoadFrom AND Date_Time <= @LoadTo;
        INSERT #R SELECT Date_Time, BARCODE, Station_Number, NULL, Station_Status, CASE WHEN Station_Status = 'REJECT' THEN 'NOK' ELSE Station_Status END, 1, 0
            FROM [RE_Vallam_J1EA2_Gear_Train_Conveyor_DB].dbo.[SA-21D] WHERE Station_Number = 'SA-21D' AND BARCODE <> ' ' AND Station_Status IN ('OK', 'REJECT') AND Date_Time > @LoadFrom AND Date_Time <= @LoadTo;
        INSERT #R SELECT Date_Time, BARCODE, Station_Number, NULL, Station_Status, Station_Status, 1, 0
            FROM [RE_Vallam_J1EA2_Gear_Train_Conveyor_DB].dbo.[SA-21E_New] WHERE Station_Number = 'SA-21E_New' AND BARCODE <> ' ' AND Station_Status IN ('OK', 'NOK') AND Date_Time > @LoadFrom AND Date_Time <= @LoadTo;
        INSERT #R SELECT Date_Time, BARCODE, Station_Number, NULL, Station_Status, CASE WHEN Station_Status = 'REJECT' THEN 'NOK' ELSE Station_Status END, 1, 0
            FROM [RE_Vallam_J1EA2_Gear_Train_Conveyor_DB].dbo.[SA-21F] WHERE Station_Number = 'SA-21F' AND BARCODE <> ' ' AND Station_Status IN ('OK', 'REJECT') AND Date_Time > @LoadFrom AND Date_Time <= @LoadTo;
    END

    /* ---------- Crankcase (OP10..OP140 conveyor tables + SA-14A in the QHold / PDI DB) ---------- */
    ELSE IF @SubAssembly = 'CRANKCASE'
    BEGIN
        DECLARE @Op TABLE (Tbl SYSNAME, Station VARCHAR(10));
        INSERT @Op VALUES ('OP10','SA-01'),('OP20','SA-02'),('OP30','SA-03'),('OP40','SA-04'),('OP50','SA-05'),('OP60','SA-06'),('OP70','SA-07'),
                          ('OP80','SA-08'),('OP90','SA-09'),('OP100','SA-10'),('OP110','SA-11'),('OP120','SA-12'),('OP130','SA-13'),('OP140','SA-14');
        DECLARE @Tbl SYSNAME, @OpStation VARCHAR(10), @Sql NVARCHAR(MAX);
        DECLARE op CURSOR LOCAL FAST_FORWARD FOR SELECT Tbl, Station FROM @Op;
        OPEN op;
        FETCH NEXT FROM op INTO @Tbl, @OpStation;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            SET @Sql = N'INSERT #R SELECT DateTime, Engine_Number, Station_Number, NULL, STATIONSTATUS,
                             CASE WHEN STATIONSTATUS = ''NOT ACCEPTED'' THEN ''NA'' ELSE STATIONSTATUS END, 1, 0
                         FROM [RE_Vallam_J1EA2_Crankcase_Conveyor_DB].dbo.' + QUOTENAME(@Tbl) + N'
                         WHERE Station_Number = @St AND STATIONSTATUS IN (''OK'', ''NOK'', ''NOT ACCEPTED'')
                           AND DateTime > @F AND DateTime <= @T';
            EXEC sp_executesql @Sql, N'@St VARCHAR(10), @F DATETIME, @T DATETIME', @OpStation, @LoadFrom, @LoadTo;
            FETCH NEXT FROM op INTO @Tbl, @OpStation;
        END
        CLOSE op; DEALLOCATE op;

        INSERT #R
        SELECT Date_Time, Engine_Number, Station_Number, NULL, Station_Status,
               CASE WHEN Station_Status = 'NOT ACCEPTED' THEN 'NA' ELSE Station_Status END, 1, 0
        FROM [RE_Vallam_J1EA2_QHold_PDI_DB].dbo.QHold_PDI_DB
        WHERE Station_Number = 'SA-14A' AND Station_Status IN ('OK', 'NOK', 'NOT ACCEPTED')
          AND Date_Time > @LoadFrom AND Date_Time <= @LoadTo;

        INSERT #RWD
        SELECT ProductionDate, Shift, Station_Number, Engine_Number,
               CASE WHEN Rework_PDI = 'OK' THEN 1 ELSE 0 END, CASE WHEN Rework_PDI = 'NOK' THEN 1 ELSE 0 END
        FROM (
            SELECT w.Engine_Number, w.Rework_PDI, w.Station_Number, d.ProductionDate, d.Shift,
                   ROW_NUMBER() OVER (PARTITION BY d.ProductionDate, w.Station_Number, w.Engine_Number, w.Rework_PDI ORDER BY w.Date_Time DESC) AS Rn
            FROM [RE_Vallam_J1EA2_Crankcase_Conveyor_DB].dbo.Rework_DB w
            CROSS APPLY (SELECT CASE WHEN CAST(w.Date_Time AS TIME) > '00:15:00' THEN CAST(w.Date_Time AS DATE) ELSE DATEADD(DAY, -1, CAST(w.Date_Time AS DATE)) END AS ProductionDate,
                                CASE WHEN CAST(w.Date_Time AS TIME) > '00:15:00' AND CAST(w.Date_Time AS TIME) <= '07:15:00' THEN 'A'
                                     WHEN CAST(w.Date_Time AS TIME) > '07:15:00' AND CAST(w.Date_Time AS TIME) <= '15:45:00' THEN 'B' ELSE 'C' END AS Shift) d
            WHERE w.Station_Number = 'CC-REWORK' AND w.Rework_PDI IS NOT NULL
              AND w.Date_Time > @StartDate AND w.Date_Time <= @EndDate
        ) x
        WHERE Rn = 1;
    END

    /* ---------- Engine Test Bed (Result_Table, Date_Time is varchar) ---------- */
    ELSE IF @SubAssembly = 'ENGINE_TESTBED'
    BEGIN
        INSERT #R
        SELECT t.Ts, r.Engine_Number, 'TEST_BED_' + RIGHT(r.Machine_ID, 1), NULL, r.Overall_Result, r.Overall_Result, 1, 0
        FROM [RE_Vallam_J1EA2_Testbed_DB].dbo.Result_Table r
        CROSS APPLY (SELECT TRY_CONVERT(DATETIME, r.Date_Time, 121) AS Ts) t
        WHERE r.Machine_ID IN ('M_1', 'M_2', 'M_3', 'M_4', 'M_5', 'M_6', 'M_7')
          AND r.Overall_Result <> ' ' AND r.Engine_Number <> ' '
          AND t.Ts > @LoadFrom AND t.Ts <= @LoadTo;

        -- Power BI Engine_TB_Rework: rework rows joined to the engine's test results (OK / NOK)
        INSERT #RWD
        SELECT d.ProductionDate, d.Shift, UPPER(w.Rejected_Station), m.Engine_Number,
               CASE WHEN m.Overall_Result = 'OK' THEN 1 ELSE 0 END, CASE WHEN m.Overall_Result = 'NOK' THEN 1 ELSE 0 END
        FROM [RE_Vallam_J1EA2_Rework_DB].dbo.Rework_DB w
        CROSS APPLY (SELECT CASE WHEN CAST(w.Date_Time AS TIME) > '00:15:00' THEN CAST(w.Date_Time AS DATE) ELSE DATEADD(DAY, -1, CAST(w.Date_Time AS DATE)) END AS ProductionDate,
                            CASE WHEN CAST(w.Date_Time AS TIME) > '00:15:00' AND CAST(w.Date_Time AS TIME) <= '07:15:00' THEN 'A'
                                 WHEN CAST(w.Date_Time AS TIME) > '07:15:00' AND CAST(w.Date_Time AS TIME) <= '15:45:00' THEN 'B' ELSE 'C' END AS Shift) d
        JOIN (SELECT Engine_Number, Overall_Result FROM [RE_Vallam_J1EA2_Testbed_DB].dbo.Result_Table GROUP BY Engine_Number, Overall_Result) m
          ON m.Engine_Number = w.Engine_Number
        WHERE w.Rejected_Station IN ('Test_Bed_1', 'Test_Bed_2', 'Test_Bed_3', 'Test_Bed_4', 'Test_Bed_5', 'Test_Bed_6', 'Test_Bed_7')
          AND w.Date_Time > @StartDate AND w.Date_Time <= @EndDate;
    END

    /* ---------- Crankshaft (machine shop) and Crankshaft OP-60 ---------- */
    ELSE IF @SubAssembly = 'CRANKSHAFT'
    BEGIN
        INSERT #R
        SELECT m.DateTime, m.Barcode_2, o.Op, CAST(m.Cell_Number AS VARCHAR(30)), m.OverallStation_Status,
               CASE WHEN m.OverallStation_Status = 'REJECT' THEN 'NOK' ELSE m.OverallStation_Status END, 1, 0
        FROM [RE_VL_MachineShop].dbo.MachineShopData m
        JOIN (VALUES ('33','OP-10'), ('34','OP-20'), ('61','OP-30A'), ('35','OP-30'), ('36','OP-40'), ('37','OP-50'), ('38','OP-70')) o(Code, Op)
          ON o.Code = m.Station_Number
        WHERE m.Barcode_2 <> ' ' AND m.Barcode_2 <> 'BYPASSED' AND m.OverallStation_Status IN ('OK', 'NOK', 'REJECT')
          AND m.DateTime > @LoadFrom AND m.DateTime <= @LoadTo;

        INSERT #B
        SELECT m.DateTime, o.Op, CAST(m.Cell_Number AS VARCHAR(30)), CASE WHEN m.OverallStation_Status = 'REJECT' THEN 'NOK' ELSE m.OverallStation_Status END
        FROM [RE_VL_MachineShop].dbo.MachineShopData m
        JOIN (VALUES ('33','OP-10'), ('34','OP-20'), ('61','OP-30A'), ('35','OP-30'), ('36','OP-40'), ('37','OP-50'), ('38','OP-70')) o(Code, Op)
          ON o.Code = m.Station_Number
        WHERE m.Barcode_2 = 'BYPASSED' AND m.OverallStation_Status IN ('OK', 'NOK', 'REJECT')
          AND m.DateTime > @StartDate AND m.DateTime <= @EndDate;
    END
    ELSE IF @SubAssembly = 'CRANKSHAFT_OP60'
    BEGIN
        INSERT #R
        SELECT DateTime, Barcode_2, 'OP-60', DIPV_10_Status, OverallStation_Status,
               CASE WHEN OverallStation_Status = 'REJECT' THEN 'NOK' ELSE OverallStation_Status END, 1, 0
        FROM [RE_VL_MachineShop].dbo.MachineShopData
        WHERE Station_Number = '62' AND Barcode_2 <> ' ' AND Barcode_2 <> 'BYPASSED' AND OverallStation_Status IN ('OK', 'REJECT')
          AND DateTime > @LoadFrom AND DateTime <= @LoadTo;

        INSERT #B
        SELECT DateTime, 'OP-60', DIPV_10_Status, CASE WHEN OverallStation_Status = 'REJECT' THEN 'NOK' ELSE OverallStation_Status END
        FROM [RE_VL_MachineShop].dbo.MachineShopData
        WHERE Station_Number = '62' AND Barcode_2 = 'BYPASSED' AND OverallStation_Status IN ('OK', 'REJECT')
          AND DateTime > @StartDate AND DateTime <= @EndDate;
    END

    /* ---------- Common aggregation ---------- */
    SELECT r.*, d.ProductionDate, d.Shift, CASE WHEN r.Ts > @StartDate AND r.Ts <= @EndDate THEN 1 ELSE 0 END AS InRange,
           CASE WHEN r.NoDedup = 1 THEN 1 ELSE ROW_NUMBER() OVER (PARTITION BY r.Unit, r.Station, r.SubGroup, r.RawStatus ORDER BY r.Ts DESC) END AS RnAssy
    INTO #D
    FROM #R r
    CROSS APPLY (SELECT CASE WHEN CAST(r.Ts AS TIME) > '00:15:00' THEN CAST(r.Ts AS DATE) ELSE DATEADD(DAY, -1, CAST(r.Ts AS DATE)) END AS ProductionDate,
                        CASE WHEN CAST(r.Ts AS TIME) > '00:15:00' AND CAST(r.Ts AS TIME) <= '07:15:00' THEN 'A'
                             WHEN CAST(r.Ts AS TIME) > '07:15:00' AND CAST(r.Ts AS TIME) <= '15:45:00' THEN 'B' ELSE 'C' END AS Shift) d;

    -- 1. Assy (Balancer / Piston barrel: BYPASSED-status rows count here but not in Straight Pass)
    SELECT ProductionDate, Shift, Station, SubGroup,
           SUM(CASE WHEN Status = 'OK'  THEN 1 ELSE 0 END) AS OkQty,
           SUM(CASE WHEN Status = 'NOK' THEN 1 ELSE 0 END) AS NokQty,
           SUM(CASE WHEN Status = 'IC'  THEN 1 ELSE 0 END) AS IncompleteQty,
           SUM(CASE WHEN Status = 'NA'  THEN 1 ELSE 0 END) AS NotAcceptedQty,
           COUNT(*) AS ActualQty
    FROM #D
    WHERE RnAssy = 1 AND InRange = 1
    GROUP BY ProductionDate, Shift, Station, SubGroup
    ORDER BY ProductionDate, Shift, Station;

    -- 2. Straight Pass - first attempt per part
    SELECT ProductionDate, Shift, Station, SubGroup,
           SUM(CASE WHEN Status = 'OK'  THEN 1 ELSE 0 END) AS OkQty,
           SUM(CASE WHEN Status = 'NOK' THEN 1 ELSE 0 END) AS NokQty,
           SUM(CASE WHEN Status = 'IC'  THEN 1 ELSE 0 END) AS IncompleteQty,
           SUM(CASE WHEN Status = 'NA'  THEN 1 ELSE 0 END) AS NotAcceptedQty,
           COUNT(*) AS ActualQty
    FROM (SELECT *, CASE WHEN NoDedup = 1 THEN 1 ELSE ROW_NUMBER() OVER (PARTITION BY Unit, Station, SubGroup ORDER BY Ts) END AS RnSp
          FROM #D WHERE InSp = 1) s
    WHERE RnSp = 1 AND InRange = 1
    GROUP BY ProductionDate, Shift, Station, SubGroup
    ORDER BY ProductionDate, Shift, Station;

    -- 3. Bypassed
    SELECT d.ProductionDate, d.Shift, b.Station, b.SubGroup,
           SUM(CASE WHEN b.Status = 'OK'  THEN 1 ELSE 0 END) AS OkQty,
           SUM(CASE WHEN b.Status = 'NOK' THEN 1 ELSE 0 END) AS NokQty,
           0 AS IncompleteQty, 0 AS NotAcceptedQty,
           COUNT(*) AS ActualQty
    FROM #B b
    CROSS APPLY (SELECT CASE WHEN CAST(b.Ts AS TIME) > '00:15:00' THEN CAST(b.Ts AS DATE) ELSE DATEADD(DAY, -1, CAST(b.Ts AS DATE)) END AS ProductionDate,
                        CASE WHEN CAST(b.Ts AS TIME) > '00:15:00' AND CAST(b.Ts AS TIME) <= '07:15:00' THEN 'A'
                             WHEN CAST(b.Ts AS TIME) > '07:15:00' AND CAST(b.Ts AS TIME) <= '15:45:00' THEN 'B' ELSE 'C' END AS Shift) d
    GROUP BY d.ProductionDate, d.Shift, b.Station, b.SubGroup
    ORDER BY d.ProductionDate, d.Shift, b.Station;

    -- 4. Rework
    SELECT ProductionDate, Shift, Station, SUM(IsOk) AS OkQty, SUM(IsNok) AS NokQty, COUNT(DISTINCT Engine) AS DistinctEngines
    FROM #RWD
    GROUP BY ProductionDate, Shift, Station
    ORDER BY ProductionDate, Shift, Station;

    -- 5. Reworked engines per shift / station - the page counts distinct engines over the whole range
    --    (summing the per-day counts of set 4 would count an engine reworked on several days twice)
    SELECT DISTINCT Shift, Station, Engine
    FROM #RWD;
END
GO
