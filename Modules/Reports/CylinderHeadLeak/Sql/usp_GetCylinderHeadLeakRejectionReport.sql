USE [RE_Vallam_J1EA2_SA_PTL_IPV_NR_DB];
GO
/* Cylinder Head Leak Rejection Report - SA-30E first attempts per barcode, for Oragadam EA3 (linked server
   10.117.1.204) and Vallam EA2 / EA1. Read-only.
   Fix 2026-11-02: the EA3 columns arrive over the linked server in Latin1_General_CI_AS while this server uses
   SQL_Latin1_General_CP1_CI_AS, so the UNION ALL failed (Msg 457, collation conflict) for every login.
   Station_Number / Station_Status of EA3 are now converted with COLLATE DATABASE_DEFAULT. Nothing else changed. */
CREATE OR ALTER PROCEDURE dbo.usp_GetCylinderHeadLeakRejectionReport
    @StartDate DATE = NULL,
    @EndDate DATE = NULL,
    @Plant NVARCHAR(20) = NULL,        -- 'ORAGADAM' or 'VALLAM'
    @AssemblyLine NVARCHAR(10) = NULL, -- 'EA1', 'EA2', 'EA3'
    @Shift NVARCHAR(5) = NULL          -- 'A', 'B', 'C'
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @RawStart DATETIME2 = CASE WHEN @StartDate IS NULL THEN NULL ELSE CAST(@StartDate AS DATETIME2) END;
    DECLARE @RawEnd DATETIME2 = CASE WHEN @EndDate IS NULL THEN NULL ELSE DATEADD(DAY, 2, CAST(@EndDate AS DATETIME2)) END;

    -- EA3 rows come from Oragadam over the linked server, whose columns use Latin1_General_CI_AS;
    -- convert them to this database's collation so the UNION ALL with the Vallam rows works.
    ;WITH EA3_Base AS (
        SELECT s.Date_Time,
               s.Station_Number COLLATE DATABASE_DEFAULT AS Station_Number,
               s.Station_Status COLLATE DATABASE_DEFAULT AS Station_Status, sc.New_Date_Time, sc.ShiftPlant, sc.Cell,
            ROW_NUMBER() OVER (PARTITION BY s.Barcode_1, s.Station_Number ORDER BY s.Date_Time) AS Row_Num
        FROM [10.117.1.204].[RE_ORG_J1EA3_SA_PTL_IPV_NR_DB].[dbo].[SA_PTL_IPV_NR] s
        CROSS APPLY dbo.fn_CylinderHeadShiftCell(s.Date_Time, s.Barcode_1) sc
        WHERE s.Station_Number IN ('SA-30E') AND s.Barcode_1 <> ' '
          AND s.Station_Status IN ('OK', 'NOK', 'BYPASSED', 'INCOMPLETE CYCLE', 'INCOMPLETE CYCLE ')
          AND sc.Cell IS NOT NULL
          AND (@RawStart IS NULL OR s.Date_Time >= @RawStart)
          AND (@RawEnd IS NULL OR s.Date_Time <= @RawEnd)
    ),
    EA2_Base AS (
        SELECT s.Date_Time, s.Station_Number, s.Station_Status, sc.New_Date_Time, sc.ShiftPlant, sc.Cell,
            ROW_NUMBER() OVER (PARTITION BY s.Barcode_1, s.Station_Number ORDER BY s.Date_Time) AS Row_Num
        FROM [RE_Vallam_J1EA2_SA_PTL_IPV_NR_DB].[dbo].[SA_PTL_IPV_NR] s
        CROSS APPLY dbo.fn_CylinderHeadShiftCell(s.Date_Time, s.Barcode_1) sc
        WHERE s.Station_Number IN ('SA-30E') AND s.Barcode_1 <> ' '
          AND s.Station_Status IN ('OK', 'NOK', 'BYPASSED', 'INCOMPLETE CYCLE', 'INCOMPLETE CYCLE ')
          AND sc.Cell IS NOT NULL
          AND (@RawStart IS NULL OR s.Date_Time >= @RawStart)
          AND (@RawEnd IS NULL OR s.Date_Time <= @RawEnd)
    ),
    EA1_Base AS (
        SELECT s.Date_Time, s.Station_Number, s.Station_Status, sc.New_Date_Time, sc.ShiftPlant, sc.Cell,
            ROW_NUMBER() OVER (PARTITION BY s.Barcode_1, s.Station_Number ORDER BY s.Date_Time) AS Row_Num
        FROM [RE_Vallam_J1EA1_SA_PTL_IPV_NR_DB].[dbo].[SA_PTL_IPV_NR] s
        CROSS APPLY dbo.fn_CylinderHeadShiftCell(s.Date_Time, s.Barcode_1) sc
        WHERE s.Station_Number IN ('SA-30E') AND s.Barcode_1 <> ' '
          AND s.Station_Status IN ('OK', 'NOK', 'BYPASSED', 'INCOMPLETE CYCLE', 'INCOMPLETE CYCLE ')
          AND sc.Cell IS NOT NULL
          AND (@RawStart IS NULL OR s.Date_Time >= @RawStart)
          AND (@RawEnd IS NULL OR s.Date_Time <= @RawEnd)
    ),
    Combined AS (
        SELECT 'ORAGADAM' AS Location, 'EA3' AS Source, New_Date_Time, ShiftPlant, Station_Number, Cell,
               SUM(CASE WHEN Station_Status = 'OK' THEN 1 ELSE 0 END) AS OkQty,
               SUM(CASE WHEN Station_Status = 'NOK' THEN 1 ELSE 0 END) AS NotOkQty,
               COUNT(Station_Status) AS ActualQty
        FROM EA3_Base WHERE Row_Num = 1
        GROUP BY New_Date_Time, ShiftPlant, Station_Number, Cell

        UNION ALL

        SELECT 'VALLAM' AS Location, 'EA2' AS Source, New_Date_Time, ShiftPlant, Station_Number, Cell,
               SUM(CASE WHEN Station_Status = 'OK' THEN 1 ELSE 0 END),
               SUM(CASE WHEN Station_Status = 'NOK' THEN 1 ELSE 0 END),
               COUNT(Station_Status)
        FROM EA2_Base WHERE Row_Num = 1
        GROUP BY New_Date_Time, ShiftPlant, Station_Number, Cell

        UNION ALL

        SELECT 'VALLAM' AS Location, 'EA1' AS Source, New_Date_Time, ShiftPlant, Station_Number, Cell,
               SUM(CASE WHEN Station_Status = 'OK' THEN 1 ELSE 0 END),
               SUM(CASE WHEN Station_Status = 'NOK' THEN 1 ELSE 0 END),
               COUNT(Station_Status)
        FROM EA1_Base WHERE Row_Num = 1
        GROUP BY New_Date_Time, ShiftPlant, Station_Number, Cell
    )
    SELECT
        Location, Source AS AssemblyLine, New_Date_Time AS [Date], ShiftPlant AS Shift,
        Station_Number AS StationNumber, Cell,
        OkQty, NotOkQty, ActualQty
    FROM Combined
    WHERE (@StartDate IS NULL OR New_Date_Time >= @StartDate)
      AND (@EndDate IS NULL OR New_Date_Time <= @EndDate)
      AND (@Plant IS NULL OR Location = @Plant)
      AND (@AssemblyLine IS NULL OR Source = @AssemblyLine)
      AND (@Shift IS NULL OR ShiftPlant = @Shift)
    ORDER BY New_Date_Time, ShiftPlant, Cell;
END
GO
