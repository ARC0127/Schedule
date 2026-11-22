using System;
using System.IO;
using System.IO.Compression;
using System.Reflection;
using System.Collections.Generic;
using System.Security.Cryptography;
using Map=System.Collections.Generic.Dictionary<string,object>;
static class OriginalArchiveTests {
    static void Check(bool ok,string message){if(!ok)throw new Exception(message);Console.WriteLine("PASS "+message);}
    static int Main(string[] args){try{
        string root=args[1];Directory.CreateDirectory(root);Directory.CreateDirectory(Path.Combine(root,"images"));Environment.SetEnvironmentVariable("SCHEDULE_TEST_DATA",root);
        var image=File.ReadAllBytes(args[2]);string id;using(var sha=SHA256.Create())id=BitConverter.ToString(sha.ComputeHash(image)).Replace("-","").ToLowerInvariant()+".png";
        string original=Path.Combine(root,"images",id);File.WriteAllBytes(original,image);
        string text="{\"WidgetState\":{\"privateContent\":{\"edits\":{},\"projects\":[]},\"nativeImages\":[[\"\\uE000\",{\"src\":\"https://schedule-images.local/"+id+"\",\"name\":\"original.png\"}]]},\"Schedules\":{}}";
        File.WriteAllText(Path.Combine(root,"journal.json"),text);
        var assembly=Assembly.LoadFrom(args[0]);var archive=assembly.GetType("JournalArchive");
        Action<string,object[]> invoke=(name,values)=>archive.GetMethod(name,BindingFlags.NonPublic|BindingFlags.Static).Invoke(null,values);
        string zipPath=Path.Combine(root,"backup.zip");invoke("ExportBundle",new object[]{zipPath});
        using(var zip=ZipFile.OpenRead(zipPath)){using(var input=zip.GetEntry("images/"+id).Open())using(var m=new MemoryStream()){input.CopyTo(m);Check(Convert.ToBase64String(m.ToArray())==Convert.ToBase64String(image),"complete Windows backup contains exact external original");}}
        File.Delete(original);invoke("ReadBundle",new object[]{zipPath});Check(File.Exists(original)&&Convert.ToBase64String(File.ReadAllBytes(original))==Convert.ToBase64String(image),"backup import restores and verifies an absent original");
        var payload=new Map{{"documents",new object[]{new Map{{"name","day.md"},{"text","![original](images/original.png)"}}}},{"images",new object[]{new Map{{"name","original.png"},{"ref",id}}}}};
        string md=Path.Combine(root,"markdown.zip");invoke("ExportMarkdown",new object[]{md,payload});using(var zip=ZipFile.OpenRead(md))Check(zip.GetEntry("images/original.png").Length==image.Length,"Markdown export includes external original bytes");
        string bad=Path.Combine(root,"bad.zip");using(var f=File.Create(bad))using(var zip=new ZipArchive(f,ZipArchiveMode.Create)){using(var w=new StreamWriter(zip.CreateEntry("journal.json").Open()))w.Write(text);using(var w=zip.CreateEntry("images/"+id).Open())w.WriteByte(1);}
        bool rejected=false;try{invoke("ReadBundle",new object[]{bad});}catch(TargetInvocationException e){rejected=e.InnerException is InvalidDataException;}Check(rejected&&Convert.ToBase64String(File.ReadAllBytes(original))==Convert.ToBase64String(image),"corrupt archive is rejected without changing existing original");return 0;
    }catch(Exception e){Console.Error.WriteLine(e);return 1;}}
}
