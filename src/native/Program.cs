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
[assembly:System.Reflection.AssemblyProduct("Schedule")]
[assembly:System.Reflection.AssemblyVersion("0.0.1.0")]
[assembly:System.Reflection.AssemblyFileVersion("0.0.1.0")]
internal static class Program
{
    internal static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 100 * 1024 * 1024 };
    internal static readonly string DataDir = Environment.GetEnvironmentVariable("SCHEDULE_TEST_DATA") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "CodexJournal");
    internal static readonly string StateFile = Path.Combine(DataDir, "journal.json");
    internal static Store Data;
    internal static readonly string AppDir = AppDomain.CurrentDomain.BaseDirectory;
    internal static JournalWindow Window;
    internal static string ActivationDate;
    [STAThread]
    static int Main(string[] args)
    {
        Directory.CreateDirectory(DataDir);
        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);
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
                    if(!args.Contains("--autostart"))File.WriteAllText(Path.Combine(DataDir, "activate.txt"),args.Contains("--exit")?"exit":ActivationDate ?? DateTime.Now.ToString("yyyy-MM-dd"));
                    return 0;
                }
                if(args.Contains("--exit"))return 0;
                Load();
                if(Environment.GetEnvironmentVariable("SCHEDULE_TEST_DATA")==null)
                    foreach (var pair in Data.Schedules.ToArray()) WindowsReminders.Reconcile(pair.Key, pair.Value);
                Save();
                Window = new JournalWindow(args.Contains("--autostart"));
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
    static void Load()
    {
        Data = File.Exists(StateFile) ? Json.Deserialize<Store>(File.ReadAllText(StateFile, Encoding.UTF8)) : new Store();
        if (Data == null || Data.Schedules == null) throw new InvalidDataException("本地日志格式无法读取，原文件已保留。");
    }
    internal static void Save()
    {
        var tmp = StateFile + ".tmp";
        File.WriteAllText(tmp, Json.Serialize(Data), new UTF8Encoding(false));
        if (File.Exists(StateFile)) File.Replace(tmp, StateFile, StateFile + ".bak");
        else File.Move(tmp, StateFile);
    }
}
