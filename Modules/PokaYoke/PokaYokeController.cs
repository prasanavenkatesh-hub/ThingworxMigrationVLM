using ControlTower.Models;
using ControlTower.Services;
using Microsoft.AspNetCore.Mvc;

namespace ControlTower.Controllers;

// PokaYoke screens (sidebar PokaYoke > JEA1 Line ...). {line} is a key of PokaYoke:Lines (e.g. jea1).
[ApiController]
[Route("api/pokayoke")]
public class PokaYokeController : ControllerBase
{
    private readonly PokaYokeStatusService _service;

    public PokaYokeController(PokaYokeStatusService service)
    {
        _service = service;
    }

    // Live OK / Manual Inspection checkpoint counts per station + line total (cached for
    // PokaYoke:RefreshSeconds).
    [HttpGet("{line}/stations")]
    public async Task<ActionResult<PokaYokeLineStatus>> GetStations(string line)
    {
        if (!_service.HasLine(line)) return NotFound($"Unknown PokaYoke line '{line}'.");
        return Ok(await _service.GetStatusAsync(line));
    }

    // Checkpoints of one station (description + OK / MI) for the station pop-up. {station} is the
    // tag-master station number, e.g. ML-08 or SA-42C.
    [HttpGet("{line}/stations/{station}")]
    public async Task<ActionResult<PokaYokeStationDetail>> GetStation(string line, string station)
    {
        if (!_service.HasLine(line)) return NotFound($"Unknown PokaYoke line '{line}'.");
        return Ok(await _service.GetStationAsync(line, station));
    }

    // Checkpoints behind the summary (HC) table values for its pop-up: every station counted in the
    // line total. status = OK | MI | all (default).
    [HttpGet("{line}/checkpoints")]
    public async Task<ActionResult<PokaYokeLineCheckpoints>> GetCheckpoints(string line, [FromQuery] string? status)
    {
        if (!_service.HasLine(line)) return NotFound($"Unknown PokaYoke line '{line}'.");
        return Ok(await _service.GetLineCheckpointsAsync(line, status));
    }
}
