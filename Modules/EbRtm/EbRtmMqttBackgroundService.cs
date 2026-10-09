using System.Buffers;
using System.Text;
using System.Text.Json;
using ControlTower.Models;
using MQTTnet;

namespace ControlTower.Services;

// Connects to the plant MQTT broker and keeps EbRtmStateStore updated from the
// "vlmEnergyMonitoring" topic (Kepware batch JSON, single 33KV incomer meter
// VLM_EMS.Meter4_SID7). Runs its own connection, deliberately separate from Fire Hydrant's and
// Gas Leak's, so nothing here can affect their live feeds even if this connection has trouble.
// Reconnects on failure/disconnect rather than crashing the host - same pattern as the other two.
public class EbRtmMqttBackgroundService : BackgroundService
{
    private readonly EbRtmStateStore _store;
    private readonly EbRtmReadingLogger _readingLogger;
    private readonly EbRtmPowerFailureMonitor _powerFailureMonitor;
    private readonly IConfiguration _config;
    private readonly ILogger<EbRtmMqttBackgroundService> _logger;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public EbRtmMqttBackgroundService(EbRtmStateStore store, EbRtmReadingLogger readingLogger, EbRtmPowerFailureMonitor powerFailureMonitor, IConfiguration config, ILogger<EbRtmMqttBackgroundService> logger)
    {
        _store = store;
        _readingLogger = readingLogger;
        _powerFailureMonitor = powerFailureMonitor;
        _config = config;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var host = _config["EbRtm:Mqtt:Host"] ?? _config["Mqtt:Host"] ?? "localhost";
        var port = _config.GetValue<int?>("EbRtm:Mqtt:Port") ?? _config.GetValue<int?>("Mqtt:Port") ?? 1883;
        var topic = _config["EbRtm:Mqtt:Topic"] ?? "vlmEnergyMonitoring";

        var factory = new MqttClientFactory();
        using var client = factory.CreateMqttClient();

        var options = new MqttClientOptionsBuilder()
            .WithTcpServer(host, port)
            .WithClientId($"ControlTower-EbRtm-{Guid.NewGuid():N}")
            .WithCleanSession()
            .Build();

        client.ApplicationMessageReceivedAsync += async e =>
        {
            try
            {
                var json = Encoding.UTF8.GetString(e.ApplicationMessage.Payload.ToArray());
                var payload = JsonSerializer.Deserialize<MqttEbRtmPayload>(json, JsonOptions);
                if (payload == null) return;

                _store.UpdateFromPayload(payload);

                var reading = _store.GetCurrentReading();
                await _readingLogger.EvaluateAsync(reading);
                if (reading.AvgVoltage.HasValue) await _powerFailureMonitor.EvaluateAsync(reading.AvgVoltage.Value);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to process EB Real Time Monitoring MQTT message");
            }
        };

        client.DisconnectedAsync += e =>
        {
            _store.SetConnected(false);
            _logger.LogWarning("EB Real Time Monitoring MQTT disconnected: {Reason}", e.Reason);
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
                    _logger.LogInformation("Connected to EB Real Time Monitoring MQTT broker at {Host}:{Port}, subscribed to {Topic}", host, port, topic);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "EB Real Time Monitoring MQTT connection failed, retrying in 5s");
            }

            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
    }
}
