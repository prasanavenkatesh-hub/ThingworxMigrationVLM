-- Fire Hydrant tables in the FireHydrant:Database database (ControlTowerVLM) on 10.130.1.73.
-- Moved on 2026-10-26 from the old FireHydrant database (Alerts / PumpRunningCount / Duration ->
-- FH_Alerts / FH_PumpRunningCount / FH_Duration, rows copied; 4 duplicate FH_Duration rows - the same
-- pump run written by two running copies of the app - removed before adding the primary key).
-- The app's login (factreread) needs SELECT, INSERT and UPDATE on all three.
--
-- None of the id columns has IDENTITY: the app assigns MAX(id)+1 on insert; the primary keys make
-- a second running copy of the app fail instead of writing a duplicate id.

USE [ControlTowerVLM];
GO

-- Alerts (FireHydrantAlertRepository): append-only - "open" row when a red condition starts,
-- "close" row (same AlertId) when it recovers; SnoozeTime set on the open row.
CREATE TABLE [dbo].[FH_Alerts] (
    [id]          BIGINT        NOT NULL CONSTRAINT [PK_FH_Alerts] PRIMARY KEY,
    [DateTime]    TIMESTAMP     NULL,       -- SQL Server rowversion (from the old table), not a date - unused by the app
    [Type]        NVARCHAR(100) NULL,
    [Description] NVARCHAR(MAX) NULL,
    [status]      NVARCHAR(10)  NULL,       -- 'open' | 'close'
    [SnoozeTime]  DATETIME2     NULL,
    [AlertId]     BIGINT        NULL,       -- yyyyMMddHHmmssfff, same on the open and close row
    [EventTime]   DATETIME2     NULL
);
CREATE INDEX [IX_FH_Alerts_AlertId] ON [dbo].[FH_Alerts] ([AlertId], [EventTime]);
GO

-- Pump running count change log (FireHydrantPumpCountRepository): a row when a pump's count changes.
CREATE TABLE [dbo].[FH_PumpRunningCount] (
    [id]       BIGINT       NOT NULL CONSTRAINT [PK_FH_PumpRunningCount] PRIMARY KEY,
    [DateTime] DATETIME     NULL,
    [Pump]     NVARCHAR(30) NULL,
    [Count]    BIGINT       NULL
);
CREATE INDEX [IX_FH_PumpRunningCount_Pump] ON [dbo].[FH_PumpRunningCount] ([Pump], [DateTime]);
GO

-- Pump run sessions (FireHydrantPumpDurationRepository): inserted when a pump starts (EndTime /
-- Duration NULL), updated when it stops.
CREATE TABLE [dbo].[FH_Duration] (
    [id]        BIGINT       NOT NULL CONSTRAINT [PK_FH_Duration] PRIMARY KEY,
    [Date]      DATETIME     NULL,
    [Pump]      NVARCHAR(50) NULL,
    [StartTime] DATETIME     NULL,
    [EndTime]   DATETIME     NULL,
    [Duration]  TIME         NULL
);
CREATE INDEX [IX_FH_Duration_Pump_StartTime] ON [dbo].[FH_Duration] ([Pump], [StartTime]);
GO
