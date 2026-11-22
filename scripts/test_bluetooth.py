"""Run the existing Android v1 protocol/merge fixtures against the integrated code."""
import os
from pathlib import Path
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
csc = Path(os.environ.get('WINDIR', r'C:\Windows')) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
with tempfile.TemporaryDirectory(prefix='schedule-bluetooth-test-') as temp:
    exe = Path(temp) / 'BluetoothTest.exe'
    sources = [root / 'src/native' / name for name in ['BluetoothRfcomm.cs', 'BluetoothProtocol.cs', 'BluetoothSync.cs', 'JournalSyncTransfer.cs','WifiTransport.cs','SyncAssets.cs']]
    subprocess.run([str(csc), '/nologo', '/utf8output', '/target:exe', '/platform:x64', '/reference:System.Web.Extensions.dll', '/out:' + str(exe),
                    str(root / 'tests/BluetoothTests.cs')] + [str(p) for p in sources], check=True)
    result = subprocess.run([str(exe)] + sys.argv[1:], cwd=temp, capture_output=True, text=True, encoding='utf8')
    log = result.stdout + result.stderr
    (root / 'artifacts').mkdir(exist_ok=True)
    (root / 'artifacts/bluetooth-protocol-test.txt').write_text(log, encoding='utf8')
    print(log)
    result.check_returncode()
