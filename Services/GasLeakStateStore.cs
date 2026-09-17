using ControlTower.Models;

namespace ControlTower.Services;

// Thread-safe holder for the latest LPG Gas Leak Yard snapshot, built from the
// "VallamGasLeakTopic" MQTT topic by GasLeakMqttBackgroundService and read by GasLeakController.
// Mirrors FireHydrantStateStore's shape/locking pattern.
//
// Tag ids are hardcoded here (matching FireHydrantStateStore's convention) rather than routed
// through a config-driven tag map - these are fixed, already-confirmed Kepware tag paths from
// the original GasSentry project's appsettings.json.
public class GasLeakStateStore
{
    private readonly object _lock = new();
    private GasLeakStatus _status = CreateDefault();

    // Tags whose quality is checked to compute TagQualityAlert - "did any tag we currently map
    // report q:false in the last batch?", recomputed fresh every message (not accumulated).
    private static readonly HashSet<string> MappedTagIds = new()
    {
        "GasLeak.Leak.LPG Lot yard1",
        "GasLeak.Leak.LPG Lot yard2",
        "PS_GasLeak.PaintShop2.GasDetector.StatusGas/GAS_DETECTOR_HEALTY_HWG_3",
        "PS_GasLeak.PaintShop2.GasDetector.StatusGas/GAS_DETECTOR_HEALTY_HWG_4",
        "PS_GasLeak.PaintShop2.GasDetector.StatusGas/GAS_DETECTOR_HEALTY_HEATUP_ZONE_OVEN",
        "PS_GasLeak.PaintShop2.GasDetector.StatusGas/GAS_DETECTOR_HEALTY_HOLDUP_ZONE_OVEN",
        "FireHydrant.Hydrant.SprinklerTank"
        // TODO: add the 4 valve-open-status tag ids here once known (see UpdateFromPayload).
    };

    public GasLeakStatus GetStatus()
    {
        lock (_lock)
        {
            return _status;
        }
    }

    public void SetConnected(bool connected)
    {
        lock (_lock)
        {
            _status.Connected = connected;
        }
    }

    public void UpdateFromPayload(MqttGasLeakPayload payload)
    {
        lock (_lock)
        {
            var s = _status;
            var anyMappedTagHadBadQuality = false;

            foreach (var tag in payload.Values)
            {
                if (MappedTagIds.Contains(tag.Id) && !tag.Q)
                    anyMappedTagHadBadQuality = true;

                switch (tag.Id)
                {
                    case "GasLeak.Leak.LPG Lot yard1":
                        if (GasLeakPayloadParser.TryParseDouble(tag.V, out var lot1)) ApplyZone(s.Lot1, lot1);
                        break;
                    case "GasLeak.Leak.LPG Lot yard2":
                        if (GasLeakPayloadParser.TryParseDouble(tag.V, out var lot2)) ApplyZone(s.Lot2, lot2);
                        break;

                    // FireHydrant.Hydrant.SprinklerTank reports a raw value 100x the actual bar
                    // reading (e.g. 747 -> 7.47 bar) - same convention as the Fire Hydrant gauges.
                    case "FireHydrant.Hydrant.SprinklerTank":
                        if (GasLeakPayloadParser.TryParseDouble(tag.V, out var pressure)) s.SprinklerPressure = Math.Round(pressure / 100.0, 2);
                        break;

                    case "PS_GasLeak.PaintShop2.GasDetector.StatusGas/GAS_DETECTOR_HEALTY_HWG_3":
                        SetHealthy(s.PaintShop2, "HWG - 3", tag.V);
                        break;
                    case "PS_GasLeak.PaintShop2.GasDetector.StatusGas/GAS_DETECTOR_HEALTY_HWG_4":
                        SetHealthy(s.PaintShop2, "HWG - 4", tag.V);
                        break;
                    case "PS_GasLeak.PaintShop2.GasDetector.StatusGas/GAS_DETECTOR_HEALTY_HEATUP_ZONE_OVEN":
                        SetHealthy(s.PaintShop2, "PTCED - 2 Heat up", tag.V);
                        break;
                    case "PS_GasLeak.PaintShop2.GasDetector.StatusGas/GAS_DETECTOR_HEALTY_HOLDUP_ZONE_OVEN":
                        SetHealthy(s.PaintShop2, "PTCED - 2 Hold up", tag.V);
                        break;

                    // TODO: valve-open-status tags for Lot1/Lot2/PaintShop1/PaintShop2 aren't
                    // known yet (see original GasSentry appsettings.json's REPLACE_WITH_* keys).
                    // Add cases here once Kepware's real tag ids for these are confirmed; until
                    // then each zone's ValveOpen stays at its CreateDefault() value (true).
                }
            }

            s.TagQualityAlert = anyMappedTagHadBadQuality;
            s.Connected = true;
            s.LastUpdated = payload.Timestamp;
        }
    }

    // Mirrors the source ThingWorx Thing's blinkShapes bands exactly: <=20 green, 20-40
    // yellow, >40 red. Alert (used for the "Danger"/"Normal" badge) is true only in the red band.
    private static void ApplyZone(GasLeakZoneDto zone, double value)
    {
        zone.Value = value;
        zone.Band = value <= 20 ? "green" : value <= 40 ? "yellow" : "red";
        zone.Alert = value > 40;
    }

    private static void SetHealthy(GasLeakPaintShopDto shop, string pointName, System.Text.Json.JsonElement v)
    {
        if (!GasLeakPayloadParser.TryParseBool(v, out var healthy)) return;
        var point = shop.Points.FirstOrDefault(p => p.Name == pointName);
        if (point != null) point.Status = healthy ? "green" : "red";
    }

    // Mirrors GasLeakState.Snapshot()'s point layout from the original GasSentry project: of
    // Paint Shop 2's 7 status rows, only these 4 are live-wired; VPC-2 and Liquid Line-3/4 are
    // statically green (no tag). All of Paint Shop 1's 7 rows are unbound (always grey).
    private static GasLeakStatus CreateDefault() => new()
    {
        Lot1 = new GasLeakZoneDto { Id = "lot1", Label = "Lot 1", ValveOpen = true },
        Lot2 = new GasLeakZoneDto { Id = "lot2", Label = "Lot 2", ValveOpen = true },
        PaintShop1 = new GasLeakPaintShopDto
        {
            ValveOpen = true,
            Points =
            [
                new() { Name = "VPC - 1", Status = "grey" },
                new() { Name = "HWG - 1", Status = "grey" },
                new() { Name = "HWG - 2", Status = "grey" },
                new() { Name = "PTCED - 1 Heat up", Status = "grey" },
                new() { Name = "PTCED - 1 Hold up", Status = "grey" },
                new() { Name = "Liquid Line - 1", Status = "grey" },
                new() { Name = "Liquid Line - 2", Status = "grey" }
            ]
        },
        PaintShop2 = new GasLeakPaintShopDto
        {
            ValveOpen = true,
            Points =
            [
                new() { Name = "VPC - 2", Status = "green" },
                new() { Name = "HWG - 3", Status = "green" },
                new() { Name = "HWG - 4", Status = "green" },
                new() { Name = "PTCED - 2 Heat up", Status = "green" },
                new() { Name = "PTCED - 2 Hold up", Status = "green" },
                new() { Name = "Liquid Line - 3", Status = "green" },
                new() { Name = "Liquid Line - 4", Status = "green" }
            ]
        }
    };
}
