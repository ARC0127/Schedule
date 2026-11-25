using System;
using System.IO;
using System.Linq;
using System.Threading;
using System.Web.Script.Serialization;
class FakeAssistant {
 static void Main(string[] args){
  Console.OutputEncoding=new System.Text.UTF8Encoding(false);Console.InputEncoding=new System.Text.UTF8Encoding(false);
  var json=new JavaScriptSerializer();
  if(args.Length>0&&args[0]=="echo"){Console.Write(json.Serialize(args.Skip(1).ToArray()));return;}
  if(args.Length>0&&args[0]=="app-server"){
   Console.ReadLine();Console.WriteLine("{\"id\":1,\"result\":{}}");Console.ReadLine();Console.ReadLine();
   Console.WriteLine("{\"id\":2,\"result\":{\"data\":[{\"model\":\"gpt-6.2-astra\",\"hidden\":false,\"supportedReasoningEfforts\":[{\"reasoningEffort\":\"xhigh\"}]}]}}");return;
  }
  File.AppendAllText("calls.txt","call\n");File.WriteAllText("args.json",json.Serialize(args));
  string prompt=Console.In.ReadToEnd();File.WriteAllText("prompt.txt",prompt);
  if(prompt.Contains("TEST_SLOW")){Thread.Sleep(60000);return;}
  if(prompt.Contains("TEST_FAIL")){Console.Error.Write("provider rejected request");Environment.Exit(7);}
  string result="## Questions\nWhat observation would falsify this claim? [idea/test]";
  int index=Array.IndexOf(args,"-o");if(index>=0)File.WriteAllText(args[index+1],result);
  else Console.Write(json.Serialize(new{result=result,is_error=false,modelUsage=new{claudeOpusTest=new{inputTokens=1}}}));
 }
}
