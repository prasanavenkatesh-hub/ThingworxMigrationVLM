using System.Text.Json;

namespace ControlTower.Services;

// Best-effort parser for a Kepware batch-JSON tag value ("v" field), which can arrive as a
// native JSON number, boolean, or string depending on the tag's quality - a bad-quality tag
// has been observed sending "v":"" (empty string) rather than a number.
public static class GasLeakPayloadParser
{
    public static bool TryParseDouble(JsonElement v, out double value)
    {
        switch (v.ValueKind)
        {
            case JsonValueKind.Number:
                return v.TryGetDouble(out value);
            case JsonValueKind.String:
                return double.TryParse(v.GetString(), out value);
            case JsonValueKind.True:
                value = 1;
                return true;
            case JsonValueKind.False:
                value = 0;
                return true;
            default:
                value = 0;
                return false;
        }
    }

    public static bool TryParseBool(JsonElement v, out bool value)
    {
        switch (v.ValueKind)
        {
            case JsonValueKind.True:
                value = true;
                return true;
            case JsonValueKind.False:
                value = false;
                return true;
            case JsonValueKind.Number:
                value = v.GetDouble() != 0;
                return true;
            case JsonValueKind.String:
                if (bool.TryParse(v.GetString(), out value)) return true;
                if (double.TryParse(v.GetString(), out var n)) { value = n != 0; return true; }
                value = false;
                return false;
            default:
                value = false;
                return false;
        }
    }
}
