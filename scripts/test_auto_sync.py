"""Exercise scheduler boundaries with an injected clock; never touch live journals."""
from pathlib import Path
import subprocess, tempfile
root=Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='schedule-auto-tests-') as folder:
    exe=Path(folder)/'AutoSyncTests.exe'
    subprocess.run(['C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe','/nologo','/utf8output','/target:exe','/reference:System.Web.Extensions.dll','/out:'+str(exe),str(root/'src/native/AutoSync.cs'),str(root/'tests/AutoSyncTests.cs')],check=True)
    subprocess.run([str(exe)],check=True)
