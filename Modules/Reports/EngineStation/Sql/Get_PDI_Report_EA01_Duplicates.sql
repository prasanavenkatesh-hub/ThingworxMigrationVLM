-- dbo.Get_PDI_Report_EA01_Duplicates  (FACTREPRDETL @ 10.130.1.73) - copied read-only from the database on 2026-11-12 for reference.
-- The app only EXECUTEs this proc; keep this file in sync with the database.
CREATE   PROCEDURE [dbo].[Get_PDI_Report_EA01_Duplicates]
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
            M.[DATE], M.SHIFT, M.ENGINE_NUMBER, M.MODEL,
            M.PDI_STATION, M.USER_ID, M.PDI_RESULT, M.LEAK_VALUE_PA,
            M.PDI_DEFECT, M.REWORK_DETAILS,
            M.REWORK_TORQUE_STATUS, M.PART_REPLACE_DETAILS,
            M.REWORK_OIL_FILLING_VALUE, M.CATEGORY, M.SUPPLIER,
            M.REWORK_DATE, M.REWORK_USER_ID, M.VERIFIED_QF_USER_ID,
 
            -- SHIFT DATE CALCULATION
            CASE
                WHEN CAST(M.[DATE] AS TIME) > '00:15:00'
                    THEN CAST(M.[DATE] AS DATE)
                ELSE DATEADD(DAY, -1, CAST(M.[DATE] AS DATE))
            END AS New_Date_Time,
 
            -- SHIFT PLANT CALCULATION
            CASE
                WHEN CAST(M.[DATE] AS TIME) > '00:15:00'
                     AND CAST(M.[DATE] AS TIME) <= '07:15:00' THEN 'A'
                WHEN CAST(M.[DATE] AS TIME) > '07:15:00'
                     AND CAST(M.[DATE] AS TIME) <= '15:45:00' THEN 'B'
                ELSE 'C'
            END AS ShiftPlant
        FROM dbo.PDI_Report_Master_EA01 AS M
        WHERE
            -- DATE RANGE (SARGABLE)
            (@FromDate IS NULL OR @ToDate IS NULL
                OR M.[DATE] BETWEEN @FromDate AND @ToDate)
 
            -- SHIFT FILTER
            AND (
                @ShiftCode IS NULL OR @ShiftCode = ''
                OR EXISTS (
                    SELECT 1
                    FROM STRING_SPLIT(@ShiftCode, ',') ss
                    WHERE LTRIM(RTRIM(ss.value)) = M.SHIFT
                )
            )
 
            -- ENGINE NUMBER FILTER
            AND (
                @EngineNumber IS NULL OR @EngineNumber = ''
                OR EXISTS (
                    SELECT 1
                    FROM STRING_SPLIT(@EngineNumber, ',') ss
                    WHERE LTRIM(RTRIM(ss.value)) = M.ENGINE_NUMBER
                )
            )
 
            -- MODEL FILTER
            AND (
                @ModelCode IS NULL OR @ModelCode = ''
                OR EXISTS (
                    SELECT 1
                    FROM STRING_SPLIT(@ModelCode, ',') ss
                    WHERE LTRIM(RTRIM(ss.value)) = M.MODEL
                )
            )
 
            -- PDI DEFECT FILTER
            AND (
                @PDIDefect IS NULL OR @PDIDefect = ''
                OR EXISTS (
                    SELECT 1
                    FROM STRING_SPLIT(@PDIDefect, ',') ss
                    WHERE LTRIM(RTRIM(ss.value)) = M.PDI_DEFECT
                )
            )
 
            -- REWORK DETAILS FILTER
            AND (
                @ReworkDetails IS NULL OR @ReworkDetails = ''
                OR EXISTS (
                    SELECT 1
                    FROM STRING_SPLIT(@ReworkDetails, ',') ss
                    WHERE LTRIM(RTRIM(ss.value)) = M.REWORK_DETAILS
                )
            )
 
            -- PDI RESULT FILTER
            AND (
                @PDIResult IS NULL OR @PDIResult = ''
                OR EXISTS (
                    SELECT 1
                    FROM STRING_SPLIT(@PDIResult, ',') ss
                    WHERE LTRIM(RTRIM(ss.value)) = M.PDI_RESULT
                )
            )
 
            -- LEAK VALUE FILTER
            AND (
                @LeakValuePA IS NULL OR @LeakValuePA = ''
                OR EXISTS (
                    SELECT 1
                    FROM STRING_SPLIT(@LeakValuePA, ',') ss
                    WHERE LTRIM(RTRIM(ss.value)) = M.LEAK_VALUE_PA
                )
            )
            AND M.ENGINE_NUMBER <> ''
    ),
 
    CountPerEngine AS
    (
        SELECT ENGINE_NUMBER, COUNT(*) AS TestCount
        FROM FilteredData
        GROUP BY ENGINE_NUMBER
        HAVING COUNT(*) > 1
    ),
 
    RankedData AS
    (
        SELECT
            f.*,
            ROW_NUMBER() OVER (
                PARTITION BY f.ENGINE_NUMBER, f.PDI_RESULT
                ORDER BY f.[DATE] DESC
            ) AS RowNum
        FROM FilteredData f
        INNER JOIN CountPerEngine c
            ON f.ENGINE_NUMBER = c.ENGINE_NUMBER
    )
 
    SELECT
        [DATE],
        SHIFT AS ShiftCode,
        ENGINE_NUMBER AS EngineNumber,
        MODEL AS ModelCode,
        PDI_STATION AS PDIStation,
        USER_ID AS USERID,
        PDI_RESULT AS PDIResult,
        LEAK_VALUE_PA AS LeakValuePA,
        PDI_DEFECT AS PDIDefect,
        REWORK_DETAILS AS ReworkDetails,
        REWORK_TORQUE_STATUS AS ReworkTorqueStatus,
        PART_REPLACE_DETAILS AS PartReplaceDetails,
        REWORK_OIL_FILLING_VALUE AS ReworkOilFillingValue,
        CATEGORY AS Category,
        SUPPLIER AS Supplier,
        REWORK_DATE AS ReworkDate,
        REWORK_USER_ID AS ReworkUserId,
        VERIFIED_QF_USER_ID AS VerifiedQFUserId,
        New_Date_Time,
        ShiftPlant
    FROM RankedData
    WHERE RowNum = 1
    ORDER BY [DATE];
END
GO
