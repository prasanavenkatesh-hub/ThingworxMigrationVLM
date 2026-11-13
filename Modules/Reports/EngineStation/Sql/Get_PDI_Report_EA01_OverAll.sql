-- dbo.Get_PDI_Report_EA01_OverAll  (FACTREPRDETL @ 10.130.1.73) - copied read-only from the database on 2026-11-12 for reference.
-- The app only EXECUTEs this proc; keep this file in sync with the database.
CREATE   PROCEDURE [dbo].[Get_PDI_Report_EA01_OverAll]
(
    @FromDate DATETIME = NULL,
    @ToDate   DATETIME = NULL,
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
 
    SELECT
        M.[DATE],
        M.SHIFT        AS ShiftCode,
        M.ENGINE_NUMBER AS EngineNumber,
        M.MODEL        AS ModelCode,
        M.PDI_STATION  AS PDIStation,
        M.USER_ID      AS USERID,
        M.PDI_RESULT   AS PDIResult,
        M.LEAK_VALUE_PA AS LeakValuePA,
        M.PDI_DEFECT   AS PDIDefect,
        M.REWORK_DETAILS AS ReworkDetails,
        M.REWORK_TORQUE_STATUS AS ReworkTorqueStatus,
        M.PART_REPLACE_DETAILS AS PartReplaceDetails,
        M.REWORK_OIL_FILLING_VALUE AS ReworkOilFillingValue,
        M.CATEGORY     AS Category,
        M.SUPPLIER     AS Supplier,
        M.REWORK_DATE  AS ReworkDate,
        M.REWORK_USER_ID AS ReworkUserId,
        M.VERIFIED_QF_USER_ID AS VerifiedQFUserId
    FROM dbo.PDI_Report_Master_EA01 AS M
    WHERE
        -- DATE range (SARGABLE)
        (@FromDate IS NULL OR @ToDate IS NULL
         OR M.[DATE] BETWEEN @FromDate AND @ToDate)
 
        -- SHIFT filter
        AND (
            @ShiftCode IS NULL OR @ShiftCode = ''
            OR EXISTS (
                SELECT 1 FROM STRING_SPLIT(@ShiftCode, ',') ss
                WHERE LTRIM(RTRIM(ss.value)) = M.SHIFT
            )
        )
 
        -- ENGINE_NUMBER filter
        AND (
            @EngineNumber IS NULL OR @EngineNumber = ''
            OR EXISTS (
                SELECT 1 FROM STRING_SPLIT(@EngineNumber, ',') ss
                WHERE LTRIM(RTRIM(ss.value)) = M.ENGINE_NUMBER
            )
        )
 
        -- MODEL filter
        AND (
            @ModelCode IS NULL OR @ModelCode = ''
            OR EXISTS (
                SELECT 1 FROM STRING_SPLIT(@ModelCode, ',') ss
                WHERE LTRIM(RTRIM(ss.value)) = M.MODEL
            )
        )
 
        -- PDI_DEFECT filter
        AND (
            @PDIDefect IS NULL OR @PDIDefect = ''
            OR EXISTS (
                SELECT 1 FROM STRING_SPLIT(@PDIDefect, ',') ss
                WHERE LTRIM(RTRIM(ss.value)) = M.PDI_DEFECT
            )
        )
 
        -- REWORK_DETAILS filter
        AND (
            @ReworkDetails IS NULL OR @ReworkDetails = ''
            OR EXISTS (
                SELECT 1 FROM STRING_SPLIT(@ReworkDetails, ',') ss
                WHERE LTRIM(RTRIM(ss.value)) = M.REWORK_DETAILS
            )
        )
 
        -- PDI_RESULT filter
        AND (
            @PDIResult IS NULL OR @PDIResult = ''
            OR EXISTS (
                SELECT 1 FROM STRING_SPLIT(@PDIResult, ',') ss
                WHERE LTRIM(RTRIM(ss.value)) = M.PDI_RESULT
            )
        )
 
        -- LEAK_VALUE filter
        AND (
            @LeakValuePA IS NULL OR @LeakValuePA = ''
            OR EXISTS (
                SELECT 1 FROM STRING_SPLIT(@LeakValuePA, ',') ss
                WHERE LTRIM(RTRIM(ss.value)) = M.LEAK_VALUE_PA
            )
        )
    ORDER BY M.[DATE];
END;
GO
