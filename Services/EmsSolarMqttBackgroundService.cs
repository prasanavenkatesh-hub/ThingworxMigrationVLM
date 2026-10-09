using System.Buffers;
using System.Text;
using System.Text.Json;
using ControlTower.Models;
using MQTTnet;

namespace ControlTower.Services;

// Bridges vlmsolarlivetag (2 solar feeder meters) into EmsSolarStateStore, and inserts the
// daily 00:15 baseline row into [ControlTowerVLM].[dbo].[SolarData] used for Today/Yesterday
// delta calculations. Same reconnect-on-failure pattern as FireHydrantMqttBackgroundService.
public class EmsSolarMqttBackgroundService : BackgroundService
{
    private readonly EmsSolarStateStore _store;
    private readonly EmsSolarDataRepository _repo;
    private readonly IConfiguration _config;
    private readonly ILogger<EmsSolarMqttBackgroundService> _logger;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };
    private DateTime? _lastDailyInsertDate;
    private DateTime? _lastHourlyInsert;

    public EmsSolarMqttBackgroundService(EmsSolarStateStore store, EmsSolarDataRepository repo, IConfiguration config, ILogger<EmsSolarMqttBackgroundService> logger)
    {
        _store = store;
        _repo = repo;
        _config = config;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var host = _config["EmsMqtt:Host"] ?? "localhost";
        var port = _config.GetValue<int?>("EmsMqtt:Port") ?? 1883;
        var topic = _config["EmsMqtt:SolarTopic"] ?? "";

        var factory = new MqttClientFactory();
        using var client = factory.CreateMqttClient();
        var options = new MqttClientOptionsBuilder()
            .WithTcpServer(host, port)
            .WithClientId($"ControlTower-EmsSolar-{Guid.NewGuid():N}")
            .WithCleanSession()
            .Build();

        client.ApplicationMessageReceivedAsync += async e =>
        {
            try
            {
                var json = Encoding.UTF8.GetString(e.ApplicationMessage.Payload.ToArray());
                var payload = JsonSerializer.Deserialize<MqttEmsPayload>(json, JsonOptions);
                if (payload == null) return;
                _store.UpdateFromPayload(payload);
                await MaybeInsertDailyBaselineAsync();
                await MaybeInsertHourlyGraphPointAsync();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to process EMS Solar MQTT message");
            }
        };

        client.DisconnectedAsync += e =>
        {
            _store.SetConnected(false);
            _logger.LogWarning("EMS Solar MQTT disconnected: {Reason}", e.Reason);
            return Task.CompletedTask;
        };

        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                if (!client.IsConnected)
                {
                    await client.ConnectAsync(options, stoppingToken);
                    await client.SubscribeAsync(topic, cancellationToken: stoppingToken);
                    _store.SetConnected(true);
                    _logger.LogInformation("Connected to EMS Solar MQTT broker at {Host}:{Port}, subscribed to {Topic}", host, port, topic);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "EMS Solar MQTT connection failed, retrying in 5s");
            }

            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
    }

    // Fires once per day, the first message received during the 00:15 minute (acts on a
    // transition, not every tick - same convention as the FireHydrant loggers).
    private async Task MaybeInsertDailyBaselineAsync()
    {
        var now = DateTime.Now;
        if (now.Hour != 0 || now.Minute != 15) return;
        if (_lastDailyInsertDate == now.Date) return;
        _lastDailyInsertDate = now.Date;
        try
        {
            await _repo.InsertAsync(now, _store.LiveKw, _store.RealEnergySum);
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to insert daily EMS Solar baseline row");
        }
    }

    // One point per hour at HH:15 (00:15 to next day's 00:15), for the hourly Live(kW) chart.
    private async Task MaybeInsertHourlyGraphPointAsync()
    {
        var now = DateTime.Now;
        if (now.Minute != 15) return;
        if (_lastHourlyInsert.HasValue && _lastHourlyInsert.Value.Date == now.Date && _lastHourlyInsert.Value.Hour == now.Hour) return;
        _lastHourlyInsert = now;
        try
        {
            await _repo.InsertLiveGraphPointAsync(now, (long)Math.Round(_store.LiveKw));
        }
        catch (Exception ex)
        {
            _logger.LogWarning(ex, "Failed to insert EMS Solar hourly graph point");
        }
    }
}
