using System;
using System.IO;
using System.IO.Pipes;
using System.Security.AccessControl;
using System.Security.Principal;
using System.Threading.Tasks;

// One request at a time, same Windows user only; all journal mutations execute in the UI owner.
internal sealed class LocalApi : IDisposable
{
    readonly JournalWindow window;
    NamedPipeServerStream pipe;
    bool stopped;
    internal LocalApi(JournalWindow owner){window=owner;Task.Run((Func<Task>)Listen);}
    async Task Listen()
    {
        while(!stopped) {
            try {
                var security=new PipeSecurity();security.SetAccessRuleProtection(true,false);
                security.AddAccessRule(new PipeAccessRule(new SecurityIdentifier(WellKnownSidType.NetworkSid,null),PipeAccessRights.FullControl,AccessControlType.Deny));
                security.AddAccessRule(new PipeAccessRule(WindowsIdentity.GetCurrent().User,PipeAccessRights.FullControl,AccessControlType.Allow));
                using(var server=new NamedPipeServerStream(ApiProtocol.Name(Program.DataDir),PipeDirection.InOut,1,PipeTransmissionMode.Byte,PipeOptions.Asynchronous,4096,4096,security)) {
                    pipe=server;await server.WaitForConnectionAsync();
                    var read=Task.Run(()=>ApiProtocol.Read(server,2*1024*1024));
                    if(await Task.WhenAny(read,Task.Delay(15000))!=read)continue;
                    string request=await read;
                    var completed=new TaskCompletionSource<string>();
                    window.BeginInvoke(new Action(async delegate {
                        try {completed.TrySetResult(await window.ExecuteApi(request));}
                        catch(Exception e){completed.TrySetResult(Program.Json.Serialize(new{ok=false,error=e.Message}));}
                    }));
                    string response=await Task.WhenAny(completed.Task,Task.Delay(60000))!=completed.Task?"{\"ok\":false,\"error\":\"Request timed out; inspect state before retrying a write.\"}":await completed.Task;
                    var write=Task.Run(()=>ApiProtocol.Write(server,response));
                    if(await Task.WhenAny(write,Task.Delay(15000))==write)await write;
                }
            } catch(Exception e) {
                if(!stopped)File.WriteAllText(Path.Combine(Program.DataDir,"api-error.txt"),e.ToString());
            } finally {pipe=null;}
        }
    }
    public void Dispose(){stopped=true;if(pipe!=null)pipe.Dispose();}
}
