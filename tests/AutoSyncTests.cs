using System;
using System.IO;
using System.Collections.Generic;
using System.Web.Script.Serialization;
internal static class Program {internal static string DataDir=Path.Combine(Path.GetTempPath(),"schedule-auto-"+Guid.NewGuid().ToString("N"));internal static JavaScriptSerializer Json=new JavaScriptSerializer();}
class AutoSyncTests {
    static int count;
    static void Check(bool pass,string message){if(!pass)throw new Exception(message);Console.WriteLine("PASS "+message);count++;}
    static void Main(){
        var now=new DateTime(2034,3,12,10,0,0,DateTimeKind.Utc);var p=new AutoSyncPolicy();
        Check(p.Due(now,"a",now,1),"first reachable connection triggers sync");
        p.Success(now,"a");
        Check(!p.Due(now.AddMinutes(59),"a",now,1),"unchanged connected device waits for one-hour interval");
        Check(p.Due(now.AddHours(1),"a",now,1),"one-hour boundary triggers exactly when due");
        p.Success(now.AddHours(1),"a");Check(!p.Due(now.AddHours(1).AddSeconds(30),"a",now,1),"successful interval sync does not loop");
        Check(!p.Due(now.AddHours(1).AddSeconds(30),"b",now.AddHours(1).AddSeconds(25),1),"active changes debounce ten seconds");
        Check(p.Due(now.AddHours(1).AddSeconds(36),"b",now.AddHours(1).AddSeconds(25),1),"settled change triggers sync before interval");
        p.Success(now.AddHours(1).AddSeconds(36),"b");p.Failure(now.AddHours(1).AddMinutes(1),true);
        Check(!p.Due(now.AddHours(1).AddMinutes(1).AddSeconds(10),"b",now,1),"disconnect retry has cooldown");
        Check(p.Due(now.AddHours(1).AddMinutes(2),"b",now,1),"reconnect triggers sync despite unchanged revision");
        for(int i=0;i<12;i++)p.Failure(now,true);
        Check(p.RetryAfter<=now.AddMinutes(5),"failure backoff stays bounded");
        Directory.CreateDirectory(Program.DataDir);try{
            var settings=new AutoSyncSettings();Check(settings.Enabled&&settings.Hours==1,"new profile defaults to automatic one-hour interval");
            var path=Path.Combine(Program.DataDir,"auto-sync.json");
            File.WriteAllText(path,Program.Json.Serialize(new Dictionary<string,object>{{"peer","AABBCCDDEEFF"},{"enabled",false},{"hours",2},{"lastSuccessUtc",now.ToString("o")}}));
            var migrated=new AutoSyncSettings();migrated.Load();
            Check(migrated.Hours==1&&!migrated.Enabled&&migrated.Peer=="AABBCCDDEEFF"&&migrated.LastSuccess==now,"legacy two-hour profile migrates without changing pause, peer or last success");
            Check(Program.Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(path)).ContainsKey("intervalVersion"),"migration persists its marker");
            migrated.Apply(new Dictionary<string,object>{{"peer","AABBCCDDEEFF"},{"enabled",true},{"hours",2}});migrated.Save();
            var chosen=new AutoSyncSettings();chosen.Load();Check(chosen.Hours==2,"later explicit two-hour choice survives restart");
            File.WriteAllText(path,Program.Json.Serialize(new Dictionary<string,object>{{"peer","AABBCCDDEEFF"},{"enabled",false},{"hours",8}}));
            var custom=new AutoSyncSettings();custom.Load();Check(custom.Hours==8&&!custom.Enabled,"legacy custom interval remains unchanged");
            settings.Apply(new Dictionary<string,object>{{"peer","AABBCCDDEEFF"},{"enabled",false},{"hours",4}});settings.Save();
            var restored=new AutoSyncSettings();restored.Load();Check(!restored.Enabled&&restored.Hours==4&&restored.Peer=="AABBCCDDEEFF","pause, trusted peer and interval persist across restart");
            bool rejected=false;try{restored.Apply(new Dictionary<string,object>{{"peer","bad"},{"enabled",true},{"hours",0}});}catch(ArgumentException){rejected=true;}Check(rejected,"invalid peer or interval rejected");
        }finally{Directory.Delete(Program.DataDir,true);}
        Console.WriteLine("TOTAL "+count);
    }
}
