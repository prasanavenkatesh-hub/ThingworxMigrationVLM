-- dbo.Get_PDI_Report_EA02_Distinct  (FACTREPRDETL @ 10.130.1.73) - copied read-only from the database on 2026-11-12 for reference.
-- The app only EXECUTEs this proc; keep this file in sync with the database.
CREATE PROCEDURE [dbo].[Get_PDI_Report_EA02_Distinct]
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
            M.[DATE],
            M.SHIFT,
            M.ENGINE_NUMBER,
            M.MODEL,
            M.PDI_STATION,
            M.USER_ID,
            M.PDI_RESULT,
            M.LEAK_VALUE_PA,
            M.PDI_DEFECT,
            M.ROOT_CAUSE,
            M.REWORK_DETAILS,
            M.REWORK_TORQUE_STATUS,
            M.PART_REPLACE_DETAILS,
            M.REWORK_OIL_FILLING_VALUE,
            M.CATEGORY,
            M.SUPPLIER,
            M.REWORK_DATE,
            M.REWORK_USER_ID,
            M.VERIFIED_QF_USER_ID,
 
            CASE
                WHEN CAST(M.[DATE] AS TIME) > '00:15:00'
                THEN CAST(M.[DATE] AS DATE)
                ELSE DATEADD(DAY, -1, CAST(M.[DATE] AS DATE))
            END AS New_Date_Time,
 
            CASE
                WHEN CAST(M.[DATE] AS TIME) > '00:15:00'
                     AND CAST(M.[DATE] AS TIME) <= '07:15:00' THEN 'A'
                WHEN CAST(M.[DATE] AS TIME) > '07:15:00'
                     AND CAST(M.[DATE] AS TIME) <= '15:45:00' THEN 'B'
                ELSE 'C'
            END AS ShiftPlant
        FROM dbo.PDI_Report_Master_EA02 AS M
        WHERE
            (@FromDate IS NULL OR @ToDate IS NULL
             OR M.[DATE] BETWEEN @FromDate AND @ToDate)
 
            AND (@ShiftCode IS NULL OR @ShiftCode = ''
                 OR EXISTS
                 (
                     SELECT 1
                     FROM STRING_SPLIT(@ShiftCode, ',') ss
                     WHERE LTRIM(RTRIM(ss.value)) = M.SHIFT
                 ))
 
            AND (@EngineNumber IS NULL OR @EngineNumber = ''
                 OR EXISTS
                 (
                     SELECT 1
                     FROM STRING_SPLIT(@EngineNumber, ',') ss
                     WHERE LTRIM(RTRIM(ss.value)) = M.ENGINE_NUMBER
                 ))
 
            AND (@ModelCode IS NULL OR @ModelCode = ''
                 OR EXISTS
                 (
                     SELECT 1
                     FROM STRING_SPLIT(@ModelCode, ',') ss
                     WHERE LTRIM(RTRIM(ss.value)) = M.MODEL
                 ))
 
            AND (@PDIDefect IS NULL OR @PDIDefect = ''
                 OR EXISTS
                 (
                     SELECT 1
                     FROM STRING_SPLIT(@PDIDefect, ',') ss
                     WHERE LTRIM(RTRIM(ss.value)) = M.PDI_DEFECT
                 ))
 
            AND (@ReworkDetails IS NULL OR @ReworkDetails = ''
                 OR EXISTS
                 (
                     SELECT 1
                     FROM STRING_SPLIT(@ReworkDetails, ',') ss
                     WHERE LTRIM(RTRIM(ss.value)) = M.REWORK_DETAILS
                 ))
 
            AND (@PDIResult IS NULL OR @PDIResult = ''
                 OR EXISTS
                 (
                     SELECT 1
                     FROM STRING_SPLIT(@PDIResult, ',') ss
                     WHERE LTRIM(RTRIM(ss.value)) = M.PDI_RESULT
                 ))
 
            AND (@LeakValuePA IS NULL OR @LeakValuePA = ''
                 OR EXISTS
                 (
                     SELECT 1
                     FROM STRING_SPLIT(@LeakValuePA, ',') ss
                     WHERE LTRIM(RTRIM(ss.value)) = M.LEAK_VALUE_PA
                 ))
 
            AND M.ENGINE_NUMBER <> ''
    ),
 
    LatestEngineRecord AS
    (
        SELECT *,
               ROW_NUMBER() OVER
               (
                   PARTITION BY ENGINE_NUMBER
                   ORDER BY [DATE] DESC
               ) AS RN
        FROM FilteredData
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
        f.New_Date_Time,
        f.ShiftPlant
    FROM LatestEngineRecord f
    WHERE f.RN = 1
    ORDER BY f.[DATE];
END
GO
