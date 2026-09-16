using ControlTower.Models;
using System.Collections.Generic;
using System.Threading.Tasks;

namespace ControlTower.Services
{
    public interface IReportsService
    {
        Task<IEnumerable<BiometricReport>> GetBiometricShiftwiseReportAsync(string line, string? historyCard, string startDate, string endDate);
        Task<IEnumerable<MainLineCycleTimeReport>> GetMainLineCycleTimeReportAsync(string startDate, string endDate);
        Task<IEnumerable<string>> GetPokeYokeHistoryCardsAsync(string line);
        Task<IEnumerable<string>> GetPokeYokeStationsAsync(string line, string historyCard);
        Task<IEnumerable<PokeYokeReport>> GetPokeYokeReportAsync(string line, string historyCard, string? station, string? startDate, string? endDate, string? engineNo = null);
        Task<IEnumerable<PokeYokeSummaryReport>> GetPokeYokeSummaryReportAsync(string line, string historyCard, string? station, string? startDate, string? endDate);
        Task<IEnumerable<BiometricEngineBarcodeReport>> GetBiometricEngineBarcodeReportAsync(string line, string historyCard, string value);
    }
}
