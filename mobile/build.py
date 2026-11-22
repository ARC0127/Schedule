"""Build Schedule for Android or the Windows Bluetooth companion on Windows."""
import argparse
import getpass
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parent
PACKAGE = "io.github.arc0127.schedule"
BUILD_TOOLS = "36.0.0"


def run(*args, env=None):
    subprocess.run([str(arg) for arg in args], cwd=ROOT, check=True, env=env)


def windows(output, tests=False):
    framework = Path(os.environ.get("WINDIR", "C:/Windows")) / "Microsoft.NET" / "Framework64" / "v4.0.30319"
    main = "ScheduleSync.WindowsTests" if tests else "ScheduleSync.SyncWindow"
    sources = sorted((ROOT / "windows").glob("*.cs"))
    if tests:
        sources += [ROOT / "tests" / "WindowsTests.cs"]
    run(framework / "csc.exe", "/nologo", "/codepage:65001", "/optimize+",
        "/target:exe" if tests else "/target:winexe", f"/main:{main}",
        f"/out:{output}", "/reference:System.Web.Extensions.dll",
        "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll",
        f"/win32icon:{ROOT / 'windows/assets/schedule.ico'}", *sources)


def android(output, sdk, jdk, keystore, alias, tests=False):
    tools = sdk / "build-tools" / BUILD_TOOLS
    jar = sdk / "platforms" / "android-36" / "android.jar"
    java = jdk / "bin" / "java.exe"
    if not jar.is_file() or not java.is_file() or not (tools / "aapt2.exe").is_file():
        raise SystemExit("Install JDK 17 and Android SDK platforms;android-36 and build-tools;36.0.0, then pass --sdk and --jdk.")
    env = dict(os.environ)
    env["SCHEDULE_STORE_PASSWORD"] = env.get("SCHEDULE_STORE_PASSWORD") or getpass.getpass("Signing keystore password: ")
    if not env["SCHEDULE_STORE_PASSWORD"]:
        raise SystemExit("A signing password is required.")
    if not keystore.exists():
        if tests:
            raise SystemExit("Build the application before building the instrumentation APK.")
        keystore.parent.mkdir(parents=True, exist_ok=True)
        run(jdk / "bin" / "keytool.exe", "-genkeypair", "-keystore", keystore, "-storetype", "PKCS12",
            "-alias", alias, "-keyalg", "RSA", "-keysize", "3072", "-validity", "10000",
            "-dname", "CN=Schedule Android, O=ARCLIGHT", "-storepass:env", "SCHEDULE_STORE_PASSWORD",
            "-keypass:env", "SCHEDULE_STORE_PASSWORD", env=env)
    with tempfile.TemporaryDirectory(prefix="schedule-apk-", dir=output.parent) as scratch:
        work = Path(scratch)
        classes = work / "classes"
        classes.mkdir()
        dex = work / "dex"
        dex.mkdir()
        compiled = work / "compiled.apk"
        unsigned = work / "unsigned.apk"
        aligned = work / "aligned.apk"
        resources = work / "resources.zip"
        root = ROOT / "android"
        aapt = tools / "aapt2.exe"
        link = [aapt, "link", "-o", compiled, "-I", jar]
        if tests:
            link += ["--manifest", ROOT / "tests" / "AndroidTestManifest.xml"]
        else:
            run(aapt, "compile", "--dir", root / "res", "-o", resources)
            link += ["--manifest", root / "AndroidManifest.xml", "-A", root / "assets", resources]
        run(*link)
        sources = sorted((root / "java").rglob("*.java"))
        if tests:
            # The runner uses the installed app classes, not a separately packaged copy.
            sources += sorted((ROOT / "tests" / "android").rglob("*.java"))
        boot = os.pathsep.join(map(str, (jar, tools / "core-lambda-stubs.jar")))
        run(jdk / "bin" / "javac.exe", "-encoding", "UTF-8", "-source", "8", "-target", "8",
            "-bootclasspath", boot, "-d", classes, *sources)
        binaries = sorted(classes.rglob("*.class"))
        if tests:
            binaries = [item for item in binaries if item.name.startswith("AndroidTests")]
        run(java, "-cp", tools / "lib" / "d8.jar", "com.android.tools.r8.D8", "--min-api", "26",
            "--lib", jar, "--classpath", classes, "--output", dex, *binaries)
        with zipfile.ZipFile(compiled) as resources_apk, zipfile.ZipFile(unsigned, "w", compression=zipfile.ZIP_DEFLATED) as apk:
            for entry in resources_apk.infolist():
                apk.writestr(entry.filename, resources_apk.read(entry), compress_type=entry.compress_type)
            for file in sorted(dex.glob("*.dex")):
                apk.write(file, file.name)
        run(tools / "zipalign.exe", "-f", "4", unsigned, aligned)
        run(java, "-jar", tools / "lib" / "apksigner.jar", "sign", "--ks", keystore,
            "--ks-key-alias", alias, "--ks-pass", "env:SCHEDULE_STORE_PASSWORD", "--out", output, aligned, env=env)
        run(java, "-jar", tools / "lib" / "apksigner.jar", "verify", "--verbose", output)


def main():
    cli = argparse.ArgumentParser(description=__doc__)
    cli.add_argument("target", choices=("android", "windows", "android-tests", "windows-tests"))
    cli.add_argument("--output", type=Path, required=True)
    cli.add_argument("--sdk", type=Path, default=Path(os.environ.get("ANDROID_SDK_ROOT") or os.environ.get("ANDROID_HOME") or ""))
    cli.add_argument("--jdk", type=Path, default=Path(os.environ.get("JAVA_HOME") or ""))
    cli.add_argument("--keystore", type=Path, default=ROOT / "build" / "schedule.p12")
    cli.add_argument("--alias", default="schedule")
    args = cli.parse_args()
    output = args.output.resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    if args.target.startswith("windows"):
        windows(output, args.target == "windows-tests")
    else:
        android(output, args.sdk.resolve(), args.jdk.resolve(), args.keystore.resolve(), args.alias,
                args.target == "android-tests")


if __name__ == "__main__":
    main()

