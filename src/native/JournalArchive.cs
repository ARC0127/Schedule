using System;
using System.Collections;
using System.Collections.Generic;
using System.IO;
using System.IO.Compression;
using System.Linq;
using System.Text;
using System.Windows.Forms;

// Snapshots use the complete store, including embedded images. Linked files stay in place.
internal static class JournalArchive
{
    static string Folder { get { return Path.Combine(Program.DataDir,"history"); } }
    static string pendingText;
    static string pendingId;
    internal static void Daily(string text)
    {
        Directory.CreateDirectory(Folder);
        string path=Path.Combine(Folder,"daily-"+DateTime.Now.ToString("yyyy-MM-dd")+".json");
        if(!File.Exists(path)) WriteNew(path,text);
        foreach(var old in new DirectoryInfo(Folder).GetFiles("daily-*.json").OrderByDescending(f=>f.Name).Skip(30))old.Delete();
    }
    static void WriteNew(string path,string text)
    {
        string tmp=path+".tmp";File.WriteAllText(tmp,text,new UTF8Encoding(false));File.Move(tmp,path);
    }
    internal static object Snapshot(string reason)
    {
        Directory.CreateDirectory(Folder);
        string id=reason+"-"+DateTime.Now.ToString("yyyyMMdd-HHmmss-fff")+"-"+Guid.NewGuid().ToString("N").Substring(0,6)+".json";
        WriteNew(Path.Combine(Folder,id),File.ReadAllText(Program.StateFile,Encoding.UTF8));
        return new {id=id};
    }
    internal static object List()
    {
        Directory.CreateDirectory(Folder);
        return new DirectoryInfo(Folder).GetFiles("*.json").OrderByDescending(f=>f.LastWriteTimeUtc)
            .Select(f=>new{id=f.Name,at=f.LastWriteTime.ToString("yyyy-MM-dd HH:mm:ss"),bytes=f.Length}).ToArray();
    }
    static string HistoryFile(string id)
    {
        if(String.IsNullOrEmpty(id)||id!=Path.GetFileName(id)||!id.EndsWith(".json",StringComparison.Ordinal))throw new ArgumentException("无效的备份标识。");
        return Path.Combine(Folder,id);
    }
    internal static Store Validate(string text)
    {
        var root=Program.Json.Deserialize<Dictionary<string,object>>(text);
        if(root==null||!root.ContainsKey("WidgetState")||!root.ContainsKey("Schedules"))throw new InvalidDataException("不是完整的 Schedule 备份。");
        var store=Program.Json.Deserialize<Store>(text);
        if(store.Schedules==null)throw new InvalidDataException("日程数据无效。");
        var widget=store.WidgetState as Dictionary<string,object>;
        if(widget!=null) {
            var pc=widget.ContainsKey("privateContent")?widget["privateContent"] as Dictionary<string,object>:null;
            if(pc==null||!pc.ContainsKey("edits")||!(pc["edits"] is Dictionary<string,object>)||!pc.ContainsKey("projects")||!(pc["projects"] is IList))throw new InvalidDataException("日志数据结构无效。");
            var projectIds=new HashSet<string>();
            foreach(var value in (IList)pc["projects"]) {
                var project=value as Dictionary<string,object>;
                if(project==null||!project.ContainsKey("id")||!(project["id"] is string)||!projectIds.Add((string)project["id"])||!project.ContainsKey("name")||!(project["name"] is string)||!project.ContainsKey("root")||!(project["root"] is string))throw new InvalidDataException("备份中的项目无效或标识重复。");
            }
            foreach(var p in (Dictionary<string,object>)pc["edits"]) {
                DateTime date;var r=p.Value as Dictionary<string,object>;
                if(!DateTime.TryParseExact(p.Key,"yyyy-MM-dd",null,System.Globalization.DateTimeStyles.None,out date)||r==null||!r.ContainsKey("body")||!(r["body"] is string)||!r.ContainsKey("files")||!(r["files"] is IList))throw new InvalidDataException("备份包含无法读取的日期记录。");
                foreach(var file in (IList)r["files"])if(!(file is Dictionary<string,object>))throw new InvalidDataException("备份中的关联资料无效。");
            }
            if(widget.ContainsKey("nativeImages")) {
                var images=widget["nativeImages"] as IList;if(images==null)throw new InvalidDataException("备份图片索引无效。");
                var tokens=new HashSet<string>();
                foreach(var value in images) {
                    var pair=value as IList;
                    if(pair==null||pair.Count!=2||!(pair[0] is string)||!tokens.Add((string)pair[0])||!(pair[1] is Dictionary<string,object>))throw new InvalidDataException("备份图片条目无效。");
                }
            }
        }
        foreach(var pair in store.Schedules) {
            var s=pair.Value;if(s==null)throw new InvalidDataException("日程数据无效。");
            if(String.IsNullOrEmpty(s.Date))s.Date=pair.Key.Split('/')[0];
            if(String.IsNullOrEmpty(s.Id))s.Id="legacy-"+s.Date;
            DateTime date;if(!DateTime.TryParseExact(s.Date,"yyyy-MM-dd",null,System.Globalization.DateTimeStyles.None,out date))throw new InvalidDataException("日程日期无效。");
        }
        return store;
    }
    static Dictionary<string,object> Edits(Store store)
    {
        var widget=store.WidgetState as Dictionary<string,object>;
        if(widget==null)return new Dictionary<string,object>();
        var pc=(Dictionary<string,object>)widget["privateContent"];
        return (Dictionary<string,object>)pc["edits"];
    }
    internal static object Preview(string id,string text=null)
    {
        var raw=text??File.ReadAllText(HistoryFile(id),Encoding.UTF8);var next=Validate(raw);
        var before=Edits(Program.Data);var after=Edits(next);
        var dates=before.Keys.Union(after.Keys).OrderByDescending(d=>d).Select(d=>new {
            date=d, status=!before.ContainsKey(d)?"新增":!after.ContainsKey(d)?"移除":Program.Json.Serialize(before[d])==Program.Json.Serialize(after[d])?"相同":"修改",
            before=before.ContainsKey(d)?before[d]:null, after=after.ContainsKey(d)?after[d]:null
        }).Where(d=>d.status!="相同").ToArray();
        pendingText=raw;pendingId=Guid.NewGuid().ToString("N");
        return new{token=pendingId,dates=dates,schedulesBefore=Program.Data.Schedules.Count,schedulesAfter=next.Schedules.Count,recordsBefore=before.Count,recordsAfter=after.Count,projectsBefore=ProjectNames(Program.Data),projectsAfter=ProjectNames(next),eventsBefore=Program.Data.Schedules.Values.Select(s=>(s.Date??"")+" "+s.Time+" "+s.Title).ToArray(),eventsAfter=next.Schedules.Values.Select(s=>s.Date+" "+s.Time+" "+s.Title).ToArray()};
    }
    static string[] ProjectNames(Store store)
    {
        var widget=store.WidgetState as Dictionary<string,object>;if(widget==null)return new string[0];
        var pc=(Dictionary<string,object>)widget["privateContent"];
        return ((IEnumerable)pc["projects"]).Cast<Dictionary<string,object>>().Select(p=>Convert.ToString(p["name"])).ToArray();
    }
    internal static object Restore(string token)
    {
        if(token!=pendingId||pendingText==null)throw new InvalidOperationException("请先预览要恢复的备份。");
        var next=Validate(pendingText);string warning=Program.Restore(next);pendingText=null;pendingId=null;
        return new{restored=true,warning=warning};
    }
    internal static string ReadBundle(string path)
    {
        using(var zip=ZipFile.OpenRead(path)) {
            var entry=zip.GetEntry("journal.json");
            if(entry==null||entry.Length>100L*1024*1024)throw new InvalidDataException("备份包缺少有效的 journal.json。");
            using(var reader=new StreamReader(entry.Open(),Encoding.UTF8))return reader.ReadToEnd();
        }
    }
    internal static object PickImport()
    {
        using(var dialog=new OpenFileDialog{Title="导入完整备份",Filter="Schedule 备份 (*.zip;*.json)|*.zip;*.json"}) {
            if(dialog.ShowDialog(Program.Window)!=DialogResult.OK)return new{cancelled=true};
            string text=Path.GetExtension(dialog.FileName).Equals(".zip",StringComparison.OrdinalIgnoreCase)?ReadBundle(dialog.FileName):File.ReadAllText(dialog.FileName,Encoding.UTF8);
            return Preview(null,text);
        }
    }
    internal static void ExportBundle(string path)
    {
        using(var stream=new FileStream(path,FileMode.Create,FileAccess.Write))
        using(var zip=new ZipArchive(stream,ZipArchiveMode.Create)) {
            using(var writer=new StreamWriter(zip.CreateEntry("journal.json").Open(),new UTF8Encoding(false)))writer.Write(File.ReadAllText(Program.StateFile,Encoding.UTF8));
            using(var writer=new StreamWriter(zip.CreateEntry("README.txt").Open(),new UTF8Encoding(false)))writer.Write("Schedule complete backup. Embedded images, projects, ideas, styles and schedules are included. Linked files remain at their original paths. Import using Schedule > Data > Import backup.");
        }
    }
    internal static object Export(Dictionary<string,object> request)
    {
        bool markdown=Convert.ToString(request["format"])=="markdown";
        using(var dialog=new SaveFileDialog{Title=markdown?"导出 Markdown 与图片":"导出完整备份",Filter="ZIP 文件 (*.zip)|*.zip",FileName="Schedule-"+DateTime.Now.ToString("yyyyMMdd")+(markdown?"-markdown":"-backup")+".zip"}) {
            if(dialog.ShowDialog(Program.Window)!=DialogResult.OK)return new{cancelled=true};
            if(!markdown)ExportBundle(dialog.FileName);
            else ExportMarkdown(dialog.FileName,request);
            return new{path=dialog.FileName};
        }
    }
    internal static void ExportMarkdown(string path,Dictionary<string,object> request)
    {
            using(var stream=new FileStream(path,FileMode.Create,FileAccess.Write))using(var zip=new ZipArchive(stream,ZipArchiveMode.Create)) {
                foreach(Dictionary<string,object> doc in (IEnumerable)request["documents"]) {
                    string name=Convert.ToString(doc["name"]);
                    if(name!=Path.GetFileName(name)||!name.EndsWith(".md"))throw new ArgumentException("无效的导出文件名。");
                    using(var writer=new StreamWriter(zip.CreateEntry(name).Open(),new UTF8Encoding(false)))writer.Write(Convert.ToString(doc["text"]));
                }
                foreach(Dictionary<string,object> img in (IEnumerable)request["images"]) {
                    string name=Convert.ToString(img["name"]);
                    if(name!=Path.GetFileName(name))throw new ArgumentException("无效的图片文件名。");
                    using(var output=zip.CreateEntry("images/"+name).Open()) {var bytes=Convert.FromBase64String(Convert.ToString(img["base64"]));output.Write(bytes,0,bytes.Length);}
                }
            }
    }
    internal static object PickMarkdown()
    {
        using(var dialog=new OpenFileDialog{Title="导入 Markdown 到选中日期",Filter="Markdown (*.md)|*.md"}) {
            if(dialog.ShowDialog(Program.Window)!=DialogResult.OK)return new{cancelled=true};
            return ReadMarkdown(dialog.FileName);
        }
    }
    internal static object ReadMarkdown(string path)
    {
            if(new FileInfo(path).Length>2*1024*1024)throw new InvalidDataException("Markdown 文件超过 2 MB。");
            string text=File.ReadAllText(path,Encoding.UTF8);
            var images=new List<object>();
            string folder=Path.GetFullPath(Path.GetDirectoryName(path))+Path.DirectorySeparatorChar;
            foreach(System.Text.RegularExpressions.Match match in System.Text.RegularExpressions.Regex.Matches(text,@"!\[[^\]]*\]\(([^)]+)\)")) {
                string relative=Uri.UnescapeDataString(match.Groups[1].Value);
                if(Path.IsPathRooted(relative)||relative.Contains(":"))continue;
                string image=Path.GetFullPath(Path.Combine(folder,relative));
                if(!image.StartsWith(folder,StringComparison.OrdinalIgnoreCase))continue;
                string extension=Path.GetExtension(image).ToLowerInvariant();
                if(!new[]{".png",".jpg",".jpeg",".gif",".webp",".bmp",".avif"}.Contains(extension))continue;
                if(!File.Exists(image))throw new FileNotFoundException("Markdown 图片不存在："+relative);
                if(new FileInfo(image).Length>20*1024*1024)throw new InvalidDataException("Markdown 图片超过 20 MB。");
                images.Add(new{markdown=match.Value,name=Path.GetFileName(image),src="data:image/"+(extension==".jpg"?"jpeg":extension.Substring(1))+";base64,"+Convert.ToBase64String(File.ReadAllBytes(image))});
            }
            return new{text=text,name=Path.GetFileNameWithoutExtension(path),images=images};
    }
}
