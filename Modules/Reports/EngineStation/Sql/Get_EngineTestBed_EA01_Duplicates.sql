-- dbo.Get_EngineTestBed_EA01_Duplicates  (FACTREPRDETL @ 10.130.1.73) - copied read-only from the database on 2026-11-12 for reference.
-- The app only EXECUTEs this proc; keep this file in sync with the database.
CREATE   PROCEDURE [dbo].[Get_EngineTestBed_EA01_Duplicates]
(
    @FromDate DATETIME = NULL,
    @ToDate DATETIME = NULL,
    @ShiftCode NVARCHAR(MAX) = NULL,
    @EngineNumber NVARCHAR(MAX) = NULL,
    @ModelCode NVARCHAR(MAX) = NULL,
    @DefectDetails NVARCHAR(MAX) = NULL,
    @ReworkDetails NVARCHAR(MAX) = NULL,
    @TestingResult NVARCHAR(MAX) = NULL,
    @BedNo NVARCHAR(MAX) = NULL,
    @NoOfTimes NVARCHAR(MAX) = NULL,
    @LhDbValue NVARCHAR(MAX) = NULL,
    @RhDbValue NVARCHAR(MAX) = NULL
)
AS
BEGIN
    SET NOCOUNT ON;
 
    ;WITH FilteredData AS
    (
        SELECT
            [DATE], SHIFT, ENGINE_NUMBER, MODEL,
            BED_NO, LH_DB_VALUE, RH_DB_VALUE, Number_Of_Times, USER_ID, TESTING_RESULT, NOT_OK_BED_NO,
            DEFECT_DETAILS, ROOT_CAUSE, REWORK_DETAILS,
            REWORK_TORQUE_STATUS, PART_REPLACE_DETAILS,
            REWORK_OIL_FILLING_VALUE, CATEGORY, SUPPLIER,
            REWORK_RELOAD_BED_NO, REWORK_COUNT, REWORK_USER_ID, VERIFIED_QF_USER_ID
        FROM dbo.Engine_TestBed_Master_EA01 AS M
        WHERE
            -- DATE Range filter (SARGABLE)
            (@FromDate IS NULL OR @ToDate IS NULL
                OR M.[DATE] BETWEEN @FromDate AND @ToDate)
 
            -- SHIFT
            AND (@ShiftCode IS NULL OR @ShiftCode = ''
                 OR EXISTS (SELECT 1
                            FROM STRING_SPLIT(@ShiftCode, ',') ss
                            WHERE M.SHIFT = LTRIM(RTRIM(ss.value))))
 
            -- Engine Number
            AND (@EngineNumber IS NULL OR @EngineNumber = ''
                 OR EXISTS (SELECT 1
                            FROM STRING_SPLIT(@EngineNumber, ',') ss
                            WHERE M.ENGINE_NUMBER = LTRIM(RTRIM(ss.value))))
 
            -- Model
            AND (@ModelCode IS NULL OR @ModelCode = ''
                 OR EXISTS (SELECT 1
                            FROM STRING_SPLIT(@ModelCode, ',') ss
                            WHERE M.MODEL = LTRIM(RTRIM(ss.value))))
 
            
            AND (@DefectDetails IS NULL OR @DefectDetails = ''
                 OR EXISTS (SELECT 1
                            FROM STRING_SPLIT(@DefectDetails, ',') ss
                            WHERE M.DEFECT_DETAILS = LTRIM(RTRIM(ss.value))))
 
            -- Rework Details
            AND (@ReworkDetails IS NULL OR @ReworkDetails = ''
                 OR EXISTS (SELECT 1
                            FROM STRING_SPLIT(@ReworkDetails, ',') ss
                            WHERE M.REWORK_DETAILS = LTRIM(RTRIM(ss.value))))
 
            
            AND (@TestingResult IS NULL OR @TestingResult = ''
                 OR EXISTS (SELECT 1
                            FROM STRING_SPLIT(@TestingResult, ',') ss
                            WHERE M.TESTING_RESULT = LTRIM(RTRIM(ss.value))))
 
            
            AND (@BedNo IS NULL OR @BedNo = ''
                 OR EXISTS (SELECT 1
                            FROM STRING_SPLIT(@BedNo, ',') ss
                            WHERE M.BED_NO = LTRIM(RTRIM(ss.value))))

            AND (@NoOfTimes IS NULL OR @NoOfTimes = ''
                 OR EXISTS (SELECT 1
                            FROM STRING_SPLIT(@NoOfTimes, ',') ss
                            WHERE M.Number_Of_Times = LTRIM(RTRIM(ss.value))))

           AND (@LhDbValue IS NULL OR @LhDbValue = ''
                 OR EXISTS (SELECT 1
                            FROM STRING_SPLIT(@LhDbValue, ',') ss
                            WHERE M.LH_DB_VALUE = LTRIM(RTRIM(ss.value))))

          AND (@RhDbValue IS NULL OR @RhDbValue = ''
                 OR EXISTS (SELECT 1
                            FROM STRING_SPLIT(@RhDbValue, ',') ss
                            WHERE M.RH_DB_VALUE = LTRIM(RTRIM(ss.value))))
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
                PARTITION BY f.ENGINE_NUMBER, f.TESTING_RESULT
                ORDER BY f.[DATE] DESC
            ) AS RowNum,
 
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
    )
 
    SELECT
        [DATE],
        SHIFT AS ShiftCode,
        ENGINE_NUMBER AS EngineNumber,
        MODEL AS ModelCode,
        BED_NO AS BedNo,
        LH_DB_VALUE AS LhDbValue,
        RH_DB_VALUE AS RhDbValue,
        Number_Of_Times AS NoOfTimes,
        USER_ID AS UserId,
        TESTING_RESULT AS TestingResult,
        NOT_OK_BED_NO AS NotOkBedNo,
        DEFECT_DETAILS AS DefectDetails,
        ROOT_CAUSE AS RootCause,
        REWORK_DETAILS AS ReworkDetails,
        REWORK_TORQUE_STATUS AS ReworkTorqueStatus,
        PART_REPLACE_DETAILS AS PartReplaceDetails,
        REWORK_OIL_FILLING_VALUE AS ReworkOilFillingValue,
        CATEGORY AS Category,
        SUPPLIER AS Supplier,
        REWORK_RELOAD_BED_NO AS ReworkReloadBedNo,
        REWORK_COUNT AS ReworkCount,
        REWORK_USER_ID AS ReworkUserId,
        VERIFIED_QF_USER_ID AS VerifiedQFUserId,
        New_Date_Time, ShiftPlant
    FROM RankedData
    WHERE RowNum = 1
    ORDER BY [DATE];
END
GO
