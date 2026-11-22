using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Security.Cryptography;
using System.Text.RegularExpressions;
using Map=System.Collections.Generic.Dictionary<string,object>;

namespace ScheduleSync {
    // Immutable originals. A completed file survives a failed journal transaction.
    internal sealed class SyncAssets {
        internal const int Chunk=192*1024, Maximum=64*1024*1024;
        internal readonly string Folder;
        internal SyncAssets(string folder){Folder=folder;Directory.CreateDirectory(folder);}
        internal static bool Valid(string id){return Regex.IsMatch(id??"",@"\A[a-f0-9]{64}\.(png|jpeg|gif|webp|avif|bmp|heic|heif)\z");}
        internal string PathFor(string id){if(!Valid(id))throw new InvalidDataException("Invalid original image identity.");return Path.Combine(Folder,id);}
        internal static string Hash(Stream stream){using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(stream)).Replace("-","").ToLowerInvariant();}
        internal bool Has(string id){var path=PathFor(id);if(!File.Exists(path))return false;using(var f=File.OpenRead(path))return f.Length>0&&f.Length<=Maximum&&id.StartsWith(Hash(f)+".",StringComparison.Ordinal);}
        internal string[] Inventory(){return Directory.GetFiles(Folder).Select(Path.GetFileName).Where(id=>Valid(id)&&Has(id)).ToArray();}
        internal static Map Reference(string id){if(!Valid(id))throw new InvalidDataException("Invalid image identity.");return new Map{{"ref",true},{"mime","image/"+id.Split('.')[1]}};}
        internal Map Prepare(Map assets){
            var result=new Map();
            foreach(var pair in assets){
                string path=PathFor(pair.Key);var value=Wire.Object(pair.Value);
                if(value.ContainsKey("data")) {
                    var bytes=Convert.FromBase64String(Wire.Text(value,"data"));
                    using(var stream=new MemoryStream(bytes))if(bytes.Length<1||bytes.Length>Maximum||!pair.Key.StartsWith(Hash(stream)+".",StringComparison.Ordinal))throw new InvalidDataException("Original image checksum mismatch.");
                    if(!Has(pair.Key)){var tmp=path+".part";File.WriteAllBytes(tmp,bytes);if(File.Exists(path))File.Delete(path);File.Move(tmp,path);}
                }
                if(!Has(pair.Key))throw new InvalidDataException("Missing original image: "+pair.Key);
                result[pair.Key]=Reference(pair.Key);
            }
            return result;
        }
        internal Map Materialize(Map assets){var result=new Map();foreach(var pair in Prepare(assets)){var value=Reference(pair.Key);value.Remove("ref");value["data"]=Convert.ToBase64String(File.ReadAllBytes(PathFor(pair.Key)));result[pair.Key]=value;}return result;}
        internal string StoreDataUrl(string src){
            var match=Regex.Match(src??"",@"\Adata:image/(png|jpeg|gif|webp|avif|bmp|heic|heif);base64,([A-Za-z0-9+/=\r\n]+)\z");
            if(!match.Success)throw new InvalidDataException("Unsupported original image.");
            var bytes=Convert.FromBase64String(match.Groups[2].Value);string id;
            using(var input=new MemoryStream(bytes))id=Hash(input)+"."+match.Groups[1].Value;
            Prepare(new Map{{id,new Map{{"data",match.Groups[2].Value}}}});return "https://schedule-images.local/"+id;
        }
        internal void Send(Stream stream,Map assets,HashSet<string> known,Action<string> progress){
            var ids=Prepare(assets).Keys.Where(id=>!known.Contains(id)).ToArray();
            var start=Wire.Frame("assets-start");start["count"]=ids.Length;Wire.Send(stream,start);
            for(int n=0;n<ids.Length;n++)using(var file=File.OpenRead(PathFor(ids[n]))) {
                var header=Wire.Frame("asset-start");header["id"]=ids[n];header["length"]=file.Length;Wire.Send(stream,header);
                var buffer=new byte[Chunk];int index=0,read;long sent=0;
                while((read=file.Read(buffer,0,buffer.Length))>0){var part=Wire.Frame("asset-part");part["index"]=index++;part["data"]=Convert.ToBase64String(buffer,0,read);Wire.Send(stream,part);sent+=read;if(progress!=null)progress(String.Format("发送原图 {0}/{1} · {2:F1}/{3:F1} MiB",n+1,ids.Length,sent/1048576.0,file.Length/1048576.0));}
                if(Wire.Text(Wire.Receive(stream,"asset-ack"),"id")!=ids[n])throw new InvalidDataException("Image acknowledgement mismatch.");
            }
        }
        internal void Receive(Stream stream,Map expected,Action<string> progress){
            foreach(var pair in expected){var value=Wire.Object(pair.Value);if(!Valid(pair.Key)||!value.ContainsKey("ref")||!Equals(value["ref"],true)||Wire.Text(value,"mime")!="image/"+pair.Key.Split('.')[1])throw new InvalidDataException("Invalid original image manifest.");}
            int count=Convert.ToInt32(Wire.Receive(stream,"assets-start")["count"]);
            if(count<0||count>expected.Count)throw new InvalidDataException("Invalid image count.");
            var seen=new HashSet<string>();
            for(int n=0;n<count;n++){
                var header=Wire.Receive(stream,"asset-start");string id=Wire.Text(header,"id"),path=PathFor(id),tmp=path+".part";long length=Convert.ToInt64(header["length"]);
                if(!expected.ContainsKey(id)||!seen.Add(id)||length<1||length>Maximum)throw new InvalidDataException("Invalid original image batch.");
                try {
                    using(var file=new FileStream(tmp,FileMode.Create,FileAccess.ReadWrite)){
                        for(int index=0;file.Position<length;index++){
                            var part=Wire.Receive(stream,"asset-part");var bytes=Convert.FromBase64String(Wire.Text(part,"data"));
                            if(Convert.ToInt32(part["index"])!=index||bytes.Length<1||bytes.Length>Chunk||file.Position+bytes.Length>length)throw new InvalidDataException("Invalid image chunk.");
                            file.Write(bytes,0,bytes.Length);if(progress!=null)progress(String.Format("接收原图 {0}/{1} · {2:F1}/{3:F1} MiB",n+1,count,file.Position/1048576.0,length/1048576.0));
                        }
                        file.Flush(true);file.Position=0;if(!id.StartsWith(Hash(file)+".",StringComparison.Ordinal))throw new InvalidDataException("Original image checksum mismatch.");
                    }
                    if(File.Exists(path)){if(Has(id))File.Delete(tmp);else {File.Delete(path);File.Move(tmp,path);}}else File.Move(tmp,path);
                } finally {if(File.Exists(tmp))File.Delete(tmp);}
                var ack=Wire.Frame("asset-ack");ack["id"]=id;Wire.Send(stream,ack);
            }
            foreach(var id in expected.Keys)if(!Has(id))throw new InvalidDataException("Missing original image: "+id);
        }
    }
}
