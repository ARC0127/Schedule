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

[assembly:System.Reflection.AssemblyTitle("Schedule")]
[assembly:System.Runtime.Versioning.TargetFramework(".NETFramework,Version=v4.8", FrameworkDisplayName=".NET Framework 4.8")]
[assembly:System.Reflection.AssemblyProduct("Schedule")]
[assembly:System.Reflection.AssemblyVersion("0.0.6.0")]
[assembly:System.Reflection.AssemblyFileVersion("0.0.6.0")]
internal static class Program
{
    internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 100 * 1024 * 1024 };
    internal static readonly string DataDir = Environment.GetEnvironmentVariable("SCHEDULE_TEST_DATA") ?? StoragePaths.DefaultDirectory;
    internal static readonly string StateFile = Path.Combine(DataDir, "journal.json");
    internal static Store Data;
    internal static readonly string AppDir = AppDomain.CurrentDomain.BaseDirectory;
    internal static JournalWindow Window;
    internal static string ActivationDate;
    static string loadedStateText;
    static string loadedDataText;
    [STAThread]
    static int Main(string[] args)
    {
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
        Directory.CreateDirectory(DataDir);
        try
        {
            // Register the app's own toast identity and COM activator, never impersonate another app.
            ToastNotificationManagerCompat.OnActivated += delegate(ToastNotificationActivatedEventArgsCompat e) {
                var value = ToastArguments.Parse(e.Argument);
                if (value.Contains("date")) {
                    ActivationDate = value["date"];
                    if (Window != null && Window.IsHandleCreated) Window.BeginInvoke(new Action(Window.OpenActivation));
                }
            };
            if (args.Length > 0 && args[0] == "--diagnostic") { Load();return WindowsReminders.Diagnostic(args); }
            bool first;
            using (var mutex = new Mutex(true, Environment.GetEnvironmentVariable("SCHEDULE_TEST_DATA")==null?"Local\\CodexJournalDesktop":"Local\\ScheduleTest", out first)) {
                if (!first) {
                    if(!args.Contains("--autostart")&&!args.Contains("--api-host"))File.WriteAllText(Path.Combine(DataDir, "activate.txt"),args.Contains("--exit")?"exit":ActivationDate ?? DateTime.Now.ToString("yyyy-MM-dd"));
                    return 0;
                }
                if(args.Contains("--exit"))return 0;
                if(Environment.GetEnvironmentVariable("SCHEDULE_TEST_DATA")==null)
                    StoragePaths.MigrateLegacy(DataDir, StoragePaths.LegacyFiles(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData)));
                Load();
                if(Environment.GetEnvironmentVariable("SCHEDULE_TEST_DATA")==null)
                    foreach (var pair in Data.Schedules.ToArray()) WindowsReminders.Reconcile(pair.Key, pair.Value);
                Save();
                Window = new JournalWindow(args.Contains("--autostart")||args.Contains("--api-host"),args.Contains("--api-host"));
                Application.Run(Window);
            }
            return 0;
        }
        catch (Exception e) {
            File.WriteAllText(Path.Combine(DataDir, "last-error.txt"), e.ToString());
            if (args.Length > 0) return 1;
            MessageBox.Show(e.Message, "Schedule无法启动", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return 1;
        }
    }
    static string ReadStateText()
    {
        try { return File.ReadAllText(StateFile, Encoding.UTF8); }
        catch (FileNotFoundException) { return null; }
    }
    internal static void Load()
    {
        var text = ReadStateText();
        var next = text == null ? new Store() : Json.Deserialize<Store>(text);
        if (next == null || next.Schedules == null) throw new InvalidDataException("本地日志格式无法读取，原文件已保留。");
        Data = next;
        loadedStateText = text;
        loadedDataText = SerializeStore();
        foreach(var pair in Data.Schedules) {
            if(String.IsNullOrEmpty(pair.Value.Date)) pair.Value.Date=pair.Key.Split('/')[0];
            if(String.IsNullOrEmpty(pair.Value.Id)) pair.Value.Id="legacy-"+pair.Value.Date;
        }
        TaskLinks.Apply(Data);
    }
    static string SerializeStore()
    {
        return Json.Serialize(new { WidgetState=Data.WidgetState,
            Dock=new { Monitor=Data.Dock.Monitor, Edge=Data.Dock.Edge, Fraction=Data.Dock.Fraction },
            Schedules=Data.Schedules });
    }
    internal static void Save()
    {
        if (!String.Equals(ReadStateText(), loadedStateText, StringComparison.Ordinal))
            throw new IOException("本地日志已发生变化，未覆盖磁盘内容。请先复制未保存的修改，再按 F5 重新读取。");
        var text = SerializeStore();
        if (loadedStateText != null && text == loadedDataText) return;
        if(loadedStateText!=null) JournalArchive.Daily(loadedStateText);
        var tmp = StateFile + ".tmp";
        File.WriteAllText(tmp, text, new UTF8Encoding(false));
        if (File.Exists(StateFile)) File.Replace(tmp, StateFile, StateFile + ".bak");
        else File.Move(tmp, StateFile);
        loadedStateText = text;
        loadedDataText = text;
    }
    internal static string Restore(Store next)
    {
        var previous=Data;
        JournalArchive.Snapshot("before-restore");
        TaskLinks.Apply(next);
        Data=next;
        try { Save(); } catch { Data=previous;throw; }
        string warning=WindowsReminders.ReplaceAll(previous.Schedules);
        Save();
        return warning;
    }
}
