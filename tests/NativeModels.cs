using System;
using System.Collections;
using System.Reflection;
using System.Web.Script.Serialization;

internal static class NativeModels
{
    static void Check(bool value, string message) { if (!value) throw new Exception(message); }
    static int Main(string[] args)
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
        Console.WriteLine("Native models passed: HTTP/S validation and image-only dock idea.");
        return 0;
    }
}
