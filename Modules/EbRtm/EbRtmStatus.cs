using System.Text.Json;

namespace ControlTower.Models;

// Live snapshot for the EB (Electricity Board) 33KV Real Time Monitoring dashboard, built from
// the "vlmEnergyMonitoring" MQTT topic (Kepware batch JSON, same shape as Gas Leak/Fire
// Hydrant) for a single incomer meter (VLM_EMS.Meter4_SID7).
public class EbRtmStatus
{
    public bool Connected { get; set; }
    public long LastUpdated { get; set; }

    public double AvgVoltage { get; set; }         // kV
    public double AvgCurrent { get; set; }         // A
    public double Frequency { get; set; }          // Hz
    public double ActivePower { get; set; }        // kW
    public double PowerFactorSigned { get; set; }  // PF
    public double MaxDemand { get; set; }          // kVA
    public double PresentDemand { get; set; }      // kVA
    public double RealEnergyIntoLoad { get; set; } // cumulative kWh totalizer register

    public double MaxDemandLimitKva { get; set; }

    // AvgVoltage < 0 is treated as an ongoing power failure (per the tag sheet's rule).
    public bool PowerFailureActive { get; set; }
    public double PowerFailureCurrentDurationSeconds { get; set; } // 0 while not currently failing
    public int PowerFailureCountToday { get; set; }
}

// Raw payload shape published on the "vlmEnergyMonitoring" MQTT topic (Kepware IoT Gateway
// batch format). V is JsonElement rather than double - like the Gas Leak feed, a bad-quality
// tag can arrive as "v":"" (empty string) instead of a number.
public class MqttEbRtmValue
{
    public string Id { get; set; } = "";
    public JsonElement V { get; set; }
    public bool Q { get; set; }
    public long T { get; set; }
}

public class MqttEbRtmPayload
{
    public long Timestamp { get; set; }
    public List<MqttEbRtmValue> Values { get; set; } = new();
}
