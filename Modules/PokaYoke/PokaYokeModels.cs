using System.Text.Json.Serialization;

namespace ControlTower.Models;

// OK / Manual Inspection checkpoint counts of one station (or of the whole line).
public class PokaYokeCount
{
    public int Ok { get; set; }
    public int Mi { get; set; }
}

// Live Poka Yoke status of one line (GET /api/pokayoke/{line}/stations).
//   Stations - keyed by station number as in the tag master (ML-01, SA-42I, RW-04, ...), after
//              PokaYoke:Lines:<line>:StationAliases
//   Total    - sum over all stations except SummaryExcludedStations (the auto stations)
//   Checkpoints / Ignored - checkpoints counted / skipped (no value, "NA", or no record yet)
//   UnmatchedTables - tag-master tables with no entry in PokaYoke:Lines:<line>:Sources (not read)
//   Errors   - per-table query errors of the last refresh; Error - the whole refresh failed
//   QueryStartedAt / UpdatedAt - when the database queries of this snapshot started / finished,
//   QuerySeconds - how long they took
public class PokaYokeLineStatus
{
    public string Line { get; set; } = "";
    public DateTime? QueryStartedAt { get; set; }
    public DateTime? UpdatedAt { get; set; }
    public double QuerySeconds { get; set; }
    public int RefreshSeconds { get; set; }
    public Dictionary<string, PokaYokeCount> Stations { get; set; } = new();
    public PokaYokeCount Total { get; set; } = new();
    public int Checkpoints { get; set; }
    public int Ignored { get; set; }
    public List<string> UnmatchedTables { get; set; } = new();
    public List<string> Errors { get; set; } = new();
    public string? Error { get; set; }

    // Station -> its checkpoints (tag-master order); served per station by GET .../stations/{station}.
    [JsonIgnore]
    public Dictionary<string, List<PokaYokeCheckpoint>> Details { get; set; } = new();
}

// One checkpoint in the station / summary pop-up: Station (tag-master station number, after
// StationAliases), tag-master Description, Status OK / MI, Value = the raw value read (e.g. OK,
// BYPASSED, OFF).
public class PokaYokeCheckpoint
{
    public string Station { get; set; } = "";
    public string Description { get; set; } = "";
    public string Status { get; set; } = "";
    public string Value { get; set; } = "";
}

// GET /api/pokayoke/{line}/stations/{station}: the station's checkpoints from the same snapshot as
// the counts (so the pop-up always adds up to the cells).
public class PokaYokeStationDetail
{
    public string Line { get; set; } = "";
    public string Station { get; set; } = "";
    public DateTime? UpdatedAt { get; set; }
    public int Ok { get; set; }
    public int Mi { get; set; }
    public List<PokaYokeCheckpoint> Checkpoints { get; set; } = new();
    public string? Error { get; set; }
}

// GET /api/pokayoke/{line}/checkpoints?status=: the checkpoints behind the summary table (HC table)
// values - every station counted in Total (so without SummaryExcludedStations), station by station.
// Ok / Mi = the line Total, whatever the status filter.
public class PokaYokeLineCheckpoints
{
    public string Line { get; set; } = "";
    public string Status { get; set; } = "";
    public DateTime? UpdatedAt { get; set; }
    public int Ok { get; set; }
    public int Mi { get; set; }
    public List<PokaYokeCheckpoint> Checkpoints { get; set; } = new();
    public string? Error { get; set; }
}
