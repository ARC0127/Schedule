using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using Map=System.Collections.Generic.Dictionary<string,object>;
class Program {
 internal static JavaScriptSerializer Json=new JavaScriptSerializer{MaxJsonLength=16000000};
 static void Check(bool ok,string message){if(!ok)throw new Exception(message);}
 static Map Row(string provider,string source){return new Map{{"provider",provider},{"source",source},{"title","Synthetic test"},{"createdAt","2026-11-25T00:00:00Z"},{"instructions",""},{"effort","xhigh"}};}
 static void Main(string[] args){try{Run(args[0],args[1]).GetAwaiter().GetResult();}catch(Exception e){Console.Error.WriteLine(e.GetType().Name+": "+e.Message);Environment.Exit(1);}}
 static async Task Run(string root,string fake){
  var runner=new AnalysisRunner(root);Check(!runner.Enabled,"binding defaults off");
  string[] samples={"space name","", "a\"b", "C:\\space path\\", "Unicode 中文", "\\\""};
  using(var p=Process.Start(new ProcessStartInfo(fake,"echo "+string.Join(" ",samples.Select(AnalysisRunner.Quote))){UseShellExecute=false,CreateNoWindow=true,RedirectStandardOutput=true,StandardOutputEncoding=System.Text.Encoding.UTF8})){var actual=Json.Deserialize<string[]>(p.StandardOutput.ReadToEnd());p.WaitForExit();Check(actual.SequenceEqual(samples),"Windows argument quoting: "+Json.Serialize(actual));}
  var catalog=await AnalysisRunner.Models(fake,CancellationToken.None);Check(AnalysisRunner.SelectModel(catalog)=="gpt-6.2-astra","catalog selection");
  var models=(object[])catalog["data"];var baseline=(Map)models[0];
  catalog["data"]=new object[]{new Map(baseline){{"id","new"}},new Map{{"model","gpt-6.2-sol"},{"supportedReasoningEfforts",baseline["supportedReasoningEfforts"]}},new Map{{"model","gpt-7-pro"},{"hidden",true},{"supportedReasoningEfforts",baseline["supportedReasoningEfforts"]}}};
  Check(AnalysisRunner.SelectModel(catalog)=="gpt-6.2-astra","hidden and tier selection");
  catalog["data"]=new object[0];try{AnalysisRunner.SelectModel(catalog);throw new Exception("must reject empty catalog");}catch(IOException){}
  runner.Configure(new Map{{"provider","codex"},{"enabled",true},{"executable",fake}});
  var row=Row("codex","Synthetic idea 中文");var result=await runner.Run("request-one",row,CancellationToken.None);Check((string)result["status"]=="completed","codex completes: "+result["error"]);
  await runner.Run("request-one",row,CancellationToken.None);
  string folder=Path.Combine(runner.Root,"requests","request-one");Check(File.ReadAllLines(Path.Combine(folder,"calls.txt")).Length==1,"no duplicate generation");
  Check(File.ReadAllText(Path.Combine(folder,"source.md"))=="Synthetic idea 中文","immutable snapshot");Check(File.ReadAllText(Path.Combine(folder,"prompt.txt")).Contains("Synthetic idea 中文"),"UTF-8 stdin");
  var arguments=Json.Deserialize<string[]>(File.ReadAllText(Path.Combine(folder,"args.json")));Check(arguments.Contains("model_reasoning_effort=\"xhigh\"")&&arguments.Contains("read-only")&&arguments.Contains("--ignore-user-config"),"codex isolation and effort args");
  var changed=Row("codex","different");try{await runner.Run("request-one",changed,CancellationToken.None);throw new Exception("changed source accepted");}catch(InvalidOperationException){}
  result=await runner.Run("failure",Row("codex","TEST_FAIL"),CancellationToken.None);Check((string)result["status"]=="failed"&&((string)result["error"]).Contains("7"),"visible provider failure");
  using(var token=new CancellationTokenSource()){token.CancelAfter(1000);result=await runner.Run("cancel",Row("codex","TEST_SLOW"),token.Token);Check((string)result["status"]=="cancelled","cancellation");}
  var interrupted=AnalysisRunner.Read(Path.Combine(folder,"run.json"));interrupted["status"]="running";AnalysisRunner.Write(Path.Combine(folder,"run.json"),interrupted);
  result=await new AnalysisRunner(root).Run("request-one",row,CancellationToken.None);Check((string)result["status"]=="failed","restart does not regenerate interrupted request");Check(File.ReadAllLines(Path.Combine(folder,"calls.txt")).Length==1,"restart launch count");
  runner.Configure(new Map{{"provider","claude"},{"enabled",true},{"executable",fake}});
  result=await runner.Run("claude-one",Row("claude","Synthetic Claude idea"),CancellationToken.None);Check((string)result["status"]=="completed","claude completes");
  arguments=Json.Deserialize<string[]>(File.ReadAllText(Path.Combine(runner.Root,"requests","claude-one","args.json")));Check(arguments.Contains("xhigh")&&arguments.Contains("opus")&&arguments.Contains("--strict-mcp-config")&&arguments.Contains("--no-session-persistence"),"claude isolation/effort");
  Console.WriteLine("{\"passed\":true,\"checks\":[\"binding off by default\",\"Windows quote roundtrip\",\"catalog flagship xhigh\",\"Codex and Claude fake process execution\",\"source and project files\",\"idempotence and restart\",\"changed source rejected\",\"failure and cancellation\"],\"realProviderGeneration\":false}");
 }
}
