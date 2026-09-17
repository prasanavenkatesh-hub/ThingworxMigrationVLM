namespace ControlTower.Models;

public class FireHydrantTankDto
{
    public string Id { get; set; } = "";
    public string Label { get; set; } = "";
    public double Capacity { get; set; }
    public string Unit { get; set; } = "";
    public double Level { get; set; }
}

public class FireHydrantPumpDto
{
    public string Id { get; set; } = "";
    public string Label { get; set; } = "";
    public string Kind { get; set; } = "";
    public string Line { get; set; } = "";
    public bool Running { get; set; }
    public int Count { get; set; }
}

public class FireHydrantGaugeDto
{
    public string Id { get; set; } = "";
    public string Label { get; set; } = "";
    public double Value { get; set; }
    public double Max { get; set; }
}

public class FireHydrantPressurePointDto
{
    public string Key { get; set; } = "";
    public double? Value { get; set; }
}

public class FireHydrantStatus
{
    public bool Connected { get; set; }
    public long LastUpdated { get; set; }
    public List<FireHydrantTankDto> Tanks { get; set; } = new();
    public FireHydrantTankDto Diesel { get; set; } = new();
    public List<FireHydrantPumpDto> Pumps { get; set; } = new();
    public List<FireHydrantGaugeDto> Gauges { get; set; } = new();
    public List<FireHydrantPressurePointDto> PressurePoints { get; set; } = new();
}

// Raw payload shape published on both the "vlmfirehydrantpumproom" and
// "vlmfirehydrantotherlocation" MQTT topics.
public class MqttHydrantValue
{
    public string Id { get; set; } = "";
    public double V { get; set; }
    public bool Q { get; set; }
    public long T { get; set; }
}

public class MqttHydrantPayload
{
    public long Timestamp { get; set; }
    public List<MqttHydrantValue> Values { get; set; } = new();
}
