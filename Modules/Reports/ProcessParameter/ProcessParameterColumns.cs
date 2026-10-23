namespace ControlTower.Services;

// The Power BI "Dynamic Columns - Mainline" / "Dynamic Columns - QHold" field parameters of
// Process_Product_Parameter_Report_1.pbix: (display name, source column, order, station). They are
// also the whitelist of columns the report may SELECT - only these names are ever put into SQL.
// Note the source column "PTL_1_count " really has a trailing space in STN_data.
public record ProcessParameterColumn(string Name, string Column, int Order, string Station);

public static class ProcessParameterColumns
{
    public static readonly IReadOnlyList<ProcessParameterColumn> Mainline = Build(new (string, string, int, string)[]
    {
        ("Barcode_2", "Barcode_2", 0, "ML-01"), ("Child_Part_Status", "Child_Part_Status", 1, "ML-01"), ("FLAG", "FLAG", 2, "ML-01"),
        ("PTL_1_count", "PTL_1_count ", 3, "ML-01"), ("PTL_1_status", "PTL_1_status", 4, "ML-01"), ("PTL_2_count", "PTL_2_count", 5, "ML-01"),
        ("PTL_2_status", "PTL_2_status", 6, "ML-01"), ("Stn_Status", "Stn_Status", 7, "ML-01"),

        ("Stn_Status", "Stn_Status", 7, "ML-02"), ("Child_Part_Status", "Child_Part_Status", 1, "ML-02"), ("FLAG", "FLAG", 2, "ML-02"),
        ("Barcode_1", "Barcode_1", 0, "ML-02"), ("PTL_1_count", "PTL_1_count ", 3, "ML-02"), ("PTL_1_status", "PTL_1_status", 4, "ML-02"),
        ("PTL_7_status", "PTL_7_status", 4, "ML-02"), ("PTL_5_status", "PTL_5_status", 4, "ML-02"),

        ("Stn_Status", "Stn_Status", 7, "ML-03"), ("Child_Part_Status", "Child_Part_Status", 1, "ML-03"), ("FLAG", "FLAG", 2, "ML-03"),
        ("Barcode_1", "Barcode_1", 0, "ML-03"), ("PTL_1_count", "PTL_1_count ", 3, "ML-03"), ("PTL_1_status", "PTL_1_status", 4, "ML-03"),
        ("PTL_4_status", "PTL_4_status", 4, "ML-03"), ("DIPV3", "DIPV3", 4, "ML-03"), ("PTL_7_count", "PTL_7_count", 3, "ML-03"),
        ("PTL_7_status", "PTL_7_status", 4, "ML-03"), ("PTL_2_status", "PTL_2_status", 4, "ML-03"),

        ("Stn_Status", "Stn_Status", 7, "ML-04"), ("DIPV3", "DIPV3", 4, "ML-04"), ("PTL_2_count", "PTL_2_count", 5, "ML-04"),
        ("PTL_2_status", "PTL_2_status", 6, "ML-04"),

        ("Stn_Status", "Stn_Status", 7, "ML-05"),
        // ML-06 is commented out in Power BI (it is the QHold page) and is excluded from Mainline.

        ("Stn_Status", "Stn_Status", 7, "ML-07"), ("Child_Part_Status", "Child_Part_Status", 1, "ML-07"), ("Barcode_2", "Barcode_2", 0, "ML-07"),
        ("FLAG", "FLAG", 2, "ML-07"),

        ("Stn_Status", "Stn_Status", 1, "ML-08"),
        ("N2_torque1", "N2_torque1", 1, "ML-08"), ("N2_range1", "N2_range1", 1, "ML-08"), ("N2_status1", "N2_status1", 1, "ML-08"),
        ("N2_torque2", "N2_torque2", 1, "ML-08"), ("N2_range2", "N2_range2", 1, "ML-08"), ("N2_status2", "N2_status2", 1, "ML-08"),
        ("N2_torque3", "N2_torque3", 1, "ML-08"), ("N2_range3", "N2_range3", 1, "ML-08"), ("N2_status3", "N2_status3", 1, "ML-08"),
        ("N2_torque4", "N2_torque4", 1, "ML-08"), ("N2_range4", "N2_range4", 1, "ML-08"), ("N2_status4", "N2_status4", 1, "ML-08"),

        ("Stn_Status", "Stn_Status", 1, "ML-09"), ("PTL_4_status", "PTL_4_status", 1, "ML-09"), ("PTL_4_count", "PTL_4_count", 1, "ML-09"),
        ("PTL_1_status", "PTL_1_status", 1, "ML-09"), ("PTL_1_count", "PTL_1_count ", 1, "ML-09"),

        // ML-10: N5 / N4 nutrunner 1-16, plus barcode and PTL 2 (Power BI lists N4 twice; once here)
        ("Stn_Status", "Stn_Status", 1, "ML-10"), ("N5_status", "N5_status", 1, "ML-10"), ("N4_status", "N4_status", 1, "ML-10"),
        ("Barcode_1", "Barcode_1", 1, "ML-10"), ("PTL_2_status", "PTL_2_status", 1, "ML-10"), ("PTL_2_count", "PTL_2_count", 1, "ML-10"),

        ("Stn_Status", "Stn_Status", 7, "ML-11"), ("N2_status1", "N2_status1", 1, "ML-11"), ("N2_torque1", "N2_torque1", 1, "ML-11"),
        ("N2_range1", "N2_range1", 1, "ML-11"), ("N2_torque2", "N2_torque2", 1, "ML-11"), ("N2_range2", "N2_range2", 1, "ML-11"),
        ("N2_status2", "N2_status2", 1, "ML-11"), ("PTL_1_status", "PTL_1_status", 1, "ML-11"), ("PTL_1_count", "PTL_1_count ", 5, "ML-11"),

        ("Stn_Status", "Stn_Status", 7, "ML-12"), ("N2_status1", "N2_status1", 1, "ML-12"), ("N2_torque1", "N2_torque1", 1, "ML-12"),
        ("N2_range1", "N2_range1", 1, "ML-12"), ("PTL_2_status", "PTL_2_status", 1, "ML-12"), ("PTL_1_status", "PTL_1_status", 1, "ML-12"),
        ("PTL_1_count", "PTL_1_count ", 1, "ML-12"),

        ("Stn_Status", "Stn_Status", 7, "ML-13"), ("N2_status1", "N2_status1", 1, "ML-13"), ("N2_torque1", "N2_torque1", 1, "ML-13"),
        ("N2_range1", "N2_range1", 1, "ML-13"),
        ("IPV_1", "IPV1_1", 1, "ML-13"), ("IPV_2", "IPV1_2", 1, "ML-13"), ("IPV_3", "IPV1_3", 1, "ML-13"),
        ("IPV_4", "IPV1_4", 1, "ML-13"), ("IPV_5", "IPV1_5", 1, "ML-13"), ("IPV_6", "IPV1_6", 1, "ML-13"),
        ("PTL_8_status", "PTL_8_status", 1, "ML-13"),

        ("Stn_Status", "Stn_Status", 7, "ML-14"), ("Child_Part_Status", "Child_Part_Status", 1, "ML-14"), ("FLAG", "FLAG", 2, "ML-14"),
        ("Barcode_1", "Barcode_1", 0, "ML-14"), ("Barcode_2", "Barcode_2", 0, "ML-14"), ("PTL_1_status", "PTL_1_status", 1, "ML-14"),

        ("Stn_Status", "Stn_Status", 7, "ML-15"), ("PTL_2_status", "PTL_2_status", 1, "ML-15"), ("PTL_2_count", "PTL_2_count", 1, "ML-15"),
        ("PTL_5_status", "PTL_5_status", 1, "ML-15"), ("PTL_5_count", "PTL_5_count", 5, "ML-15"), ("PTL_4_status", "PTL_4_status", 1, "ML-15"),
        ("N2_status1", "N2_status1", 1, "ML-15"), ("N2_torque1", "N2_torque1", 1, "ML-15"), ("N2_range1", "N2_range1", 1, "ML-15"),

        ("Stn_Status", "Stn_Status", 7, "ML-16"), ("PTL_4_status", "PTL_4_status", 1, "ML-16"), ("PTL_1_status", "PTL_1_status", 1, "ML-16"),
        ("PTL_1_count", "PTL_1_count ", 1, "ML-16"),

        ("Stn_Status", "Stn_Status", 7, "ML-17"), ("Child_Part_Status", "Child_Part_Status", 1, "ML-17"), ("FLAG", "FLAG", 2, "ML-17"),
        ("Barcode_1", "Barcode_1", 0, "ML-17"), ("N5_status", "N5_status", 1, "ML-17"),
        ("N5_torque1", "N5_torque1", 1, "ML-17"), ("N5_range1", "N5_range1", 1, "ML-17"), ("N5_torque2", "N5_torque2", 1, "ML-17"),
        ("N5_range2", "N5_range2", 1, "ML-17"), ("N5_torque3", "N5_torque3", 1, "ML-17"), ("N5_range3", "N5_range3", 1, "ML-17"),
        ("N5_torque4", "N5_torque4", 1, "ML-17"), ("N5_range4", "N5_range4", 1, "ML-17"),
        ("N2_torque1", "N2_torque1", 1, "ML-17"), ("N2_range2", "N2_range2", 1, "ML-17"), ("N2_status1", "N2_status1", 1, "ML-17"),
        ("N2_status2", "N2_status2", 1, "ML-17"), ("N4_status", "N4_status", 1, "ML-17"),
        ("N4_torque1", "N4_torque1", 1, "ML-17"), ("N4_range1", "N4_range1", 1, "ML-17"), ("N4_torque2", "N4_torque2", 1, "ML-17"),
        ("N4_range2", "N4_range2", 1, "ML-17"), ("N4_torque3", "N4_torque3", 1, "ML-17"), ("N4_range3", "N4_range3", 1, "ML-17"),
        ("N4_torque4", "N4_torque4", 1, "ML-17"), ("N4_range4", "N4_range4", 1, "ML-17"),

        ("Stn_Status", "Stn_Status", 7, "ML-18"), ("Child_Part_Status", "Child_Part_Status", 1, "ML-18"), ("PTL_1_status", "PTL_1_status", 1, "ML-18"),
        ("PTL_1_count", "PTL_1_count ", 1, "ML-18"), ("DIPV3", "DIPV3", 4, "ML-18"), ("PTL_3_count", "PTL_3_count", 5, "ML-18"),
        ("PTL_3_status", "PTL_3_status", 6, "ML-18"), ("PTL_4_status", "PTL_4_status", 6, "ML-18"), ("Barcode_1", "Barcode_1", 0, "ML-18"),
        ("FLAG", "FLAG", 2, "ML-18"),

        ("Stn_Status", "Stn_Status", 7, "ML-19"),

        ("Stn_Status", "Stn_Status", 7, "ML-20"), ("DIPV3", "DIPV3", 4, "ML-20"), ("N5_Status", "N5_status", 1, "ML-20"),
        ("N5_torque1", "N5_torque1", 1, "ML-20"), ("N5_range1", "N5_range1", 1, "ML-20"), ("N5_torque2", "N5_torque2", 1, "ML-20"),
        ("N5_range2", "N5_range2", 1, "ML-20"), ("N5_torque3", "N5_torque3", 1, "ML-20"), ("N5_range3", "N5_range3", 1, "ML-20"),
        ("N5_torque4", "N5_torque4", 1, "ML-20"), ("N5_range4", "N5_range4", 1, "ML-20"), ("N4_Status", "N4_status", 1, "ML-20"),
        ("N4_torque1", "N4_torque1", 1, "ML-20"), ("N4_range1", "N4_range1", 1, "ML-20"), ("N4_torque2", "N4_torque2", 1, "ML-20"),
        ("N4_range2", "N4_range2", 1, "ML-20"), ("N4_torque3", "N4_torque3", 1, "ML-20"), ("N4_range3", "N4_range3", 1, "ML-20"),
        ("N4_torque4", "N4_torque4", 1, "ML-20"), ("N4_range4", "N4_range4", 1, "ML-20")
    }, ml10Nutrunners: true);

    // "Dynamic Columns - QHold": Station_Status (shown as Stn_Status) + Checkpoints_1..16, tagged ML-06.
    public static readonly IReadOnlyList<ProcessParameterColumn> QHold =
        new[] { new ProcessParameterColumn("Stn_Status", "Station_Status", 7, "ML-06") }
            .Concat(Enumerable.Range(1, 16).Select(i => new ProcessParameterColumn($"Checkpoints_{i}", $"Checkpoints_{i}", 10 + i, "ML-06")))
            .ToList();

    private static List<ProcessParameterColumn> Build((string Name, string Column, int Order, string Station)[] items, bool ml10Nutrunners)
    {
        var list = items.Select(i => new ProcessParameterColumn(i.Name, i.Column, i.Order, i.Station)).ToList();
        if (ml10Nutrunners)
        {
            // ML-10 in Power BI: N5_torque/range 1-16 and N4_torque/range 1-16 (N5_status / N4_status above).
            foreach (var n in new[] { "N5", "N4" })
            {
                for (var i = 1; i <= 16; i++)
                {
                    list.Add(new ProcessParameterColumn($"{n}_torque{i}", $"{n}_torque{i}", 1, "ML-10"));
                    list.Add(new ProcessParameterColumn($"{n}_range{i}", $"{n}_range{i}", 1, "ML-10"));
                }
            }
        }
        return list;
    }
}
