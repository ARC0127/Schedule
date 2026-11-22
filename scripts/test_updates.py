"""Check release selection, download integrity and installer recovery in temporary files."""
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parent.parent
with tempfile.TemporaryDirectory(prefix='schedule-update-tests-') as folder:
    exe = Path(folder) / 'UpdateTests.exe'
    subprocess.run([
        'C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',
        '/nologo', '/utf8output', '/target:exe', '/platform:x64', '/out:' + str(exe),
        '/reference:System.Web.Extensions.dll', '/reference:System.IO.Compression.dll',
        '/reference:System.IO.Compression.FileSystem.dll',
        str(root / 'tests/UpdateTests.cs'), str(root / 'src/native/ReleaseUpdate.cs'),
        str(root / 'src/shared/UpdateInstall.cs')], check=True)
    subprocess.run([str(exe), str(Path(folder) / 'data')], check=True)
