"""Exercise interrupted original batches and the compiled app's backup handling."""
from pathlib import Path
import os, subprocess, tempfile

root = Path(__file__).resolve().parents[1]
csc = Path(os.environ.get('WINDIR', r'C:\Windows')) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
with tempfile.TemporaryDirectory(prefix='schedule-batch-tests-') as temp:
    work = Path(temp)
    sources = [root / 'src/native' / name for name in
               ['BluetoothRfcomm.cs', 'BluetoothProtocol.cs', 'BluetoothSync.cs',
                'JournalSyncTransfer.cs', 'WifiTransport.cs', 'SyncAssets.cs']]
    exe = work / 'BatchAssetsTests.exe'
    subprocess.run([str(csc), '/nologo', '/utf8output', '/target:exe', '/platform:x64',
                    '/main:BatchAssetsTests', '/reference:System.Web.Extensions.dll', '/out:' + str(exe),
                    str(root / 'tests/WifiTests.cs'), str(root / 'tests/BatchAssetsTests.cs'),
                    *map(str, sources)], check=True)
    subprocess.run([str(exe), str(work / 'batches')], check=True)
    exe = work / 'OriginalArchiveTests.exe'
    subprocess.run([str(csc), '/nologo', '/utf8output', '/target:exe', '/platform:x64',
                    '/reference:System.IO.Compression.dll', '/reference:System.IO.Compression.FileSystem.dll',
                    '/out:' + str(exe), str(root / 'tests/OriginalArchiveTests.cs')], check=True)
    subprocess.run([str(exe), str(root / 'dist/Schedule/Journal.exe'), str(work / 'archive'),
                    str(root / 'assets/schedule-icon.png')], check=True)
