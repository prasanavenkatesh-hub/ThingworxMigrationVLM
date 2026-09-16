using ControlTower.Models;

namespace ControlTower.Services;

// Thread-safe holder for the latest Fire Hydrant SCADA snapshot, built from the
// "vlmfirehydrantpumproom" and "vlmfirehydrantotherlocation" MQTT topics by
// FireHydrantMqttBackgroundService and read by FireHydrantController.
public class FireHydrantStateStore
{
    private readonly object _lock = new();
    private FireHydrantStatus _status = CreateDefault();

    public FireHydrantStatus GetStatus()
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

    public void UpdateFromPayload(MqttHydrantPayload payload)
    {
        lock (_lock)
        {
            var byId = new Dictionary<string, double>();
            foreach (var v in payload.Values)
            {
                if (v.Q) byId[v.Id] = v.V;
            }

            var s = _status;

            if (byId.TryGetValue("FireHydrant.Hydrant.Fire Tank1", out var t1)) s.Tanks[0].Level = t1;
            if (byId.TryGetValue("FireHydrant.Hydrant.Fire Tank2", out var t2)) s.Tanks[1].Level = t2;
            if (byId.TryGetValue("FireHydrant.Hydrant.DieselTank", out var dt)) s.Diesel.Level = dt;

            // Raw pressure transmitter values are scaled x100 (0-1000 -> 0-10 bar).
            if (byId.TryGetValue("FireHydrant.Hydrant.HydrantTank", out var hp)) s.Gauges[0].Value = Math.Round(hp / 100.0, 2);
            if (byId.TryGetValue("FireHydrant.Hydrant.SprinklerTank", out var sp)) s.Gauges[1].Value = Math.Round(sp / 100.0, 2);

            SetRunning(s, "diesel", byId, "FireHydrant.Hydrant.Diesel Tank On\\Off status");
            SetRunning(s, "hmain", byId, "FireHydrant.Hydrant.Hydrant Pump On\\Off status");
            SetRunning(s, "hjockey", byId, "FireHydrant.Hydrant.Jockey Pump1 On\\Off status");
            SetRunning(s, "sjockey", byId, "FireHydrant.Hydrant.Jockey Pump2 On\\Off status");
            SetRunning(s, "smain", byId, "FireHydrant.Hydrant.Sprinkler Pump On\\Off status");

            SetCount(s, "diesel", byId, "FireHydrant.Hydrant.DieselTankcount");
            SetCount(s, "hmain", byId, "FireHydrant.Hydrant.Hydrant Count");
            SetCount(s, "hjockey", byId, "FireHydrant.Hydrant.Jockey Pump 1");
            SetCount(s, "sjockey", byId, "FireHydrant.Hydrant.Jockey Pump 2");
            SetCount(s, "smain", byId, "FireHydrant.Hydrant.Sprinkler Count");

            // Fire Hydrant shopfloor pressure point mirrors the Hydrant Pressure gauge.
            SetPressurePoint(s, "fh", s.Gauges[0].Value);

            s.Connected = true;
            s.LastUpdated = payload.Timestamp;
        }
    }

    public void UpdateFromOtherLocationsPayload(MqttHydrantPayload payload)
    {
        lock (_lock)
        {
            var byId = new Dictionary<string, double>();
            foreach (var v in payload.Values)
            {
                if (v.Q) byId[v.Id] = v.V;
            }

            var s = _status;

            if (byId.TryGetValue("Firehydrant_otherLocations.EV.EV", out var ev)) SetPressurePoint(s, "ev", ev);
            if (byId.TryGetValue("Firehydrant_otherLocations.G120.G120", out var g120)) SetPressurePoint(s, "g120", g120);
            if (byId.TryGetValue("Firehydrant_otherLocations.VA_PT.MS", out var ms)) SetPressurePoint(s, "machine", ms);
            if (byId.TryGetValue("Firehydrant_otherLocations.Canteen.Canteen", out var canteen)) SetPressurePoint(s, "canteen", canteen);
            if (byId.TryGetValue("Firehydrant_otherLocations.VA_PT.EA", out var ea)) SetPressurePoint(s, "engine", ea);
            if (byId.TryGetValue("Firehydrant_otherLocations.PS.PS2", out var ps2)) SetPressurePoint(s, "paint2", ps2);
            if (byId.TryGetValue("Firehydrant_otherLocations.VA_PT.VA", out var va)) SetPressurePoint(s, "vehicle", va);
            if (byId.TryGetValue("Firehydrant_otherLocations.PS.PS1", out var ps1)) SetPressurePoint(s, "paint1", ps1);
            if (byId.TryGetValue("Firehydrant_otherLocations.DCD.WaterPressure", out var dcd)) SetPressurePoint(s, "warehouse", dcd);
        }
    }

    private static void SetRunning(FireHydrantStatus status, string pumpId, Dictionary<string, double> byId, string mqttId)
    {
        if (!byId.TryGetValue(mqttId, out var v)) return;
        var pump = status.Pumps.FirstOrDefault(p => p.Id == pumpId);
        if (pump != null) pump.Running = v != 0;
    }

    private static void SetCount(FireHydrantStatus status, string pumpId, Dictionary<string, double> byId, string mqttId)
    {
        if (!byId.TryGetValue(mqttId, out var v)) return;
        var pump = status.Pumps.FirstOrDefault(p => p.Id == pumpId);
        if (pump != null) pump.Count = (int)Math.Round(v);
    }

    private static void SetPressurePoint(FireHydrantStatus status, string key, double value)
    {
        var point = status.PressurePoints.FirstOrDefault(p => p.Key == key);
        if (point != null) point.Value = Math.Round(value, 2);
    }

    private static FireHydrantStatus CreateDefault() => new()
    {
        Tanks =
        [
            new() { Id = "wt1", Label = "Water Tank 1", Capacity = 232, Unit = "m³", Level = 0 },
            new() { Id = "wt2", Label = "Water Tank 2", Capacity = 232, Unit = "m³", Level = 0 }
        ],
        Diesel = new() { Id = "diesel", Label = "Diesel Tank", Capacity = 283, Unit = "L", Level = 0 },
        Pumps =
        [
            new() { Id = "diesel", Label = "Diesel Pump", Kind = "main", Line = "hydrant", Running = false, Count = 0 },
            new() { Id = "hmain", Label = "Hydrant Main Pump", Kind = "main", Line = "hydrant", Running = false, Count = 0 },
            new() { Id = "hjockey", Label = "Hydrant Jockey Pump", Kind = "jockey", Line = "hydrant", Running = false, Count = 0 },
            new() { Id = "sjockey", Label = "Sprinkler Jockey Pump", Kind = "jockey", Line = "sprinkler", Running = false, Count = 0 },
            new() { Id = "smain", Label = "Sprinkler Main Pump", Kind = "main", Line = "sprinkler", Running = false, Count = 0 }
        ],
        Gauges =
        [
            new() { Id = "hydrant", Label = "Hydrant Pressure (bar)", Value = 0, Max = 10 },
            new() { Id = "sprinkler", Label = "Sprinkler Pressure (bar)", Value = 0, Max = 10 }
        ],
        // "ro" and "mrs" have no MQTT source yet, so they stay null (shown as "--").
        PressurePoints =
        [
            new() { Key = "ev", Value = null },
            new() { Key = "g120", Value = null },
            new() { Key = "ro", Value = null },
            new() { Key = "fh", Value = null },
            new() { Key = "mrs", Value = null },
            new() { Key = "machine", Value = null },
            new() { Key = "canteen", Value = null },
            new() { Key = "engine", Value = null },
            new() { Key = "paint2", Value = null },
            new() { Key = "vehicle", Value = null },
            new() { Key = "paint1", Value = null },
            new() { Key = "warehouse", Value = null }
        ]
    };
}
