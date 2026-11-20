-- Machine Shop > Part Parameter Config > Report Configuration
-- Copy of the ThingWorx data tables RE_GaugeReport_TemplateDT (Crank Case LH) and
-- RE_GaugeReportTemplate_CoverLH_DT (Cover LH), data shape RE_GaugeReport_TemplateDS: the Gauging Report
-- layout, one row per process code + parameter, with the "Show" flag the Report Configuration pop-up edits.
-- Only the SD = 'Row' entries are kept; the SD = 'Header' entries (Component No / Employee ID / column
-- titles) are report labels the app builds itself. Header2 was always empty and is left out.
-- The rows were loaded from the ThingWorx exports (Cover LH: data table CSV of 2025-06-13).

USE [ControlTowerVLM];
GO

IF OBJECT_ID(N'dbo.MS_GaugeReportTemplate', N'U') IS NULL
BEGIN
    CREATE TABLE dbo.MS_GaugeReportTemplate
    (
        Id                  int IDENTITY(1,1) NOT NULL CONSTRAINT PK_MS_GaugeReportTemplate PRIMARY KEY,
        Machine             nvarchar(50)  NOT NULL,   -- Part Parameter Config tab name: 'CRANK CASE LH', 'COVER LH'
        SerialNo            int           NOT NULL,   -- ThingWorx serialNo (key of the data table, "160.0" -> 160)
        SNo                 int           NULL,       -- ThingWorx SNo (number shown in the report)
        ProcessCode         nvarchar(100) NOT NULL,
        PartParaDescription nvarchar(500) NULL,       -- parameter text before the "(" ...
        Specification       nvarchar(200) NULL,       -- ... the "(...)" part ...
        GaugeNumber         nvarchar(100) NULL,       -- ... and the gauge after it
        ParaDescription     nvarchar(600) NULL,       -- ThingWorx Paradescription: the full original text
        CriticalParameter   bit           NULL,
        Show                bit           NOT NULL CONSTRAINT DF_MS_GaugeReportTemplate_Show DEFAULT (1),
        UpdatedAt           datetime      NULL,       -- set by the app when Show is saved
        CONSTRAINT UQ_MS_GaugeReportTemplate_Machine_SerialNo UNIQUE (Machine, SerialNo)
    );
END
GO
