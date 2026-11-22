using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Net.Sockets;
using System.Runtime.InteropServices;

namespace ScheduleSync
{
    internal sealed class Rfcomm : Stream
    {
        const int AfBth = 32, SockStream = 1, RfcommProtocol = 3;
        const int SocketLevel = 0xffff, ReceiveTimeout = 0x1006, SendTimeout = 0x1005;
        const int Authenticate = unchecked((int)0x80000001), Encrypt = 2;
        static readonly IntPtr InvalidSocket = new IntPtr(-1);
        internal static readonly Guid Service = new Guid("eb703723-8f0f-4b98-aa19-be0423b0a0c6");
        IntPtr handle = InvalidSocket;
        bool started;

        [DllImport("ws2_32.dll")] static extern int WSAStartup(ushort version, [Out] byte[] data);
        [DllImport("ws2_32.dll")] static extern int WSACleanup();
        [DllImport("ws2_32.dll")] static extern int WSAGetLastError();
        [DllImport("ws2_32.dll")] static extern IntPtr socket(int family, int type, int protocol);
        [DllImport("ws2_32.dll")] static extern int closesocket(IntPtr socket);
        [DllImport("ws2_32.dll")] static extern int setsockopt(IntPtr socket, int level, int name, ref int value, int length);
        [DllImport("ws2_32.dll")] static extern int connect(IntPtr socket, byte[] address, int size);
        [DllImport("ws2_32.dll")] static extern int send(IntPtr socket, byte[] bytes, int length, int flags);
        [DllImport("ws2_32.dll")] static extern int recv(IntPtr socket, [Out] byte[] bytes, int length, int flags);

        [StructLayout(LayoutKind.Sequential)]
        struct Search
        {
            public int Size;
            public int Authenticated, Remembered, Unknown, Connected, Inquiry;
            public byte TimeoutMultiplier;
            public IntPtr Radio;
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        struct DeviceInfo
        {
            public int Size;
            public ulong Address;
            public int ClassOfDevice, Connected, Remembered, Authenticated;
            public System.Runtime.InteropServices.ComTypes.FILETIME LastSeen0, LastSeen1;
            public System.Runtime.InteropServices.ComTypes.FILETIME LastUsed0, LastUsed1;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 248)] public string Name;
        }

        [DllImport("bthprops.cpl", SetLastError = true)]
        static extern IntPtr BluetoothFindFirstDevice(ref Search search, ref DeviceInfo info);
        [DllImport("bthprops.cpl", SetLastError = true)]
        static extern bool BluetoothFindNextDevice(IntPtr search, ref DeviceInfo info);
        [DllImport("bthprops.cpl")] static extern bool BluetoothFindDeviceClose(IntPtr search);

        internal sealed class Device
        {
            internal readonly ulong Address;
            internal readonly string Name;
            internal Device(ulong address, string name) { Address = address; Name = name; }
            public override string ToString()
            {
                return Name + "  ·  " + Address.ToString("X12");
            }
        }

        internal static List<Device> PairedDevices()
        {
            var search = new Search { Size = Marshal.SizeOf(typeof(Search)), Authenticated = 1 };
            var info = new DeviceInfo { Size = Marshal.SizeOf(typeof(DeviceInfo)) };
            var devices = new List<Device>();
            IntPtr found = BluetoothFindFirstDevice(ref search, ref info);
            if (found == IntPtr.Zero)
            {
                int error = Marshal.GetLastWin32Error();
                if (error == 259 || error == 1168) return devices;
                throw new Win32Exception(error, "Bluetooth device enumeration failed (" + error + ").");
            }
            try
            {
                do
                {
                    if (info.Authenticated != 0 && !devices.Exists(device => device.Address == info.Address))
                        devices.Add(new Device(info.Address, info.Name));
                } while (BluetoothFindNextDevice(found, ref info));
                int error = Marshal.GetLastWin32Error();
                if (error != 259) throw new Win32Exception(error);
                return devices;
            }
            finally { BluetoothFindDeviceClose(found); }
        }

        Rfcomm()
        {
            int error = WSAStartup(0x0202, new byte[512]);
            if (error != 0) throw new SocketException(error);
            started = true;
            try
            {
                handle = socket(AfBth, SockStream, RfcommProtocol);
                if (handle == InvalidSocket) throw new SocketException(WSAGetLastError());
                Option(RfcommProtocol, Authenticate, 1);
                Option(RfcommProtocol, Encrypt, 1);
                Option(SocketLevel, ReceiveTimeout, 20000);
                Option(SocketLevel, SendTimeout, 20000);
            }
            catch { Dispose(); throw; }
        }

        internal static void Probe()
        {
            using (var stream = new Rfcomm()) {}
        }

        internal static Rfcomm Open(ulong address)
        {
            var stream = new Rfcomm();
            try
            {
                byte[] endpoint = Endpoint(address);
                if (connect(stream.handle, endpoint, endpoint.Length) != 0) throw new SocketException(WSAGetLastError());
                return stream;
            }
            catch { stream.Dispose(); throw; }
        }

        internal static byte[] Endpoint(ulong address)
        {
            // SOCKADDR_BTH is byte-packed. A zero channel requests SDP lookup by UUID.
            var endpoint = new byte[30];
            Buffer.BlockCopy(BitConverter.GetBytes((ushort)AfBth), 0, endpoint, 0, 2);
            Buffer.BlockCopy(BitConverter.GetBytes(address), 0, endpoint, 2, 8);
            Buffer.BlockCopy(Service.ToByteArray(), 0, endpoint, 10, 16);
            return endpoint;
        }

        void Option(int level, int name, int value)
        {
            if (setsockopt(handle, level, name, ref value, sizeof(int)) != 0)
                throw new SocketException(WSAGetLastError());
        }

        public override int Read(byte[] buffer, int offset, int count)
        {
            if (count == 0) return 0;
            var target = offset == 0 ? buffer : new byte[Math.Min(count, 16384)];
            int read = recv(handle, target, Math.Min(count, target.Length), 0);
            if (read < 0) throw new SocketException(WSAGetLastError());
            if (offset != 0) Buffer.BlockCopy(target, 0, buffer, offset, read);
            return read;
        }

        public override void Write(byte[] buffer, int offset, int count)
        {
            var packet = new byte[16384];
            while (count > 0)
            {
                int requested = Math.Min(packet.Length, count);
                Buffer.BlockCopy(buffer, offset, packet, 0, requested);
                int written = send(handle, packet, requested, 0);
                if (written <= 0) throw new SocketException(WSAGetLastError());
                offset += written;
                count -= written;
            }
        }

        protected override void Dispose(bool disposing)
        {
            if (handle != InvalidSocket) { closesocket(handle); handle = InvalidSocket; }
            if (started) { WSACleanup(); started = false; }
            base.Dispose(disposing);
        }

        public override bool CanRead { get { return true; } }
        public override bool CanWrite { get { return true; } }
        public override bool CanSeek { get { return false; } }
        public override void Flush() {}
        public override long Length { get { throw new NotSupportedException(); } }
        public override long Position { get { throw new NotSupportedException(); } set { throw new NotSupportedException(); } }
        public override long Seek(long offset, SeekOrigin origin) { throw new NotSupportedException(); }
        public override void SetLength(long value) { throw new NotSupportedException(); }
    }
}

