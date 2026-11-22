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
        if (pipe == null) {
            try{return ScheduleSync.Rfcomm.Open(address);}
            catch(System.Net.Sockets.SocketException error){throw new IOException("Windows 蓝牙连接未能建立（错误 "+error.NativeErrorCode+"）："+error.Message,error);}
        }
        var stream = new NamedPipeClientStream(".", pipe, PipeDirection.InOut);
        try {stream.Connect(5000); return stream;}
        catch {stream.Dispose(); throw;}
    }

    // New phones acknowledge a probe and keep the same RFCOMM connection for
    // a due transfer. Older phones still use the previous one-shot probe.
    internal sealed class ProbeConnection : IDisposable
    {
        Stream stream;
        bool pending;
        internal readonly Dictionary<string,object> Status;
        internal ProbeConnection(ulong address,int hours) {
            stream=Open(address);
            try {
                var hello=ScheduleSync.Wire.Frame("hello");hello["autoProbe"]=true;hello["hours"]=hours;hello["continueSync"]=true;
                ScheduleSync.Wire.Send(stream,hello);Status=ScheduleSync.Wire.Receive(stream,"auto-status");
                object supported;pending=Status.TryGetValue("continueSync",out supported)&&Convert.ToBoolean(supported);
                if(!pending){stream.Dispose();stream=null;}
            }catch{stream.Dispose();stream=null;throw;}
        }
        internal Stream Continue() {
            if(stream==null)return null;
            var next=ScheduleSync.Wire.Frame("auto-next");next["sync"]=true;
            ScheduleSync.Wire.Send(stream,next);pending=false;return stream;
        }
        public void Dispose() {
            if(stream==null)return;
            try {if(pending){var next=ScheduleSync.Wire.Frame("auto-next");next["sync"]=false;ScheduleSync.Wire.Send(stream,next);}}
            catch(IOException){}catch(System.Net.Sockets.SocketException){}
            finally{stream.Dispose();stream=null;}
        }
    }
}
