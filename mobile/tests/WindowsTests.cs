using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Globalization;
using System.IO;
using System.Linq;
using Map = System.Collections.Generic.Dictionary<string, object>;

namespace ScheduleSync
{
    internal static class WindowsTests
    {
        const string Date = "2034-03-10";
        const string Key = Date + "/android-7ef6a4b8";
        static readonly string Token = "da758db3-6747-4499-a5e8-b72a4ac850dc";
        static Entry current;
        static int writes;
        static string folder;
        static int checks;

        static void Check(bool condition, string name)
        {
            if (!condition) throw new Exception("FAIL " + name);
            ++checks;
            Console.WriteLine("PASS " + name);
        }

        static object Desktop(Entry entry)
        {
            var at = DateTimeOffset.FromUnixTimeMilliseconds(entry.At).ToLocalTime();
            return new Map { {"Id", entry.Id}, {"Title", entry.Title}, {"Time", entry.Time},
                {"At", at.ToString("o", CultureInfo.InvariantCulture)}, {"RemindMinutes", entry.Minutes},
                {"Done", entry.Done}, {"Important", entry.Important}, {"IdeaId", entry.Locked ? "fixture-idea" : null} };
        }

        static void Persist()
        {
            var items = new Map();
            if (current != null) items[current.Key] = Desktop(current);
            File.WriteAllText(Path.Combine(folder, "journal.json"), Wire.Json.Serialize(new Map { {"Schedules", items} }));
        }

        static Map Cli(Map request)
        {
            string op = Wire.Text(request, "op");
            if (op == "get_day") return new Map { {"ok", true}, {"revision", writes.ToString()}, {"result", new Map {
                {"record", new Map { {"appointments", current == null ? new object[0] : new[] {Desktop(current)}} }}
            }} };
            if (Wire.Text(request, "revision") != writes.ToString()) return new Map { {"ok", false}, {"error", "CONFLICT"} };
            writes++;
            current = op == "delete_event" ? null : DesktopJournal.ParseDesktop(Date,
                new Map(Wire.Object(request["event"])) { {"Id", Wire.Text(request, "id")} });
            Persist();
            return new Map { {"ok", true} };
        }

        static Map Pending(Entry baseline, Entry desired)
        {
            return new Map { {"key", Key}, {"token", Token}, {"base", baseline == null ? null : baseline.ToWire()},
                {"value", desired == null ? null : desired.ToWire()} };
        }

        static string Merge(DesktopJournal repo, Entry baseline, Entry desired)
        {
            var changes = Wire.Frame("changes");
            changes["items"] = new object[] { Pending(baseline, desired) };
            var ack = Wire.Frame("ack"); ack["source"] = repo.Source;
            using (var stream = new ScriptedLink(changes, ack))
            {
                SyncSession.Run(stream, repo);
                stream.Sent.Position = 0;
                Check(Wire.Text(Wire.Receive(stream.Sent, "hello"), "source") == repo.Source, "source in hello");
                var snapshot = Wire.Receive(stream.Sent, "snapshot");
                Check(Wire.Array(snapshot, "events").Length == (current == null ? 0 : 1), "final full snapshot");
                return Wire.Text(Wire.Object(Wire.Array(snapshot, "results")[0]), "status");
            }
        }

        static int Main(string[] args)
        {
            try
            {
                if (args.Length == 2 && args[0] == "--read-only")
                {
                    var repo = new DesktopJournal(args[1], null);
                    Console.WriteLine("Read-only validation: {0} projected entries.", repo.Snapshot().Count);
                    return 0;
                }
                folder = Path.Combine(Environment.CurrentDirectory, "schedule-fixture-" + Guid.NewGuid().ToString("N"));
                Directory.CreateDirectory(folder);
                Persist();
                var desktop = new DesktopJournal(Path.Combine(folder, "journal.json"), null, Cli);
                long time = new DateTimeOffset(new DateTime(2034, 3, 10, 12, 30, 0)).ToUnixTimeMilliseconds();
                var phone = new Entry(Key, "合成测试 Ω", "12:30", time, 15, false, true, false);
                var changed = new Entry(Key, "changed", "12:30", time, 5, false, true, false);
                Check(Merge(desktop, null, phone) == "applied" && writes == 1 && Entry.Same(phone, current), "create through revision-aware API");
                Check(Merge(desktop, null, phone) == "applied" && writes == 1, "reconnect after lost acknowledgement is idempotent");
                Check(Merge(desktop, phone, changed) == "applied" && writes == 2 && Entry.Same(changed, current), "update with stable identity");
                Check(Merge(desktop, phone, null) == "conflict" && writes == 2 && Entry.Same(changed, current), "stale delete preserves Windows");
                Check(Merge(desktop, changed, null) == "applied" && writes == 3 && current == null, "delete propagates in full snapshot");
                Check(Merge(desktop, changed, null) == "applied" && writes == 3, "delete replay is idempotent");
                var legacy = DesktopJournal.ParseDesktop(Date, new Map(Wire.Object(Desktop(phone))) { {"IdeaDate", Date} }, Date);
                Check(legacy.Locked, "legacy entry is visible and locked");
                var bad = Wire.Frame("changes");
                bad["items"] = new object[] { Pending(null, phone), Pending(null, changed) };
                try { Change.Parse(bad); throw new Exception("Duplicate accepted"); }
                catch (InvalidDataException) { Check(true, "duplicate keys/tokens rejected"); }
                using (var bytes = new MemoryStream(new byte[] { 0, 0, 0, 6, 123 }))
                {
                    try { Wire.Receive(bytes, "changes"); throw new Exception("Truncation accepted"); }
                    catch (EndOfStreamException) { Check(true, "truncated stream rejected"); }
                }
                byte[] address = Rfcomm.Endpoint(0x001122334455UL);
                Check(address.Length == 30 && address[0] == 32 && address[2] == 0x55 &&
                    address[7] == 0 && address.Skip(10).Take(16).SequenceEqual(Rfcomm.Service.ToByteArray()) &&
                    address.Skip(26).All(b => b == 0), "native RFCOMM service endpoint layout");
                Rfcomm.Probe();
                Check(true, "Windows authenticated/encrypted AF_BTH RFCOMM socket opens");
                var devices = Rfcomm.PairedDevices();
                Console.WriteLine("Paired classic devices: " + devices.Count);
                Console.WriteLine("TOTAL " + checks);
                return 0;
            }
            catch (Exception error) { Console.Error.WriteLine(error); return 1; }
        }

        private sealed class ScriptedLink : Stream
        {
            readonly MemoryStream incoming = new MemoryStream();
            internal readonly MemoryStream Sent = new MemoryStream();

            internal ScriptedLink(params Map[] frames)
            {
                foreach (var frame in frames) Wire.Send(incoming, frame);
                incoming.Position = 0;
            }
            public override int Read(byte[] data, int offset, int count) { return incoming.Read(data, offset, Math.Min(3, count)); }
            public override void Write(byte[] data, int offset, int count) { Sent.Write(data, offset, count); }
            protected override void Dispose(bool disposing) { incoming.Dispose(); Sent.Dispose(); base.Dispose(disposing); }
            public override bool CanRead { get { return true; } }
            public override bool CanWrite { get { return true; } }
            public override bool CanSeek { get { return false; } }
            public override void Flush() {}
            public override long Length { get { throw new NotSupportedException(); } }
            public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }
            public override long Seek(long offset, SeekOrigin origin) { throw new NotSupportedException(); }
            public override void SetLength(long value) { throw new NotSupportedException(); }
        }
    }
}

