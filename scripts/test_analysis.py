"""Native runner checks using a fake local CLI, never user notes or model credits."""
from pathlib import Path
import subprocess,tempfile
root=Path(__file__).resolve().parent.parent
csc='C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe'
with tempfile.TemporaryDirectory(prefix='schedule-analysis-') as folder:
 folder=Path(folder);fake=folder/'FakeAssistant.exe';test=folder/'AnalysisTests.exe'
 for target,sources in [(fake,['tests/FakeAssistant.cs']),(test,['src/native/AnalysisRunner.cs','tests/AnalysisTests.cs'])]:
  subprocess.run([csc,'/nologo','/utf8output','/target:exe','/reference:System.Web.Extensions.dll','/out:'+str(target),*[str(root/source) for source in sources]],check=True)
 subprocess.run([str(test),str(folder/'data'),str(fake)],check=True)
