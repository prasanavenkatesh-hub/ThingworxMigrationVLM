using System.Buffers;
using System.Text;
using System.Text.Json;
using ControlTower.Models;
using MQTTnet;

namespace ControlTower.Services;

// Connects to the plant MQTT broker and keeps FireHydrantStateStore updated from both the
// "vlmfirehydrantpumproom" (tanks/diesel/pumps/gauges) and "vlmfirehydrantotherlocation"
// (shopfloor pressure grid) topics on a single connection. Reconnects on failure/disconnect
// rather than crashing the host, since the broker may be temporarily unreachable.
public class FireHydrantMqttBackgroundService : BackgroundService
{
    private readonly FireHydrantStateStore _store;
    private readonly FireHydrantAlertMonitor _alertMonitor;
    private readonly FireHydrantPumpCountLogger _pumpCountLogger;
    private readonly FireHydrantPumpDurationLogger _pumpDurationLogger;
    private readonly IConfiguration _config;
    private readonly ILogger<FireHydrantMqttBackgroundService> _logger;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    public FireHydrantMqttBackgroundService(FireHydrantStateStore store, FireHydrantAlertMonitor alertMonitor, FireHydrantPumpCountLogger pumpCountLogger, FireHydrantPumpDurationLogger pumpDurationLogger, IConfiguration config, ILogger<FireHydrantMqttBackgroundService> logger)
    {
        _store = store;
        _alertMonitor = alertMonitor;
        _pumpCountLogger = pumpCountLogger;
        _pumpDurationLogger = pumpDurationLogger;
        _config = config;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var host = _config["Mqtt:Host"] ?? "localhost";
        var port = _config.GetValue<int?>("Mqtt:Port") ?? 1883;
        var topic = _config["Mqtt:Topic"] ?? "";
        var otherLocationsTopic = _config["Mqtt:OtherLocationsTopic"] ?? "";

        var factory = new MqttClientFactory();
        using var client = factory.CreateMqttClient();

        var options = new MqttClientOptionsBuilder()
            .WithTcpServer(host, port)
            .WithClientId($"ControlTower-FireHydrant-{Guid.NewGuid():N}")
            .WithCleanSession()
            .Build();

        client.ApplicationMessageReceivedAsync += async e =>
        {
            try
            {
                var json = Encoding.UTF8.GetString(e.ApplicationMessage.Payload.ToArray());
                var payload = JsonSerializer.Deserialize<MqttHydrantPayload>(json, JsonOptions);
                if (payload == null) return;

                if (e.ApplicationMessage.Topic == otherLocationsTopic)
                {
                    _store.UpdateFromOtherLocationsPayload(payload);
                }
                else
                {
                    _store.UpdateFromPayload(payload);
                    // Pump counts/on-off state only come from the pump-room topic.
                    await _pumpCountLogger.EvaluateAsync(_store.GetStatus());
                    await _pumpDurationLogger.EvaluateAsync(_store.GetStatus());
                }

                await _alertMonitor.EvaluateAsync(_store.GetStatus());
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to process Fire Hydrant MQTT message");
            }
        };

        client.DisconnectedAsync += e =>
        {
            _store.SetConnected(false);
            _logger.LogWarning("Fire Hydrant MQTT disconnected: {Reason}", e.Reason);
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
                    await client.SubscribeAsync(otherLocationsTopic, cancellationToken: stoppingToken);
                    _store.SetConnected(true);
                    _logger.LogInformation("Connected to Fire Hydrant MQTT broker at {Host}:{Port}, subscribed to {Topic} and {OtherTopic}", host, port, topic, otherLocationsTopic);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Fire Hydrant MQTT connection failed, retrying in 5s");
            }

            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
    }
}
