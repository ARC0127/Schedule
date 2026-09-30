using System;
using System.Collections;
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
        Console.WriteLine("Native models passed: URL validation, image-only dock, stale-write protection, reload and backup retention.");
        return 0;
    }
}
