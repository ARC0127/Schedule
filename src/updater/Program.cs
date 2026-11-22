using System;
using System.Diagnostics;
using System.IO;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Forms;

internal static class ScheduleUpdater {
    [STAThread]static int Main(string[] args) {
        string folder=AppDomain.CurrentDomain.BaseDirectory;UpdatePlan plan=null;
        try {
            if(args.Length!=0)throw new ArgumentException("Updater does not accept command-line paths.");
            plan=new JavaScriptSerializer().Deserialize<UpdatePlan>(File.ReadAllText(Path.Combine(folder,"plan.json")));
            if(Path.GetFullPath(plan.Stage)!=Path.GetFullPath(Path.Combine(folder,"payload")))throw new IOException("Invalid update staging directory.");
            try {using(var process=Process.GetProcessById(plan.ProcessId)){if(process.StartTime.ToUniversalTime().Ticks==plan.ProcessStarted&&!process.WaitForExit(30000))throw new IOException("Schedule 尚未退出，未安装更新。");}}
            catch(ArgumentException){}
            using(var mutex=new Mutex(false,Environment.GetEnvironmentVariable("SCHEDULE_TEST_DATA")==null?"Local\\CodexJournalDesktop":"Local\\ScheduleTest")) {
                bool locked;try{locked=mutex.WaitOne(1000);}catch(AbandonedMutexException){locked=true;}
                if(!locked)throw new IOException("Schedule 已重新打开，请退出后重试更新。");
                try{UpdateInstall.Apply(plan,Path.Combine(folder,"backup"));}finally{mutex.ReleaseMutex();}
            }
            Process.Start(new ProcessStartInfo(Path.Combine(plan.Target,"Journal.exe")){UseShellExecute=true});return 0;
        }catch(Exception error) {
            File.WriteAllText(Path.Combine(folder,"update-error.txt"),error.ToString());
            MessageBox.Show(error.Message+"\n\n"+folder,"Schedule 更新未完成",MessageBoxButtons.OK,MessageBoxIcon.Error);return 1;
        }
    }
}
