using System;
using System.Diagnostics;
using System.Linq;

internal static class ExternalLinks
{
    internal static Uri Parse(string input)
    {
        Uri uri;
        if (String.IsNullOrWhiteSpace(input) || input.Any(Char.IsControl) ||
            !Uri.TryCreate(input, UriKind.Absolute, out uri) ||
            (uri.Scheme != Uri.UriSchemeHttp && uri.Scheme != Uri.UriSchemeHttps) ||
            String.IsNullOrEmpty(uri.Host))
            throw new ArgumentException("仅支持有效的 HTTP/HTTPS 网页链接。");
        return uri;
    }
    internal static object Open(string input)
    {
        var uri = Parse(input);
        Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
        return new { opened = true };
    }
}
