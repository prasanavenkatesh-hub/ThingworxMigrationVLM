-- dbo.Get_PDI_Report_EA02_Duplicates  (FACTREPRDETL @ 10.130.1.73) - copied read-only from the database on 2026-11-12 for reference.
-- The app only EXECUTEs this proc; keep this file in sync with the database.
CREATE PROCEDURE [dbo].[Get_PDI_Report_EA02_Duplicates]
(
    @FromDate DATETIME = NULL,
    @ToDate DATETIME = NULL,
    @ShiftCode NVARCHAR(MAX) = NULL,
    @EngineNumber NVARCHAR(MAX) = NULL,
    @ModelCode NVARCHAR(MAX) = NULL,
    @PDIDefect NVARCHAR(MAX) = NULL,
    @ReworkDetails NVARCHAR(MAX) = NULL,
    @PDIResult NVARCHAR(MAX) = NULL,
    @LeakValuePA NVARCHAR(MAX) = NULL
)
AS
BEGIN
    SET NOCOUNT ON;
 
    ;WITH FilteredData AS
    (
        SELECT
            [DATE],
            SHIFT,
            ENGINE_NUMBER,
            MODEL,
            PDI_STATION,
            USER_ID,
            PDI_RESULT,
            LEAK_VALUE_PA,
            PDI_DEFECT,
            ROOT_CAUSE,
            REWORK_DETAILS,
            REWORK_TORQUE_STATUS,
            PART_REPLACE_DETAILS,
            REWORK_OIL_FILLING_VALUE,
            CATEGORY,
            SUPPLIER,
            REWORK_DATE,
            REWORK_USER_ID,
            VERIFIED_QF_USER_ID
        FROM dbo.PDI_Report_Master_EA02 AS M
        WHERE
            (@FromDate IS NULL OR @ToDate IS NULL
             OR M.[DATE] BETWEEN @FromDate AND @ToDate)
 
            AND (@ShiftCode IS NULL OR @ShiftCode = ''
                 OR EXISTS
                 (
                     SELECT 1
                     FROM STRING_SPLIT(@ShiftCode, ',') ss
                     WHERE M.SHIFT = LTRIM(RTRIM(ss.value))
                 ))
 
            AND (@EngineNumber IS NULL OR @EngineNumber = ''
                 OR EXISTS
                 (
                     SELECT 1
                     FROM STRING_SPLIT(@EngineNumber, ',') ss
                     WHERE M.ENGINE_NUMBER = LTRIM(RTRIM(ss.value))
                 ))
 
            AND (@ModelCode IS NULL OR @ModelCode = ''
                 OR EXISTS
                 (
                     SELECT 1
                     FROM STRING_SPLIT(@ModelCode, ',') ss
                     WHERE M.MODEL = LTRIM(RTRIM(ss.value))
                 ))
 
            AND (@PDIDefect IS NULL OR @PDIDefect = ''
                 OR EXISTS
                 (
                     SELECT 1
                     FROM STRING_SPLIT(@PDIDefect, ',') ss
                     WHERE M.PDI_DEFECT = LTRIM(RTRIM(ss.value))
                 ))
 
            AND (@ReworkDetails IS NULL OR @ReworkDetails = ''
                 OR EXISTS
                 (
                     SELECT 1
                     FROM STRING_SPLIT(@ReworkDetails, ',') ss
                     WHERE M.REWORK_DETAILS = LTRIM(RTRIM(ss.value))
                 ))
 
            AND (@PDIResult IS NULL OR @PDIResult = ''
                 OR EXISTS
                 (
                     SELECT 1
                     FROM STRING_SPLIT(@PDIResult, ',') ss
                     WHERE M.PDI_RESULT = LTRIM(RTRIM(ss.value))
                 ))
 
            AND (@LeakValuePA IS NULL OR @LeakValuePA = ''
                 OR EXISTS
                 (
                     SELECT 1
                     FROM STRING_SPLIT(@LeakValuePA, ',') ss
                     WHERE M.LEAK_VALUE_PA = LTRIM(RTRIM(ss.value))
                 ))
    ),
 
    CountPerEngine AS
    (
        SELECT ENGINE_NUMBER
        FROM FilteredData
        GROUP BY ENGINE_NUMBER
        HAVING COUNT(*) > 1
    )
 
    SELECT
        f.[DATE],
        f.SHIFT AS ShiftCode,
        f.ENGINE_NUMBER AS EngineNumber,
        f.MODEL AS ModelCode,
        f.PDI_STATION AS PDIStation,
        f.USER_ID AS USERID,
        f.PDI_RESULT AS PDIResult,
        f.LEAK_VALUE_PA AS LeakValuePA,
        f.PDI_DEFECT AS PDIDefect,
        f.ROOT_CAUSE AS RootCause,
        f.REWORK_DETAILS AS ReworkDetails,
        f.REWORK_TORQUE_STATUS AS ReworkTorqueStatus,
        f.PART_REPLACE_DETAILS AS PartReplaceDetails,
        f.REWORK_OIL_FILLING_VALUE AS ReworkOilFillingValue,
        f.CATEGORY AS Category,
        f.SUPPLIER AS Supplier,
        f.REWORK_DATE AS ReworkDate,
        f.REWORK_USER_ID AS ReworkUserId,
        f.VERIFIED_QF_USER_ID AS VerifiedQFUserId,
 
        CASE
            WHEN CAST(f.[DATE] AS TIME) > '00:15:00'
            THEN CAST(f.[DATE] AS DATE)
            ELSE DATEADD(DAY, -1, CAST(f.[DATE] AS DATE))
        END AS New_Date_Time,
 
        CASE
            WHEN CAST(f.[DATE] AS TIME) > '07:15:00'
                 AND CAST(f.[DATE] AS TIME) <= '15:45:00' THEN 'B'
            WHEN CAST(f.[DATE] AS TIME) > '15:45:00' THEN 'C'
            ELSE 'A'
        END AS ShiftPlant
 
    FROM FilteredData f
    INNER JOIN CountPerEngine c
        ON f.ENGINE_NUMBER = c.ENGINE_NUMBER
 
    ORDER BY f.[DATE];
END
GO
