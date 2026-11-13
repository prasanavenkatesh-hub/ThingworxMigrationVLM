-- dbo.Get_EngineTestBed_EA02_Distinct  (FACTREPRDETL @ 10.130.1.73) - copied read-only from the database on 2026-11-12 for reference.
-- The app only EXECUTEs this proc; keep this file in sync with the database.
CREATE   PROCEDURE [dbo].[Get_EngineTestBed_EA02_Distinct]
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
            M.[DATE],
        M.SHIFT ,
        M.ENGINE_NUMBER,
        M.MODEL,
        M.BED_NO,
        M.LH_DB_VALUE,
        M.RH_DB_VALUE,
        M.Number_Of_Times,
        M.USER_ID,
        M.TESTING_RESULT,
        M.NOT_OK_BED_NO,
        M.DEFECT_DETAILS,
        M.ROOT_CAUSE,
        M.REWORK_DETAILS,
        M.REWORK_TORQUE_STATUS,
        M.PART_REPLACE_DETAILS,
        M.REWORK_OIL_FILLING_VALUE,
        M.CATEGORY,
        M.SUPPLIER,
        M.REWORK_RELOAD_BED_NO,
        M.REWORK_COUNT,
        M.REWORK_USER_ID,
        M.VERIFIED_QF_USER_ID,
 
            -- Precompute shift date logic
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
        FROM dbo.Engine_TestBed_Master_EA02 AS M
        WHERE
            -- DATE filter (SARGABLE)
            (@FromDate IS NULL OR @ToDate IS NULL
                OR M.[DATE] BETWEEN @FromDate AND @ToDate)
 
            -- SHIFT
            AND (@ShiftCode IS NULL OR @ShiftCode = ''
                 OR EXISTS (SELECT 1 FROM STRING_SPLIT(@ShiftCode, ',') ss
                            WHERE LTRIM(RTRIM(ss.value)) = M.SHIFT))
 
            -- ENGINE NUMBER
            AND (@EngineNumber IS NULL OR @EngineNumber = ''
                 OR EXISTS (SELECT 1 FROM STRING_SPLIT(@EngineNumber, ',') ss
                            WHERE LTRIM(RTRIM(ss.value)) = M.ENGINE_NUMBER))
 
            -- MODEL
            AND (@ModelCode IS NULL OR @ModelCode = ''
                 OR EXISTS (SELECT 1 FROM STRING_SPLIT(@ModelCode, ',') ss
                            WHERE LTRIM(RTRIM(ss.value)) = M.MODEL))
 
           
            AND (@DefectDetails IS NULL OR @DefectDetails = ''
                 OR EXISTS (SELECT 1 FROM STRING_SPLIT(@DefectDetails, ',') ss
                            WHERE LTRIM(RTRIM(ss.value)) = M.DEFECT_DETAILS))
 
            -- REWORK DETAILS
            AND (@ReworkDetails IS NULL OR @ReworkDetails = ''
                 OR EXISTS (SELECT 1 FROM STRING_SPLIT(@ReworkDetails, ',') ss
                            WHERE LTRIM(RTRIM(ss.value)) = M.REWORK_DETAILS))
 
            
            AND (@TestingResult IS NULL OR @TestingResult = ''
                 OR EXISTS (SELECT 1 FROM STRING_SPLIT(@TestingResult, ',') ss
                            WHERE LTRIM(RTRIM(ss.value)) = M.TESTING_RESULT))
 
            
            AND (@BedNo IS NULL OR @BedNo = ''
                 OR EXISTS (SELECT 1 FROM STRING_SPLIT(@BedNo, ',') ss
                            WHERE LTRIM(RTRIM(ss.value)) = M.BED_NO))

            AND (@NoOfTimes IS NULL OR @NoOfTimes = ''
                 OR EXISTS (SELECT 1 FROM STRING_SPLIT(@NoOfTimes, ',') ss
                            WHERE LTRIM(RTRIM(ss.value)) = M.Number_Of_Times))

            AND (@LhDbValue IS NULL OR @LhDbValue = ''
                 OR EXISTS (SELECT 1 FROM STRING_SPLIT(@LhDbValue, ',') ss
                            WHERE LTRIM(RTRIM(ss.value)) = M.LH_DB_VALUE))

            AND (@RhDbValue IS NULL OR @RhDbValue = ''
                 OR EXISTS (SELECT 1 FROM STRING_SPLIT(@RhDbValue, ',') ss
                            WHERE LTRIM(RTRIM(ss.value)) = M.RH_DB_VALUE))
 
            AND M.ENGINE_NUMBER <> ''
    ),
 
    Ranked AS
    (
        SELECT
            *,
            ROW_NUMBER() OVER (PARTITION BY ENGINE_NUMBER ORDER BY [DATE] ASC) AS FirstTestRank,
            ROW_NUMBER() OVER (PARTITION BY ENGINE_NUMBER ORDER BY [DATE] DESC) AS LatestTestRank
        FROM FilteredData
    ),
 
    FirstTimePass AS
    (
        SELECT ENGINE_NUMBER
        FROM Ranked
        WHERE FirstTestRank = 1
    )
 
    SELECT
        f.[DATE],
        f.SHIFT AS ShiftCode,
        f.ENGINE_NUMBER AS EngineNumber,
        f.MODEL AS ModelCode,
        f.BED_NO AS BedNo,
        f.LH_DB_VALUE AS LhDbValue,
        f.RH_DB_VALUE AS RhDbValue,
        f.Number_Of_Times AS NoOfTimes,
        f.USER_ID AS UserId,
        f.TESTING_RESULT AS TestingResult,
        f.NOT_OK_BED_NO AS NotOkBedNo,
        f.DEFECT_DETAILS AS DefectDetails,
        f.ROOT_CAUSE AS RootCause,
        f.REWORK_DETAILS AS ReworkDetails,
        f.REWORK_TORQUE_STATUS AS ReworkTorqueStatus,
        f.PART_REPLACE_DETAILS AS PartReplaceDetails,
        f.REWORK_OIL_FILLING_VALUE AS ReworkOilFillingValue,
        f.CATEGORY AS Category,
        f.SUPPLIER AS Supplier,
        f.REWORK_RELOAD_BED_NO AS ReworkReloadBedNo,
        f.REWORK_COUNT AS ReworkCount,
        f.REWORK_USER_ID AS ReworkUserId,
        f.VERIFIED_QF_USER_ID AS VerifiedQFUserId,
        f.New_Date_Time, f.ShiftPlant
    FROM Ranked f
    INNER JOIN FirstTimePass fp
        ON f.ENGINE_NUMBER = fp.ENGINE_NUMBER
    WHERE f.LatestTestRank = 1
    ORDER BY f.[DATE];
END
GO
