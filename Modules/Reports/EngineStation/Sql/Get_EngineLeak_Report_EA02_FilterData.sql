-- dbo.Get_EngineLeak_Report_EA02_FilterData  (FACTREPRDETL @ 10.130.1.73) - copied read-only from the database on 2026-11-12 for reference.
-- The app only EXECUTEs this proc; keep this file in sync with the database.
CREATE   PROCEDURE [dbo].[Get_EngineLeak_Report_EA02_FilterData]
    @FromDate DATETIME = NULL,   -- CHANGED FROM DATE → DATETIME
    @ToDate   DATETIME = NULL   -- CHANGED FROM DATE → DATETIME
AS
BEGIN
    SET NOCOUNT ON;

    SELECT TOP 500
        NULLIF(LTRIM(RTRIM(MODEL_CODE)), '') AS ModelCode,
        NULLIF(LTRIM(RTRIM(LEAK_DESCRIPTION)), '') AS DefectWise,
        NULLIF(LTRIM(RTRIM(REWORK_DETAILS)), '') AS ReworkDetails,
        NULLIF(LTRIM(RTRIM(RESULT)), '') AS Result,
        NULLIF(LTRIM(RTRIM(Leak1_Status)), '') AS Leak1_Status,
        NULLIF(LTRIM(RTRIM(LEAK_PA)), '') AS LeakValue1,
        NULLIF(LTRIM(RTRIM(Leak2)), '') AS LeakMachine,
        NULLIF(LTRIM(RTRIM(Leak3)), '') AS LeakValue2,
        NULLIF(LTRIM(RTRIM(MODEL)), '') AS ModelShortCode,
        NULLIF(LTRIM(RTRIM(STATION)), '') AS Station,
        NULLIF(LTRIM(RTRIM(SHIFT)), '') AS ShiftCode
        --,ENGINE_NUMBER AS EngineNumber
    FROM dbo.Engine_Leak_Master_EA02
    WHERE
        (@FromDate IS NULL OR @ToDate IS NULL OR [Date] BETWEEN @FromDate AND @ToDate)
END
GO
