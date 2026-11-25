using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using Map=System.Collections.Generic.Dictionary<string,object>;

internal static class JournalSyncCommit
{
    internal static object Apply(Map payload)
    {
        var next=Program.Json.Deserialize<Store>(Program.Json.Serialize(Program.Data));
        var widget=(Map)next.WidgetState;var pc=(Map)widget["privateContent"];
        pc["edits"]=payload["records"];pc["projects"]=payload["projects"];widget["nativeImages"]=payload["images"];
        if(payload.ContainsKey("analyses"))pc["analyses"]=payload["analyses"];
        var schedules=new Dictionary<string,Schedule>();
        foreach(var raw in (IList)payload["events"]) {
            var entry=ScheduleSync.Entry.FromWire(raw);
            var prior=next.Schedules.FirstOrDefault(p=>(p.Value.Date??p.Key.Split('/')[0])+"/"+p.Value.Id==entry.Key);
            if(prior.Value!=null && ScheduleSync.DesktopJournal.ParseDesktop(entry.Date,Program.Json.Deserialize<Map>(Program.Json.Serialize(prior.Value)),prior.Key).Locked) {
                schedules.Add(prior.Key,prior.Value);continue;
            }
            if(entry.Locked)throw new InvalidDataException("A phone cannot create a locked Windows event.");
            var at=DateTimeOffset.FromUnixTimeMilliseconds(entry.At).ToLocalTime();
            if(at.ToString("yyyy-MM-dd")!=entry.Date||at.ToString("HH:mm")!=entry.Time)throw new InvalidDataException("Event time zone differs; original data was retained.");
            schedules.Add(entry.Key,new Schedule{Id=entry.Key.Substring(11),Date=entry.Date,Title=entry.Title,Time=entry.Time,At=at.ToString("o",CultureInfo.InvariantCulture),RemindMinutes=entry.Minutes,Done=entry.Done,Important=entry.Important});
        }
        // Linked and legacy occurrences cannot be deleted by a remote journal.
        foreach(var pair in next.Schedules) if(!String.IsNullOrEmpty(pair.Value.IdeaId)||!pair.Key.Contains("/"))schedules[pair.Key]=pair.Value;
        next.Schedules=schedules;
        next=JournalArchive.Validate(Program.Json.Serialize(next));
        var warning=Program.Restore(next); // full pre-sync snapshot + atomic journal replace
        return new {schedules=Program.Data.Schedules,warning=warning};
    }
}
