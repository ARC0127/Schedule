"""Test native parsing without starting a UI or launching external applications."""
import os
from pathlib import Path
import subprocess
import tempfile

root = Path(__file__).resolve().parents[1]
csc = Path(os.environ.get('WINDIR', r'C:\Windows')) / 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
with tempfile.TemporaryDirectory(prefix='schedule-model-test-') as temp:
    exe = Path(temp) / 'ModelsTest.exe'
    subprocess.run([str(csc), '/nologo', '/utf8output', '/target:exe', '/reference:System.Web.Extensions.dll',
                    '/out:' + str(exe), str(root / 'tests/NativeModels.cs')], check=True)
    subprocess.run([str(exe), str(root / 'dist/Schedule/Journal.exe')], check=True,
                   env={**os.environ, 'SCHEDULE_TEST_DATA': temp})
