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

internal class JournalWindow : Form
{
    readonly WebView2 web = new WebView2 { Dock=DockStyle.Fill };
    readonly System.Windows.Forms.Timer activationTimer = new System.Windows.Forms.Timer { Interval=500 };
    bool ready, closing, minimizing;
    bool backgroundLaunch, initializationStarted, transitionPending;
    string initialMode;
    readonly NotifyIcon tray = new NotifyIcon();
    readonly ContextMenuStrip trayMenu = new ContextMenuStrip();
    readonly ToolStripMenuItem dockItem = new ToolStripMenuItem();
    readonly ToolStripMenuItem startupItem = new ToolStripMenuItem("开机启动");
    DockWindow dock;
    FormWindowState expandedState=FormWindowState.Normal;
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr window);
    public JournalWindow(bool startInBackground=false)
    {
        backgroundLaunch=startInBackground;initialMode=startInBackground?"dock":"main";
        Text="Schedule"; Width=1160; Height=860; MinimumSize=new Size(780,560); StartPosition=FormStartPosition.CenterScreen;
        Icon=new Icon(Path.Combine(Program.AppDir,"schedule.ico"));
        tray.Icon=Icon;tray.Text="Schedule";tray.ContextMenuStrip=trayMenu;
        trayMenu.Items.Add("打开 Schedule",null,delegate{OpenActivation();});
        dockItem.Click+=delegate{if(dock!=null&&dock.Visible)HideToTray();else RequestTransition("dock");};trayMenu.Items.Add(dockItem);
        startupItem.Click+=delegate{try{StartupRegistration.SetEnabled(!StartupRegistration.IsEnabled());RefreshTrayMenu();}catch(Exception ex){MessageBox.Show(ex.Message,"开机启动未修改",MessageBoxButtons.OK,MessageBoxIcon.Warning);}};trayMenu.Items.Add(startupItem);
        trayMenu.Items.Add("退出",null,delegate{RequestExit();});
        trayMenu.Opening+=delegate{RefreshTrayMenu();};
        tray.MouseClick+=delegate(object sender,MouseEventArgs e){if(e.Button==MouseButtons.Left)OpenActivation();};
        Controls.Add(web);
        FormClosed+=delegate{tray.Visible=false;tray.Dispose();trayMenu.Dispose();activationTimer.Dispose();if(dock!=null)dock.Dispose();};
        Resize+=delegate {
            if(WindowState!=FormWindowState.Minimized){expandedState=WindowState;return;}
            if(!ready||closing||minimizing)return;minimizing=true;
            RequestTransition("dock");
        };
        Shown += async delegate { if(!initializationStarted){initializationStarted=true;await Init();} };
        FormClosing += delegate(object sender, FormClosingEventArgs e) {
            if (closing) return;
            if(e.CloseReason==CloseReason.WindowsShutDown){Program.Save();return;}
            if(!ready){closing=true;return;}
            e.Cancel=true;
            RequestTransition("tray");
        };
        activationTimer.Tick += delegate {
            var path=Path.Combine(Program.DataDir,"activate.txt");
            if(File.Exists(path)) { var command=File.ReadAllText(path);File.Delete(path);if(command=="exit")RequestExit();else{Program.ActivationDate=command;OpenActivation();} }
        };
    }
    protected override void SetVisibleCore(bool value)
    {
        if(value&&backgroundLaunch){if(!IsHandleCreated)CreateHandle();if(!initializationStarted){initializationStarted=true;BeginInvoke(new Action(async delegate{await Init();}));}base.SetVisibleCore(false);return;}
        base.SetVisibleCore(value);
    }
    void RefreshTrayMenu()
    {
        dockItem.Text=dock!=null&&dock.Visible?"隐藏悬浮窗":"显示悬浮窗";
        try{startupItem.Checked=StartupRegistration.IsEnabled();startupItem.Enabled=true;}catch{startupItem.Checked=false;startupItem.Enabled=false;}
    }
    internal void RequestExit(){RequestTransition("exit");}
    async void RequestTransition(string mode)
    {
        if(closing||transitionPending)return;
        if(!ready){if(mode=="exit"){closing=true;Close();}else initialMode=mode;return;}
        transitionPending=true;
        string action=mode=="exit"?"closeWindow":mode=="tray"?"hideToTray":"showDock";
        try{await web.CoreWebView2.ExecuteScriptAsync("window.journalFlush().then(()=>window.journalNative.call('"+action+"')).catch(e=>window.journalNative.call('transitionFailed',{message:e.message}))");}
        catch(Exception ex){TransitionFailed(ex.Message);}
    }
    void TransitionFailed(string message){transitionPending=false;minimizing=false;OpenActivation();MessageBox.Show(message,"保存未完成",MessageBoxButtons.OK,MessageBoxIcon.Warning);}
    void HideToTray(){transitionPending=false;minimizing=false;if(dock!=null)dock.Hide();Hide();tray.Visible=true;RefreshTrayMenu();}
    async Task Init()
    {
        try {
            var env=await CoreWebView2Environment.CreateAsync(null,Path.Combine(Program.DataDir,"WebView2"));
            await web.EnsureCoreWebView2Async(env);
            web.CoreWebView2.Settings.AreDevToolsEnabled=false;
            web.CoreWebView2.Settings.AreDefaultContextMenusEnabled=false;
            web.CoreWebView2.Settings.IsStatusBarEnabled=false;
            web.CoreWebView2.SetVirtualHostNameToFolderMapping("journal.local",Program.AppDir,CoreWebView2HostResourceAccessKind.DenyCors);
            web.CoreWebView2.NavigationStarting += delegate(object sender,CoreWebView2NavigationStartingEventArgs e) { if(e.Uri!="https://journal.local/index.html")e.Cancel=true;else ready=false; };
            web.CoreWebView2.NewWindowRequested += delegate(object sender,CoreWebView2NewWindowRequestedEventArgs e) {e.Handled=true;};
            web.CoreWebView2.PermissionRequested += delegate(object sender,CoreWebView2PermissionRequestedEventArgs e) {e.State=CoreWebView2PermissionState.Deny;};
            web.CoreWebView2.WebMessageReceived += Message;
            await web.CoreWebView2.AddScriptToExecuteOnDocumentCreatedAsync(File.ReadAllText(Path.Combine(Program.AppDir,"bridge.js")));
            web.CoreWebView2.Navigate("https://journal.local/index.html");
        } catch(Exception e) {if(closing||IsDisposed)return;MessageBox.Show(e.Message,"桌面界面加载失败",MessageBoxButtons.OK,MessageBoxIcon.Error);closing=true;Close();}
    }
    async void Message(object sender,CoreWebView2WebMessageReceivedEventArgs e)
    {
        if(e.Source!="https://journal.local/index.html")return;
        string id=null;
        try {
            var req=Program.Json.Deserialize<Dictionary<string,object>>(e.WebMessageAsJson);
            id=Convert.ToString(req["id"]);
            var op=Convert.ToString(req["method"]);object result;
            if(op=="loadState") {
                Program.Load();
                result=new {widgetState=Program.Data.WidgetState,schedules=Program.Data.Schedules};
            } else if(op=="uiReady") {
                ready=true;backgroundLaunch=false;tray.Visible=true;RefreshTrayMenu();activationTimer.Start();
                if(initialMode=="dock"&&Program.ActivationDate==null)ShowDock();else if(initialMode=="tray"&&Program.ActivationDate==null)HideToTray();else OpenActivation();
                initialMode="main";
                result=new {ready=true};
            } else if(op=="saveState") {
                if(!ready)throw new InvalidOperationException("日志尚未加载完成，未保存空白界面。");
                object prior=Program.Data.WidgetState;
                Program.Data.WidgetState=req["payload"];
                try {Program.Save();} catch {Program.Data.WidgetState=prior;throw;}
                if(dock!=null)dock.RefreshToday();result=new {saved=true};
            } else if(op=="saveSchedule") result=WindowsReminders.SetSchedule((Dictionary<string,object>)req["payload"]);
            else if(op=="inspectPath"||op=="openPath") {
                var path=Convert.ToString(((Dictionary<string,object>)req["payload"])["path"]);
                var entry=await Task.Run(()=>LocalPaths.Inspect(path));
                result=op=="openPath"?LocalPaths.Open(entry):(object)entry;
            }
            else if(op=="droppedPaths") {
                var files=e.AdditionalObjects.OfType<CoreWebView2File>().Select(f=>f.Path).ToArray();
                if(files.Length==0)throw new ArgumentException("未收到本地路径，请用关联资料输入完整路径。");
                result=await Task.Run(()=>files.Select(LocalPaths.Inspect).ToArray());
            }
            else if(op=="testNotification")result=WindowsReminders.TestNotification();
            else if(op=="openExternal")result=ExternalLinks.Open(Convert.ToString(((Dictionary<string,object>)req["payload"])["url"]));
            else if(op=="minimize"||op=="showDock") { ShowDock();result=new {docked=true}; }
            else if(op=="restoreWindow") { OpenActivation();result=new {restored=true}; }
            else if(op=="hideToTray") { HideToTray();result=new {hidden=true}; }
            else if(op=="transitionFailed") { TransitionFailed(Convert.ToString(((Dictionary<string,object>)req["payload"])["message"]));result=new {restored=true}; }
            else if(op=="notificationStatus")result=new {setting=ToastNotificationManagerCompat.CreateToastNotifier().Setting.ToString()};
            else if(op=="openCreatorPage") { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("https://arc0127.github.io/") {UseShellExecute=true}); result=new {opened=true}; }
            else if(op=="notificationSettings") { System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("ms-settings:notifications") {UseShellExecute=true}); result=new {opened=true}; }
            else if(op=="closeWindow") { result=new {closing=true}; closing=true;BeginInvoke(new Action(Close)); }
            else throw new ArgumentException("不支持的桌面操作。");
            web.CoreWebView2.PostWebMessageAsJson(Program.Json.Serialize(new {id=id,result=result}));
        } catch(Exception ex) {web.CoreWebView2.PostWebMessageAsJson(Program.Json.Serialize(new {id=id,error=ex.Message}));}
        await Task.CompletedTask;
    }
    void ShowDock()
    {
        minimizing=false;transitionPending=false;
        if(dock==null||dock.IsDisposed)dock=new DockWindow(this);
        Hide();dock.Reveal();tray.Visible=true;RefreshTrayMenu();
    }
    internal async void ToggleDockIdea(string date,string id)
    {
        await web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('journal:toggle-idea',{detail:"+Program.Json.Serialize(new {date=date,id=id})+"}))");
    }
    internal async void OpenActivation()
    {
        if(!ready)return;
        minimizing=true;
        var restoreState=expandedState;
        Show();WindowState=restoreState;BringToFront();Activate();SetForegroundWindow(Handle);
        if(dock!=null)dock.Hide();minimizing=false;
        if(Program.ActivationDate!=null){await web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('journal:open-date',{detail:"+Program.Json.Serialize(Program.ActivationDate)+"}))");Program.ActivationDate=null;}
        else await web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new Event('journal:resume'))");
    }
}
