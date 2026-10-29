using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using System.Collections.Generic;
using System.Linq;

namespace ControlTower.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class ConfigurationController : ControllerBase
    {
        private readonly IConfiguration _configuration;

        public ConfigurationController(IConfiguration configuration)
        {
            _configuration = configuration;
        }

        [HttpGet("version")]
        public IActionResult GetVersion()
        {
            return Ok(new { version = _configuration["App:Version"] ?? "v1.0.0" });
        }

        // ShiftConfiguration:Shifts as { "A": { "start": "00:15:00", "end": "07:14:59" }, ... } - lets a
        // page default to the current shift / production day without copying the times into JS.
        [HttpGet("shifts")]
        public IActionResult GetShifts()
        {
            var shifts = _configuration.GetSection("ShiftConfiguration:Shifts").GetChildren()
                .ToDictionary(s => s.Key, s => new { start = s["Start"], end = s["End"] });
            return Ok(shifts);
        }

        [HttpGet("dashboard-dropdown")]
        public ActionResult<IEnumerable<string>> GetDashboardDropdownValues()
        {
            var values = _configuration.GetSection("DashboardDropdownValues").Get<List<string>>();
            return Ok(values ?? new List<string>());
        }
    }
}
