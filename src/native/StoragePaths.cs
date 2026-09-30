using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text;

internal static class StoragePaths
{
    // AppData is redirected when a Win32 child inherits an MSIX host's context.
    // A user-profile directory outside AppData has the same view from both launchers.
    internal static string DefaultDirectory {
        get { return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".schedule"); }
    }

    internal static IEnumerable<string> LegacyFiles(string localAppData)
    {
        yield return Path.Combine(localAppData, "CodexJournal", "journal.json");
        var packages = Path.Combine(localAppData, "Packages");
        if (!Directory.Exists(packages)) yield break;
        foreach (var package in Directory.GetDirectories(packages).OrderBy(p => p, StringComparer.OrdinalIgnoreCase))
            yield return Path.Combine(package, "LocalCache", "Local", "CodexJournal", "journal.json");
    }

    static object Value(IDictionary<string,object> data, string key)
    {
        object value;
        return data != null && data.TryGetValue(key, out value) ? value : null;
    }
    static bool HasItems(object value) { var items = value as ICollection; return items != null && items.Count > 0; }
    static bool HasContent(string text)
    {
        var data = Program.Json.Deserialize<Store>(text);
        if (data == null || data.Schedules == null || data.Dock == null)
            throw new InvalidDataException("旧日志格式无法读取，原文件已保留。");
        var widget = data.WidgetState as IDictionary<string,object>;
        var content = Value(widget, "privateContent") as IDictionary<string,object>;
        return data.Schedules.Count > 0 || HasItems(Value(widget, "nativeImages")) ||
            HasItems(Value(content, "projects")) || HasItems(Value(content, "edits"));
    }

    internal static void MigrateLegacy(string destination, IEnumerable<string> legacyFiles)
    {
        var target = Path.Combine(destination, "journal.json");
        // Once migrated, legacy snapshots are archival only. Never resurrect old edits.
        if (File.Exists(target)) return;
        var sources = new List<KeyValuePair<string,string>>();
        foreach (var file in legacyFiles.Distinct(StringComparer.OrdinalIgnoreCase)) {
            string text;
            try { text = File.ReadAllText(file, Encoding.UTF8); }
            catch (FileNotFoundException) { continue; }
            catch (DirectoryNotFoundException) { continue; }
            sources.Add(new KeyValuePair<string,string>(file, text));
        }
        if (sources.Count == 0) return;
        Directory.CreateDirectory(destination);
        var backup = Path.Combine(destination, "legacy-backups", DateTime.UtcNow.ToString("yyyyMMdd-HHmmss") + "-" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(backup);
        var index = new StringBuilder();
        for (int i = 0; i < sources.Count; i++) {
            File.WriteAllText(Path.Combine(backup, i + ".json"), sources[i].Value, new UTF8Encoding(false));
            if (File.Exists(sources[i].Key + ".bak")) File.Copy(sources[i].Key + ".bak", Path.Combine(backup, i + ".json.bak"));
            index.AppendLine(i + ".json: " + sources[i].Key);
        }
        File.WriteAllText(Path.Combine(backup, "sources.txt"), index.ToString(), new UTF8Encoding(false));
        var populated = sources.Where(s => HasContent(s.Value)).ToList();
        var distinct = populated.Select(s => s.Value).Distinct(StringComparer.Ordinal).ToList();
        if (distinct.Count > 1)
            throw new IOException("发现多份不同的旧日志，未自动覆盖或合并。请先核对备份目录：" + backup + "，将确认的 journal.json 放入：" + destination);
        var selected = populated.Count > 0 ? populated[0] : sources[0];
        var temp = Path.Combine(destination, "journal.migrate.tmp");
        File.WriteAllText(temp, selected.Value, new UTF8Encoding(false));
        File.Move(temp, target);
    }
}
