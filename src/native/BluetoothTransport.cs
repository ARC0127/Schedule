using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Pipes;
using System.Linq;
using System.Text.RegularExpressions;

internal static class BluetoothTransport
{
    // An isolated test profile may replace only the radio stream with a local
    // pipe. Production profiles always enumerate and connect authenticated peers.
    static string TestPipe
    {
        get {
            if (String.IsNullOrEmpty(Environment.GetEnvironmentVariable("SCHEDULE_TEST_DATA"))) return null;
            string name = Environment.GetEnvironmentVariable("SCHEDULE_TEST_BLUETOOTH_PIPE");
            if (String.IsNullOrEmpty(name)) return null;
            if (!Regex.IsMatch(name, @"\AScheduleBluetoothTest-[a-fA-F0-9]{32}\z"))
                throw new InvalidOperationException("Invalid isolated Bluetooth test pipe.");
            return name;
        }
    }

    internal static List<ScheduleSync.Rfcomm.Device> PairedDevices()
    {
        if (TestPipe != null) return new List<ScheduleSync.Rfcomm.Device> {new ScheduleSync.Rfcomm.Device(1, "隔离测试手机")};
        return ScheduleSync.Rfcomm.PairedDevices();
    }

    internal static Stream Open(ulong address)
    {
        if (!PairedDevices().Any(device => device.Address == address))
            throw new InvalidOperationException("请选择仍处于已配对列表中的手机。");
        string pipe = TestPipe;
        if (pipe == null) return ScheduleSync.Rfcomm.Open(address);
        var stream = new NamedPipeClientStream(".", pipe, PipeDirection.InOut);
        try {stream.Connect(5000); return stream;}
        catch {stream.Dispose(); throw;}
    }
}
