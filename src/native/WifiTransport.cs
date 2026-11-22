using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Security;
using System.Net.Sockets;
using System.Runtime.InteropServices;
using System.Security;
using System.Security.Authentication;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using Map=System.Collections.Generic.Dictionary<string,object>;

namespace ScheduleSync {
internal sealed class TemporaryWifi:IDisposable {
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Interface {public Guid Id;[MarshalAs(UnmanagedType.ByValTStr,SizeConst=256)]public string Description;public int State;}
    [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)] struct Parameters {public int Mode;[MarshalAs(UnmanagedType.LPWStr)]public string Profile;public IntPtr Ssid,Bssid;public int BssType;public uint Flags;}
    [DllImport("wlanapi.dll")]static extern uint WlanOpenHandle(uint version,IntPtr reserved,out uint negotiated,out IntPtr handle);
    [DllImport("wlanapi.dll")]static extern uint WlanCloseHandle(IntPtr handle,IntPtr reserved);
    [DllImport("wlanapi.dll")]static extern uint WlanEnumInterfaces(IntPtr handle,IntPtr reserved,out IntPtr list);
    [DllImport("wlanapi.dll")]static extern void WlanFreeMemory(IntPtr memory);
    [DllImport("wlanapi.dll")]static extern uint WlanQueryInterface(IntPtr handle,ref Guid id,int opcode,IntPtr reserved,out int size,out IntPtr data,out int type);
    [DllImport("wlanapi.dll",CharSet=CharSet.Unicode)]static extern uint WlanConnect(IntPtr handle,ref Guid id,ref Parameters parameters,IntPtr reserved);
    [DllImport("wlanapi.dll")]static extern uint WlanDisconnect(IntPtr handle,ref Guid id,IntPtr reserved);
    IntPtr handle;Guid id;string previous;bool changed;
    static void Check(uint code){if(code!=0)throw new Win32Exception((int)code,"Windows 无线连接操作失败 ("+code+")。");}
    string Current() {
        int size,type;IntPtr data;
        uint code=WlanQueryInterface(handle,ref id,7,IntPtr.Zero,out size,out data,out type);
        if(code==5023)return null;Check(code);
        try{return Marshal.ReadInt32(data)==1?Marshal.PtrToStringUni(IntPtr.Add(data,8)):null;}finally{WlanFreeMemory(data);}
    }
    void Connect(string profile,bool temporary) {var p=new Parameters{Mode=temporary?1:0,Profile=profile,BssType=1};Check(WlanConnect(handle,ref id,ref p,IntPtr.Zero));}
    internal static string Profile(string name,string ssid,string password) {
        if(Encoding.UTF8.GetByteCount(ssid)<1||Encoding.UTF8.GetByteCount(ssid)>32||password.Length<8||password.Length>63)throw new InvalidDataException("Invalid hotspot credentials.");
        string hex=BitConverter.ToString(Encoding.UTF8.GetBytes(ssid)).Replace("-","");
        return "<WLANProfile xmlns=\"http://www.microsoft.com/networking/WLAN/profile/v1\"><name>"+SecurityElement.Escape(name)+"</name><SSIDConfig><SSID><hex>"+hex+"</hex></SSID></SSIDConfig><connectionType>ESS</connectionType><connectionMode>manual</connectionMode><MSM><security><authEncryption><authentication>WPA2PSK</authentication><encryption>AES</encryption><useOneX>false</useOneX></authEncryption><sharedKey><keyType>passPhrase</keyType><protected>false</protected><keyMaterial>"+SecurityElement.Escape(password)+"</keyMaterial></sharedKey></security></MSM></WLANProfile>";
    }
    internal TemporaryWifi(string ssid,string password) {
        uint version;Check(WlanOpenHandle(2,IntPtr.Zero,out version,out handle));
        try {
            IntPtr list;Check(WlanEnumInterfaces(handle,IntPtr.Zero,out list));
            try {
                int count=Marshal.ReadInt32(list),size=Marshal.SizeOf(typeof(Interface));
                if(count==0)throw new IOException("电脑没有可用的 Wi-Fi 网卡。");
                var choices=new List<Interface>();for(int i=0;i<count;i++)choices.Add((Interface)Marshal.PtrToStructure(IntPtr.Add(list,8+i*size),typeof(Interface)));
                id=choices.OrderByDescending(v=>v.State==1).First().Id;
            }finally{WlanFreeMemory(list);}
            previous=Current();string name="Schedule-"+Guid.NewGuid().ToString("N");
            Connect(Profile(name,ssid,password),true);changed=true;
            for(int i=0;i<90;i++){if(Current()==name)return;Thread.Sleep(500);}
            throw new IOException("连接手机临时 Wi-Fi 超时。");
        }catch{Dispose();throw;}
    }
    internal IEnumerable<string> Gateways() {
        var nic=NetworkInterface.GetAllNetworkInterfaces().FirstOrDefault(n=>n.Id.Trim('{','}').Equals(id.ToString(),StringComparison.OrdinalIgnoreCase));
        if(nic==null)return new string[0];var p=nic.GetIPProperties();
        return p.GatewayAddresses.Select(v=>v.Address.ToString()).Concat(p.DhcpServerAddresses.Select(v=>v.ToString())).Distinct().ToArray();
    }
    public void Dispose() {
        if(handle==IntPtr.Zero)return;
        try {
            if(changed) {
                if(String.IsNullOrEmpty(previous))Check(WlanDisconnect(handle,ref id,IntPtr.Zero));
                else {
                    Connect(previous,false);
                    for(int i=0;i<40;i++){if(Current()==previous)return;Thread.Sleep(500);}
                    throw new IOException("传输通道已关闭，但原 Wi-Fi 未恢复，请在系统中重新连接。");
                }
            }
        }finally{WlanCloseHandle(handle,IntPtr.Zero);handle=IntPtr.Zero;}
    }
}
internal sealed class WifiTransferConnection:IDisposable {
    internal Stream Stream;TcpClient client;TemporaryWifi temporary;
    internal static bool LocalAddress(string host,bool test=false) {
        IPAddress ip;if(!IPAddress.TryParse(host,out ip)||ip.AddressFamily!=AddressFamily.InterNetwork)return false;
        var b=ip.GetAddressBytes();return b[0]==10||b[0]==172&&b[1]>=16&&b[1]<=31||b[0]==192&&b[1]==168||test&&b[0]==127;
    }
    internal static WifiTransferConnection Open(Map offer,bool allowTest=false) {
        int port=checked((int)Wire.Number(offer,"port"));string pin=Wire.Text(offer,"fingerprint"),token=Wire.Text(offer,"token");
        if(port<1||port>65535||!System.Text.RegularExpressions.Regex.IsMatch(pin,"\\A[a-f0-9]{64}\\z")||token.Length<24||token.Length>128)throw new InvalidDataException("Invalid Wi-Fi credentials.");
        var result=new WifiTransferConnection();
        try {
            if(offer.ContainsKey("direct")&&Wire.Boolean(offer,"direct"))result.temporary=new TemporaryWifi(Wire.Text(offer,"ssid"),Wire.Text(offer,"password"));
            var hosts=Wire.Array(offer,"hosts").Select(v=>Convert.ToString(v)).Where(h=>LocalAddress(h,allowTest)).Take(8).ToList();
            Exception last=null;int rounds=result.temporary==null?1:4;
            for(int round=0;round<rounds;round++) {
                var candidates=(result.temporary==null?new string[0]:result.temporary.Gateways()).Concat(hosts).Where(h=>LocalAddress(h,allowTest)).Distinct().Take(8);
                foreach(string host in candidates) {
                    var tcp=new TcpClient();try {
                        var pending=tcp.BeginConnect(host,port,null,null);
                        using(pending.AsyncWaitHandle)if(!pending.AsyncWaitHandle.WaitOne(2000))throw new IOException("Wi-Fi connection timed out.");
                        tcp.EndConnect(pending);tcp.ReceiveTimeout=120000;tcp.SendTimeout=120000;
                        var tls=new SslStream(tcp.GetStream(),false,(sender,certificate,chain,errors)=>{
                            if(certificate==null)return false;
                            using(var sha=SHA256.Create())return BitConverter.ToString(sha.ComputeHash(certificate.GetRawCertData())).Replace("-","").ToLowerInvariant()==pin;
                        });
                        tls.ReadTimeout=10000;tls.WriteTimeout=10000;
                        tls.AuthenticateAsClient("Schedule",null,SslProtocols.Tls12,false);
                        var auth=Wire.Frame("wifi-auth");auth["token"]=token;Wire.Send(tls,auth);Wire.Receive(tls,"wifi-ready");
                        tls.ReadTimeout=120000;tls.WriteTimeout=120000;result.client=tcp;result.Stream=tls;return result;
                    }catch(Exception error){last=error;tcp.Close();}
                }
                if(round+1<rounds)Thread.Sleep(1000);
            }
            throw new IOException("Wi-Fi 通道未建立。"+(last==null?"":last.Message));
        }catch{result.Dispose();throw;}
    }
    public void Dispose(){try{if(Stream!=null)Stream.Dispose();if(client!=null)client.Close();}finally{if(temporary!=null){var saved=temporary;temporary=null;saved.Dispose();}}}
}
}
