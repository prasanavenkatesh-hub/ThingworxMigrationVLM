SELECT RTRIM(Station_Number) st, COUNT(*) n7days, MAX([DateTime]) last, COUNT(DISTINCT Cell_Number) cells
FROM RE_VL_MachineShop.dbo.MachineShopData WITH (NOLOCK)
WHERE [DateTime] >= DATEADD(day,-7,GETDATE()) AND Station_Number IN ('25','29','30','11','12','13','15','19','20','21','41','6','7')
GROUP BY RTRIM(Station_Number) ORDER BY CAST(RTRIM(Station_Number) AS int)
