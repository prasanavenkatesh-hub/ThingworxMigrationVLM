using ControlTower.Models;
using ControlTower.Services;
using Microsoft.AspNetCore.Mvc;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace ControlTower.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class ReportsController : ControllerBase
    {
        private readonly IReportsService _reportsService;

        public ReportsController(IReportsService reportsService)
        {
            _reportsService = reportsService;
        }

        [HttpGet("biometric-shiftwise")]
        public async Task<ActionResult<IEnumerable<BiometricReport>>> GetBiometricShiftwiseReport(
            [FromQuery] string line, 
            [FromQuery] string? historyCard, 
            [FromQuery] string startDate, 
            [FromQuery] string endDate)
        {
            var result = await _reportsService.GetBiometricShiftwiseReportAsync(line, historyCard, startDate, endDate);
            return Ok(result);
        }

        [HttpGet("biometric-engine-barcode")]
        public async Task<ActionResult<IEnumerable<BiometricEngineBarcodeReport>>> GetBiometricEngineBarcodeReport(
            [FromQuery] string line,
            [FromQuery] string historyCard,
            [FromQuery] string? engineNo,
            [FromQuery] string? barcode)
        {
            var value = !string.IsNullOrWhiteSpace(engineNo) ? engineNo : barcode;
            if (string.IsNullOrWhiteSpace(value))
            {
                return BadRequest("Engine Number or Barcode is required.");
            }

            var result = await _reportsService.GetBiometricEngineBarcodeReportAsync(line, historyCard, value);
            return Ok(result);
        }

        [HttpGet("mainline")]
        public async Task<ActionResult<IEnumerable<MainLineCycleTimeReport>>> GetMainLineCycleTimeReport([FromQuery] string startDate, [FromQuery] string endDate)
        {
            var result = await _reportsService.GetMainLineCycleTimeReportAsync(startDate, endDate);
            return Ok(result);
        }

        [HttpGet("poke-yoke/history-cards")]
        public async Task<ActionResult<IEnumerable<string>>> GetPokeYokeHistoryCards([FromQuery] string line)
        {
            var result = await _reportsService.GetPokeYokeHistoryCardsAsync(line);
            return Ok(result);
        }
        [HttpGet("poke-yoke/stations")]
        public async Task<ActionResult<IEnumerable<string>>> GetPokeYokeStations([FromQuery] string line, [FromQuery] string historyCard)
        {
            var result = await _reportsService.GetPokeYokeStationsAsync(line, historyCard);
            return Ok(result);
        }

        [HttpGet("poke-yoke/data")]
        public async Task<ActionResult<IEnumerable<PokeYokeReport>>> GetPokeYokeReport(
            [FromQuery] string line, 
            [FromQuery] string historyCard, 
            [FromQuery] string? station, 
            [FromQuery] string? startDate, 
            [FromQuery] string? endDate,
            [FromQuery] string? engineNo)
        {
            var result = await _reportsService.GetPokeYokeReportAsync(line, historyCard, station, startDate, endDate, engineNo);
            return Ok(result);
        }

        [HttpGet("poke-yoke/summary/data")]
        public async Task<ActionResult<IEnumerable<PokeYokeSummaryReport>>> GetPokeYokeSummaryReport(
            [FromQuery] string line, 
            [FromQuery] string historyCard, 
            [FromQuery] string? station, 
            [FromQuery] string? startDate, 
            [FromQuery] string? endDate)
        {
            var result = await _reportsService.GetPokeYokeSummaryReportAsync(line, historyCard, station, startDate, endDate);
            return Ok(result);
        }

        [HttpGet("qhold/data")]
        public async Task<ActionResult<IEnumerable<QHoldReport>>> GetQHoldReport(
            [FromQuery] string? mode,
            [FromQuery] string? startDate,
            [FromQuery] string? endDate,
            [FromQuery] string? model,
            [FromQuery] string? engineNumber,
            [FromQuery] string? qHoldStation,
            [FromQuery] string? result,
            [FromQuery] string? category,
            [FromQuery] string? rejectionDetails,
            [FromQuery] string? reworkDetails,
            [FromQuery] string? shift)
        {
            var data = await _reportsService.GetQHoldReportAsync(
                mode ?? "Overall", startDate, endDate, model, engineNumber, qHoldStation, result, category, rejectionDetails, reworkDetails, shift);
            return Ok(data);
        }

        [HttpGet("cylinder-head-leak/data")]
        public async Task<ActionResult<IEnumerable<CylinderHeadLeakReport>>> GetCylinderHeadLeakReport(
            [FromQuery] string? startDate,
            [FromQuery] string? endDate,
            [FromQuery] string? plant,
            [FromQuery] string? assemblyLine,
            [FromQuery] string? shift)
        {
            var data = await _reportsService.GetCylinderHeadLeakReportAsync(startDate, endDate, plant, assemblyLine, shift);
            return Ok(data);
        }
    }
}
