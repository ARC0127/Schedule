<p align="center"><img src="assets/schedule-icon.png" width="88" alt="Schedule icon" /></p>
<h1 align="center">Schedule</h1>
<p align="center"><b>A place for today's ideas.</b></p>
<p align="center">A lightweight Windows calendar journal. Capture ideas, connect projects, and keep your files where they belong.</p>
<p align="center"><a href="README.md">简体中文</a> · <b>English</b></p>
<p align="center">
  <a href="https://github.com/ARC0127/Schedule/releases/tag/v0.0.2">Download v0.0.2</a> ·
  <a href="docs/releases/0.0.2.md">Release notes</a> ·
  <a href="https://arc0127.github.io/">ARCLIGHT</a> · <a href="LICENSE">MIT</a>
</p>

![Windows build](https://github.com/ARC0127/Schedule/actions/workflows/build.yml/badge.svg)

![Schedule home: calendar, projects, and today's ideas](docs/images/home.png)

<p align="center"><sub>Interface preview with synthetic demo data. The desktop app launches directly; no localhost server is required.</sub></p>

## See your days. Keep your ideas together.

| | What Schedule offers |
| --- | --- |
| **A calendar of progress** | Monthly and yearly views shade days in green by the number of meaningful ideas, normalized within the visible date range. Important items have reddish markers. |
| **Simple writing** | Enter adds a line; Shift+Enter adds an idea. Paste text or images and mark ideas complete. |
| **Projects across dates** | Link an idea to multiple projects. Open a project in the sidebar to see its ideas across dates, or use the dedicated unbound view. Overviews display images and open web links and shared day-level attachments. |
| **Local files, connected** | Drop files or folders, or paste paths. Files stay in their original locations and open directly from the desktop app. |
| **Windows reminders** | One scheduled event per day, with a time and advance reminder delivered through Windows notifications. Importance and reminders are separate settings. |
| **Within reach** | A transparent floating desktop icon, hover preview for today, click to restore, system tray, and optional startup at sign-in. |

## Download and start

1. Download **`Schedule-0.0.2-windows-x64.zip`** from the [v0.0.2 release](https://github.com/ARC0127/Schedule/releases/tag/v0.0.2).
2. Extract the entire archive into a fixed, writable folder.
3. Double-click **`Journal.exe`**. Its display name is **Schedule**. No installer is needed; the executable name is retained for existing shortcut and notification compatibility.

Requires **Windows 10/11 x64**, **.NET Framework 4.8**, and the [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/). Python, Node.js, and development tools are not needed to run the package.

> Choose the Windows ZIP to run the app. GitHub's automatic “Source code” downloads contain source files. The executable is currently unsigned, so Windows may display a publisher verification prompt.

## Everyday controls

| Action | How |
| --- | --- |
| Write for a day | Select a date and type in the editor on the right |
| Add an idea | **Shift+Enter**; **Enter** only adds a line |
| Choose projects | Select projects before adding an idea, or edit the current idea's bindings later |
| Mark complete | Place the caret inside an idea and **tap Ctrl alone**; Ctrl+C/V do not trigger completion |
| Insert an image | **Ctrl+V** in the editor |
| Add an event | Use the clock / add-event control beneath the date |
| Float on the desktop | Use the floating-icon control in the top bar; hover to preview today and click to restore |
| Tray and exit | Closing the main window sends it to the tray; use Exit in the tray menu to stop the app |
| Resize the sidebar | Drag the divider between the sidebar and content |

HTTP/HTTPS URLs and Markdown web links are clickable in project overviews. Windows paths in idea text are clickable too; quote paths containing spaces. The daily resources section belongs to the date record and is shared across that day’s project views.

## Your data stays on your computer

Data is stored in `%LOCALAPPDATA%\CodexJournal\journal.json`, including journal text, ideas, project bindings, images, events, and floating-window position. Linked files remain at their original paths. Saves use a temporary file and atomic replacement; `.bak` holds the preceding version.

**Back up:** Exit from the tray, then copy the entire `%LOCALAPPDATA%\CodexJournal` folder.

**Upgrade:** Exit and back up first, then extract the new package over the existing program folder. Keeping the executable location and data folder preserves existing shortcuts and Windows notification identity. Legacy `points` / `newPointProjects` fields migrate to `ideas` / `newIdeaProjects`, retaining IDs, text, project bindings, and completion state.

## Build from source

On Windows, install Python 3.10+ and run:

```powershell
py -3 scripts/build.py
.\dist\Schedule\Journal.exe
```

The first build downloads pinned NuGet dependencies and uses the .NET Framework compiler included with Windows. Rust and the .NET SDK are not required. To create the distribution archive:

```powershell
py -3 scripts/package_release.py
```

The output is `dist/Schedule-0.0.2-windows-x64.zip`. It includes the app, both READMEs, the home screenshot, licenses, and the notes for this release.

Development tests also require Node.js and npm:

```powershell
npm ci
npm test
npm run test:native
npm run test:overview
py -3 scripts/test_native_models.py
```

Native tests require a desktop session and WebView2, and set an isolated data directory before process startup. CI runs state migration tests and a Windows build. The release workflow builds from the `v0.0.2` tag and publishes using the [versioned release notes](docs/releases/0.0.2.md).

## Current scope

`0.0.2` is a project-overview maintenance release. The app interface is currently Chinese. Storage is single-user JSON; Markdown import/export, SQLite, and a formal Codex skill/CLI interface for concurrent editing are not implemented yet. External tools should not overwrite the journal while the app is running. Windows notification settings, Do Not Disturb, shutdown, and sleep can affect reminder delivery.

## Creator and license

Made by [**ARCLIGHT**](https://arc0127.github.io/) and released under the [MIT License](LICENSE). Report problems through [Issues](https://github.com/ARC0127/Schedule/issues).

[Architecture and data model (Chinese)](docs/architecture.md) · [Third-party notices](THIRD_PARTY_NOTICES.md) · [v0.0.2 release notes](docs/releases/0.0.2.md)
