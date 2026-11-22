using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using ScheduleSync;
using Map=System.Collections.Generic.Dictionary<string,object>;
static class BatchWifiTests {
    static void Check(bool condition,string message){if(!condition)throw new Exception(message);Console.WriteLine("PASS "+message);}
    static int Main(string[] args){try{Run(args);return 0;}catch(Exception e){Console.Error.WriteLine(e);return 1;}}
    static void Run(string[] args){
        bool background=args.Length>3&&args[3]=="background";
        var offer=Wire.Object(Wire.Json.DeserializeObject(File.ReadAllText(args[0])));offer["hosts"]=new object[]{"127.0.0.1"};offer["port"]=Int32.Parse(args[2]);
        string folder=Path.GetDirectoryName(args[1]),journal=Path.Combine(folder,"journal.json");File.WriteAllText(journal,"{\"Schedules\":{}}");
        var fixture=Wire.Object(Wire.Json.DeserializeObject(File.ReadAllText(args[1])));var assets=Wire.Object(fixture["assets"]);bool repeat=Wire.Boolean(fixture,"repeat");
        var cache=new SyncAssets(Path.Combine(folder,"images"));long sourceBytes=assets.Keys.Sum(id=>new FileInfo(cache.PathFor(id)).Length);
        Check(sourceBytes>(background?2L:100L)*1024*1024,"desktop original fixture has the required byte size");
        var desktop=new DesktopJournal(journal,request=>{
            if(Wire.Text(request,"op")=="sync_inventory")return new Map{{"ok",true},{"result",cache.Inventory()}};
            var payload=Wire.Object(request["payload"]);var incoming=Wire.Object(payload["assets"]);
            Check(incoming.Values.All(value=>Wire.Boolean(Wire.Object(value),"ref")),"phone metadata contains file references, no embedded originals");
            foreach(var pair in incoming){Check(cache.Has(pair.Key),"received original checksum verified");assets[pair.Key]=pair.Value;}
            var entities=Wire.Object(payload["entities"]);
            entities["idea/wifi-desktop-idea"]=new Map{{"date","2034-03-12"},{"text","wifi-large "+String.Join("\n",Wire.Array(fixture,"desktopIds").Select(id=>"![original](schedule-image:"+id+")"))},{"formats",new object[0]},{"projects",new object[0]},{"state","note"},{"important",false},{"due",""},{"order",5}};
            return new Map{{"ok",true},{"result",new Map{{"schema",2},{"status","complete"},{"reviewId",""},{"entities",entities},{"conflicts",new Map()},{"assets",new Map(assets)}}}};
        });
        using(var connection=WifiTransferConnection.Open(offer,true))using(var counted=new CountStream(connection.Stream)){
            string result=SyncSession.Run(counted,desktop,null,null,background);Check(result.Contains("同步完成"),"real Windows TLS and Android metadata commit completed");
            if(repeat)Check(counted.Sent<200000&&counted.Received<200000,"repeat skips all completed originals in both directions");
            else Check(counted.Sent>(background?2L:100L)*1024*1024&&counted.Received>(background?0L:100L*1024*1024),"expected originals transferred in both directions");
            Console.WriteLine("BYTES sent="+counted.Sent+" received="+counted.Received);
        }
        Check(cache.Inventory().Sum(id=>new FileInfo(cache.PathFor(id)).Length)>(background?2L:256L)*1024*1024,"received and sent originals retained on disk");
        fixture["repeat"]=true;fixture["assets"]=assets;File.WriteAllText(args[1],Wire.Json.Serialize(fixture));
    }
}
