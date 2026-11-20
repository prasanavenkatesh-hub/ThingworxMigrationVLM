-- Machine Shop > Part Parameter Config (port of ThingWorx RE_PartParameter_Configuration_MU). Created in ControlTowerVLM 2026-11-03.
-- MS_PartParamSettings: the page's two settings, global as in ThingWorx
--   NonCritical = RE_Crank_case_TH.noncritcal, SampleSize = RE_CrankCase_Helper_DB_TH.SampleSizefromConfiguration.
-- MS_SPCSampleSize: SPC control-chart constants per sample size (ThingWorx data table RE_SampleSizeInfo_DT); the
--   Sample Size dropdown lists these. The values are the standard SPC constants - provisional until checked
--   against the rows of RE_SampleSizeInfo_DT (not exported).
-- The part parameters themselves stay in the plant tables [<part database>].[dbo].[CriticalPartParameter] (read-only).
USE [ControlTowerVLM];
GO

CREATE TABLE [dbo].[MS_PartParamSettings] (
    [SettingKey]   varchar(50)  NOT NULL CONSTRAINT [PK_MS_PartParamSettings] PRIMARY KEY,
    [SettingValue] varchar(100) NOT NULL,
    [UpdatedDate]  datetime     NOT NULL CONSTRAINT [DF_MS_PartParamSettings_UpdatedDate] DEFAULT (GETDATE())
);
GO
INSERT INTO [dbo].[MS_PartParamSettings] ([SettingKey], [SettingValue]) VALUES ('NonCritical', 'true'), ('SampleSize', '7');
GO

CREATE TABLE [dbo].[MS_SPCSampleSize] (
    [SampleSize] int           NOT NULL CONSTRAINT [PK_MS_SPCSampleSize] PRIMARY KEY,
    [A2]         decimal(6, 3) NOT NULL,
    [A3]         decimal(6, 3) NOT NULL,
    [d2]         decimal(6, 3) NOT NULL,
    [D3]         decimal(6, 3) NOT NULL,
    [D4]         decimal(6, 3) NOT NULL,
    [B3]         decimal(6, 3) NOT NULL,
    [B4]         decimal(6, 3) NOT NULL
);
GO
INSERT INTO [dbo].[MS_SPCSampleSize] ([SampleSize], [A2], [A3], [d2], [D3], [D4], [B3], [B4]) VALUES
 (2,  1.880, 2.659, 1.128, 0.000, 3.267, 0.000, 3.267),
 (3,  1.023, 1.954, 1.693, 0.000, 2.574, 0.000, 2.568),
 (4,  0.729, 1.628, 2.059, 0.000, 2.282, 0.000, 2.266),
 (5,  0.577, 1.427, 2.326, 0.000, 2.114, 0.000, 2.089),
 (6,  0.483, 1.287, 2.534, 0.000, 2.004, 0.030, 1.970),
 (7,  0.419, 1.182, 2.704, 0.076, 1.924, 0.118, 1.882),
 (8,  0.373, 1.099, 2.847, 0.136, 1.864, 0.185, 1.815),
 (9,  0.337, 1.032, 2.970, 0.184, 1.816, 0.239, 1.761),
 (10, 0.308, 0.975, 3.078, 0.223, 1.777, 0.284, 1.716);
GO
