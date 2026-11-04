-- LPG Gas Leak alerts. Written by GasLeakAlertMonitor (open row when a lot enters the Warning
-- (20-40%) or Danger (>40%) band, close row with the same AlertId when the band changes or clears),
-- read by the Gas Leak dashboard (open alerts, snooze, alert history). Create in the
-- GasLeak:Database database (ControlTowerVLM) on 10.130.1.73. Created 2026-10-26; the app's login
-- (factreread) needs SELECT, INSERT and UPDATE on it.
--
-- id has no IDENTITY: the app assigns MAX(id)+1 on insert (same as the FH_ tables); the primary key
-- makes a second running copy of the app fail instead of writing a duplicate id.

USE [ControlTowerVLM];
GO

CREATE TABLE [dbo].[GasLeak_Alerts] (
    [id]          BIGINT        NOT NULL CONSTRAINT [PK_GasLeakAlerts] PRIMARY KEY,
    [AlertId]     BIGINT        NOT NULL,   -- yyyyMMddHHmmssfff; same value on an alert's open and close row
    [EventTime]   DATETIME2(3)  NOT NULL,   -- server-local time of the open / close
    [Type]        NVARCHAR(100) NOT NULL,   -- 'Gas Leak'
    [Description] NVARCHAR(500) NOT NULL,   -- e.g. 'Lot 1 LPG leak level reached Danger band (>40%)'
    [status]      NVARCHAR(10)  NOT NULL,   -- 'open' | 'close'
    [SnoozeTime]  DATETIME2(3)  NULL        -- set on the open row when the user snoozes the alert
);
GO

CREATE INDEX [IX_GasLeak_Alerts_AlertId] ON [dbo].[GasLeak_Alerts] ([AlertId], [EventTime]) INCLUDE ([status]);
CREATE INDEX [IX_GasLeak_Alerts_EventTime] ON [dbo].[GasLeak_Alerts] ([EventTime]) INCLUDE ([status], [AlertId]);
GO
