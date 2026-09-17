using System.Text.Json;

namespace ControlTower.Models;

// One "zone" (Lot 1 / Lot 2) driven by a numeric leak-sensor reading, banded exactly like the
// source ThingWorx Thing's blinkShapes service: <=20 Normal (green), 20-40 Warning (yellow),
// >40 Danger (red). The siren blinks continuously regardless of band - blinkShapes toggles
// blinkGreen/blinkYellow/blinkRed every second, not just when in the red band.
public class GasLeakZoneDto
{
    public string Id { get; set; } = "";        // "lot1" / "lot2"
    public string Label { get; set; } = "";     // "Lot 1" / "Lot 2"
    public double Value { get; set; }           // raw tag reading
    public string Band { get; set; } = "green"; // "green" | "yellow" | "red"
    public bool Alert { get; set; }             // true only in the red (Danger) band
    public bool ValveOpen { get; set; } = true;
}

public class GasLeakPointDto
{
    public string Name { get; set; } = "";
    public string Status { get; set; } = "grey"; // "green" | "red" | "grey" (not live-wired)
}

public class GasLeakPaintShopDto
{
    public bool ValveOpen { get; set; } = true;
    public List<GasLeakPointDto> Points { get; set; } = new();
}

public class GasLeakStatus
{
    public bool Connected { get; set; }
    public long LastUpdated { get; set; }
    public double SprinklerPressure { get; set; } = 8.0;
    public bool TagQualityAlert { get; set; }
    public GasLeakZoneDto Lot1 { get; set; } = new() { Id = "lot1", Label = "Lot 1" };
    public GasLeakZoneDto Lot2 { get; set; } = new() { Id = "lot2", Label = "Lot 2" };
    public GasLeakPaintShopDto PaintShop1 { get; set; } = new();
    public GasLeakPaintShopDto PaintShop2 { get; set; } = new();
}

// Raw payload shape published on the "VallamGasLeakTopic" MQTT topic (Kepware IoT Gateway
// batch format). V is JsonElement rather than double - unlike the Fire Hydrant topics, this
// one has been observed sending "v":"" (an empty string) for a bad-quality tag, which would
// throw a JSON deserialization exception if V were declared as a plain double.
public class MqttGasLeakValue
{
    public string Id { get; set; } = "";
    public JsonElement V { get; set; }
    public bool Q { get; set; }
    public long T { get; set; }
}

public class MqttGasLeakPayload
{
    public long Timestamp { get; set; }
    public List<MqttGasLeakValue> Values { get; set; } = new();
}
