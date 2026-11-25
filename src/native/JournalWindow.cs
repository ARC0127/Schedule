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
    bool bluetoothRunning;
    bool autoChecking;
    readonly System.Windows.Forms.Timer autoTimer=new System.Windows.Forms.Timer{Interval=30000};
    readonly AutoSyncSettings autoSettings=new AutoSyncSettings();
    AutoSyncPolicy autoPolicy=new AutoSyncPolicy();
    readonly AnalysisRunner analysis=new AnalysisRunner(Program.DataDir);
    readonly System.Windows.Forms.Timer analysisTimer=new System.Windows.Forms.Timer{Interval=5000};
    System.Threading.CancellationTokenSource analysisCancel;
    bool analysisBusy;
    string activeAnalysisId="";
    string initialMode;
    LocalApi api;
    readonly Dictionary<string,TaskCompletionSource<string>> apiReplies=new Dictionary<string,TaskCompletionSource<string>>();
    readonly NotifyIcon tray = new NotifyIcon();
    readonly ContextMenuStrip trayMenu = new ContextMenuStrip();
    readonly ToolStripMenuItem dockItem = new ToolStripMenuItem();
    readonly ToolStripMenuItem startupItem = new ToolStripMenuItem("开机启动");
    DockWindow dock;
    FormWindowState expandedState=FormWindowState.Normal;
    [System.Runtime.InteropServices.DllImport("user32.dll")]
    static extern bool SetForegroundWindow(IntPtr window);
    public JournalWindow(bool startInBackground=false,bool apiHost=false)
    {
        backgroundLaunch=startInBackground;initialMode=apiHost?"tray":startInBackground?"dock":"main";
        AutoScaleDimensions=new SizeF(96f,96f);AutoScaleMode=AutoScaleMode.Dpi;
        Text="Schedule"; Width=1160; Height=860; MinimumSize=new Size(780,560); StartPosition=FormStartPosition.CenterScreen;
        Icon=new Icon(Path.Combine(Program.AppDir,"schedule.ico"));
        tray.Icon=Icon;tray.Text="Schedule";tray.ContextMenuStrip=trayMenu;
        trayMenu.Items.Add("打开 Schedule",null,delegate{OpenActivation();});
        dockItem.Click+=delegate{if(dock!=null&&dock.Visible)HideToTray();else RequestTransition("dock");};trayMenu.Items.Add(dockItem);
        startupItem.Click+=delegate{try{StartupRegistration.SetEnabled(!StartupRegistration.IsEnabled());RefreshTrayMenu();}catch(Exception ex){MessageBox.Show(ex.Message,"开机启动未修改",MessageBoxButtons.OK,MessageBoxIcon.Warning);}};trayMenu.Items.Add(startupItem);
        trayMenu.Items.Add("退出",null,delegate{RequestExit();});
        trayMenu.Opening+=delegate{RefreshTrayMenu();};
        tray.MouseClick+=delegate(object sender,MouseEventArgs e){if(e.Button==MouseButtons.Left)OpenActivation();};
        tray.BalloonTipClicked+=async delegate {OpenActivation();await web.CoreWebView2.ExecuteScriptAsync("document.querySelector('#j-bluetooth-open').click()");};
        Controls.Add(web);
        FormClosed+=delegate{if(api!=null)api.Dispose();tray.Visible=false;tray.Dispose();trayMenu.Dispose();activationTimer.Dispose();if(dock!=null)dock.Dispose();};
        Resize+=delegate {
            if(WindowState!=FormWindowState.Minimized){expandedState=WindowState;return;}
            if(!ready||closing||minimizing)return;minimizing=true;
            RequestTransition("dock");
        };
        Shown += async delegate { if(!initializationStarted){initializationStarted=true;await Init();} };
        autoTimer.Tick+=async delegate{await AutoSyncTick();};
        analysisTimer.Tick+=async delegate{await AnalysisTick();};
        FormClosed+=delegate{analysisTimer.Dispose();if(analysisCancel!=null)analysisCancel.Cancel();};
        FormClosed+=delegate{autoTimer.Dispose();};
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
            Directory.CreateDirectory(Path.Combine(Program.DataDir,"images"));
            web.CoreWebView2.SetVirtualHostNameToFolderMapping("schedule-images.local",Path.Combine(Program.DataDir,"images"),CoreWebView2HostResourceAccessKind.DenyCors);
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
                result=new {widgetState=Program.Data.WidgetState,schedules=Program.Data.Schedules,processId=System.Diagnostics.Process.GetCurrentProcess().Id,appDirectory=Program.AppDir,dataDirectory=Program.DataDir};
            } else if(op=="uiReady") {
                ready=true;backgroundLaunch=false;tray.Visible=true;RefreshTrayMenu();activationTimer.Start();
                if(api==null)api=new LocalApi(this);
                analysisTimer.Start();
                try{autoSettings.Load();autoPolicy.LastSuccess=autoSettings.LastSuccess;autoTimer.Start();}catch(Exception error){autoSettings.Message=error.Message;}
                if(initialMode=="dock"&&Program.ActivationDate==null)ShowDock();else if(initialMode=="tray"&&Program.ActivationDate==null)HideToTray();else OpenActivation();
                initialMode="main";
                result=new {ready=true};
            } else if(op=="apiResult") {
                var payload=(Dictionary<string,object>)req["payload"];TaskCompletionSource<string> completion;
                if(apiReplies.TryGetValue(Convert.ToString(payload["requestId"]),out completion))completion.TrySetResult(Program.Json.Serialize(payload["response"]));
                result=new{received=true};
            } else if(op=="saveState") {
                if(!ready)throw new InvalidOperationException("日志尚未加载完成，未保存空白界面。");
                object prior=Program.Data.WidgetState;
                var priorSchedules=Program.Json.Deserialize<Dictionary<string,Schedule>>(Program.Json.Serialize(Program.Data.Schedules));
                Program.Data.WidgetState=req["payload"];
                var changed=TaskLinks.Apply(Program.Data);
                try {Program.Save();} catch {Program.Data.WidgetState=prior;Program.Data.Schedules=priorSchedules;throw;}
                foreach(var key in changed)WindowsReminders.Reconcile(key,Program.Data.Schedules[key]);
                if(changed.Count>0)Program.Save();
                if(dock!=null)dock.RefreshToday();result=new {saved=true,schedules=Program.Data.Schedules};
            } else if(op=="saveSchedule") result=WindowsReminders.SetSchedule((Dictionary<string,object>)req["payload"]);
            else if(op=="bluetoothDevices") result=await Task.Run(() => BluetoothTransport.PairedDevices().OrderBy(device=>device.Name).Select(device=>new {address=device.Address.ToString("X12"),name=device.Name}).ToArray());
            else if(op=="bluetoothSync") result=await SyncBluetooth((Dictionary<string,object>)req["payload"]);
            else if(op=="checkUpdate")result=await CheckUpdate();
            else if(op=="downloadUpdate")result=await DownloadUpdate();
            else if(op=="installUpdate")result=await InstallUpdate();
            else if(op=="autoSyncSettings") result=autoSettings.View();
            else if(op=="assistantSettings")result=analysis.View();
            else if(op=="setAssistant") {if(analysisBusy)throw new InvalidOperationException("请先停止当前分析再修改绑定。");analysis.Configure((Dictionary<string,object>)req["payload"]);result=analysis.View();}
            else if(op=="assistantExecutable") {using(var picker=new OpenFileDialog{Filter="CLI executable (*.exe)|*.exe",Title="选择 Codex 或 Claude CLI"})result=new{path=picker.ShowDialog(this)==DialogResult.OK?picker.FileName:""};}
            else if(op=="assistantFolder") {analysis.Prepare();System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("explorer.exe",AnalysisRunner.Quote(analysis.Root)){UseShellExecute=true});result=new{opened=true};}
            else if(op=="assistantCancel") {var payload=(Dictionary<string,object>)req["payload"];if(analysisCancel!=null&&payload!=null&&Convert.ToString(payload["id"])==activeAnalysisId)analysisCancel.Cancel();result=new{cancelled=true};}
            else if(op=="setAutoSync") {
                var settings=(Dictionary<string,object>)req["payload"];
                if((bluetoothRunning||autoChecking)&&Convert.ToBoolean(settings["enabled"]))throw new InvalidOperationException("正在检查连接，请稍后修改。仍可暂停自动同步。");
                string peer=Convert.ToString(settings["peer"]);
                if(Convert.ToBoolean(settings["enabled"])&&peer!=""&&!BluetoothTransport.PairedDevices().Any(d=>d.Address.ToString("X12")==peer))throw new ArgumentException("请选择已配对手机。");
                autoSettings.Apply(settings);autoSettings.Save();autoPolicy=new AutoSyncPolicy();result=autoSettings.View();
                BeginInvoke(new Action(async delegate{await AutoSyncTick();}));
            }
            else if(op=="storeOriginal") result=new ScheduleSync.SyncAssets(Path.Combine(Program.DataDir,"images")).StoreDataUrl(Convert.ToString(((Dictionary<string,object>)req["payload"])["src"]));
            else if(op=="prepareSyncAssets") result=new ScheduleSync.SyncAssets(Path.Combine(Program.DataDir,"images")).Prepare((Dictionary<string,object>)req["payload"]);
            else if(op=="legacyAssetBytes") {
                var originals=new ScheduleSync.SyncAssets(Path.Combine(Program.DataDir,"images"));
                result=((Dictionary<string,object>)req["payload"]).Keys.Sum(key=>4*((new FileInfo(originals.PathFor(key)).Length+2)/3));
            }
            else if(op=="commitSync") result=JournalSyncCommit.Apply((Dictionary<string,object>)req["payload"]);
            else if(op=="loadSyncReview") result=JournalSyncReview.Load();
            else if(op=="stageSyncReview") {
                result=JournalSyncReview.Stage((Dictionary<string,object>)req["payload"]);
                if(Environment.GetEnvironmentVariable("SCHEDULE_TEST_DATA")==null) {
                    tray.Visible=true;tray.ShowBalloonTip(8000,"Schedule · 同步待确认","手机与电脑的记录有冲突，已暂停同步。请打开蓝牙同步逐项确认。",ToolTipIcon.Warning);
                }
            }
            else if(op=="approveSyncReview") result=JournalSyncReview.Approve((Dictionary<string,object>)req["payload"]);
            else if(op=="bluetoothSettings") {System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo("ms-settings:bluetooth") {UseShellExecute=true});result=new {opened=true};}
            else if(op=="listHistory")result=JournalArchive.List();
            else if(op=="snapshot")result=JournalArchive.Snapshot("manual");
            else if(op=="previewHistory")result=JournalArchive.Preview(Convert.ToString(((Dictionary<string,object>)req["payload"])["id"]));
            else if(op=="restoreHistory")result=JournalArchive.Restore(Convert.ToString(((Dictionary<string,object>)req["payload"])["token"]));
            else if(op=="importBackup")result=JournalArchive.PickImport();
            else if(op=="exportData")result=JournalArchive.Export((Dictionary<string,object>)req["payload"]);
            else if(op=="importMarkdown")result=JournalArchive.PickMarkdown();
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
    internal async Task<string> ExecuteApi(string request)
    {
        if(!ready||closing||transitionPending)throw new InvalidOperationException("Schedule is loading or closing; retry after it is ready.");
        object parsed=Program.Json.DeserializeObject(request);
        string id=Guid.NewGuid().ToString("N");var completion=new TaskCompletionSource<string>();apiReplies[id]=completion;
        try {
            await web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('journal:api',{detail:"+Program.Json.Serialize(new{requestId=id,request=parsed})+"}))");
            if(await Task.WhenAny(completion.Task,Task.Delay(55000))!=completion.Task)throw new TimeoutException("API response timed out; inspect state before retrying a write.");
            return await completion.Task;
        } finally {apiReplies.Remove(id);}
    }
    // Called only on the Bluetooth worker. The UI thread remains free to answer
    // WebView API requests and process saveSchedule/saveState bridge messages.
    Dictionary<string,object> BluetoothApi(Dictionary<string,object> request)
    {
        string json=ScheduleSync.Wire.Json.Serialize(request);
        var reply=new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        BeginInvoke(new Action(async delegate {
            try {reply.TrySetResult(await ExecuteApi(json));}
            catch(Exception error) {reply.TrySetException(error);}
        }));
        return ScheduleSync.Wire.Object(ScheduleSync.Wire.Json.DeserializeObject(reply.Task.GetAwaiter().GetResult()));
    }
    ReleaseUpdate updateCandidate;
    UpdatePlan updatePlan;
    string updateFolder;
    bool updateBusy;
    async Task<object> CheckUpdate() {
        if(updateBusy)throw new InvalidOperationException("正在准备更新，请稍候。");
        updateBusy=true;
        try {
            updatePlan=null;updateCandidate=null;
            var current=System.Reflection.Assembly.GetExecutingAssembly().GetName().Version;
            updateCandidate=await Task.Run(()=>ReleaseUpdate.Check(current));
            return new {current=current.ToString(3),available=updateCandidate!=null,version=updateCandidate==null?"":updateCandidate.Version,notes=updateCandidate==null?"":updateCandidate.Notes};
        }finally{updateBusy=false;}
    }
    async Task<object> DownloadUpdate() {
        if(updateBusy||updateCandidate==null)throw new InvalidOperationException("请先检查更新。");
        updateBusy=true;
        try {
            updateFolder=Path.Combine(Program.DataDir,"updates",Guid.NewGuid().ToString("N"));Directory.CreateDirectory(updateFolder);
            string app=Path.GetFullPath(Program.AppDir).TrimEnd(Path.DirectorySeparatorChar)+Path.DirectorySeparatorChar;
            if(Path.GetFullPath(Program.DataDir).StartsWith(app,StringComparison.OrdinalIgnoreCase))throw new IOException("程序目录包含数据目录，请将程序移到独立目录后更新。");
            updatePlan=await Task.Run(()=>{
                string archive=Path.Combine(updateFolder,"release.zip");updateCandidate.Download(archive,percent=>BeginInvoke(new Action(async delegate{await web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('journal:update-progress',{detail:"+percent+"}))");})));
                return UpdateInstall.Extract(archive,Path.Combine(updateFolder,"payload"),Program.AppDir,updateCandidate.Version);
            });
            return new{ready=true};
        }finally{updateBusy=false;}
    }
    async Task<object> InstallUpdate() {
        if(updateBusy||updatePlan==null)throw new InvalidOperationException("请先下载并校验更新。");
        if(bluetoothRunning||autoChecking)throw new InvalidOperationException("正在同步，请同步结束后再安装。");
        updateBusy=true;
        try {
            var saved=Program.Json.Deserialize<Dictionary<string,object>>(await ExecuteApi(Program.Json.Serialize(new{op="get_day",date=DateTime.Now.ToString("yyyy-MM-dd")})));
            if(!Convert.ToBoolean(saved["ok"]))throw new IOException(Convert.ToString(saved["error"]));
            Program.Save();JournalArchive.Snapshot("before-update");
            var process=System.Diagnostics.Process.GetCurrentProcess();updatePlan.ProcessId=process.Id;updatePlan.ProcessStarted=process.StartTime.ToUniversalTime().Ticks;
            string helper=Path.Combine(updateFolder,"Schedule.Update.exe");File.Copy(Path.Combine(Program.AppDir,"Schedule.Update.exe"),helper,true);
            File.WriteAllText(Path.Combine(updateFolder,"plan.json"),Program.Json.Serialize(updatePlan));
            System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(helper){UseShellExecute=true,WorkingDirectory=updateFolder});
            closing=true;BeginInvoke(new Action(Close));return new{installing=true};
        }catch{updateBusy=false;throw;}
    }
    async Task<object> SyncBluetooth(Dictionary<string,object> payload,bool automatic=false,Stream connected=null)
    {
        if(updateBusy)throw new InvalidOperationException("正在准备更新，请稍后同步。");
        if(bluetoothRunning)throw new InvalidOperationException("正在同步，请等待本次同步结束。");
        if(!automatic&&autoChecking)throw new InvalidOperationException("正在检查或同步连接，请稍候；自动同步会继续处理。");
        object value;ulong address;
        if(payload==null||!payload.TryGetValue("address",out value)||!(value is string)||
           !System.Text.RegularExpressions.Regex.IsMatch((string)value,@"\A[0-9a-fA-F]{12}\z")||
           !UInt64.TryParse((string)value,System.Globalization.NumberStyles.HexNumber,System.Globalization.CultureInfo.InvariantCulture,out address))
            throw new ArgumentException("请选择已配对的手机。");
        bluetoothRunning=true;
        try {
            // Flush current edits through the same guarded path before the first
            // disk snapshot. This does not alter protocol source identity.
            string response=await ExecuteApi(Program.Json.Serialize(new {op="get_day",date=DateTime.Now.ToString("yyyy-MM-dd")}));
            var readyResponse=Program.Json.Deserialize<Dictionary<string,object>>(response);
            if(!Convert.ToBoolean(readyResponse["ok"]))throw new InvalidOperationException(Convert.ToString(readyResponse["error"]));
            var journal=new ScheduleSync.DesktopJournal(Program.StateFile,request=>{request["peer"]=address.ToString("X12");return BluetoothApi(request);});
            bool wifi=!payload.ContainsKey("wifi")||Convert.ToBoolean(payload["wifi"]);
            Action<string> report=progressText=>BeginInvoke(new Action(async delegate {
                await web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('journal:sync-progress',{detail:"+Program.Json.Serialize(progressText)+"}))");
            }));
            string message=await Task.Run(() => {
                if(connected!=null)return ScheduleSync.SyncSession.Run(connected,journal,wifi?(Func<Dictionary<string,object>,ScheduleSync.WifiTransferConnection>)(offer=>ScheduleSync.WifiTransferConnection.Open(offer)):null,report,automatic);
                using(var stream=BluetoothTransport.Open(address))
                    return ScheduleSync.SyncSession.Run(stream,journal,wifi?(Func<Dictionary<string,object>,ScheduleSync.WifiTransferConnection>)(offer=>ScheduleSync.WifiTransferConnection.Open(offer)):null,report,automatic);
            });
            if(!String.IsNullOrEmpty(journal.CompletedReviewId))JournalSyncReview.Complete(journal.CompletedReviewId);
            return new {message=message};
        } finally {bluetoothRunning=false;}
    }
    Dictionary<string,object> ProbePhone(ulong address) {
        using(var probe=new BluetoothTransport.ProbeConnection(address,autoSettings.Hours))return probe.Status;
    }
    async Task AutoSyncTick() {
        if(!ready||closing||transitionPending||updateBusy||bluetoothRunning||autoChecking||!autoSettings.Enabled||autoSettings.Peer==""||DateTime.UtcNow<autoPolicy.RetryAfter)return;
        autoChecking=true;
        try {
            var review=JournalSyncReview.Load();
            if(review!=null&&!Convert.ToBoolean(review["approved"])){autoSettings.Message="有冲突待确认，自动同步已暂停";return;}
            ulong peer=Convert.ToUInt64(autoSettings.Peer,16);Dictionary<string,object> status;
            BluetoothTransport.ProbeConnection probe;
            try {probe=await Task.Run(()=>new BluetoothTransport.ProbeConnection(peer,autoSettings.Hours));}
            catch(Exception error){autoPolicy.Failure(DateTime.UtcNow,true);autoSettings.Message="暂未连接到手机，将自动重试";autoSettings.Error=error.Message;return;}
            using(probe) {
            status=probe.Status;
            autoSettings.Error="";
            if(!autoSettings.Enabled)return;
            if(!ScheduleSync.Wire.Boolean(status,"enabled")){autoSettings.Message="手机已暂停自动同步";return;}
            var changed=DateTimeOffset.FromUnixTimeMilliseconds(Convert.ToInt64(status["changed"])).UtcDateTime;
            var localChanged=File.GetLastWriteTimeUtc(Program.StateFile);if(localChanged>changed)changed=localChanged;
            string revision=Convert.ToString(status["revision"])+"|"+localChanged.Ticks;
            int hours=autoSettings.Hours;
            bool due=autoPolicy.Due(DateTime.UtcNow,revision,changed,hours);autoPolicy.Reachable=true;
            if(!due)return;
            autoSettings.Message="正在自动同步…";await PublishAutoStatus();
            var connected=await Task.Run(()=>probe.Continue());
            await SyncBluetooth(new Dictionary<string,object>{{"address",autoSettings.Peer},{"wifi",true}},true,connected);
            }
            review=JournalSyncReview.Load();
            if(review!=null){autoSettings.Message="有冲突待确认，自动同步已暂停";return;}
            // Import redraws the editor and can queue a projection save. Settle it
            // before recording the baseline, otherwise that save looks like a new edit.
            var settled=Program.Json.Deserialize<Dictionary<string,object>>(await ExecuteApi(Program.Json.Serialize(new{op="get_day",date=DateTime.Now.ToString("yyyy-MM-dd")})));
            if(!Convert.ToBoolean(settled["ok"]))throw new InvalidOperationException(Convert.ToString(settled["error"]));
            status=await Task.Run(()=>ProbePhone(peer));
            string baseline=Convert.ToString(status["revision"])+"|"+File.GetLastWriteTimeUtc(Program.StateFile).Ticks;
            autoPolicy.Success(DateTime.UtcNow,baseline);autoSettings.LastSuccess=autoPolicy.LastSuccess;autoSettings.Message="已自动同步";autoSettings.Save();
        }catch(Exception error){autoPolicy.Failure(DateTime.UtcNow,false);autoSettings.Message="本次同步未完成，将稍后重试";autoSettings.Error=error.Message;}
        finally{autoChecking=false;if(!closing&&!IsDisposed)BeginInvoke(new Action(async delegate{await PublishAutoStatus();}));}
    }
    async Task PublishAutoStatus(){if(!closing&&!IsDisposed&&web.CoreWebView2!=null)await web.CoreWebView2.ExecuteScriptAsync("window.dispatchEvent(new CustomEvent('journal:auto-sync',{detail:"+Program.Json.Serialize(autoSettings.View())+"}))");}
    async Task AnalysisTick(){
        if(!ready||closing)return;
        if(analysisBusy){
            var cancellation=analysisCancel;string active=activeAnalysisId;
            if(cancellation!=null&&active!="")try{string status=await web.CoreWebView2.ExecuteScriptAsync("window.scheduleAnalysisCancelled("+Program.Json.Serialize(active)+")");if(status=="true"&&cancellation==analysisCancel)cancellation.Cancel();}catch(Exception error){System.Diagnostics.Debug.WriteLine(error.Message);}
            return;
        }
        if(bluetoothRunning||autoChecking||updateBusy||!analysis.Enabled)return;
        analysisBusy=true;analysisCancel=new System.Threading.CancellationTokenSource();
        try{
            string raw=await web.CoreWebView2.ExecuteScriptAsync("window.scheduleAnalysisPending&&window.scheduleAnalysisPending("+Program.Json.Serialize(analysis.Provider)+")");
            var item=Program.Json.DeserializeObject(raw) as Dictionary<string,object>;if(item==null)return;
            string id=Convert.ToString(item["id"]);activeAnalysisId=id;var row=(Dictionary<string,object>)item["row"];
            var running=new {status="running",error=""};
            var applied=Program.Json.Deserialize<Dictionary<string,object>>(await ExecuteApi(Program.Json.Serialize(new{op="assistant_update",id=id,expected=row,patch=running})));
            if(!Convert.ToBoolean(applied["ok"])||!Convert.ToBoolean(applied["result"]))return;
            Dictionary<string,object> outcome;
            try{outcome=await Task.Run(()=>analysis.Run(id,row,analysisCancel.Token));}
            catch(Exception error){outcome=new Dictionary<string,object>{{"status","failed"},{"error",error.Message}};}
            if(!closing&&!IsDisposed)await ExecuteApi(Program.Json.Serialize(new{op="assistant_update",id=id,expected=row,patch=outcome}));
        }catch(Exception error){System.Diagnostics.Debug.WriteLine("Schedule analysis: "+error.Message);}
        finally{analysisBusy=false;activeAnalysisId="";analysisCancel.Dispose();analysisCancel=null;}
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
