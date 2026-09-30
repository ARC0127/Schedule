"""Build the portable Windows x64 app without machine-specific tools or paths."""
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import urllib.request
import zipfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
PACKAGES = {
    'microsoft.web.webview2': '1.0.3650.58',
    'microsoft.toolkit.uwp.notifications': '7.1.3',
    'microsoft.windows.sdk.contracts': '10.0.19041.1',
    'system.valuetuple': '4.5.0',
}

def restore(cache):
    result = {}
    for name, version in PACKAGES.items():
        target = cache / name / version
        manifests = list(target.glob('*.nuspec'))
        if not manifests:
            target.mkdir(parents=True, exist_ok=True)
            package = cache / (name + '.' + version + '.nupkg')
            urllib.request.urlretrieve(
                f'https://api.nuget.org/v3-flatcontainer/{name}/{version}/{name}.{version}.nupkg', package)
            with zipfile.ZipFile(package) as archive:
                for item in archive.infolist():
                    resolved = (target / item.filename).resolve()
                    if not resolved.is_relative_to(target.resolve()):
                        raise ValueError('Package contains an invalid path')
                archive.extractall(target)
            manifests = list(target.glob('*.nuspec'))
        manifest = ET.parse(manifests[0]).getroot()
        actual = next(x.text for x in manifest.iter() if x.tag.endswith('}version') or x.tag == 'version')
        if actual != version:
            raise ValueError(f'Incorrect cached package: {name} {actual}, expected {version}')
        result[name] = target
    return result

def references(out, packages):
    windows = Path(os.environ.get('WINDIR', r'C:\Windows'))
    framework = windows / 'Microsoft.NET/Framework64/v4.0.30319'
    refs = ['System.dll', 'System.Core.dll', 'System.Drawing.dll', 'System.Windows.Forms.dll',
            'System.Web.Extensions.dll', str(framework / 'System.Runtime.WindowsRuntime.dll')]
    refs += [str(out / n) for n in ['Microsoft.Web.WebView2.Core.dll', 'Microsoft.Web.WebView2.WinForms.dll',
                                   'Microsoft.Toolkit.Uwp.Notifications.dll', 'System.ValueTuple.dll']]
    contracts = packages['microsoft.windows.sdk.contracts'] / 'ref/netstandard2.0'
    refs += [str(contracts / n) for n in ['Windows.Foundation.FoundationContract.winmd', 'Windows.Foundation.UniversalApiContract.winmd']]
    refs += [str(p) for p in (windows / 'Microsoft.NET/assembly/GAC_MSIL/System.Runtime').glob('*/System.Runtime.dll')]
    return framework / 'csc.exe', refs

def build(out, cache):
    if os.name != 'nt':
        raise SystemExit('Schedule builds on Windows x64 with .NET Framework 4.8.')
    out.mkdir(parents=True, exist_ok=True)
    packages = restore(cache)
    web = packages['microsoft.web.webview2']
    dlls = [web / 'lib/net462/Microsoft.Web.WebView2.Core.dll',
            web / 'lib/net462/Microsoft.Web.WebView2.WinForms.dll',
            web / 'runtimes/win-x64/native/WebView2Loader.dll',
            packages['microsoft.toolkit.uwp.notifications'] / 'lib/net461/Microsoft.Toolkit.Uwp.Notifications.dll',
            packages['system.valuetuple'] / 'lib/net47/System.ValueTuple.dll']
    for p in dlls:
        shutil.copy2(p, out / p.name)
    for p in (ROOT / 'assets').iterdir():
        if p.suffix in {'.png', '.ico'}:
            shutil.copy2(p, out / p.name)
    for n in ['app.css', 'app.js', 'state.js', 'content.js', 'bridge.js']:
        shutil.copy2(ROOT / 'src/web' / n, out / n)
    shutil.copy2(ROOT / 'third_party/lucide.js', out / 'lucide.js')
    shutil.copytree(ROOT / 'third_party/katex', out / 'katex', dirs_exist_ok=True)
    document = '''<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'">
<title>Schedule</title><link rel="stylesheet" href="katex/katex.min.css"><link rel="stylesheet" href="app.css"><script src="katex/katex.min.js"></script><script src="lucide.js"></script><script src="state.js"></script><script src="content.js"></script></head><body>'''
    document += (ROOT / 'src/web/app.html').read_text(encoding='utf8')
    document += '<script src="app.js"></script></body></html>'
    (out / 'index.html').write_text(document, encoding='utf8')
    csc, refs = references(out, packages)
    if not csc.exists():
        raise SystemExit('Missing .NET Framework x64 compiler: ' + str(csc))
    subprocess.run([str(csc), '/nologo', '/utf8output', '/target:winexe', '/platform:x64',
                    '/win32icon:' + str(out / 'schedule.ico'), '/out:' + str(out / 'Journal.exe')]
                   + ['/reference:' + r for r in refs]
                   + [str(p) for p in sorted((ROOT / 'src/native').glob('*.cs'))], check=True)
    (out / 'Journal.exe.config').write_text('<configuration><startup><supportedRuntime version="v4.0" sku=".NETFramework,Version=v4.8" /></startup></configuration>', encoding='utf8')
    for n in ['LICENSE', 'THIRD_PARTY_NOTICES.md']:
        shutil.copy2(ROOT / n, out / n)
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf8'))['version']
    for n in ['README.md', 'README.en.md', 'assets/schedule-icon.png',
              'docs/architecture.md', 'docs/images/home.png', f'docs/releases/{version}.md']:
        destination = out / n
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(ROOT / n, destination)
    licenses = out / 'licenses'
    licenses.mkdir(exist_ok=True)
    for p in (ROOT / 'third_party').glob('*LICENSE*'):
        shutil.copy2(p, licenses / p.name)
    print('Built:', out / 'Journal.exe')

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', type=Path, default=ROOT / 'dist/Schedule')
    args = parser.parse_args()
    build(args.output.resolve(), ROOT / '.deps')
