using System;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Sockets;
using System.Threading.Tasks;
using System.Collections.Generic;
using ScheduleSync;
using Map=System.Collections.Generic.Dictionary<string,object>;
static class BatchAssetsTests {
    static int passed;
    static void Check(bool condition,string message){if(!condition)throw new Exception(message);passed++;Console.WriteLine("PASS "+message);}
    static string Save(SyncAssets store,byte[] bytes){string id;using(var input=new MemoryStream(bytes))id=SyncAssets.Hash(input)+".png";File.WriteAllBytes(store.PathFor(id),bytes);return id;}
    static Map Frame(string type,params object[] fields){var m=Wire.Frame(type);for(int i=0;i<fields.Length;i+=2)m[(string)fields[i]]=fields[i+1];return m;}
    static int Main(string[] args){try{Run(args[0]);return 0;}catch(Exception e){Console.Error.WriteLine(e);return 1;}}
    static void Run(string root){
        var sender=new SyncAssets(Path.Combine(root,"sender"));var receiver=new SyncAssets(Path.Combine(root,"receiver"));
        var bytes=Enumerable.Range(0,32768).Select(n=>(byte)(n%251)).ToArray();string first=Save(sender,bytes);
        var secondBytes=(byte[])bytes.Clone();secondBytes[0]=123;string second=Save(sender,secondBytes);
        var expected=new Map{{first,SyncAssets.Reference(first)},{second,SyncAssets.Reference(second)}};
        using(var broken=new BluetoothOfferStream(Frame("assets-start","count",2),Frame("asset-start","id",first,"length",bytes.Length),Frame("asset-part","index",0,"data",Convert.ToBase64String(bytes)),Frame("asset-start","id",second,"length",secondBytes.Length))) {
            bool failed=false;try{receiver.Receive(broken,expected,null);}catch(EndOfStreamException){failed=true;}
            Check(failed,"truncated next-image transfer reports failure");
            Check(receiver.Has(first)&&!receiver.Has(second),"completed original survives interruption, incomplete image is not published");
            Check(!Directory.GetFiles(receiver.Folder,"*.part").Any(),"incomplete temporary image cleaned up");
            broken.Output.Position=0;Check(Wire.Text(Wire.Receive(broken.Output,"asset-ack"),"id")==first,"only verified durable original acknowledged");
        }
        var listener=new TcpListener(IPAddress.Loopback,0);listener.Start();var endpoint=(IPEndPoint)listener.LocalEndpoint;
        var received=Task.Run(()=>{using(var server=listener.AcceptTcpClient())receiver.Receive(server.GetStream(),expected,null);});int updates=0;
        using(var client=new TcpClient()){client.Connect(endpoint);sender.Send(client.GetStream(),expected,new HashSet<string>(receiver.Inventory()),_=>updates++);}received.GetAwaiter().GetResult();listener.Stop();
        Check(updates==1&&receiver.Has(first)&&receiver.Has(second),"retry transfers only the missing original and preserves exact bytes");
        var corruptBytes=(byte[])secondBytes.Clone();corruptBytes[10]^=1;string corrupt;using(var f=new MemoryStream(corruptBytes))corrupt=SyncAssets.Hash(f)+".png";
        using(var broken=new BluetoothOfferStream(Frame("assets-start","count",1),Frame("asset-start","id",corrupt,"length",bytes.Length),Frame("asset-part","index",0,"data",Convert.ToBase64String(bytes)))) {
            bool failed=false;try{receiver.Receive(broken,new Map{{corrupt,SyncAssets.Reference(corrupt)}},null);}catch(InvalidDataException){failed=true;}
            Check(failed&&!File.Exists(receiver.PathFor(corrupt))&&broken.Output.Length==0,"checksum mismatch is rejected before publish or acknowledgement");
        }
        bool invalid=false;try{receiver.PathFor("../outside.png");}catch(InvalidDataException){invalid=true;}Check(invalid,"image identifiers cannot escape original storage");
        using(var remote=new BluetoothOfferStream(Frame("sync-error","phase","save-records","message","Synthetic disk full"))){bool shown=false;try{Wire.Receive(remote,"journal-start");}catch(IOException e){shown=e.Message.Contains("save-records")&&e.Message.Contains("disk full");}Check(shown,"remote phase and concrete error survive protocol parsing");}
        Console.WriteLine("TOTAL "+passed);
    }
}
