using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.IO;
using System.Web.Script.Serialization;

internal static class NativeModels
{
    static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    static int Main(string[] args)
    {
        try { return Run(args); }
        catch (Exception e) {
            Console.Error.WriteLine(e.GetType().FullName + ": " + e.Message);
            if (e.InnerException != null) Console.Error.WriteLine(e.InnerException.GetType().FullName + ": " + e.InnerException.Message);
            return 1;
        }
    }
    static int Run(string[] args)
    {
        var assembly = Assembly.LoadFrom(args[0]);
        var parse = assembly.GetType("ExternalLinks").GetMethod("Parse", BindingFlags.Static | BindingFlags.NonPublic);
        foreach (var input in new[] { "https://example.com/docs?q=1&b=2", "http://localhost:8000/a", "https://example.com/中文" })
            Check(((Uri)parse.Invoke(null, new object[] { input })).Scheme.StartsWith("http"), "Valid HTTP URL rejected");
        foreach (var input in new[] { "javascript:alert(1)", "file:///C:/Windows/notepad.exe", "ms-settings:notifications", "https://", "https://example.com/\r\n" }) {
            bool rejected = false;
            try { parse.Invoke(null, new object[] { input }); }
            catch (TargetInvocationException e) { rejected = e.InnerException is ArgumentException; }
            Check(rejected, "Non-web or malformed URI accepted");
        }
        var json = new JavaScriptSerializer();
        var state = json.DeserializeObject("{\"privateContent\":{\"edits\":{\"2026-01-01\":{\"body\":\"• \\ue000\",\"ideas\":[{\"id\":\"image\",\"offset\":0,\"done\":true}]}}}}");
        var read = assembly.GetType("DockWindow").GetMethod("ReadIdeas", BindingFlags.Static | BindingFlags.NonPublic);
        var ideas = (IList)read.Invoke(null, new object[] { state, "2026-01-01" });
        Check(ideas.Count == 1, "Image-only idea missing from dock");
        Check((string)ideas[0].GetType().GetField("Text").GetValue(ideas[0]) == "[图片]", "Dock image placeholder missing");
        var profile = Environment.GetEnvironmentVariable("SCHEDULE_TEST_DATA");
        Check(!String.IsNullOrEmpty(profile), "Storage tests require an isolated profile");
        var file = Path.Combine(profile, "journal.json");
        var program = assembly.GetType("Program");
        var load = program.GetMethod("Load", BindingFlags.Static | BindingFlags.NonPublic);
        var save = program.GetMethod("Save", BindingFlags.Static | BindingFlags.NonPublic);
        File.WriteAllText(file, "{\"WidgetState\":{\"privateContent\":{\"projects\":[],\"edits\":{}}},\"Schedules\":{}}");
        File.WriteAllText(file + ".bak", "previous backup");
        load.Invoke(null, null); save.Invoke(null, null);
        var backup = File.ReadAllText(file + ".bak");
        save.Invoke(null, null);
        Check(File.ReadAllText(file + ".bak") == backup, "No-op save must retain the previous backup");
        var changed = File.ReadAllText(file).Replace("\"projects\":[]", "\"projects\":[{\"id\":\"recovered\",\"name\":\"Recovered\",\"root\":\"\"}]");
        File.WriteAllText(file, changed);
        bool conflict = false;
        try { save.Invoke(null, null); } catch (TargetInvocationException e) { conflict = e.InnerException is IOException; }
        Check(conflict && File.ReadAllText(file) == changed, "Stale state overwrote recovered disk data");
        load.Invoke(null, null); save.Invoke(null, null);
        Check(File.ReadAllText(file).Contains("Recovered"), "Reload did not retain recovered project");
        var storage = assembly.GetType("StoragePaths");
        var defaultDir = (string)storage.GetProperty("DefaultDirectory", BindingFlags.Static | BindingFlags.NonPublic).GetValue(null, null);
        Check(defaultDir == Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile), ".schedule"), "Default data must be outside redirected AppData");
        var discover = storage.GetMethod("LegacyFiles", BindingFlags.Static | BindingFlags.NonPublic);
        var migrate = storage.GetMethod("MigrateLegacy", BindingFlags.Static | BindingFlags.NonPublic);
        var legacy = Path.Combine(profile, "legacy");
        var plain = Path.Combine(legacy, "CodexJournal", "journal.json");
        var redirected = Path.Combine(legacy, "Packages", "Example.Host_abc", "LocalCache", "Local", "CodexJournal", "journal.json");
        Directory.CreateDirectory(Path.GetDirectoryName(plain));
        Directory.CreateDirectory(Path.GetDirectoryName(redirected));
        var empty = "{\"WidgetState\":{\"privateContent\":{\"projects\":[],\"edits\":{}}},\"Schedules\":{}}";
        File.WriteAllText(plain, empty);
        // Migration copies the complete envelope, including inline images and unknown fields.
        var populated = changed.Replace("\"WidgetState\":{", "\"WidgetState\":{\"nativeImages\":[[\"token\",{\"src\":\"data:image/png;base64,AA==\"}]],");
        File.WriteAllText(redirected, populated);
        File.WriteAllText(redirected + ".bak", "older backup");
        var destination = Path.Combine(profile, "canonical");
        var candidates = discover.Invoke(null, new object[] { legacy });
        migrate.Invoke(null, new object[] { destination, candidates });
        var migrated = Path.Combine(destination, "journal.json");
        Check(File.ReadAllText(migrated) == populated, "Empty desktop state replaced populated MSIX state");
        Check(File.ReadAllText(plain) == empty && File.ReadAllText(redirected) == populated, "Migration modified source files");
        Check(Directory.GetFiles(Path.Combine(destination, "legacy-backups"), "*.json", SearchOption.AllDirectories).Length == 2, "Both legacy stores must be backed up");
        Check(Directory.GetFiles(Path.Combine(destination, "legacy-backups"), "*.bak", SearchOption.AllDirectories).Length == 1, "Legacy backup must be retained");
        File.WriteAllText(migrated, empty);
        migrate.Invoke(null, new object[] { destination, candidates });
        Check(File.ReadAllText(migrated) == empty, "Second startup resurrected old data");
        var conflictDestination = Path.Combine(profile, "conflicting");
        File.WriteAllText(plain, populated.Replace("Recovered", "Different"));
        bool migrationConflict = false;
        try { migrate.Invoke(null, new object[] { conflictDestination, candidates }); }
        catch (TargetInvocationException e) { migrationConflict = e.InnerException is IOException; }
        Check(migrationConflict && !File.Exists(Path.Combine(conflictDestination, "journal.json")), "Different populated histories must not be silently overwritten");
        File.WriteAllText(plain, populated);
        var identicalDestination = Path.Combine(profile, "identical");
        migrate.Invoke(null, new object[] { identicalDestination, candidates });
        Check(File.ReadAllText(Path.Combine(identicalDestination, "journal.json")) == populated, "Identical legacy views should migrate once");
        File.WriteAllText(plain, "{broken");
        var invalidDestination = Path.Combine(profile, "invalid");
        bool invalid = false;
        try { migrate.Invoke(null, new object[] { invalidDestination, candidates }); }
        catch (TargetInvocationException) { invalid = true; }
        Check(invalid && !File.Exists(Path.Combine(invalidDestination, "journal.json")), "Corrupt source was silently discarded");
        Check(Directory.GetFiles(Path.Combine(invalidDestination, "legacy-backups"), "*.json", SearchOption.AllDirectories).Length == 2, "Corrupt migration did not preserve originals");
        Console.WriteLine("Native models passed: URL/dock, stale-write/reload/backup, shared storage path, MSIX discovery, complete migration, idempotence, conflicts and corrupt-source preservation.");
        return 0;
    }
}
