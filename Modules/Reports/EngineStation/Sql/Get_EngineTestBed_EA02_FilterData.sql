-- dbo.Get_EngineTestBed_EA02_FilterData  (FACTREPRDETL @ 10.130.1.73) - copied read-only from the database on 2026-11-12 for reference.
-- The app only EXECUTEs this proc; keep this file in sync with the database.
CREATE     PROCEDURE [dbo].[Get_EngineTestBed_EA02_FilterData]
    @FromDate DATETIME = NULL,   -- CHANGED FROM DATE → DATETIME
    @ToDate   DATETIME = NULL   -- CHANGED FROM DATE → DATETIME
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        NULLIF(LTRIM(RTRIM(MODEL)), '') AS ModelCode,
        --NULLIF(LTRIM(RTRIM(ENGINE_NUMBER)), '') AS EngineNumber,
        NULLIF(LTRIM(RTRIM(DEFECT_DETAILS)), '') AS DefectDetails,
        NULLIF(LTRIM(RTRIM(REWORK_DETAILS)), '') AS ReworkDetails,
        NULLIF(LTRIM(RTRIM(BED_NO)), '') AS BedNo,
        NULLIF(LTRIM(RTRIM(TESTING_RESULT)), '') AS TestingResult,
        NULLIF(LTRIM(RTRIM(LH_DB_VALUE)), '') AS LhDbValue,
        NULLIF(LTRIM(RTRIM(RH_DB_VALUE)), '') AS RhDbValue,
        NULLIF(LTRIM(RTRIM(Number_Of_Times)), '') AS NoOfTimes,
        NULLIF(LTRIM(RTRIM(SHIFT)), '') AS ShiftCode 
    FROM dbo.Engine_TestBed_Master_EA02
    WHERE
        (@FromDate IS NULL OR @ToDate IS NULL OR [Date] BETWEEN @FromDate AND @ToDate)
END
GO
