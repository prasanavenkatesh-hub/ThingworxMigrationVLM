-- dbo.Get_EngineLeak_Report_EA02_OverAll  (FACTREPRDETL @ 10.130.1.73) - copied read-only from the database on 2026-11-12 for reference.
-- The app only EXECUTEs this proc; keep this file in sync with the database.
CREATE PROCEDURE [dbo].[Get_EngineLeak_Report_EA02_OverAll]
    @FromDate DATETIME = NULL,   -- CHANGED FROM DATE → DATETIME
    @ToDate   DATETIME = NULL,   -- CHANGED FROM DATE → DATETIME
    @ShiftCode NVARCHAR(100) = NULL,
    @EngineNumber NVARCHAR(MAX) = NULL,
    @ModelShortCode NVARCHAR(500) = NULL,
    @ModelCode NVARCHAR(500) = NULL,
    @DefectWise NVARCHAR(1000) = NULL,
    @Station NVARCHAR(500) = NULL,
    @ReworkDetails NVARCHAR(2000) = NULL,
    @Result NVARCHAR(100) = NULL,
    @Leak1_Status NVARCHAR(100) = NULL,
    @LeakValue1 NVARCHAR(200) = NULL,
    @LeakMachine NVARCHAR(500) = NULL,
    @LeakValue2 NVARCHAR(200) = NULL
AS
BEGIN
    SET NOCOUNT ON;

    SELECT
        [Date],
        SHIFT AS ShiftCode,
        ENGINE_NUMBER AS EngineNumber,
        MODEL AS ModelShortCode,
        MODEL_CODE AS ModelCode,
        STATION AS Station,
        LEAK_PA AS LeakPa,
        RESULT AS Result,
        Leak1_Status AS Leak1_Status,
        REWORK_RESULT AS ReworkResult,
        LEAK_DESCRIPTION AS LeakDescription,
        ROOT_CAUSE AS RootCause,
        REWORK_DETAILS AS ReworkDetails,
        LEAK_REWORK_TORQUE_STATUS AS LeakReworkTorqueStatus,
        PART_REPLACE_DETAILS AS PartReplaceDetails,
        THROTTLE_BODY AS ThrottleBody,
        CATEGORY AS Category,
        SUPPLIER_Grouping AS SupplierGrouping,
        REWORK_OIL_FILLING_VALUE AS ReworkOilFillingValue,
        REWORK_DATE AS ReworkDate,
        RETEST_LEAK_PA AS RetestLeakPa,
        CASE
            WHEN CAST(REWORK_DATE AS TIME) > '00:15:00' AND CAST(REWORK_DATE AS TIME) <= '07:15:00' THEN 'A'
            WHEN CAST(REWORK_DATE AS TIME) > '07:15:00' AND CAST(REWORK_DATE AS TIME) <= '15:45:00' THEN 'B'
            WHEN REWORK_DATE IS NULL OR REWORK_DATE = '' THEN ''
            ELSE 'C'
        END AS ReworkShift,
        REWORK_USER_ID AS ReworkedBy,
        VERIFIED_QF_USER_ID AS VerifiedBy
    FROM dbo.Engine_Leak_Master_EA02
    WHERE
        (@FromDate IS NULL OR @ToDate IS NULL OR [Date] BETWEEN @FromDate AND @ToDate)
        AND (@ShiftCode IS NULL OR @ShiftCode = '' OR SHIFT IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@ShiftCode, ',')))
        AND (@EngineNumber IS NULL OR @EngineNumber = '' OR ENGINE_NUMBER IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@EngineNumber, ',')))
        AND (@ModelShortCode IS NULL OR @ModelShortCode = '' OR MODEL IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@ModelShortCode, ',')))
        AND (@ModelCode IS NULL OR @ModelCode = '' OR MODEL_CODE IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@ModelCode, ',')))
        AND (@DefectWise IS NULL OR @DefectWise = '' OR LEAK_DESCRIPTION IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@DefectWise, ',')))
        AND (@Station IS NULL OR @Station = '' OR STATION IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@Station, ',')))
        AND (@ReworkDetails IS NULL OR @ReworkDetails = '' OR REWORK_DETAILS IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@ReworkDetails, ',')))
        AND (@Result IS NULL OR @Result = '' OR RESULT IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@Result, ',')))
        AND (@Leak1_Status IS NULL OR @Leak1_Status = '' OR Leak1_Status IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@Leak1_Status, ',')))
        AND (@LeakValue1 IS NULL OR @LeakValue1 = '' OR CONVERT(NVARCHAR(20), LEAK_PA) IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@LeakValue1, ',')))
        AND (@LeakMachine IS NULL OR @LeakMachine = '' OR Leak2 IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@LeakMachine, ',')))
        AND (@LeakValue2 IS NULL OR @LeakValue2 = '' OR CONVERT(NVARCHAR(20), Leak3) IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@LeakValue2, ',')))
    ORDER BY [Date];
END
GO
