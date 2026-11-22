// Android Schedule RFCOMM v1 implementation, shared contract with the Android companion.
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Security.Principal;
using System.Text;
using Map = System.Collections.Generic.Dictionary<string, object>;

namespace ScheduleSync
{
    internal sealed class DesktopJournal
    {
        readonly string journal;
        readonly Func<Map, Map> invoke;
        internal string Source { get; private set; }
        internal string CompletedReviewId { get; private set; }

        internal DesktopJournal(string journalPath, Func<Map, Map> api)
        {
            journal = Path.GetFullPath(journalPath);
            if (api == null) throw new ArgumentNullException("api");
            invoke = api;
            string data = WindowsIdentity.GetCurrent().User.Value + "|" + journal.ToUpperInvariant();
            using (var hash = SHA256.Create())
                Source = BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(data))).Replace("-", "").ToLowerInvariant();
        }

        internal List<Entry> Snapshot()
        {
            // Schedule atomically replaces this file. Holding a shared read handle pins either the old or new version.
            using (var stream = new FileStream(journal, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete))
            using (var reader = new StreamReader(stream, Encoding.UTF8, true))
            {
                if (stream.Length > 100 * 1024 * 1024) throw new IOException("Schedule journal exceeds 100 MiB.");
                var root = Wire.Object(Wire.Json.DeserializeObject(reader.ReadToEnd()));
                var schedules = Wire.Object(Wire.Value(root, "Schedules"));
                if (schedules.Count > Wire.MaxEvents) throw new InvalidDataException("Schedule contains more than 10,000 events.");
                var entries = new SortedDictionary<string, Entry>(StringComparer.Ordinal);
                foreach (var pair in schedules)
                {
                    string date = pair.Key.Split('/')[0];
                    Entry entry = ParseDesktop(date, Wire.Object(pair.Value), pair.Key);
                    if (entries.ContainsKey(entry.Key)) throw new InvalidDataException("Schedule contains a duplicate event ID.");
                    entries.Add(entry.Key, entry);
                }
                return entries.Values.ToList();
            }
        }

        static object Field(Map data, string name)
        {
            object value;
            if (data.TryGetValue(name, out value)) return value;
            data.TryGetValue(Char.ToLowerInvariant(name[0]) + name.Substring(1), out value);
            return value;
        }

        internal static Entry ParseDesktop(string date, Map fields, string storageKey = null)
        {
            var id = Field(fields, "Id") as string;
            bool legacy = String.IsNullOrEmpty(id) || (storageKey != null && !storageKey.Contains("/")) ||
                String.Equals(id, "legacy-" + date, StringComparison.Ordinal);
            if (String.IsNullOrEmpty(id)) id = "legacy-" + date;
            var at = DateTimeOffset.Parse(Field(fields, "At") as string, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind);
            return new Entry(date + "/" + id, (string)Field(fields, "Title"), (string)Field(fields, "Time"),
                at.ToUnixTimeMilliseconds(), Convert.ToInt32(Field(fields, "RemindMinutes"), CultureInfo.InvariantCulture),
                Convert.ToBoolean(Field(fields, "Done"), CultureInfo.InvariantCulture),
                Convert.ToBoolean(Field(fields, "Important"), CultureInfo.InvariantCulture),
                legacy || !String.IsNullOrEmpty(Field(fields, "IdeaId") as string));
        }

        static Map Result(Change change, string status, string message = "")
        {
            return new Map { {"token", change.Token}, {"status", status}, {"message", message} };
        }

        internal Map Apply(Change change)
        {
            try
            {
                var day = invoke(new Map { {"op", "get_day"}, {"date", change.Key.Substring(0, 10)} });
                if (!Wire.Boolean(day, "ok")) return Result(change, "retry", Wire.Text(day, "error"));
                string date = change.Key.Substring(0, 10), id = change.Key.Substring(11);
                var record = Wire.Object(Wire.Value(Wire.Object(Wire.Value(day, "result")), "record"));
                var appointmentList = Field(record, "Appointments") as object[];
                object oldAppointment = Field(record, "Appointment");
                if (appointmentList == null) appointmentList = oldAppointment == null ? new object[0] : new[] { oldAppointment };
                Entry current = appointmentList.Select(item => ParseDesktop(date, Wire.Object(item)))
                    .SingleOrDefault(item => item.Key == change.Key);
                if (Entry.Same(current, change.Value)) return Result(change, "applied");
                if ((current != null && current.Locked) || (change.Base != null && change.Base.Locked))
                    return Result(change, "conflict", "Linked and legacy events can only be changed on Windows.");
                if (!Entry.Same(current, change.Base))
                    return Result(change, "conflict", "Windows changed this event. Review both versions.");
                var request = new Map { {"op", change.Value == null ? "delete_event" : "save_event"},
                    {"date", date}, {"id", id}, {"revision", Wire.Text(day, "revision")} };
                if (change.Value != null)
                {
                    Entry item = change.Value;
                    DateTimeOffset at = DateTimeOffset.FromUnixTimeMilliseconds(item.At).ToLocalTime();
                    if (at.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture) != item.Date ||
                        at.ToString("HH:mm", CultureInfo.InvariantCulture) != item.Time)
                        return Result(change, "conflict", "The event date/time differs in the Windows time zone.");
                    if (!item.Done && item.Minutes >= 0 && at.AddMinutes(-item.Minutes) <= DateTimeOffset.Now)
                        return Result(change, "conflict", "The reminder time passed. Edit the event or turn off its reminder.");
                    request["event"] = new Map { {"title", item.Title}, {"time", item.Time},
                        {"at", at.ToString("o", CultureInfo.InvariantCulture)}, {"remindMinutes", item.Minutes},
                        {"done", item.Done}, {"important", item.Important} };
                }
                var response = invoke(request);
                if (!Wire.Boolean(response, "ok")) return Result(change, "retry", Wire.Text(response, "error"));
                return Result(change, "applied");
            }
            catch (Exception error) { return Result(change, "retry", error.GetBaseException().Message); }
        }

        internal Map MergeJournal(Map payload)
        {
            var response=invoke(new Map {{"op","sync_journal"},{"payload",payload}});
            if(!Wire.Boolean(response,"ok"))throw new IOException(Wire.Text(response,"error"));
            var result=Wire.Object(response["result"]);
            if(Wire.Text(result,"status")=="complete")CompletedReviewId=Wire.Text(result,"reviewId");
            return result;
        }
        internal SyncAssets Assets {get{return new SyncAssets(Path.Combine(Path.GetDirectoryName(journal),"images"));}}
        internal object Inventory() {
            var response=invoke(new Map {{"op","sync_inventory"}});
            if(!Wire.Boolean(response,"ok"))throw new IOException(Wire.Text(response,"error"));
            return Wire.Array(response,"result").Select(id=>Convert.ToString(id)).Concat(Assets.Inventory()).Distinct().ToArray();
        }

    }

    internal static class SyncSession
    {
        internal static string Run(Stream bluetooth, DesktopJournal desktop,Func<Map,WifiTransferConnection> wifi=null,Action<string> progress=null,bool automatic=false)
        {
            // Validate the data source before any mutations, so an invalid snapshot can never be treated as an empty journal.
            desktop.Snapshot();
            var hello = Wire.Frame("hello"); hello["source"] = desktop.Source;hello["journalSync"]=2;hello["assetSync"]=2;
            hello["automatic"]=automatic;
            if(wifi!=null)hello["wifiSync"]=1;
            Wire.Send(bluetooth, hello);
            var incoming=Wire.Receive(bluetooth,null);
            if(Wire.Text(incoming,"type")=="wifi-offer"&&wifi!=null) {
                for(int attempt=0;attempt<2;attempt++) {
                    bool available=Wire.Boolean(incoming,"available");WifiTransferConnection connection=null;
                    if(available)try{if(progress!=null)progress(attempt==0?"正在检查局域网通道…":"正在连接手机临时 Wi-Fi…");connection=wifi(incoming);}
                    catch(Exception error){if(progress!=null)progress("Wi-Fi 未连接："+error.Message);}
                    bool direct=connection==null&&available&&attempt==0&&!automatic;
                    var choice=Wire.Frame("wifi-result");choice["use"]=connection!=null;choice["direct"]=direct;
                    if(connection!=null)using(connection) {
                        Wire.Send(bluetooth,choice);if(progress!=null)progress("已连接 Wi-Fi，正在同步原图与记录…");
                        return "Wi-Fi · "+Run(connection.Stream,desktop,null,progress,automatic);
                    }
                    Wire.Send(bluetooth,choice);
                    if(!direct)break;
                    incoming=Wire.Receive(bluetooth,"wifi-offer");
                }
                if(progress!=null)progress("Wi-Fi 不可用，继续使用蓝牙；只补传缺少的原图。");
                incoming=Wire.Receive(bluetooth,"changes");
            }
            if(Wire.Text(incoming,"type")!="changes")throw new InvalidDataException("Unsupported sync negotiation.");
            if(incoming.ContainsKey("assetSync")&&Convert.ToInt32(incoming["assetSync"])>=1) {
                var inventory=Wire.Frame("asset-inventory");inventory["ids"]=desktop.Inventory();Wire.Send(bluetooth,inventory);
            }
            if(incoming.ContainsKey("journalSync")&&Convert.ToInt32(incoming["journalSync"])==2)
                return JournalSyncTransfer.Run(bluetooth,desktop,progress,incoming.ContainsKey("assetSync")&&Convert.ToInt32(incoming["assetSync"])==2);
            List<Change> changes = Change.Parse(incoming);
            var results = new List<Map>();
            var elapsed = Stopwatch.StartNew();
            foreach (Change change in changes)
            {
                // Leave enough time for a final snapshot, and preserve pending items across the next exchange.
                if (elapsed.Elapsed.TotalSeconds > 90)
                    results.Add(new Map { {"token", change.Token}, {"status", "retry"}, {"message", "Sync the remaining changes again."} });
                else results.Add(desktop.Apply(change));
            }
            var entries = desktop.Snapshot();
            var snapshot = Wire.Frame("snapshot");
            snapshot["source"] = desktop.Source;
            snapshot["events"] = entries.Select(entry => entry.ToWire()).ToArray();
            snapshot["results"] = results.ToArray();
            Wire.Send(bluetooth, snapshot);
            if (Wire.Text(Wire.Receive(bluetooth, "ack"), "source") != desktop.Source)
                throw new InvalidDataException("Android did not confirm the matching data source.");
            int applied = results.Count(result => Wire.Text(result, "status") == "applied");
            int conflicts = results.Count(result => Wire.Text(result, "status") == "conflict");
            int retry = results.Count - applied - conflicts;
            if (CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "zh")
                return String.Format("旧版手机：仅共享日程双向同步。共 {0} 条，手机改动已写入 {1} 条，冲突 {2} 条，待重试 {3} 条。笔记、想法和手机本地日程尚未同步。", entries.Count, applied, conflicts, retry);
            return String.Format("Synced {0} events. Phone changes: {1} applied, {2} conflicts, {3} to retry.", entries.Count, applied, conflicts, retry);
        }
    }
}

