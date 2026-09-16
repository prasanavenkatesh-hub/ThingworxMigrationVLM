using System;

namespace ControlTower.Models
{
    public class PokeYokeReport
    {
        public DateTime Date_Time { get; set; }
        public string Stn_Number { get; set; } = "";
        public string Engine_Number { get; set; } = "";
        public string Description { get; set; } = "";
    }
}
