using System;
using System.Collections;
using System.Collections.Generic;
using System.Reflection;
using System.IO;
using System.IO.Compression;
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
        var multiline = "• Diffusion \\(x\\)\n\\qquad\nflow matching\n• Second";
        var multilineState = json.DeserializeObject(json.Serialize(new {privateContent=new {edits=new Dictionary<string,object>{{"2026-01-01",new {body=multiline,ideas=new[]{new{id="multiline",offset=0,done=true},new{id="next",offset=multiline.IndexOf("• Second"),done=false}}}}}}}));
        var multilineIdeas = (IList)read.Invoke(null, new object[]{multilineState,"2026-01-01"});
        Check(multilineIdeas.Count == 2 && ((string)multilineIdeas[0].GetType().GetField("Text").GetValue(multilineIdeas[0])).Contains("flow matching"), "Dock truncated unindented continuation");
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
        var archive=assembly.GetType("JournalArchive");
        Func<string,MethodInfo> archiveMethod=name=>archive.GetMethod(name,BindingFlags.Static|BindingFlags.NonPublic);
        var snapshot=archiveMethod("Snapshot").Invoke(null,new object[]{"manual"});
        var snapshotId=(string)snapshot.GetType().GetProperty("id").GetValue(snapshot,null);
        var original=File.ReadAllText(file);
        var bundle=Path.Combine(profile,"portable.zip");
        archiveMethod("ExportBundle").Invoke(null,new object[]{bundle});
        var unpacked=(string)archiveMethod("ReadBundle").Invoke(null,new object[]{bundle});
        Check(unpacked==original,"Portable backup did not preserve the complete envelope");
        archiveMethod("Validate").Invoke(null,new object[]{unpacked});
        File.WriteAllText(file,original.Replace("Recovered","Temporary change"));load.Invoke(null,null);
        var preview=archiveMethod("Preview").Invoke(null,new object[]{snapshotId,null});
        var token=(string)preview.GetType().GetProperty("token").GetValue(preview,null);
        archiveMethod("Restore").Invoke(null,new object[]{token});
        Check(File.ReadAllText(file).Contains("Recovered")&&!File.ReadAllText(file).Contains("Temporary change"),"Restore did not recover snapshot");
        Check(Directory.GetFiles(Path.Combine(profile,"history"),"before-restore-*.json").Length==1,"Restore did not preserve current version");
        var retained=File.ReadAllText(file);bool badArchive=false;
        try{archiveMethod("Preview").Invoke(null,new object[]{null,"{\"WidgetState\":{\"privateContent\":{\"projects\":\"invalid\",\"edits\":{}}},\"Schedules\":{}}"});}catch(TargetInvocationException){badArchive=true;}
        Check(badArchive&&File.ReadAllText(file)==retained,"Malformed import changed journal");
        var set=assembly.GetType("WindowsReminders").GetMethod("SetSchedule",BindingFlags.Static|BindingFlags.NonPublic);
        Func<string,object> newEvent=title=>set.Invoke(null,new object[]{new Dictionary<string,object>{{"date","2035-01-01"},{"id",null},{"schedule",new{title=title,time="09:00",at="2035-01-01T09:00:00",remindMinutes=-1,important=false,done=false}}}});
        var event1=newEvent("First");var event2=newEvent("Second");
        var eventId1=(string)event1.GetType().GetProperty("Id").GetValue(event1,null);var eventId2=(string)event2.GetType().GetProperty("Id").GetValue(event2,null);
        Check(eventId1!=eventId2,"Event IDs collided");
        set.Invoke(null,new object[]{new Dictionary<string,object>{{"date","2035-01-01"},{"id",eventId1},{"schedule",null}}});
        var remaining=json.Deserialize<Dictionary<string,object>>(File.ReadAllText(file));
        Check(((Dictionary<string,object>)remaining["Schedules"]).Count==1,"Deleting one event affected another");
        var links=assembly.GetType("TaskLinks");
        var linkedStore=json.Deserialize("{\"WidgetState\":{\"privateContent\":{\"edits\":{\"2035-01-01\":{\"ideas\":[{\"id\":\"task\",\"done\":true}]}}}},\"Schedules\":{\"2035-01-02/link\":{\"Id\":\"link\",\"IdeaDate\":\"2035-01-01\",\"IdeaId\":\"task\",\"Done\":false}}}",assembly.GetType("Store"));
        var linkedSchedules=(IDictionary)linkedStore.GetType().GetField("Schedules").GetValue(linkedStore);
        var linkedEvent=linkedSchedules["2035-01-02/link"];
        var apply=links.GetMethod("Apply",BindingFlags.Static|BindingFlags.NonPublic);
        Check(((IList)apply.Invoke(null,new[]{linkedStore})).Count==1,"Cross-day linked schedule was not synchronized");
        Check((bool)linkedEvent.GetType().GetProperty("Done").GetValue(linkedEvent,null),"Idea completion was not authoritative");
        Check(((IList)apply.Invoke(null,new[]{linkedStore})).Count==0,"Unchanged linked schedules should not be rescheduled");
        linkedEvent.GetType().GetProperty("Done").SetValue(linkedEvent,false,null);
        bool rejectedCompletion=false;
        try {links.GetMethod("Validate",BindingFlags.Static|BindingFlags.NonPublic).Invoke(null,new[]{linkedStore,linkedEvent});}
        catch(TargetInvocationException e){rejectedCompletion=e.InnerException is ArgumentException;}
        Check(rejectedCompletion,"Linked event overwrote idea completion");
        linkedEvent.GetType().GetProperty("IdeaId").SetValue(linkedEvent,"missing",null);
        apply.Invoke(null,new[]{linkedStore});
        Check(linkedEvent.GetType().GetProperty("IdeaId").GetValue(linkedEvent,null)==null&&linkedSchedules.Count==1,"Missing idea should detach, not delete, its event");
        var markdown=Path.Combine(profile,"markdown.zip");
        var markdownRequest=new Dictionary<string,object>{{"documents",new[]{new Dictionary<string,object>{{"name","2026-10-01.md"},{"text","# Example\n![image](images/a.png)\n\\(x_\\tau\\)"}}}},{"images",new[]{new Dictionary<string,object>{{"name","a.png"},{"base64","AAEC"}}}}};
        archiveMethod("ExportMarkdown").Invoke(null,new object[]{markdown,markdownRequest});
        using(var zip=ZipFile.OpenRead(markdown)){
            using(var reader=new StreamReader(zip.GetEntry("2026-10-01.md").Open()))Check(reader.ReadToEnd().Contains("\\(x_\\tau\\)"),"Markdown export changed TeX");
            using(var stream=zip.GetEntry("images/a.png").Open())Check(stream.ReadByte()==0&&stream.ReadByte()==1&&stream.ReadByte()==2,"Image bytes changed in Markdown ZIP");
        }
        var mdDir=Path.Combine(profile,"markdown-import");Directory.CreateDirectory(Path.Combine(mdDir,"images"));
        File.WriteAllBytes(Path.Combine(mdDir,"images/a.png"),new byte[]{0,1,2});
        var mdFile=Path.Combine(mdDir,"entry.md");File.WriteAllText(mdFile,"![valid](images/a.png)\n![outside](../outside.png)\n\\(x\\)");
        var md=archiveMethod("ReadMarkdown").Invoke(null,new object[]{mdFile});
        Check(((IList)md.GetType().GetProperty("images").GetValue(md,null)).Count==1,"Markdown import did not enforce local image directory");
        Console.WriteLine("Native models passed: existing storage/MSIX regressions; complete ZIP roundtrip, snapshot preview/restore, pre-restore copy, invalid import rejection and independent multiple events.");
        return 0;
    }
}
