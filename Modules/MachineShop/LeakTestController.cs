using System.Globalization;
using ControlTower.Models;
using ControlTower.Services;
using Microsoft.AspNetCore.Mvc;

namespace ControlTower.Controllers;

// Machine Shop > Leak Test. component = a key of MachineShop:LeakTest:Components (e.g. cover-lh);
// from / to = dates (yyyy-MM-dd), inclusive.
[ApiController]
[Route("api/machineshop/leaktest")]
public class LeakTestController : ControllerBase
{
    private readonly LeakTestService _service;

    public LeakTestController(LeakTestService service)
    {
        _service = service;
    }

    [HttpGet("{component}/data")]
    public async Task<ActionResult<LeakTestData>> GetData(string component, [FromQuery] string? from, [FromQuery] string? to)
    {
        var c = _service.FindComponent(component);
        if (c == null) return NotFound($"Leak test component '{component}' is not configured.");
        if (!DateTime.TryParseExact(from, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var f)
            || !DateTime.TryParseExact(to, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var t))
            return BadRequest("from and to must be dates in yyyy-MM-dd format.");
        if (f > t) return BadRequest("from must not be after to.");
        if ((t - f).TotalDays >= _service.MaxRangeDays)
            return BadRequest($"Date range is limited to {_service.MaxRangeDays} days.");
        return Ok(await _service.GetDataAsync(c, f, t));
    }

    [HttpGet("{component}/yeartrend")]
    public async Task<ActionResult<LeakTestTrend>> GetYearTrend(string component)
    {
        var c = _service.FindComponent(component);
        if (c == null) return NotFound($"Leak test component '{component}' is not configured.");
        return Ok(await _service.GetYearTrendAsync(c));
    }
}
