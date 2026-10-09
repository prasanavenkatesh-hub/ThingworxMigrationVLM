namespace ControlTower.Controllers;

// Shared by the dashboard controllers (Fire Hydrant, Gas Leak, EB-RTM).
public static class ApiDateTime
{
    // The frontend sends datetimes via JS's toISOString(), which is always UTC ("Z"-suffixed).
    // ASP.NET Core's model binder parses that into a DateTime with Kind=Utc but does NOT shift
    // the value to local time - and every DateTime stored in the dashboards' tables is local
    // server time (DateTime.Now). Left uncorrected, a query/snooze time arrives 5.5h (IST) off
    // from what the user actually picked, silently excluding recent data or expiring a snooze
    // instantly.
    public static DateTime ToLocal(DateTime dt) => dt.Kind == DateTimeKind.Utc ? dt.ToLocalTime() : dt;
}
