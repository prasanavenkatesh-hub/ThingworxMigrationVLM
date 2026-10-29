// =============================================================================================
// TEMPORARY - header pill for view-only copies of the app (see Modules/Shared/AppWriteMode.cs for
// what it means and how to remove it). Shows "Logging ON" (this copy writes to the database) or
// "View only"; in a view-only copy body gets the class app-view-only, which greys out the buttons
// that write (app-write-mode.css) - the server rejects those requests anyway.
// =============================================================================================

async function appWriteModeInit() {
    const mqtt = document.getElementById('mqttIndicator');
    if (!mqtt) return;
    const pill = document.createElement('div');
    pill.id = 'appWriteModeIndicator';
    pill.className = 'mqtt-indicator unknown';
    pill.innerHTML = '<span class="mqtt-indicator-dot"></span><span class="mqtt-indicator-text">Logging ?</span>';
    pill.title = 'Checking whether this copy of the app writes to the database...';
    mqtt.insertAdjacentElement('afterend', pill);
    const text = pill.querySelector('.mqtt-indicator-text');
    try {
        const res = await fetch('/api/app/write-mode');
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const { writesEnabled } = await res.json();
        document.body.classList.toggle('app-view-only', !writesEnabled);
        if (writesEnabled) {
            pill.className = 'mqtt-indicator ok';
            text.textContent = 'Logging ON';
            pill.title = 'This copy of the app writes to the database (alerts, pump counts / durations, EB-RTM and EMS logging) and can send commands.\n' +
                'Only one copy should do this (App:WritesEnabled = true).';
        } else {
            pill.className = 'mqtt-indicator unknown';
            text.textContent = 'View only';
            pill.title = 'This copy of the app does not write to the database or send commands (App:WritesEnabled = false).\n' +
                'Live data is shown as usual; alert snooze, the Gas Leak valve buttons and EMS "Other Source" Update are disabled.\n' +
                'To make this the logging copy: set App__WritesEnabled=true and restart the app.';
        }
    } catch (e) {
        text.textContent = 'Logging ?';
        pill.title = `Could not get the write mode from the server (${e.message})`;
    }
}

document.addEventListener('DOMContentLoaded', appWriteModeInit);
