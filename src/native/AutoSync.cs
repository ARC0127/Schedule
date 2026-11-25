using System;
using System.IO;
using Map=System.Collections.Generic.Dictionary<string,object>;

// One scheduler on Windows coordinates both devices. Polling exchanges only status,
// and never switches networks. The phone remains a paired-device foreground listener.
internal sealed class AutoSyncPolicy
{
    internal bool Reachable;
    internal string Revision="";
    internal DateTime LastSuccess=DateTime.MinValue, RetryAfter=DateTime.MinValue;
    internal int Failures;
    internal bool Due(DateTime now,string revision,DateTime changed,int hours) {
        return now>=RetryAfter && (!Reachable || now-LastSuccess>=TimeSpan.FromHours(hours) ||
            revision!=Revision && now-changed>=TimeSpan.FromSeconds(10));
    }
    internal void Success(DateTime now,string revision){Reachable=true;Revision=revision;LastSuccess=now;RetryAfter=now.AddSeconds(10);Failures=0;}
    internal void Failure(DateTime now,bool disconnected){if(disconnected)Reachable=false;Failures=Math.Min(4,Failures+1);RetryAfter=now.AddSeconds(Math.Min(300,30*Math.Pow(2,Failures-1)));}
}

internal sealed class AutoSyncSettings
{
    internal bool Enabled=true;
    internal string Peer="",Message="请选择要同步的手机",Error="";
    internal int Hours=1;
    internal DateTime LastSuccess=DateTime.MinValue;
    string PathName{get{return Path.Combine(Program.DataDir,"auto-sync.json");}}
    internal Map View(){return new Map{{"enabled",Enabled},{"peer",Peer},{"hours",Hours},{"lastSync",LastSuccess==DateTime.MinValue?"":LastSuccess.ToLocalTime().ToString("yyyy-MM-dd HH:mm")},{"lastSuccessUtc",LastSuccess.ToString("o")},{"message",Message},{"error",Error}};}
    internal void Load(){
        if(!File.Exists(PathName))return;
        var p=Program.Json.Deserialize<Map>(File.ReadAllText(PathName));
        bool migrate=!p.ContainsKey("intervalVersion");
        if(migrate&&Convert.ToInt32(p["hours"])==2)p["hours"]=1;
        Apply(p);object last;
        if(p.TryGetValue("lastSuccessUtc",out last))DateTime.TryParse(Convert.ToString(last),null,System.Globalization.DateTimeStyles.RoundtripKind,out LastSuccess);
        if(migrate)Save();
    }
    internal void Apply(Map p){
        string peer=Convert.ToString(p["peer"]);int hours=Convert.ToInt32(p["hours"]);
        if(peer!=""&&!System.Text.RegularExpressions.Regex.IsMatch(peer,@"\A[0-9a-fA-F]{12}\z"))throw new ArgumentException("请选择已配对手机。");
        if(hours!=1&&hours!=2&&hours!=4&&hours!=8)throw new ArgumentException("请选择 1、2、4 或 8 小时。");
        Peer=peer.ToUpperInvariant();Hours=hours;Enabled=Convert.ToBoolean(p["enabled"]);
        Message=Peer==""?"请选择要同步的手机":Enabled?"等待自动连接":"自动同步已暂停";Error="";
    }
    internal void Save(){var p=View();p["intervalVersion"]=1;p["lastSuccessUtc"]=LastSuccess.ToString("o");var temp=PathName+".tmp";File.WriteAllText(temp,Program.Json.Serialize(p));if(File.Exists(PathName))File.Replace(temp,PathName,null);else File.Move(temp,PathName);}
}
