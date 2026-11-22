using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Reflection;
using System.Web.Script.Serialization;

internal sealed class UpdatePlan {
    public string Target,Stage,Version;
    public int ProcessId;
    public long ProcessStarted;
    public string[] Files;
}
internal static class UpdateInstall {
    internal static string Within(string root,string name) {
        if(String.IsNullOrWhiteSpace(name)||name.Contains(":")||name.Contains("\\")||name.Split('/').Any(p=>p==".."||p=="."||p.TrimEnd(' ','.')!=p))throw new InvalidDataException("Invalid update path.");
        string full=Path.GetFullPath(Path.Combine(root,name));
        if(!full.StartsWith(Path.GetFullPath(root).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar,StringComparison.OrdinalIgnoreCase))throw new InvalidDataException("Update path escapes its directory.");return full;
    }
    internal static UpdatePlan Extract(string archive,string stage,string target,string version) {
        Directory.CreateDirectory(stage);var names=new HashSet<string>(StringComparer.OrdinalIgnoreCase);long total=0;
        using(var zip=ZipFile.OpenRead(archive))foreach(var entry in zip.Entries) {
            string name=entry.FullName;if(name.EndsWith("/"))continue;
            string path=Within(stage,name);Within(target,name);
            if(!names.Add(name)||names.Count>2048||(total+=entry.Length)>256L*1024*1024||((entry.ExternalAttributes>>16)&0xf000)==0xa000)throw new InvalidDataException("Invalid update archive.");
            if(name.Split('/').Any(p=>p.Equals(".schedule",StringComparison.OrdinalIgnoreCase))||new[]{"journal.json","auto-sync.json","events.json"}.Contains(Path.GetFileName(name).ToLowerInvariant()))throw new InvalidDataException("Update contains user data.");
            Directory.CreateDirectory(Path.GetDirectoryName(path));entry.ExtractToFile(path);
        }
        if(!names.Contains("Journal.exe")||!names.Contains("index.html")||!names.Contains("Schedule.Update.exe"))throw new InvalidDataException("Update is missing application files.");
        var actual=AssemblyName.GetAssemblyName(Path.Combine(stage,"Journal.exe")).Version;var expected=new Version(version);
        if(actual.Major!=expected.Major||actual.Minor!=expected.Minor||actual.Build!=expected.Build)throw new InvalidDataException("Update version mismatch.");
        return new UpdatePlan{Target=Path.GetFullPath(target),Stage=Path.GetFullPath(stage),Version=version,Files=names.OrderBy(n=>n,StringComparer.Ordinal).ToArray()};
    }
    internal static void Apply(UpdatePlan plan,string backup) {
        var touched=new List<string>();var existed=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        Directory.CreateDirectory(backup);
        try {
            foreach(string name in plan.Files) {
                string source=Within(plan.Stage,name),target=Within(plan.Target,name),saved=Within(backup,name);
                if((File.GetAttributes(source)&FileAttributes.ReparsePoint)!=0)throw new IOException("Update source is a link.");
                for(var parent=new DirectoryInfo(Path.GetDirectoryName(target));parent!=null&&parent.FullName.StartsWith(plan.Target,StringComparison.OrdinalIgnoreCase);parent=parent.Parent)
                    if(parent.Exists&&(parent.Attributes&FileAttributes.ReparsePoint)!=0)throw new IOException("Update destination contains a link.");
                if(File.Exists(target)){if((File.GetAttributes(target)&FileAttributes.ReparsePoint)!=0)throw new IOException("Update destination is a link.");Directory.CreateDirectory(Path.GetDirectoryName(saved));File.Copy(target,saved);existed.Add(name);}
                Directory.CreateDirectory(Path.GetDirectoryName(target));touched.Add(name);File.Copy(source,target,true);
            }
        }catch(Exception error) {
            var failures=new List<string>();
            foreach(string name in touched.AsEnumerable().Reverse())try {
                string target=Within(plan.Target,name);if(existed.Contains(name))File.Copy(Within(backup,name),target,true);else if(File.Exists(target))File.Delete(target);
            }catch(Exception restore){failures.Add(name+": "+restore.Message);}
            throw new IOException(failures.Count==0?"更新未完成，原程序已恢复。": "更新未完成，部分文件需要从备份恢复："+String.Join("; ",failures),error);
        }
    }
}
