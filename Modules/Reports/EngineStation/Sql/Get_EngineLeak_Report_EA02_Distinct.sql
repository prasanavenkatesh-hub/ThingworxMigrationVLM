-- dbo.Get_EngineLeak_Report_EA02_Distinct  (FACTREPRDETL @ 10.130.1.73) - copied read-only from the database on 2026-11-12 for reference.
-- The app only EXECUTEs this proc; keep this file in sync with the database.
CREATE PROCEDURE [dbo].[Get_EngineLeak_Report_EA02_Distinct]
    @FromDate DATETIME = NULL,
    @ToDate DATETIME = NULL,
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
 
    ;WITH LatestEngineRecord AS
    (
        SELECT *,
            CASE
                WHEN CAST(REWORK_DATE AS TIME) > '00:15:00'
                     AND CAST(REWORK_DATE AS TIME) <= '07:15:00' THEN 'A'
                WHEN CAST(REWORK_DATE AS TIME) > '07:15:00'
                     AND CAST(REWORK_DATE AS TIME) <= '15:45:00' THEN 'B'
                WHEN REWORK_DATE IS NULL THEN ''
                ELSE 'C'
            END AS ReworkShift,
 
            CASE
                WHEN CAST([Date] AS TIME) > '00:15:00'
                    THEN CAST([Date] AS DATE)
                ELSE DATEADD(DAY,-1,CAST([Date] AS DATE))
            END AS New_Date_Time,
 
            CASE
                WHEN CAST([Date] AS TIME) > '00:15:00'
                     AND CAST([Date] AS TIME) <= '07:15:00' THEN 'A'
                WHEN CAST([Date] AS TIME) > '07:15:00'
                     AND CAST([Date] AS TIME) <= '15:45:00' THEN 'B'
                ELSE 'C'
            END AS ShiftPlant,
 
            ROW_NUMBER() OVER
            (
                PARTITION BY ENGINE_NUMBER
                ORDER BY [Date] DESC
            ) AS RN
        FROM dbo.Engine_Leak_Master_EA02
        WHERE
            (@FromDate IS NULL OR @ToDate IS NULL OR [Date] BETWEEN @FromDate AND @ToDate)
            AND ENGINE_NUMBER <> ''
    )
 
    SELECT
        f.[Date],
        f.SHIFT AS ShiftCode,
        f.ENGINE_NUMBER AS EngineNumber,
        f.MODEL AS ModelShortCode,
        f.MODEL_CODE AS ModelCode,
        f.STATION AS Station,
        f.LEAK_PA AS LeakPa,
        f.RESULT AS Result,
        f.Leak1_Status,
        f.REWORK_RESULT AS ReworkResult,
        f.LEAK_DESCRIPTION AS LeakDescription,
        f.ROOT_CAUSE AS RootCause,
        f.REWORK_DETAILS AS ReworkDetails,
        f.LEAK_REWORK_TORQUE_STATUS AS LeakReworkTorqueStatus,
        f.PART_REPLACE_DETAILS AS PartReplaceDetails,
        f.THROTTLE_BODY AS ThrottleBody,
        f.CATEGORY AS Category,
        f.SUPPLIER_Grouping AS SupplierGrouping,
        f.REWORK_OIL_FILLING_VALUE AS ReworkOilFillingValue,
        f.REWORK_DATE AS ReworkDate,
        f.RETEST_LEAK_PA AS RetestLeakPa,
        f.ReworkShift,
        f.REWORK_USER_ID AS ReworkedBy,
        f.VERIFIED_QF_USER_ID AS VerifiedBy,
        f.New_Date_Time,
        f.ShiftPlant
    FROM LatestEngineRecord f
    WHERE
        f.RN = 1
        AND (@ShiftCode IS NULL OR @ShiftCode = '' OR f.SHIFT IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@ShiftCode, ',')))
        AND (@EngineNumber IS NULL OR @EngineNumber = '' OR f.ENGINE_NUMBER IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@EngineNumber, ',')))
        AND (@ModelShortCode IS NULL OR @ModelShortCode = '' OR f.MODEL IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@ModelShortCode, ',')))
        AND (@ModelCode IS NULL OR @ModelCode = '' OR f.MODEL_CODE IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@ModelCode, ',')))
        AND (@DefectWise IS NULL OR @DefectWise = '' OR f.LEAK_DESCRIPTION IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@DefectWise, ',')))
        AND (@Station IS NULL OR @Station = '' OR f.STATION IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@Station, ',')))
        AND (@ReworkDetails IS NULL OR @ReworkDetails = '' OR f.REWORK_DETAILS IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@ReworkDetails, ',')))
        AND (@Result IS NULL OR @Result = '' OR f.RESULT IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@Result, ',')))
        AND (@Leak1_Status IS NULL OR @Leak1_Status = '' OR f.Leak1_Status IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@Leak1_Status, ',')))
        AND (@LeakValue1 IS NULL OR @LeakValue1 = '' OR CONVERT(NVARCHAR(20), f.LEAK_PA) IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@LeakValue1, ',')))
        AND (@LeakMachine IS NULL OR @LeakMachine = '' OR f.Leak2 IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@LeakMachine, ',')))
        AND (@LeakValue2 IS NULL OR @LeakValue2 = '' OR CONVERT(NVARCHAR(20), f.Leak3) IN (SELECT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@LeakValue2, ',')))
    ORDER BY f.[Date] DESC;
END
GO
