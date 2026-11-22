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
        Check(p.Due(now,"a",now,2),"first reachable connection triggers sync");
        p.Success(now,"a");
        Check(!p.Due(now.AddMinutes(119),"a",now,2),"unchanged connected device waits for two-hour interval");
        Check(p.Due(now.AddHours(2),"a",now,2),"two-hour boundary triggers exactly when due");
        p.Success(now.AddHours(2),"a");Check(!p.Due(now.AddHours(2).AddSeconds(30),"a",now,2),"successful interval sync does not loop");
        Check(!p.Due(now.AddHours(2).AddSeconds(30),"b",now.AddHours(2).AddSeconds(25),2),"active changes debounce ten seconds");
        Check(p.Due(now.AddHours(2).AddSeconds(36),"b",now.AddHours(2).AddSeconds(25),2),"settled change triggers sync before interval");
        p.Success(now.AddHours(2).AddSeconds(36),"b");p.Failure(now.AddHours(2).AddMinutes(1),true);
        Check(!p.Due(now.AddHours(2).AddMinutes(1).AddSeconds(10),"b",now,2),"disconnect retry has cooldown");
        Check(p.Due(now.AddHours(2).AddMinutes(2),"b",now,2),"reconnect triggers sync despite unchanged revision");
        for(int i=0;i<12;i++)p.Failure(now,true);
        Check(p.RetryAfter<=now.AddMinutes(5),"failure backoff stays bounded");
        Directory.CreateDirectory(Program.DataDir);try{
            var settings=new AutoSyncSettings();Check(settings.Enabled&&settings.Hours==2,"new profile defaults to automatic two-hour interval");
            settings.Apply(new Dictionary<string,object>{{"peer","AABBCCDDEEFF"},{"enabled",false},{"hours",4}});settings.Save();
            var restored=new AutoSyncSettings();restored.Load();Check(!restored.Enabled&&restored.Hours==4&&restored.Peer=="AABBCCDDEEFF","pause, trusted peer and interval persist across restart");
            bool rejected=false;try{restored.Apply(new Dictionary<string,object>{{"peer","bad"},{"enabled",true},{"hours",0}});}catch(ArgumentException){rejected=true;}Check(rejected,"invalid peer or interval rejected");
        }finally{Directory.Delete(Program.DataDir,true);}
        Console.WriteLine("TOTAL "+count);
    }
}
