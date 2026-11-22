using System;
using System.IO;
using System.IO.Compression;
using System.Collections.Generic;
using System.Security.Cryptography;
using Map=System.Collections.Generic.Dictionary<string,object>;
static class UpdateTests {
 static int count;
 static void Check(bool ok,string label){if(!ok)throw new Exception(label);count++;Console.WriteLine("PASS "+label);}
 static void Reject(Action action,string label){try{action();}catch(Exception){Check(true,label);return;}throw new Exception("Accepted: "+label);}
 static string Hash(byte[] data){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(data)).Replace("-","").ToLowerInvariant();}
 static Map Asset(string version){return new Map{{"name","Schedule-"+version+"-windows-x64.zip"},{"browser_download_url","https://github.com/ARC0127/Schedule/releases/download/v2.0.0/Schedule-"+version+"-windows-x64.zip"},{"size",3},{"digest","sha256:"+new string('a',64)}};}
 static string Release(Map asset,bool pre=false){return ReleaseUpdate.Json.Serialize(new Map{{"draft",false},{"prerelease",pre},{"tag_name","v2.0.0"},{"body","<script>untrusted notes</script>"},{"assets",new[]{asset}}});}
 static int Main(string[] args){try{Run(args);Console.WriteLine("Update assertions passed: "+count);return 0;}catch(Exception error){Console.Error.WriteLine(error);return 1;}}
 static void Run(string[] args){
  string root=Path.GetFullPath(args[0]);Directory.CreateDirectory(root);
  Check(ReleaseUpdate.Select(Release(Asset("2.0.0")),new Version("1.0.0"))!=null,"select newer Windows package");
  Check(ReleaseUpdate.Select(Release(Asset("2.0.0")),new Version("2.0.0"))==null,"reject equal version");
  Check(ReleaseUpdate.Select(Release(Asset("2.0.0")),new Version("3.0.0"))==null,"do not downgrade local development build");
  Check(ReleaseUpdate.Select(Release(Asset("2.0.0"),true),new Version("1.0.0"))==null,"ignore prereleases");
  var invalid=Asset("2.0.0");invalid["browser_download_url"]="https://example.com/app.zip";Reject(()=>ReleaseUpdate.Select(Release(invalid),new Version("1.0.0")),"reject other download source");
  invalid=Asset("2.0.0");invalid.Remove("digest");Reject(()=>ReleaseUpdate.Select(Release(invalid),new Version("1.0.0")),"reject missing release digest");
  var data=new byte[]{1,2,3};string path=Path.Combine(root,"download.zip");ReleaseUpdate.CopyVerified(new MemoryStream(data),path,3,Hash(data));Check(File.ReadAllBytes(path).Length==3,"verified download committed");
  Reject(()=>ReleaseUpdate.CopyVerified(new MemoryStream(new byte[]{1}),path,3,Hash(data)),"reject interrupted download");
  Reject(()=>ReleaseUpdate.CopyVerified(new MemoryStream(new byte[]{3,2,1}),path,3,Hash(data)),"reject checksum mismatch");
  Check(File.ReadAllBytes(path)[0]==1&&!File.Exists(path+".part"),"failed download preserves prior cache and removes partial");
  foreach(string name in new[]{"../escape","C:/escape","/escape","sub/../../escape","sub\\escape","a. /b"})Reject(()=>UpdateInstall.Within(root,name),"reject unsafe archive path "+name);
  string stage=Path.Combine(root,"stage"),target=Path.Combine(root,"app");Directory.CreateDirectory(stage);Directory.CreateDirectory(target);
  File.WriteAllText(Path.Combine(stage,"a.txt"),"new");File.WriteAllText(Path.Combine(target,"a.txt"),"old");File.WriteAllText(Path.Combine(target,"journal.json"),"user data");
  var plan=new UpdatePlan{Stage=stage,Target=target,Files=new[]{"a.txt"}};UpdateInstall.Apply(plan,Path.Combine(root,"backup-success"));
  Check(File.ReadAllText(Path.Combine(target,"a.txt"))=="new"&&File.ReadAllText(Path.Combine(target,"journal.json"))=="user data","install replaces program file and preserves unrelated data");
  File.WriteAllText(Path.Combine(stage,"a.txt"),"next");Directory.CreateDirectory(Path.Combine(stage,"broken"));File.WriteAllText(Path.Combine(stage,"broken/child"),"new");File.WriteAllText(Path.Combine(target,"broken"),"existing file");
  plan.Files=new[]{"a.txt","broken/child"};Reject(()=>UpdateInstall.Apply(plan,Path.Combine(root,"backup-failure")),"interrupted install is reported");
  Check(File.ReadAllText(Path.Combine(target,"a.txt"))=="new"&&File.ReadAllText(Path.Combine(target,"broken"))=="existing file","restore prior program files after partial installation");
  if(args.Length>1){var release=ReleaseUpdate.Check(new Version("0.0.0"));Check(release!=null,"read actual stable GitHub release");release.Download(Path.Combine(root,"live-release.zip"),null);Check(new FileInfo(Path.Combine(root,"live-release.zip")).Length==release.Size,"download actual release and verify published digest without installing it");}
 }
}
