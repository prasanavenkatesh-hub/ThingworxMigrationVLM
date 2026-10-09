using ControlTower.Models;

namespace ControlTower.Services;

// Thread-safe holder for the latest EB Real Time Monitoring snapshot, built from the
// "vlmEnergyMonitoring" MQTT topic by EbRtmMqttBackgroundService and read by EbRtmController.
// Mirrors FireHydrantStateStore/GasLeakStateStore's shape/locking pattern.
public class EbRtmStateStore
{
    // Kepware tag ids for the single incomer meter this dashboard covers.
    public const string TagAvgVoltage = "VLM_EMS.Meter4_SID7.Line to Line avg Voltage";
    public const string TagAvgCurrent = "VLM_EMS.Meter4_SID7.Current Avg";
    public const string TagFrequency = "VLM_EMS.Meter4_SID7.Frequency";
    public const string TagActivePower = "VLM_EMS.Meter4_SID7.Active power";
    public const string TagPowerFactor = "VLM_EMS.Meter4_SID7.Avg PF";
    public const string TagMaxDemand = "VLM_EMS.Meter4_SID7.Max_Demand";
    public const string TagPresentDemand = "VLM_EMS.Meter4_SID7.Present_Demand";
    public const string TagRealEnergy = "VLM_EMS.Meter4_SID7.FWD Real Energy";

    private readonly object _lock = new();
    private readonly EbRtmStatus _status;

    // Server clock time (UTC) the last MQTT payload was processed - used by the header MQTT
    // indicator to judge whether data is actually flowing, independent of Kepware's clock.
    private DateTime? _lastReceivedUtc;

    public DateTime? LastReceivedUtc
    {
        get { lock (_lock) { return _lastReceivedUtc; } }
    }

    public EbRtmStateStore(IConfiguration config)
    {
        _status = new EbRtmStatus
        {
            MaxDemandLimitKva = config.GetValue<double?>("EbRtm:MaxDemandLimitKva") ?? 9350
        };
    }

    public EbRtmStatus GetStatus()
    {
        lock (_lock)
        {
            // Shallow copy so PowerFailureCurrentDuration (which the monitor updates live, not
            // from an MQTT payload) can be layered on by the controller without a race on the
            // shared instance.
            return new EbRtmStatus
            {
                Connected = _status.Connected,
                LastUpdated = _status.LastUpdated,
                AvgVoltage = _status.AvgVoltage,
                AvgCurrent = _status.AvgCurrent,
                Frequency = _status.Frequency,
                ActivePower = _status.ActivePower,
                PowerFactorSigned = _status.PowerFactorSigned,
                MaxDemand = _status.MaxDemand,
                PresentDemand = _status.PresentDemand,
                RealEnergyIntoLoad = _status.RealEnergyIntoLoad,
                MaxDemandLimitKva = _status.MaxDemandLimitKva,
                PowerFailureActive = _status.PowerFailureActive,
                PowerFailureCurrentDurationSeconds = _status.PowerFailureCurrentDurationSeconds,
                PowerFailureCountToday = _status.PowerFailureCountToday
            };
        }
    }

    public void SetConnected(bool connected)
    {
        lock (_lock)
        {
            _status.Connected = connected;
        }
    }

    public void SetPowerFailureState(bool active, TimeSpan currentDuration, int countToday)
    {
        lock (_lock)
        {
            _status.PowerFailureActive = active;
            _status.PowerFailureCurrentDurationSeconds = currentDuration.TotalSeconds;
            _status.PowerFailureCountToday = countToday;
        }
    }

    public void UpdateFromPayload(MqttEbRtmPayload payload)
    {
        lock (_lock)
        {
            var s = _status;

            foreach (var tag in payload.Values)
            {
                if (!tag.Q) continue;
                if (!KepwareValueParser.TryParseDouble(tag.V, out var value)) continue;

                // Voltage/Active Power/Max Demand/Present Demand tags publish in base units
                // (V/W/VA) rather than the kV/kW/kVA the dashboard labels/gauges use - confirmed
                // against a live reading (e.g. 32148V observed for what should read ~32kV).
                // RealEnergyIntoLoad is deliberately left unscaled here - it's kept raw for all
                // calculations (logging, shift-delta math) and only divided by 1000 for display,
                // at the frontend.
                switch (tag.Id)
                {
                    case TagAvgVoltage: s.AvgVoltage = value / 1000.0; break;
                    case TagAvgCurrent: s.AvgCurrent = value; break;
                    case TagFrequency: s.Frequency = value; break;
                    case TagActivePower: s.ActivePower = value / 1000.0; break;
                    case TagPowerFactor: s.PowerFactorSigned = value; break;
                    case TagMaxDemand: s.MaxDemand = value / 1000.0; break;
                    case TagPresentDemand: s.PresentDemand = value / 1000.0; break;
                    case TagRealEnergy: s.RealEnergyIntoLoad = value; break;
                }
            }

            s.Connected = true;
            s.LastUpdated = payload.Timestamp;
            _lastReceivedUtc = DateTime.UtcNow;
        }
    }

    // Snapshot used by loggers/monitors that need the raw shared instance's current numeric
    // values without the per-request copy GetStatus() makes (they only read, under the lock).
    public EbRtmReadingDto GetCurrentReading()
    {
        lock (_lock)
        {
            return new EbRtmReadingDto
            {
                Timestamp = DateTime.Now,
                AvgVoltage = _status.AvgVoltage,
                AvgCurrent = _status.AvgCurrent,
                Frequency = _status.Frequency,
                ActivePower = _status.ActivePower,
                PowerFactorSigned = _status.PowerFactorSigned,
                MaxDemand = _status.MaxDemand,
                PresentDemand = _status.PresentDemand,
                RealEnergyIntoLoad = _status.RealEnergyIntoLoad
            };
        }
    }
}
