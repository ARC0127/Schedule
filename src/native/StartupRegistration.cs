using System;
using System.IO;
using Microsoft.Win32;

internal static class StartupRegistration
{
    // Tests never register a real logon entry.
    internal static readonly string KeyPath=Environment.GetEnvironmentVariable("SCHEDULE_TEST_DATA")==null?
        @"Software\Microsoft\Windows\CurrentVersion\Run":@"Software\Schedule\DevelopmentTests\Startup";
    internal const string ValueName="Schedule";
    internal static string Command { get { return "\""+Path.Combine(Program.AppDir,"Journal.exe")+"\" --autostart"; } }
    internal static bool IsEnabled()
    {
        using(var key=Registry.CurrentUser.OpenSubKey(KeyPath))return key!=null&&String.Equals(key.GetValue(ValueName) as string,Command,StringComparison.OrdinalIgnoreCase);
    }
    internal static void SetEnabled(bool enabled)
    {
        using(var key=Registry.CurrentUser.CreateSubKey(KeyPath)){
            var existing=key.GetValue(ValueName) as string;
            if(existing!=null&&!String.Equals(existing,Command,StringComparison.OrdinalIgnoreCase))throw new InvalidOperationException("已有另一项名为 Schedule 的启动配置，未覆盖它。");
            if(enabled){if(Command.Length>260)throw new InvalidOperationException("程序路径过长，无法设置开机启动。");key.SetValue(ValueName,Command,RegistryValueKind.String);}
            else if(existing!=null)key.DeleteValue(ValueName,false);
        }
        if(IsEnabled()!=enabled)throw new IOException("Windows 未保存开机启动设置。");
    }
}
