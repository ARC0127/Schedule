using System;
using System.Diagnostics;
using System.IO;
using System.IO.Pipes;
using System.Text;
using System.Threading.Tasks;
using System.Web.Script.Serialization;

internal static class ScheduleCli
{
    static int Main(string[] args)
    {
        Console.InputEncoding=Encoding.UTF8;Console.OutputEncoding=new UTF8Encoding(false);
        var json=new JavaScriptSerializer{MaxJsonLength=100*1024*1024};
        try {
            if(args.Length==1&&args[0]=="--help") {Console.WriteLine("Schedule.Cli.exe [--request request.json]\nRead one JSON request from stdin or a UTF-8 file. Example: {\"op\":\"get_day\",\"date\":\"2026-10-01\"}. Use {\"op\":\"capabilities\"} for commands. Output is one JSON response. Writes require the revision returned by a read. No network listener is used.");return 0;}
            string request;
            if(args.Length==2&&args[0]=="--request")request=File.ReadAllText(args[1],Encoding.UTF8);
            else if(args.Length==0)request=Console.In.ReadToEnd();
            else throw new ArgumentException("Usage: Schedule.Cli.exe [--request request.json]");
            if(Encoding.UTF8.GetByteCount(request)>2*1024*1024)throw new ArgumentException("Request exceeds 2 MB.");
            json.DeserializeObject(request);
            string dir=Environment.GetEnvironmentVariable("SCHEDULE_TEST_DATA")??Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),".schedule");
            using(var pipe=new NamedPipeClientStream(".",ApiProtocol.Name(dir),PipeDirection.InOut,PipeOptions.Asynchronous)) {
                try {pipe.Connect(1000);} catch(TimeoutException) {
                    Process.Start(new ProcessStartInfo(Path.Combine(AppDomain.CurrentDomain.BaseDirectory,"Journal.exe"),"--api-host"){UseShellExecute=false,CreateNoWindow=true,WindowStyle=ProcessWindowStyle.Hidden});
                    pipe.Connect(30000);
                }
                ApiProtocol.Write(pipe,request);
                var read=Task.Run(()=>ApiProtocol.Read(pipe,100*1024*1024));
                if(!read.Wait(65000))throw new TimeoutException("Response timed out. Read current state before retrying a write.");
                string response=read.Result;Console.WriteLine(response);
                var result=json.Deserialize<System.Collections.Generic.Dictionary<string,object>>(response);
                return result.ContainsKey("ok")&&Convert.ToBoolean(result["ok"])?0:1;
            }
        } catch(Exception e){Console.WriteLine(json.Serialize(new{ok=false,error=e.GetBaseException().Message}));return 1;}
    }
}
