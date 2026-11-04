SELECT RTRIM(Station_Number) AS Station, ISNULL(RTRIM(Cell_Number),'NULL') AS Cell, COUNT(*) AS n, SUM(CASE WHEN OverallStation_Status='OK' THEN 1 ELSE 0 END) AS ok, SUM(CASE WHEN OverallStation_Status='NOK' THEN 1 ELSE 0 END) AS nok
FROM RE_VL_MachineShop.dbo.MachineShopData WHERE DateTime >= '2026-10-26 00:15' AND DateTime < '2026-10-27 00:15' AND Station_Number IN ('8','26','31','38','16','22')
GROUP BY RTRIM(Station_Number), ISNULL(RTRIM(Cell_Number),'NULL') ORDER BY 1,2
