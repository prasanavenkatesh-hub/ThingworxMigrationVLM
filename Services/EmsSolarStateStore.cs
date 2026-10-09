using ControlTower.Models;

namespace ControlTower.Services;

// Thread-safe holder for the latest live solar reading from vlmsolarlivetag (2 feeder meters).
// Keeps last-good raw values per tag rather than a computed snapshot, so a message missing one
// tag doesn't zero out the others (same pattern as FireHydrantStateStore).
public class EmsSolarStateStore
{
    private readonly object _lock = new();
    private double _activePower1, _activePower2, _realEnergy1, _realEnergy2;
    private bool _connected;
    private long _lastUpdated;

    public void SetConnected(bool connected) { lock (_lock) _connected = connected; }

    public void UpdateFromPayload(MqttEmsPayload payload)
    {
        lock (_lock)
        {
            foreach (var v in payload.Values)
            {
                if (!v.Q) continue;
                switch (v.Id)
                {
                    case "VLM_EMS.Meter118_SolarFd1.Active power": _activePower1 = v.V; break;
                    case "VLM_EMS.Meter109_SolarFd2.Active power": _activePower2 = v.V; break;
                    case "VLM_EMS.Meter118_SolarFd1.FWD Real Energy": _realEnergy1 = v.V; break;
                    case "VLM_EMS.Meter109_SolarFd2.FWD Real Energy": _realEnergy2 = v.V; break;
                }
            }
            _connected = true;
            _lastUpdated = payload.Timestamp;
        }
    }

    public double LiveKw { get { lock (_lock) return Math.Round((_activePower1 + _activePower2) / 1000.0, 2); } }
    public double RealEnergySum { get { lock (_lock) return _realEnergy1 + _realEnergy2; } }
    public bool Connected { get { lock (_lock) return _connected; } }
    public long LastUpdated { get { lock (_lock) return _lastUpdated; } }
}
