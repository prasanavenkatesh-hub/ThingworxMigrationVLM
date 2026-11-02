using Microsoft.AspNetCore.Mvc;

// =============================================================================================
// TEMPORARY - "view-only" copies of the app while several developers run it at the same time.
// To remove: delete this file, the app.UseMiddleware<AppWriteModeMiddleware>() line in Program.cs,
// the "AppWriteMode" guard lines in the repositories (search "AppWriteMode"), App:WritesEnabled in
// appsettings.json, and wwwroot/js/app-write-mode.js + wwwroot/css/app-write-mode.css (+ their tags
// in index.html).
//
// App:WritesEnabled (default false) decides whether THIS copy of the app writes to the database
// and sends MQTT commands:
//   false (view only) - dashboards still show live MQTT data, but the loggers / alert monitors don't
//                       save anything and the user actions (alert snooze, Gas Leak valve, EMS
//                       "Other Source" Update) are rejected with 403;
//   true              - normal behaviour. Enable it on the ONE machine that should keep the records,
//                       e.g. with the environment variable App__WritesEnabled=true.
// Read at startup: a change needs an app restart.
// =============================================================================================

namespace ControlTower.Services
{
    public static class AppWriteMode
    {
        public const string Key = "App:WritesEnabled";

        public static bool IsEnabled(IConfiguration configuration) => configuration.GetValue(Key, false);
    }

    // Rejects every POST / PUT / PATCH / DELETE to /api in a view-only copy. Today these are exactly
    // the user actions that write (snoozes, Gas Leak valve command, EMS Other Source Update).
    public class AppWriteModeMiddleware
    {
        private readonly RequestDelegate _next;
        private readonly bool _enabled;

        public AppWriteModeMiddleware(RequestDelegate next, IConfiguration configuration)
        {
            _next = next;
            _enabled = AppWriteMode.IsEnabled(configuration);
        }

        public async Task InvokeAsync(HttpContext context)
        {
            var method = context.Request.Method;
            var writes = HttpMethods.IsPost(method) || HttpMethods.IsPut(method) || HttpMethods.IsPatch(method) || HttpMethods.IsDelete(method);
            if (!_enabled && writes && context.Request.Path.StartsWithSegments("/api"))
            {
                context.Response.StatusCode = StatusCodes.Status403Forbidden;
                await context.Response.WriteAsJsonAsync(new
                {
                    error = "This copy of the app is view-only (App:WritesEnabled = false): it does not write to the database or send commands."
                });
                return;
            }
            await _next(context);
        }
    }
}

namespace ControlTower.Controllers
{
    // GET /api/app/write-mode - for the header's "Logging ON" / "View only" pill.
    [ApiController]
    [Route("api/app/write-mode")]
    public class AppWriteModeController : ControllerBase
    {
        private readonly IConfiguration _configuration;

        public AppWriteModeController(IConfiguration configuration)
        {
            _configuration = configuration;
        }

        [HttpGet]
        public IActionResult Get() => Ok(new { writesEnabled = ControlTower.Services.AppWriteMode.IsEnabled(_configuration) });
    }
}
