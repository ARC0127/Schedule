using System;
using System.Collections.Generic;
using System.IO;
using System.Text;
using Map=System.Collections.Generic.Dictionary<string,object>;

internal static class JournalSyncReview
{
    static readonly object Gate=new object();
    static string PathName {get{return Path.Combine(Program.DataDir,"sync-review.json");}}
    static Map Read() {
        if(!File.Exists(PathName))return null;
        return Program.Json.Deserialize<Map>(File.ReadAllText(PathName,Encoding.UTF8));
    }
    static void Write(Map value) {
        var text=Program.Json.Serialize(value);
        if(Encoding.UTF8.GetByteCount(text)>100*1024*1024)throw new InvalidDataException("待确认内容超过 100 MiB，未写入。");
        var temp=PathName+".tmp";File.WriteAllText(temp,text,new UTF8Encoding(false));
        if(File.Exists(PathName))File.Replace(temp,PathName,null);else File.Move(temp,PathName);
    }
    internal static Map Load(){lock(Gate)return Read();}
    internal static Map Stage(Map value) {
        lock(Gate) {
            if(!(value["conflicts"] is Map)||((Map)value["conflicts"]).Count==0)throw new InvalidDataException("没有待确认冲突。");
            value["id"]=Guid.NewGuid().ToString("N");value["approved"]=false;Write(value);return value;
        }
    }
    internal static Map Approve(Map payload) {
        lock(Gate) {
            var current=Read();
            if(current==null||Convert.ToString(current["id"])!=Convert.ToString(payload["id"]))throw new InvalidOperationException("待确认内容已变化，请重新查看。");
            var conflicts=(Map)current["conflicts"];var choices=(Map)payload["decisions"];
            if(choices.Count!=conflicts.Count)throw new InvalidDataException("请逐项选择保留的版本。");
            foreach(var key in conflicts.Keys) {
                object choice;if(!choices.TryGetValue(key,out choice)||!Equals(choice,"desktop")&&!Equals(choice,"phone"))throw new InvalidDataException("请逐项选择保留的版本。");
            }
            current["decisions"]=choices;current["approved"]=true;Write(current);return current;
        }
    }
    internal static void Complete(string id) {
        lock(Gate) {var current=Read();if(current!=null&&Convert.ToString(current["id"])==id)File.Delete(PathName);}
    }
}
