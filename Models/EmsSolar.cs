namespace ControlTower.Models;

public class MqttEmsValue
{
    public string Id { get; set; } = "";
    public double V { get; set; }
    public bool Q { get; set; }
    public long T { get; set; }
}

public class MqttEmsPayload
{
    public long Timestamp { get; set; }
    public List<MqttEmsValue> Values { get; set; } = new();
}
