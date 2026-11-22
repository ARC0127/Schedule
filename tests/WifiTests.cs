using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using ScheduleSync;
using Map=System.Collections.Generic.Dictionary<string,object>;
sealed class CountStream:Stream {
    readonly Stream inner;internal long Sent,Received;
    internal CountStream(Stream stream){inner=stream;}
    public override int Read(byte[] b,int o,int n){int r=inner.Read(b,o,n);Received+=r;return r;}
    public override void Write(byte[] b,int o,int n){inner.Write(b,o,n);Sent+=n;}
    public override void Flush(){inner.Flush();}
    protected override void Dispose(bool disposing){if(disposing)inner.Dispose();base.Dispose(disposing);}
    public override bool CanRead{get{return true;}}public override bool CanWrite{get{return true;}}public override bool CanSeek{get{return false;}}
    public override long Length{get{throw new NotSupportedException();}}public override long Position{get{throw new NotSupportedException();}set{throw new NotSupportedException();}}
    public override long Seek(long o,SeekOrigin s){throw new NotSupportedException();}public override void SetLength(long n){throw new NotSupportedException();}
}
sealed class BluetoothOfferStream:Stream {
    readonly MemoryStream input=new MemoryStream();internal readonly MemoryStream Output=new MemoryStream();
    internal BluetoothOfferStream(params Map[] offers){foreach(var offer in offers)Wire.Send(input,offer);input.Position=0;}
    public override int Read(byte[] b,int o,int n){return input.Read(b,o,n);}public override void Write(byte[] b,int o,int n){Output.Write(b,o,n);}public override void Flush(){}
    public override bool CanRead{get{return true;}}public override bool CanWrite{get{return true;}}public override bool CanSeek{get{return false;}}
    public override long Length{get{throw new NotSupportedException();}}public override long Position{get{throw new NotSupportedException();}set{throw new NotSupportedException();}}
    public override long Seek(long o,SeekOrigin s){throw new NotSupportedException();}public override void SetLength(long n){throw new NotSupportedException();}
}
static class WifiTests {
    static void Check(bool value,string message){if(!value)throw new Exception(message);Console.WriteLine("PASS "+message);}
    static int Main(string[] args){Console.OutputEncoding=System.Text.Encoding.UTF8;try{Run(args);return 0;}catch(Exception e){Console.Error.WriteLine(e);return 1;}}
    static void Run(string[] args) {
        var offer=Wire.Object(Wire.Json.DeserializeObject(File.ReadAllText(args[0])));offer["hosts"]=new object[]{"127.0.0.1"};offer["port"]=Int32.Parse(args[2]);
        string cachePath=args[1],journal=cachePath+".journal";File.WriteAllText(journal,"{\"Schedules\":{}}");
        var cache=Wire.Object(Wire.Json.DeserializeObject(File.ReadAllText(cachePath)));bool repeat=Convert.ToBoolean(cache["repeat"]);
        var assets=Wire.Object(cache["assets"]);string large=Wire.Text(cache,"largeId");int received=-1;
        if(!repeat) {
            var wrong=new Map(offer);wrong["fingerprint"]=new string('0',64);bool refused=false;
            try{using(var unexpected=WifiTransferConnection.Open(wrong,true)){} }catch(IOException){refused=true;}
            Check(refused,"wrong TLS certificate rejected before journal exchange");
            wrong=new Map(offer);wrong["token"]=new string('x',32);refused=false;
            try{using(var unexpected=WifiTransferConnection.Open(wrong,true)){} }catch(IOException){refused=true;}
            Check(refused,"wrong session token rejected before journal exchange");
        }
        var desktop=new DesktopJournal(journal,request=>{
            if(Wire.Text(request,"op")=="sync_inventory")return new Map{{"ok",true},{"result",assets.Keys.ToArray()}};
            var payload=Wire.Object(request["payload"]);var incoming=Wire.Object(payload["assets"]);received=incoming.Count;
            foreach(var pair in incoming)assets[pair.Key]=pair.Value;
            var entities=Wire.Object(payload["entities"]);
            entities["idea/wifi-desktop-idea"]=new Map{{"date","2034-03-12"},{"text","wifi-large ![original](schedule-image:"+large+")"},{"formats",new object[0]},{"projects",new object[0]},{"state","note"},{"important",false},{"due",""},{"order",5}};
            return new Map{{"ok",true},{"result",new Map{{"schema",2},{"status","complete"},{"reviewId",""},{"entities",entities},{"conflicts",new Map()},{"assets",new Map(assets)}}}};
        });
        using(var bluetooth=new BluetoothOfferStream(offer)) {
            CountStream stream=null;
            string result=SyncSession.Run(bluetooth,desktop,details=>{var connection=WifiTransferConnection.Open(details,true);stream=new CountStream(connection.Stream);connection.Stream=stream;return connection;});
            bluetooth.Output.Position=0;Check(Wire.Number(Wire.Receive(bluetooth.Output,"hello"),"wifiSync")==1,"Bluetooth hello negotiates automatic Wi-Fi");
            Check(Wire.Boolean(Wire.Receive(bluetooth.Output,"wifi-result"),"use"),"successful TLS handshake acknowledged over Bluetooth before data transfer");
            Check(result.Contains("同步完成"),"actual Windows TLS client and Android journal transfer completed");
            if(repeat){Check(received==0,"known phone originals omitted from upload");Check(stream.Sent<100000&&stream.Received<100000,"repeat transfer has no multi-megabyte image payload in either direction");}
            else {Check(received>0,"missing phone original is received");Check(stream.Sent>2*1024*1024,"multi-megabyte original sent over TLS");}
            Console.WriteLine("BYTES sent="+stream.Sent+" received="+stream.Received);
        }
        cache["repeat"]=true;File.WriteAllText(cachePath,Wire.Json.Serialize(cache));
        var unavailable=Wire.Frame("wifi-offer");unavailable["available"]=false;
        var legacy=Wire.Frame("changes");legacy["items"]=new object[0];var ack=Wire.Frame("ack");ack["source"]=desktop.Source;
        using(var fallback=new BluetoothOfferStream(offer,unavailable,legacy,ack)) {
            SyncSession.Run(fallback,desktop,details=>{throw new IOException("Synthetic LAN unreachable");});
            fallback.Output.Position=0;Wire.Receive(fallback.Output,"hello");
            Check(Wire.Boolean(Wire.Receive(fallback.Output,"wifi-result"),"direct"),"unreachable LAN requests temporary direct Wi-Fi");
            Check(!Wire.Boolean(Wire.Receive(fallback.Output,"wifi-result"),"use"),"unavailable hotspot negotiates Bluetooth fallback without starting Wi-Fi data writes");
        }
        Check(!WifiTransferConnection.LocalAddress("8.8.8.8")&&!WifiTransferConnection.LocalAddress("127.0.0.1"),"production Wi-Fi destinations are local network addresses only");
        var xml=TemporaryWifi.Profile("Schedule-test","A&B<WiFi>","test&password");
        var document=new System.Xml.XmlDocument();document.LoadXml(xml);Check(document.InnerText.Contains("test&password"),"temporary WLAN profile escapes credentials correctly without writing a saved profile");
    }
}
