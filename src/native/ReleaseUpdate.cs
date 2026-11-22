using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using Map=System.Collections.Generic.Dictionary<string,object>;

internal sealed class ReleaseUpdate {
    internal const string Latest="https://api.github.com/repos/ARC0127/Schedule/releases/latest";
    internal string Version,Url,Digest,Notes;
    internal long Size;
    internal static readonly JavaScriptSerializer Json=new JavaScriptSerializer{MaxJsonLength=2*1024*1024};
    internal static ReleaseUpdate Select(string json,Version current) {
        var release=(Map)Json.DeserializeObject(json);
        if(Convert.ToBoolean(release["draft"])||Convert.ToBoolean(release["prerelease"]))return null;
        string tag=Convert.ToString(release["tag_name"]);
        var matches=new List<ReleaseUpdate>();
        foreach(var asset in ((object[])release["assets"]).Cast<Map>()) {
            string name=Convert.ToString(asset["name"]);var match=Regex.Match(name,@"\ASchedule-(\d+\.\d+\.\d+)-windows-x64\.zip\z");
            if(!match.Success)continue;
            var version=new Version(match.Groups[1].Value);if(version<=new Version(current.Major,current.Minor,current.Build))continue;
            string url=Convert.ToString(asset["browser_download_url"]),digest=Convert.ToString(asset.ContainsKey("digest")?asset["digest"]:null);
            if(url!="https://github.com/ARC0127/Schedule/releases/download/"+Uri.EscapeDataString(tag)+"/"+name||!Regex.IsMatch(digest,@"\Asha256:[a-f0-9]{64}\z"))throw new InvalidDataException("发行包地址或校验信息无效，未安装更新。");
            long size=Convert.ToInt64(asset["size"]);if(size<1||size>256L*1024*1024)throw new InvalidDataException("更新包大小无效。");
            matches.Add(new ReleaseUpdate{Version=match.Groups[1].Value,Url=url,Digest=digest.Substring(7),Size=size,Notes=Convert.ToString(release["body"])});
        }
        return matches.OrderByDescending(item=>new Version(item.Version)).FirstOrDefault();
    }
    static HttpWebResponse Open(string url) {
        for(int hop=0;hop<6;hop++) {
            var uri=new Uri(url);
            if(uri.Scheme!="https"||!new[]{"api.github.com","github.com","release-assets.githubusercontent.com","objects.githubusercontent.com"}.Contains(uri.Host)||!uri.IsDefaultPort)throw new IOException("更新下载跳转到不受支持的地址。");
            ServicePointManager.SecurityProtocol|=SecurityProtocolType.Tls12;
            var request=(HttpWebRequest)WebRequest.Create(uri);request.UserAgent="Schedule-Updater";request.Accept="application/vnd.github+json";request.AllowAutoRedirect=false;request.Timeout=15000;request.ReadWriteTimeout=30000;
            var response=(HttpWebResponse)request.GetResponse();int code=(int)response.StatusCode;
            if(code>=300&&code<400){string location=response.Headers["Location"];response.Dispose();url=new Uri(uri,location).AbsoluteUri;continue;}
            if(code!=200){response.Dispose();throw new IOException("更新服务器未返回安装包。");}return response;
        }
        throw new IOException("更新下载跳转次数过多。");
    }
    internal static ReleaseUpdate Check(Version current) {
        using(var response=Open(Latest))using(var input=response.GetResponseStream())using(var bytes=new MemoryStream()) {
            byte[] buffer=new byte[16384];int count;while((count=input.Read(buffer,0,buffer.Length))>0){if(bytes.Length+count>2*1024*1024)throw new IOException("版本信息过大。");bytes.Write(buffer,0,count);}
            return Select(Encoding.UTF8.GetString(bytes.ToArray()),current);
        }
    }
    internal void Download(string path,Action<int> progress) {
        using(var response=Open(Url))using(var input=response.GetResponseStream())CopyVerified(input,path,Size,Digest,progress);
    }
    internal static void CopyVerified(Stream input,string path,long size,string digest,Action<int> progress=null) {
        string partial=path+".part";
        try {
            using(var file=new FileStream(partial,FileMode.Create,FileAccess.ReadWrite)) {
                byte[] buffer=new byte[65536];int count,last=-1;long total=0;
                while((count=input.Read(buffer,0,buffer.Length))>0){total+=count;if(total>size)throw new IOException("下载长度与发行包不一致。");file.Write(buffer,0,count);int percent=(int)(total*100/size);if(progress!=null&&percent!=last){last=percent;progress(percent);}}
                if(total!=size)throw new IOException("更新下载未完成，请重试。");file.Flush(true);file.Position=0;
                using(var sha=SHA256.Create())if(BitConverter.ToString(sha.ComputeHash(file)).Replace("-","").ToLowerInvariant()!=digest)throw new IOException("更新包校验失败，未安装。");
            }
            if(File.Exists(path))File.Delete(path);File.Move(partial,path);
        }finally{if(File.Exists(partial))File.Delete(partial);}
    }
}
