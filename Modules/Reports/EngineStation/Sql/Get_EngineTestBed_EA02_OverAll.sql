-- dbo.Get_EngineTestBed_EA02_OverAll  (FACTREPRDETL @ 10.130.1.73) - copied read-only from the database on 2026-11-12 for reference.
-- The app only EXECUTEs this proc; keep this file in sync with the database.
CREATE   PROCEDURE [dbo].[Get_EngineTestBed_EA02_OverAll]
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
 
    SELECT
        M.[DATE],
        M.SHIFT AS ShiftCode,
        M.ENGINE_NUMBER AS EngineNumber,
        M.MODEL AS ModelCode,
        M.BED_NO AS BedNo,
        M.LH_DB_VALUE AS LhDbValue,
        M.RH_DB_VALUE AS RhDbValue,
        M.Number_Of_Times AS NoOfTimes,
        M.USER_ID AS UserId,
        M.TESTING_RESULT AS TestingResult,
        M.NOT_OK_BED_NO AS NotOkBedNo,
        M.DEFECT_DETAILS AS DefectDetails,
        M.ROOT_CAUSE AS RootCause,
        M.REWORK_DETAILS AS ReworkDetails,
        M.REWORK_TORQUE_STATUS AS ReworkTorqueStatus,
        M.PART_REPLACE_DETAILS AS PartReplaceDetails,
        M.REWORK_OIL_FILLING_VALUE AS ReworkOilFillingValue,
        M.CATEGORY AS Category,
        M.SUPPLIER AS Supplier,
        M.REWORK_RELOAD_BED_NO AS ReworkReloadBedNo,
        M.REWORK_USER_ID AS ReworkUserId,
        M.VERIFIED_QF_USER_ID AS VerifiedQFUserId
    FROM dbo.Engine_TestBed_Master_EA02 AS M
    WHERE
        -- DATE RANGE (SARGABLE)
        (@FromDate IS NULL OR @ToDate IS NULL
         OR M.[DATE] BETWEEN @FromDate AND @ToDate)
 
        -- SHIFT
        AND (
            @ShiftCode IS NULL OR @ShiftCode = ''
            OR EXISTS (
                SELECT 1
                FROM STRING_SPLIT(@ShiftCode, ',') ss
                WHERE LTRIM(RTRIM(ss.value)) = M.SHIFT
            )
        )
 
        -- ENGINE NUMBER
        AND (
            @EngineNumber IS NULL OR @EngineNumber = ''
            OR EXISTS (
                SELECT 1
                FROM STRING_SPLIT(@EngineNumber, ',') ss
                WHERE LTRIM(RTRIM(ss.value)) = M.ENGINE_NUMBER
            )
        )
 
        -- MODEL CODE
        AND (
            @ModelCode IS NULL OR @ModelCode = ''
            OR EXISTS (
                SELECT 1
                FROM STRING_SPLIT(@ModelCode, ',') ss
                WHERE LTRIM(RTRIM(ss.value)) = M.MODEL
            )
        )
 
        
        AND (
            @DefectDetails IS NULL OR @DefectDetails = ''
            OR EXISTS (
                SELECT 1
                FROM STRING_SPLIT(@DefectDetails, ',') ss
                WHERE LTRIM(RTRIM(ss.value)) = M.DEFECT_DETAILS
            )
        )
 
        -- REWORK DETAILS
        AND (
            @ReworkDetails IS NULL OR @ReworkDetails = ''
            OR EXISTS (
                SELECT 1
                FROM STRING_SPLIT(@ReworkDetails, ',') ss
                WHERE LTRIM(RTRIM(ss.value)) = M.REWORK_DETAILS
            )
        )
 
        
        AND (
            @TestingResult IS NULL OR @TestingResult = ''
            OR EXISTS (
                SELECT 1
                FROM STRING_SPLIT(@TestingResult, ',') ss
                WHERE LTRIM(RTRIM(ss.value)) = M.TESTING_RESULT
            )
        )
 
        
        AND (
            @BedNo IS NULL OR @BedNo = ''
            OR EXISTS (
                SELECT 1
                FROM STRING_SPLIT(@BedNo, ',') ss
                WHERE LTRIM(RTRIM(ss.value)) = M.BED_NO
            )
        )

        AND (
            @NoOfTimes IS NULL OR @NoOfTimes = ''
            OR EXISTS (
                SELECT 1
                FROM STRING_SPLIT(@NoOfTimes, ',') ss
                WHERE LTRIM(RTRIM(ss.value)) = M.Number_Of_Times
            )
        )
        AND (
            @LhDbValue IS NULL OR @LhDbValue = ''
            OR EXISTS (
                SELECT 1
                FROM STRING_SPLIT(@LhDbValue, ',') ss
                WHERE LTRIM(RTRIM(ss.value)) = M.LH_DB_VALUE
            )
        )
        AND (
            @RhDbValue IS NULL OR @RhDbValue = ''
            OR EXISTS (
                SELECT 1
                FROM STRING_SPLIT(@RhDbValue, ',') ss
                WHERE LTRIM(RTRIM(ss.value)) = M.RH_DB_VALUE
            )
        )
    ORDER BY M.[DATE];  -- Optimized because DATE is clustered in the index
END
GO
