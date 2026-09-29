"""Build a clean Windows archive containing the app and versioned documentation."""
import argparse
import json
from pathlib import Path
import re
import tempfile
import zipfile
from build import ROOT, build

def package(tag=None):
    version = json.loads((ROOT / 'package.json').read_text(encoding='utf8'))['version']
    if not re.fullmatch(r'\d+\.\d+\.\d+', version):
        raise ValueError('Expected a numeric three-part release version')
    if tag is not None and tag != 'v' + version:
        raise ValueError('Release tag and package version do not match')
    source = (ROOT / 'src/native/Program.cs').read_text(encoding='utf8')
    for attribute in ['AssemblyVersion', 'AssemblyFileVersion']:
        if f'{attribute}("{version}.0")' not in source:
            raise ValueError('Native executable version does not match package version')
    if not (ROOT / f'docs/releases/{version}.md').is_file():
        raise ValueError('Versioned release notes are required')
    dist = ROOT / 'dist'
    dist.mkdir(exist_ok=True)
    archive = dist / f'Schedule-{version}-windows-x64.zip'
    # Only a newly built directory is archived, never a running installation.
    with tempfile.TemporaryDirectory(prefix='schedule-package-') as temp:
        stage = Path(temp) / 'Schedule'
        build(stage, ROOT / '.deps')
        with zipfile.ZipFile(archive, 'w', compression=zipfile.ZIP_DEFLATED) as z:
            for p in sorted(stage.rglob('*')):
                if p.is_file():
                    z.write(p, p.relative_to(stage).as_posix())
    print('Packaged:', archive)
    return archive

if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--tag', help='Require this Git tag to match the package version')
    package(parser.parse_args().tag)
