using System.Buffers;
using System.Text;
using System.Text.Json;
using ControlTower.Models;
using MQTTnet;

namespace ControlTower.Services;

// Connects to the plant MQTT broker and keeps GasLeakStateStore updated from the
// "VallamGasLeakTopic" topic (Kepware batch JSON: LPG Yard Lot 1/2 leak sensors, Paint Shop 2
// gas detector healthy flags, sprinkler pressure). Runs its own connection, deliberately
// separate from FireHydrantMqttBackgroundService's, so nothing here can affect Fire Hydrant's
// live feed even if this connection has trouble. Reconnects on failure/disconnect rather than
// crashing the host - same pattern as FireHydrantMqttBackgroundService.
public class GasLeakMqttBackgroundService : BackgroundService
{
    private readonly GasLeakStateStore _store;
    private readonly GasLeakAlertMonitor _alertMonitor;
    private readonly IConfiguration _config;
    private readonly ILogger<GasLeakMqttBackgroundService> _logger;
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNameCaseInsensitive = true };

    private IMqttClient? _client;
    private string _lot1ValveCommandTopic = "";
    private string _lot2ValveCommandTopic = "";

    public GasLeakMqttBackgroundService(GasLeakStateStore store, GasLeakAlertMonitor alertMonitor, IConfiguration config, ILogger<GasLeakMqttBackgroundService> logger)
    {
        _store = store;
        _alertMonitor = alertMonitor;
        _config = config;
        _logger = logger;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        var host = _config["GasLeakMqtt:Host"] ?? "localhost";
        var port = _config.GetValue<int?>("GasLeakMqtt:Port") ?? 1883;
        var topic = _config["GasLeakMqtt:Topic"] ?? "VallamGasLeakTopic";
        _lot1ValveCommandTopic = _config["GasLeakMqtt:Lot1ValveCommandTopic"] ?? "";
        _lot2ValveCommandTopic = _config["GasLeakMqtt:Lot2ValveCommandTopic"] ?? "";

        var factory = new MqttClientFactory();
        var client = factory.CreateMqttClient();
        _client = client;

        var options = new MqttClientOptionsBuilder()
            .WithTcpServer(host, port)
            .WithClientId($"ControlTower-GasLeak-{Guid.NewGuid():N}")
            .WithCleanSession()
            .Build();

        client.ApplicationMessageReceivedAsync += async e =>
        {
            try
            {
                var json = Encoding.UTF8.GetString(e.ApplicationMessage.Payload.ToArray());
                var payload = JsonSerializer.Deserialize<MqttGasLeakPayload>(json, JsonOptions);
                if (payload == null) return;

                _store.UpdateFromPayload(payload);
                await _alertMonitor.EvaluateAsync(_store.GetStatus());
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Failed to process Gas Leak MQTT message");
            }
        };

        client.DisconnectedAsync += e =>
        {
            _store.SetConnected(false);
            _logger.LogWarning("Gas Leak MQTT disconnected: {Reason}", e.Reason);
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
                    _logger.LogInformation("Connected to Gas Leak MQTT broker at {Host}:{Port}, subscribed to {Topic}", host, port, topic);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex, "Gas Leak MQTT connection failed, retrying in 5s");
            }

            await Task.Delay(TimeSpan.FromSeconds(5), stoppingToken);
        }
    }

    // Publishes a valve-open/close command for Lot 1 / Lot 2 (Paint Shop valves are read-only,
    // matching the source mashup) and optimistically flips the cached state so the UI responds
    // immediately instead of waiting for the tag to echo back. Returns false if not currently
    // connected, or if the target's command topic hasn't been configured yet.
    public async Task<bool> PublishValveCommandAsync(string target)
    {
        var topic = target switch
        {
            "lot1" => _lot1ValveCommandTopic,
            "lot2" => _lot2ValveCommandTopic,
            _ => ""
        };
        if (string.IsNullOrEmpty(topic) || _client is null || !_client.IsConnected) return false;

        var status = _store.GetStatus();
        var zone = target == "lot1" ? status.Lot1 : status.Lot2;
        zone.ValveOpen = !zone.ValveOpen;

        var message = new MqttApplicationMessageBuilder()
            .WithTopic(topic)
            .WithPayload(zone.ValveOpen ? "OPEN" : "CLOSE")
            .Build();

        await _client.PublishAsync(message);
        return true;
    }
}
