using System;
using System.IO;
using System.Security.Cryptography;
using System.Text;

internal static class ApiProtocol
{
    internal static string Name(string directory)
    {
        using(var hash=SHA256.Create())return "Schedule-"+BitConverter.ToString(hash.ComputeHash(Encoding.UTF8.GetBytes(Path.GetFullPath(directory).ToLowerInvariant()))).Replace("-", "").Substring(0,24);
    }
    internal static void Write(Stream stream,string value)
    {
        var bytes=Encoding.UTF8.GetBytes(value);if(bytes.Length>100*1024*1024)throw new InvalidDataException("API response too large.");
        var size=BitConverter.GetBytes(bytes.Length);stream.Write(size,0,size.Length);stream.Write(bytes,0,bytes.Length);stream.Flush();
    }
    internal static string Read(Stream stream,int limit)
    {
        var size=new byte[4];ReadExact(stream,size);int length=BitConverter.ToInt32(size,0);
        if(length<0||length>limit)throw new InvalidDataException("API message size exceeds limit.");
        var bytes=new byte[length];ReadExact(stream,bytes);return Encoding.UTF8.GetString(bytes);
    }
    static void ReadExact(Stream stream,byte[] buffer)
    {
        int read=0;while(read<buffer.Length){int n=stream.Read(buffer,read,buffer.Length-read);if(n==0)throw new EndOfStreamException();read+=n;}
    }
}
