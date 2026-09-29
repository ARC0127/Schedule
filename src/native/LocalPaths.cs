using System;
using System.Collections.Generic;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Security;
using System.Text;
using System.Threading;
using System.Threading.Tasks;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Toolkit.Uwp.Notifications;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
using Windows.Data.Xml.Dom;
using Windows.UI.Notifications;

internal sealed class LocalEntry
{
    public string path {get;set;}
    public string name {get;set;}
    public string kind {get;set;}
}
internal static class LocalPaths
{
    [System.Runtime.InteropServices.DllImport("shell32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode)]
    static extern int SHParseDisplayName(string name,IntPtr context,out IntPtr item,uint flags,out uint attrs);
    [System.Runtime.InteropServices.DllImport("shell32.dll")]
    static extern int SHOpenFolderAndSelectItems(IntPtr item,uint count,IntPtr children,uint flags);
    internal static LocalEntry Inspect(string input)
    {
        string path=(input??"").Trim();
        if(path.Length>=2&&path[0]=='"'&&path[path.Length-1]=='"')path=path.Substring(1,path.Length-2);
        path=path.Replace('/','\\');
        bool drive=path.Length>=3&&Char.IsLetter(path[0])&&path[1]==':'&&path[2]=='\\';
        bool unc=path.StartsWith(@"\\")&&!path.StartsWith(@"\\?\")&&!path.StartsWith(@"\\.\");
        if((!drive&&!unc)||path.Any(Char.IsControl)||path.IndexOfAny(new[]{'"','*','?','<','>','|'})>=0||path.Substring(drive?2:0).Contains(":"))
            throw new ArgumentException("请输入本地文件或文件夹的完整路径，例如 C:\\Projects\\Example。");
        path=Path.GetFullPath(path);
        bool folder=Directory.Exists(path);
        if(!folder&&!File.Exists(path))throw new FileNotFoundException("路径不存在或无法访问，请检查磁盘和项目目录："+path);
        return new LocalEntry{path=path,name=Path.GetFileName(path.TrimEnd('\\')),kind=folder?"folder":"file"};
    }
    internal static object Open(LocalEntry entry)
    {
        // Reveal programs, scripts and unknown associations instead of executing them.
        string[] documents={".txt",".md",".pdf",".png",".jpg",".jpeg",".gif",".webp",".bmp",".docx",".xlsx",".pptx",".csv",".mp3",".mp4",".wav",".mov"};
        bool reveal=entry.kind=="file"&&!documents.Contains(Path.GetExtension(entry.path).ToLowerInvariant());
        if(reveal){
            IntPtr item;uint attrs;
            System.Runtime.InteropServices.Marshal.ThrowExceptionForHR(SHParseDisplayName(entry.path,IntPtr.Zero,out item,0,out attrs));
            try{System.Runtime.InteropServices.Marshal.ThrowExceptionForHR(SHOpenFolderAndSelectItems(item,0,IntPtr.Zero,0));}
            finally{System.Runtime.InteropServices.Marshal.FreeCoTaskMem(item);}
        } else System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(entry.path){UseShellExecute=true});
        return new {opened=true,revealed=reveal,path=entry.path};
    }
}
