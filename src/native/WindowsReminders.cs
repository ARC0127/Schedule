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

internal static class WindowsReminders
{
    static ToastNotifierCompat Notifier() { return ToastNotificationManagerCompat.CreateToastNotifier(); }
    static string Tag(string key) {
        if(!key.Contains("/"))return "d"+key.Replace("-", "");
        using(var hash=System.Security.Cryptography.SHA256.Create())return BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(key))).Replace("-", "").Substring(0,16);
    }
    static void Cancel(string date)
    {
        if(Environment.GetEnvironmentVariable("SCHEDULE_TEST_DATA")!=null)return;
        var notifier = Notifier();
        foreach (var item in notifier.GetScheduledToastNotifications().Where(n => n.Group == "journal" && n.Tag == Tag(date)).ToArray()) notifier.RemoveFromSchedule(item);
    }
    static XmlDocument Payload(string date, string title, string time)
    {
        var doc = new XmlDocument();
        doc.LoadXml("<toast launch=\"date=" + SecurityElement.Escape(date) + "\"><visual><binding template=\"ToastGeneric\"><text>" + SecurityElement.Escape(title) + "</text><text>" + SecurityElement.Escape(date + " · " + time) + "</text></binding></visual></toast>");
        return doc;
    }
    internal static void Reconcile(string date, Schedule s)
    {
        try {
            Cancel(date);
            if (s.Done || s.RemindMinutes < 0) { s.Status = "off"; s.Error = null; return; }
            var due = DateTimeOffset.Parse(s.At, System.Globalization.CultureInfo.InvariantCulture).AddMinutes(-s.RemindMinutes);
            if (due <= DateTimeOffset.Now) { s.Status = "elapsed"; s.Error = null; return; }
            var notifier = Notifier();
            if (notifier.Setting != NotificationSetting.Enabled) throw new InvalidOperationException("Windows 未允许Schedule通知：" + notifier.Setting);
            if(Environment.GetEnvironmentVariable("SCHEDULE_TEST_DATA")!=null){s.Status="test";s.Error=null;return;}
            var n = new ScheduledToastNotification(Payload(s.Date??date.Split('/')[0], s.Title, s.Time), due) { Tag = Tag(date), Group = "journal" };
            notifier.AddToSchedule(n);
            if (!notifier.GetScheduledToastNotifications().Any(x => x.Tag == n.Tag && x.Group == n.Group)) throw new InvalidOperationException("Windows 未确认提醒排程。");
            s.Status = "scheduled"; s.Error = null;
        } catch (Exception e) { s.Status = "error"; s.Error = e.Message; }
    }
    internal static object SetSchedule(Dictionary<string, object> payload)
    {
        string date = Convert.ToString(payload["date"]);
        DateTime parsed;
        if (!DateTime.TryParseExact(date, "yyyy-MM-dd", null, System.Globalization.DateTimeStyles.None, out parsed)) throw new ArgumentException("日程日期无效。");
        string id=payload.ContainsKey("id")?Convert.ToString(payload["id"]):null;
        string key=date;
        if(payload.ContainsKey("id")) {
            if(String.IsNullOrEmpty(id))id=Guid.NewGuid().ToString("N");
            if(!System.Text.RegularExpressions.Regex.IsMatch(id,@"^[a-zA-Z0-9-]{1,80}$"))throw new ArgumentException("日程标识无效。");
            key=Program.Data.Schedules.FirstOrDefault(p=>(p.Value.Date??p.Key.Split('/')[0])==date&&p.Value.Id==id).Key??date+"/"+id;
        }
        if (payload["schedule"] == null) {
            // Cancel first: a failed cancellation must remain visible and retryable in the UI.
            Cancel(key);
            Schedule previous; Program.Data.Schedules.TryGetValue(key, out previous);
            Program.Data.Schedules.Remove(key);
            try { Program.Save(); } catch { if (previous != null) { Program.Data.Schedules[key] = previous; Reconcile(key, previous); } throw; }
            return new { status = "removed" };
        }
        var s = Program.Json.Deserialize<Schedule>(Program.Json.Serialize(payload["schedule"]));
        s.Id=id??"legacy-"+date;s.Date=date;
        TaskLinks.Validate(Program.Data,s);
        DateTimeOffset at;
        if (String.IsNullOrWhiteSpace(s.Title) || s.Title.Length > 100 || !DateTimeOffset.TryParse(s.At, out at) || !new[] {-1,0,5,15,30,60}.Contains(s.RemindMinutes)) throw new ArgumentException("请检查日程标题和提醒时间。");
        if (at.LocalDateTime.ToString("yyyy-MM-dd") != date || at.LocalDateTime.ToString("HH:mm") != s.Time) throw new ArgumentException("日程日期与时间不一致。");
        if (!s.Done && s.RemindMinutes >= 0 && at.AddMinutes(-s.RemindMinutes) <= DateTimeOffset.Now) throw new ArgumentException("提醒时间已过，请选择未来时间或不提醒。");
        Schedule old; Program.Data.Schedules.TryGetValue(key, out old);
        s.Status = "pending"; Program.Data.Schedules[key] = s;
        try { Program.Save(); } catch { if (old == null) Program.Data.Schedules.Remove(key); else Program.Data.Schedules[key] = old; throw; }
        Reconcile(key, s);
        Program.Save();
        return s;
    }
    internal static string ReplaceAll(Dictionary<string,Schedule> previous)
    {
        // A restored backup must not leave notifications for events removed by the restore.
        var warnings=new List<string>();
        foreach(var key in previous.Keys) {
            try { Cancel(key); } catch(Exception e) { warnings.Add("旧提醒取消失败："+e.Message); }
        }
        foreach(var pair in Program.Data.Schedules)Reconcile(pair.Key,pair.Value);
        return warnings.Count==0?null:String.Join("\n",warnings.Distinct());
    }
    internal static object TestNotification()
    {
        var notifier = Notifier();
        if (notifier.Setting != NotificationSetting.Enabled) throw new InvalidOperationException("Windows 通知被关闭：" + notifier.Setting);
        notifier.Show(new ToastNotification(Payload(DateTime.Now.ToString("yyyy-MM-dd"), "Schedule · 提醒测试", "Windows 提醒已连接")) {Tag="test",Group="journal"});
        return new { status = "sent" };
    }
    internal static int Diagnostic(string[] args)
    {
        object result;
        var notifier = Notifier();
        string op = args.Length > 1 ? args[1] : "list";
        if (op == "schedule-test") {
            foreach (var x in notifier.GetScheduledToastNotifications().Where(x=>x.Group=="journal-test").ToArray()) notifier.RemoveFromSchedule(x);
            var n = new ScheduledToastNotification(Payload(DateTime.Now.ToString("yyyy-MM-dd"), "Schedule · 后台排程测试", "这是一次接入验证"), DateTimeOffset.Now.AddSeconds(15)) { Tag="schedule-test",Group="journal-test" };
            notifier.AddToSchedule(n);
            result = new { setting=notifier.Setting.ToString(), count=notifier.GetScheduledToastNotifications().Count(x=>x.Group=="journal-test") };
        } else if (op == "cancel-test") {
            foreach(var n in notifier.GetScheduledToastNotifications().Where(x=>x.Group=="journal-test").ToArray()) notifier.RemoveFromSchedule(n);
            ToastNotificationManagerCompat.History.RemoveGroup("journal-test");
            result = new { cleaned=true };
        } else if (op == "set") result = SetSchedule(Program.Json.Deserialize<Dictionary<string,object>>(File.ReadAllText(args[2],Encoding.UTF8)));
        else result = new { setting=notifier.Setting.ToString(), pending=notifier.GetScheduledToastNotifications().Select(x=>new {x.Tag,x.Group,delivery=x.DeliveryTime.ToString("o")}).ToArray(), history=ToastNotificationManagerCompat.History.GetHistory().Select(x=>new {x.Tag,x.Group}).ToArray() };
        File.WriteAllText(Path.Combine(Program.DataDir,"diagnostic.json"), Program.Json.Serialize(result),new UTF8Encoding(false));
        return 0;
    }
}
