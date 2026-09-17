using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Configuration;
using System.Collections.Generic;

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
            return Ok(new { version = "v1.0.0" });
        }

        [HttpGet("dashboard-dropdown")]
        public ActionResult<IEnumerable<string>> GetDashboardDropdownValues()
        {
            var values = _configuration.GetSection("DashboardDropdownValues").Get<List<string>>();
            return Ok(values ?? new List<string>());
        }
    }
}
