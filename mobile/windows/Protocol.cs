using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using Map = System.Collections.Generic.Dictionary<string, object>;

namespace ScheduleSync
{
    internal static class Wire
    {
        const int MaxFrame = 4 * 1024 * 1024;
        internal const int MaxEvents = 10000, MaxChanges = 100;
        static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer
        {
            MaxJsonLength = 100 * 1024 * 1024,
            RecursionLimit = 64
        };

        internal static Map Frame(string type)
        {
            return new Map { {"v", 1}, {"type", type} };
        }

        internal static void Send(Stream stream, Map message)
        {
            byte[] bytes = Utf8.GetBytes(Json.Serialize(message));
            if (bytes.Length > MaxFrame) throw new IOException("Sync message exceeds 4 MiB.");
            var size = new byte[] { (byte)(bytes.Length >> 24), (byte)(bytes.Length >> 16), (byte)(bytes.Length >> 8), (byte)bytes.Length };
            stream.Write(size, 0, size.Length);
            stream.Write(bytes, 0, bytes.Length);
            stream.Flush();
        }

        internal static Map Receive(Stream stream, string type)
        {
            byte[] header = ReadExactly(stream, 4);
            int size = (header[0] << 24) | (header[1] << 16) | (header[2] << 8) | header[3];
            if (size < 2 || size > MaxFrame) throw new InvalidDataException("Invalid frame size.");
            var message = Object(Json.DeserializeObject(Utf8.GetString(ReadExactly(stream, size))));
            if (Number(message, "v") != 1 || Text(message, "type") != type)
                throw new InvalidDataException("Unsupported Schedule sync protocol.");
            return message;
        }

        static byte[] ReadExactly(Stream stream, int size)
        {
            var bytes = new byte[size];
            for (int used = 0; used < size;)
            {
                int count = stream.Read(bytes, used, size - used);
                if (count == 0) throw new EndOfStreamException("Bluetooth disconnected.");
                used += count;
            }
            return bytes;
        }

        internal static Map Object(object value)
        {
            var map = value as Map;
            if (map == null) throw new InvalidDataException("Expected a JSON object.");
            return map;
        }

        internal static object[] Array(Map map, string key)
        {
            var array = Value(map, key) as object[];
            if (array == null) throw new InvalidDataException("Invalid " + key + ".");
            return array;
        }

        internal static object Value(Map map, string name)
        {
            object value;
            if (!map.TryGetValue(name, out value)) throw new InvalidDataException("Missing " + name + ".");
            return value;
        }

        internal static string Text(Map map, string name)
        {
            var text = Value(map, name) as string;
            if (text == null) throw new InvalidDataException("Invalid " + name + ".");
            return text;
        }

        internal static long Number(Map map, string name)
        {
            object value = Value(map, name);
            if (value is int || value is long) return Convert.ToInt64(value);
            throw new InvalidDataException("Invalid " + name + ".");
        }

        internal static bool Boolean(Map map, string name)
        {
            object value = Value(map, name);
            if (value is bool) return (bool)value;
            throw new InvalidDataException("Invalid " + name + ".");
        }

        internal static string Key(string key)
        {
            DateTime day;
            if (!Regex.IsMatch(key, @"\A\d{4}-\d{2}-\d{2}/[a-zA-Z0-9-]{1,80}\z")
                || !DateTime.TryParseExact(key.Substring(0, 10), "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out day)
                || day.Year < 1900 || day.Year > 2200)
                throw new InvalidDataException("Invalid event identity.");
            return key;
        }
    }

    internal sealed class Entry
    {
        internal readonly string Key, Title, Time;
        internal readonly long At;
        internal readonly int Minutes;
        internal readonly bool Done, Important, Locked;

        internal Entry(string key, string title, string time, long at, int minutes, bool done, bool important, bool locked)
        {
            Key = Wire.Key(key);
            DateTime parsed;
            if (String.IsNullOrWhiteSpace(title) || title.Length > 100
                || !DateTime.TryParseExact(time, "HH:mm", CultureInfo.InvariantCulture, DateTimeStyles.None, out parsed)
                || at < -2208988800000L || at > 7289654399999L || !new[] {-1, 0, 5, 15, 30, 60}.Contains(minutes))
                throw new InvalidDataException("Invalid event " + key + ".");
            Title = title; Time = time; At = at; Minutes = minutes; Done = done; Important = important; Locked = locked;
        }

        internal static Entry FromWire(object value)
        {
            if (value == null) return null;
            Map map = Wire.Object(value);
            return new Entry(Wire.Text(map, "key"), Wire.Text(map, "title"), Wire.Text(map, "time"),
                Wire.Number(map, "at"), checked((int)Wire.Number(map, "minutes")), Wire.Boolean(map, "done"),
                Wire.Boolean(map, "important"), Wire.Boolean(map, "locked"));
        }

        internal static bool Same(Entry left, Entry right)
        {
            if (left == null || right == null) return left == right;
            return left.Key == right.Key && left.Title == right.Title && left.Time == right.Time
                && left.At == right.At && left.Minutes == right.Minutes && left.Done == right.Done
                && left.Important == right.Important && left.Locked == right.Locked;
        }

        internal Map ToWire()
        {
            return new Map { {"key", Key}, {"title", Title}, {"time", Time}, {"at", At}, {"minutes", Minutes},
                {"done", Done}, {"important", Important}, {"locked", Locked} };
        }

        internal string Date { get { return Key.Substring(0, 10); } }
        internal string Id { get { return Key.Substring(11); } }
    }

    internal sealed class Change
    {
        internal readonly string Key, Token;
        internal readonly Entry Base, Value;

        Change(Map item)
        {
            Key = Wire.Key(Wire.Text(item, "key"));
            Token = Wire.Text(item, "token");
            Guid token;
            Base = Entry.FromWire(Wire.Value(item, "base"));
            Value = Entry.FromWire(Wire.Value(item, "value"));
            if (!Guid.TryParseExact(Token, "D", out token)
                || (Base != null && Base.Key != Key)
                || (Value != null && (Value.Key != Key || Value.Locked))
                || (Base == null && (Value == null || !Key.Substring(11).StartsWith("android-", StringComparison.Ordinal))))
                throw new InvalidDataException("Invalid pending change.");
        }

        internal static List<Change> Parse(Map frame)
        {
            object[] items = Wire.Array(frame, "items");
            if (items.Length > Wire.MaxChanges) throw new InvalidDataException("Too many pending changes.");
            var result = new List<Change>(items.Length);
            var keys = new HashSet<string>(StringComparer.Ordinal);
            var tokens = new HashSet<string>(StringComparer.Ordinal);
            foreach (object item in items)
            {
                var change = new Change(Wire.Object(item));
                if (!keys.Add(change.Key) || !tokens.Add(change.Token)) throw new InvalidDataException("Duplicate change.");
                result.Add(change);
            }
            return result;
        }
    }

    static class ArrayHelpers
    {
        internal static bool Contains(this int[] values, int value) { return System.Array.IndexOf(values, value) >= 0; }
    }
}

