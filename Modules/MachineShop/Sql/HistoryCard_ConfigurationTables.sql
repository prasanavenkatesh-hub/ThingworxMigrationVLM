-- Machine Shop > History Card layouts: copies of the ThingWorx data tables RE_MSConfigurationDT
-- (data shape RE_MSConfigurationDS) and SPCMSconfiguration_DT (SPCMSConfigurationDS), same names and
-- fields (the ThingWorx system fields source / tags / sourceType / location / key / timestamp are left
-- out). Primary keys = the ThingWorx primary key fields (CardName, StationName, ID).
-- Read by MachineShopHistoryCardService; the app never writes them - edit the rows here to change a card.
-- Create in ControlTowerVLM on 10.130.1.73. Use N'...' strings: codes contain 'Ø' (e.g. N'PGØ6.8').
--
-- RE_MSConfiguration    - one row per line of a card (Station data table), shown in ID order per card.
--   CardName        = internal card name (e.g. 'CoverLH'); CardDisplayName = the "Station Name" dropdown
--                     text (e.g. 'Cover LH')
--   SerialNo        = empty for a station heading row
--   DescVal         = line text; TagValue = the MachineShopData column whose value is shown
--   StationNumber   = MachineShopData.Station_Number of the line
-- SPCMSconfiguration    - one row per line of the Cover LH / RH Online SPC table, shown in ID order per card.
--   TAGVALUE_CURRENT_INSPECTION_REPORT / _BEFORE_ / _AFTER_ = JobReading.PartParaCode of the current /
--                     previous / next barcode reading; empty or 'OPERATOR' = an SPC station heading

USE [ControlTowerVLM];
GO

CREATE TABLE [dbo].[RE_MSConfiguration] (
    [CardDisplayName] NVARCHAR(100) NOT NULL,
    [CardName]        NVARCHAR(100) NOT NULL,
    [DescVal]         NVARCHAR(400) NULL,
    [ID]              INT           NOT NULL,
    [SerialNo]        NVARCHAR(20)  NULL,
    [StationName]     NVARCHAR(200) NOT NULL,
    [StationNumber]   INT           NULL,
    [TagValue]        NVARCHAR(100) NULL,
    CONSTRAINT [PK_RE_MSConfiguration] PRIMARY KEY ([CardName], [StationName], [ID])
);
GO

CREATE TABLE [dbo].[SPCMSconfiguration] (
    [CardDisplayName]                    NVARCHAR(100) NOT NULL,
    [CardName]                           NVARCHAR(100) NOT NULL,
    [CheckingMethod]                     NVARCHAR(100) NULL,
    [DescVal]                            NVARCHAR(400) NULL,
    [GaugeNumber]                        NVARCHAR(100) NULL,
    [ID]                                 INT           NOT NULL,
    [Remarks]                            NVARCHAR(400) NULL,
    [SerialNo]                           NVARCHAR(20)  NULL,
    [Specification]                      NVARCHAR(200) NULL,
    [StationName]                        NVARCHAR(100) NOT NULL,
    [StationNumber]                      INT           NULL,
    [TAGVALUE_AFTER_INSPECTION_REPORT]   NVARCHAR(50)  NULL,
    [TAGVALUE_BEFORE_INSPECTION_REPORT]  NVARCHAR(50)  NULL,
    [TAGVALUE_CURRENT_INSPECTION_REPORT] NVARCHAR(50)  NULL,
    CONSTRAINT [PK_SPCMSconfiguration] PRIMARY KEY ([CardName], [StationName], [ID])
);
GO
