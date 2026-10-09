using ControlTower.Services;
using Microsoft.AspNetCore.Mvc;

namespace ControlTower.Controllers;

// Aggregated health of every dashboard's MQTT feed, for the header's MQTT indicator. A feed
// counts as good only if data is actually arriving - i.e. a payload was processed within the
// last Mqtt:StaleAfterSeconds (default 60) - not merely if the broker connection is open.
// Ages are measured on the server's own clock (when each payload was received), so a skewed
// Kepware clock can't make a live feed look stale or vice versa. Read-only and in-memory.
[ApiController]
[Route("api/mqtt")]
public class MqttStatusController : ControllerBase
{
    private readonly FireHydrantStateStore _fireHydrant;
    private readonly GasLeakStateStore _gasLeak;
    private readonly EbRtmStateStore _ebRtm;
    private readonly EmsSolarStateStore _emsSolar;
    private readonly double _staleAfterSeconds;

    public MqttStatusController(FireHydrantStateStore fireHydrant, GasLeakStateStore gasLeak, EbRtmStateStore ebRtm, EmsSolarStateStore emsSolar, IConfiguration config)
    {
        _fireHydrant = fireHydrant;
        _gasLeak = gasLeak;
        _ebRtm = ebRtm;
        _emsSolar = emsSolar;
        _staleAfterSeconds = config.GetValue<double?>("Mqtt:StaleAfterSeconds") ?? 60;
    }

    [HttpGet("status")]
    public ActionResult<List<MqttFeedStatusDto>> GetStatus()
    {
        return Ok(new List<MqttFeedStatusDto>
        {
            Build("Fire Hydrant", _fireHydrant.LastReceivedUtc),
            Build("LPG Gas Leak", _gasLeak.LastReceivedUtc),
            Build("EMS Renewable (Solar)", _emsSolar.LastReceivedUtc),
            Build("EB-Real Time Monitoring", _ebRtm.LastReceivedUtc)
        });
    }

    private MqttFeedStatusDto Build(string name, DateTime? lastReceivedUtc)
    {
        double? age = lastReceivedUtc.HasValue ? Math.Max(0, (DateTime.UtcNow - lastReceivedUtc.Value).TotalSeconds) : null;
        return new MqttFeedStatusDto
        {
            Name = name,
            Receiving = age.HasValue && age.Value <= _staleAfterSeconds,
            SecondsSinceLastData = age.HasValue ? Math.Round(age.Value) : null
        };
    }
}

public class MqttFeedStatusDto
{
    public string Name { get; set; } = "";
    public bool Receiving { get; set; }                 // data arrived within the stale window
    public double? SecondsSinceLastData { get; set; }   // null if nothing received since app start
}
