-- dbo.Get_PDI_Report_EA01_FilterData  (FACTREPRDETL @ 10.130.1.73) - copied read-only from the database on 2026-11-12 for reference.
-- The app only EXECUTEs this proc; keep this file in sync with the database.
CREATE     PROCEDURE [dbo].[Get_PDI_Report_EA01_FilterData]
    @FromDate DATETIME = NULL,
    @ToDate   DATETIME = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SELECT
    NULLIF(LTRIM(RTRIM(MODEL)), '') AS ModelCode,
    NULLIF(LTRIM(RTRIM(PDI_DEFECT)), '') AS PDIDefect,
    NULLIF(LTRIM(RTRIM(REWORK_DETAILS)), '') AS ReworkDetails,
    NULLIF(LTRIM(RTRIM(PDI_RESULT)), '') AS PDIResult,
    NULLIF(LTRIM(RTRIM(LEAK_VALUE_PA)), '') AS LeakValuePA,
    NULLIF(LTRIM(RTRIM(SHIFT)), '') AS ShiftCode,
    NULLIF(LTRIM(RTRIM(ENGINE_NUMBER)), '') AS EngineNumber
FROM dbo.PDI_Report_Master_EA01
WHERE
    (@FromDate IS NULL OR @ToDate IS NULL OR [Date] BETWEEN @FromDate AND @ToDate);
END
GO
