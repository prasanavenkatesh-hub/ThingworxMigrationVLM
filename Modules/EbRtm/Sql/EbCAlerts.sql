-- EB-RTM alerts (port of the ThingWorx stream RE_EMRTMAlerts_ST, written by addAlert in
-- RE_EnergyMeterRealTimeMonitoring_TS). Written by EbRtmAlertMonitor, read by the EB-RTM Reports
-- "Alerts" tab. Create in the EbRtm:Database database (ControlTowerVLM) on 10.130.1.73.
--
-- Columns mirror RE_EMRTMAlerts_DS (SourceID, MeterID, Device, MeterModel, Title, Description,
-- Type) plus:
--   AlertTime   - server-local time the alert was raised (DateTime.Now, like the other EB-RTM tables)
--   Category    - which rule raised it: MaxDemand | PowerFactor | PowerFailure | TagQuality
--   ActualValue - the reading that triggered it (null for power failure / tag quality)
-- Type keeps the ThingWorx values: 2 = Medium, 3 = High, 6 = High (sendAlertEmail priority mapping).

USE [ControlTowerVLM];
GO

CREATE TABLE [dbo].[EbCAlerts] (
    [Id]          BIGINT IDENTITY(1,1) NOT NULL CONSTRAINT [PK_EbCAlerts] PRIMARY KEY,
    [AlertTime]   DATETIME       NOT NULL,
    [SourceId]    INT            NOT NULL,
    [MeterId]     INT            NOT NULL,
    [Device]      NVARCHAR(100)  NULL,
    [MeterModel]  NVARCHAR(50)   NULL,
    [Category]    NVARCHAR(30)   NOT NULL,
    [Title]       NVARCHAR(200)  NOT NULL,
    [Description] NVARCHAR(500)  NULL,
    [Type]        INT            NOT NULL,
    [ActualValue] FLOAT          NULL
);
GO

CREATE INDEX [IX_EbCAlerts_SourceId_AlertTime] ON [dbo].[EbCAlerts] ([SourceId], [AlertTime]);
GO
