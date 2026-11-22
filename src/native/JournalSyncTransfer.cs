using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using Map = System.Collections.Generic.Dictionary<string, object>;

namespace ScheduleSync
{
    // Version 2 is negotiated in the existing v1 hello/changes envelope. Large
    // journals and original images are chunked; each complete payload is verified.
    internal static class JournalSyncTransfer
    {
        const int Maximum = 100 * 1024 * 1024, Chunk = 384 * 1024;
        static string Hash(byte[] bytes) { using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(bytes)).Replace("-","").ToLowerInvariant(); }
        internal static Map Receive(Stream stream,Action<string> progress=null)
        {
            var start=Wire.Receive(stream,"journal-start");
            int length=Convert.ToInt32(start["length"]);
            if(length<2||length>Maximum)throw new InvalidDataException("Journal sync exceeds 100 MiB.");
            using(var output=new MemoryStream()) {
                for(int index=0;output.Length<length;index++) {
                    var part=Wire.Receive(stream,"journal-part");
                    if(Convert.ToInt32(part["index"])!=index)throw new InvalidDataException("Journal chunk order mismatch.");
                    var bytes=Convert.FromBase64String(Wire.Text(part,"data"));
                    if(bytes.Length<1||bytes.Length>Chunk||output.Length+bytes.Length>length)throw new InvalidDataException("Invalid journal chunk.");
                    output.Write(bytes,0,bytes.Length);
                    if(progress!=null)progress(String.Format("接收手机数据 {0:F1} / {1:F1} MiB",output.Length/1048576.0,length/1048576.0));
                }
                var data=output.ToArray();
                if(Hash(data)!=Wire.Text(start,"sha256"))throw new InvalidDataException("Journal transfer checksum mismatch.");
                return Wire.Object(Wire.Json.DeserializeObject(new UTF8Encoding(false,true).GetString(data)));
            }
        }
        internal static void Send(Stream stream,Map value,Action<string> progress=null)
        {
            byte[] bytes=Encoding.UTF8.GetBytes(Wire.Json.Serialize(value));
            if(bytes.Length>Maximum)throw new InvalidDataException("Journal sync exceeds 100 MiB.");
            var start=Wire.Frame("journal-start");start["length"]=bytes.Length;start["sha256"]=Hash(bytes);Wire.Send(stream,start);
            for(int offset=0,index=0;offset<bytes.Length;offset+=Chunk,index++) {
                var part=Wire.Frame("journal-part");part["index"]=index;part["data"]=Convert.ToBase64String(bytes,offset,Math.Min(Chunk,bytes.Length-offset));Wire.Send(stream,part);
                if(progress!=null)progress(String.Format("发送电脑数据 {0:F1} / {1:F1} MiB",Math.Min(offset+Chunk,bytes.Length)/1048576.0,bytes.Length/1048576.0));
            }
        }
        internal static string Run(Stream stream,DesktopJournal desktop,Action<string> progress=null,bool batched=false)
        {
            string phase="接收记录";
            try{return RunCore(stream,desktop,value=>{phase=value;if(progress!=null)progress(value);},batched);}
            catch(Exception error){
                if(batched)try{var frame=Wire.Frame("sync-error");frame["phase"]=phase;frame["message"]=error.Message;Wire.Send(stream,frame);}catch{}
                throw new IOException("同步中断（"+phase+"）。已校验的原图已保留，重试只补传缺少的图片。"+error.Message,error);
            }
        }
        static string RunCore(Stream stream,DesktopJournal desktop,Action<string> progress,bool batched)
        {
            var incoming=Receive(stream,progress);
            incoming["batchedAssets"]=batched;
            if(Wire.Text(incoming,"source")!=desktop.Source)throw new InvalidDataException("Journal source mismatch.");
            if(batched){desktop.Assets.Receive(stream,Wire.Object(incoming["assets"]),progress);incoming["assets"]=desktop.Assets.Prepare(Wire.Object(incoming["assets"]));}
            if(progress!=null)progress("正在核对改动与原图…");
            var result=desktop.MergeJournal(incoming);
            if(Wire.Text(result,"status")=="pending-review" && !incoming.ContainsKey("reviewSupport"))
                throw new IOException("同步已暂停，请在电脑蓝牙同步页确认冲突后重试。手机原有数据未修改。");
            if(!batched && incoming.ContainsKey("knownAssets")&&result.ContainsKey("assets")) {
                var known=new HashSet<string>(Wire.Array(incoming,"knownAssets").Select(id=>Convert.ToString(id)),StringComparer.Ordinal);
                result["assets"]=Wire.Object(result["assets"]).Where(pair=>!known.Contains(pair.Key)).ToDictionary(pair=>pair.Key,pair=>pair.Value);
            }
            var assets=result.ContainsKey("assets")?Wire.Object(result["assets"]):new Map();
            if(result.ContainsKey("assets"))result["assets"]=batched?desktop.Assets.Prepare(assets):desktop.Assets.Materialize(assets);
            result["source"]=desktop.Source;Send(stream,result,progress);
            if(batched)desktop.Assets.Send(stream,assets,new HashSet<string>(Wire.Array(incoming,"knownAssets").Select(id=>Convert.ToString(id))),progress);
            if(Wire.Text(Wire.Receive(stream,"ack"),"source")!=desktop.Source)throw new InvalidDataException("Phone did not acknowledge the journal.");
            if(Wire.Text(result,"status")=="pending-review")return "同步已暂停：请在电脑逐项确认冲突，再继续同步。两端原有数据未修改。";
            int count=Wire.Object(result["entities"]).Count;
            return String.Format("双向同步完成：{0} 条记录。笔记、想法、项目、原图及日程已同步。",count);
        }
    }
}
