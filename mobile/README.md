# Schedule for Android · 1.1.13

后台通知不再反复显示进度或失败信息。默认每小时同步，旧的 2 小时设置升级时一次性迁移，错误详情仍在同步页。

The background notification no longer repeats progress or errors. Sync defaults to hourly; legacy two-hour settings migrate once. Error details remain on the Sync page.

新增「同步 → 软件更新」：检查 GitHub 最新正式 APK，查看版本说明、下载并校验后交给系统确认安装。首次需要允许 Schedule 安装应用。旧版需手动覆盖安装一次获得此入口，不要卸载。更新来源和签名必须匹配，记录与图片保存在原应用数据目录。

**Sync → Software updates** checks the latest stable APK on GitHub, displays release notes and verifies the download before opening Android's installer. Allow installation from Schedule when prompted. Older builds need one manual in-place upgrade; do not uninstall. Updates must match the app identity and signing certificate. Existing records and images stay in the app data directory.

当前版本：默认每 1 小时自动同步，电脑恢复连接后同步一次。首次在手机选择已配对电脑并启用后台服务后，可以离开同步页，通知栏可暂停。间隔在新版 Windows 0.0.14 中修改。未保存草稿或冲突会暂停提交。自动模式不开热点、不切换电脑 Wi-Fi，手动模式保留直连加速。详情见 [0.0.14 版本说明](../docs/releases/0.0.14.md)。

Current release: automatic sync every hour and once after reconnecting. Select the paired PC and enable the background service once; the sync page can then be closed. Pause from its notification. Change the interval in Windows 0.0.14. Unsaved drafts and conflicts defer commits. Automatic mode never starts a hotspot or switches Windows Wi-Fi; manual sync retains that option. See the [release notes](../docs/releases/0.0.14.md).

[返回项目首页 / Project home](../README.md) · [下载 / Downloads](https://github.com/ARC0127/Schedule/releases/tag/v0.0.14)

这里保留 Android 应用、构建脚本与测试源码。配套电脑端为仓库根目录的 Schedule 0.0.14。`windows/` 是历史独立蓝牙工具源码，日常使用请下载根项目发布的桌面应用。

This directory contains the Android app, build script and tests. Use the desktop app at the repository root (0.0.14). The `windows/` subdirectory retains the legacy standalone Bluetooth utility for reference.

生产签名密钥不公开。使用自己的密钥构建时，请使用独立测试设备／模拟器，无法覆盖官方签名的现有应用。
Production signing keys are private. A build signed with your own key cannot update the official app; use a separate emulator or test device.

# Schedule for Android

[简体中文](#简体中文) · [English](#english)

**ARCLIGHT** · [主页 / Homepage](https://arc0127.github.io/) · [MIT](LICENSE)

## 简体中文

### 安装与第一次同步

1. 在红米 K70 打开 `Schedule.Android-1.1.13.apk` 并按 HyperOS 提示覆盖安装，保留原应用。应用支持 Android 8.0（API 26）及以上，面向 Android 16（API 36）构建。
2. 在 Windows 和手机的**系统蓝牙设置**中配对，确认两端显示的配对码。系统配对会保存设备身份。Schedule 在下一步单独建立应用使用的 RFCOMM 数据连接。
3. 手机打开 **同步**，授权**附近设备**，选择已配对电脑并启用**后台自动同步**。首次可点**允许后台自动连接**完成系统授权，之后无需反复点击连接。
4. 打开新版桌面 Schedule，点击右上角**蓝牙同步**，选择手机后点**双向同步**。无需单独运行同步工具。源码中保留的 `Schedule.Windows.Sync.exe` 是旧版共享日程客户端，只同步共享日程，不包含笔记、想法和图片。
5. 再次同步时可沿用已有配对。两端启用自动同步后会周期尝试，也可在 Windows 手动同步。已经同步的日程留在手机，锁屏或蓝牙断开后仍使用手机本地闹钟。离开等待页不会关闭后台服务。通知栏或同步页可暂停自动同步。

### 日程与提醒

- 新版通过经典蓝牙 RFCOMM 双向合并笔记、想法、项目、原始图片和全部日程，包括旧版“仅此手机”日程。要求认证和加密，稳定编号和共同版本用于识别增删改及冲突。配套 Windows 0.0.14：同一项两边都改过时暂停整次同步，电脑发送通知并等待逐项确认。手机保留现有内容、共同版本和编辑能力，确认后重新同步。断线不会清除手机草稿，重试不会产生副本。文字元数据上限 100 MiB，原图独立分批传输，不计入该总量，且不压缩。仅与旧版电脑连接时退回共享日程协议，并提示同步范围。
- Windows 关联想法和旧格式日程仍在电脑管理，关联想法的完成状态随想法同步。手机已有的项目、想法和图片保留。电脑与手机时区导致日期和时刻对应不上时，同步报错并保留当前数据。
- 在 **同步 → 提醒权限** 开启通知和准时提醒。没有准时提醒授权时，系统仍可排程，但允许延后。程序在设备重启解锁、更新及重新打开时从本地恢复排程。HyperOS 可在**设置 → 应用 → 后台自启动**允许 Schedule 用于开机恢复。锁屏提醒受通知频道、勿扰和省电设置影响，建议先用一条几分钟后的测试日程验证。系统**强行停止**应用后，需要手动打开再恢复排程。
- Windows 和手机各自可以提醒。同一手机上，同一事件、时刻及提前量只触发一次。改期、完成和删除会更新本地排程。曾进入排程的提醒可在 24 小时内补发。初次导入时已过期的提醒不会补发。

### 日记与项目

日历默认显示选中日期所在的一周，在日期区域向下拉展开整月。展开后的日期区域上下滑动只滚动内容，不收起日历；收起请点月标题／底部细条，或在这两个控件上向上划。日期格内左右滑动切换月份，邻月日期也可直接选择。日历区域外左右滑动依次切换日历、待办、项目和同步，底部按钮继续可用。正文正常上下滚动，编辑文字、选择文字、查看图片和横向滚动公式时不触发页面切换。

月标题和底部细条支持下拉展开／上划收起，拉柄会随拖动反馈。折叠状态下，日期格也支持下拉展开。展开后的日期格始终保留上下滚动，斜向浏览也不会误收起。明显左右滑动仍用于换月。

展开后使用接近全屏宽度的大日期格，每天显示最多两条日程、待办或笔记摘要，更多内容以 `+N` 表示。优先显示未完成和重要事项，同类日程按时间排列。重要事项偏红，已完成内容淡化并划线。待办有截止日期时显示在截止当天。点日期可滚动到当天完整内容，长月份可继续上下滚动。

切页和换月会跟随手指移动，短滑动平滑回弹，松手后以滑动和渐变衔接下一页。底部标签和月份按钮使用相同过渡，日历展开与收起也有缓动。动画通过 `requestAnimationFrame` 更新拖动位置，只在切换完成时重建内容。系统偏好减少动态效果时跳过导航动画。实际帧率由设备屏幕模式及 Android WebView 决定，未锁定或承诺 120 FPS。

日历热度按当月每日的手动想法条数归一化。独立日记、想法和待办均保存在手机。待办可完成、重开、标重要、设截止日期并关联多个项目。项目按未完成量排序，可浏览跨日想法、查看未绑定项、直接添加并绑定，已有想法可以原位编辑。

项目的新建、改名、删除和想法的多项目绑定均随双向同步交换。两边同时修改同一项目时保留冲突供选择。项目关联的电脑文件夹路径和手机文件授权各自保留，不会作为跨设备路径打开。

编辑器支持触屏缩进、常用 Markdown 格式、KaTeX、链接、图片和系统文件或目录授权。点缩略图进入纯图片预览，双指缩放、拖动平移，点图片外空白关闭。文件选择会复制原始图片字节。剪贴板则保存来源应用提供的图片字节。编辑器里的**另存原图**可逐张导出。图片预览没有工具栏。

Markdown 可导入导出日记正文、想法和待办，保留重要标记、截止日期与项目名称，日程仅为可读摘要，不能替代完整备份。**同步 → 完整备份（含原图）**会导出日记、项目绑定、事件、原图和提醒去重状态。恢复前验证完整性并保存当前副本。升级到此版后的首次启动自动保存完整副本，写入意外中断时下次启动恢复旧数据。外部文档、文件夹内容和系统授权不跨设备复制，换设备后可能需要重新关联。

版本 1.1.5 在模拟器中验证了事项月视图、原生触摸手势及同签名覆盖升级，并逐字节核对已有记录及原图，不卸载、不清空。项目双向同步沿用 1.1.1 的实现。实际用户手机未用于这些测试。安装更新前仍应保留原应用和签名。Windows 的 Codex/Claude Code CLI 继续可用。

### 构建

Windows 上准备 Python 3、JDK 17、Android SDK 的 `platforms;android-36` 与 `build-tools;36.0.0`。Windows 配套使用 Windows 10/11 自带 .NET Framework 的 C# 编译器。以下命令在源码解压目录里运行。

```powershell
py build.py android --sdk "C:\path\to\Android\Sdk" --jdk "C:\path\to\jdk-17" --output build/Schedule.Android.apk
py build.py windows --output build/Schedule.Windows.Sync.exe
node tests/journal.test.cjs
node --test tests/sync-projects.test.cjs
py build.py windows-tests --output build/WindowsTests.exe
```

首次 Android 构建会按输入的密码创建签名密钥，默认保存在解压目录的 `build/schedule.p12`。保留自己的密钥以覆盖升级自己的 APK。交付版 APK 使用本机生成的分发测试证书，私钥未包含在源码包中。不同签名的 APK 不能相互覆盖安装。换签名前先导出需要保留的数据。

Android 仪器测试使用 `build.py android-tests`，指定与主 APK 相同的 `--keystore`、`--sdk` 和 `--jdk`。将两个 APK 安装到空白测试设备后，允许通知和准时提醒，再运行下面的命令。

```powershell
adb shell am instrument -w io.github.arc0127.schedule.tests/io.github.arc0127.schedule.AndroidTests
```

测试使用合成事件。正式手机启用前，先用一条测试日程验证传输、锁屏提醒、编辑和删除。要验证重启恢复，可同步一条几分钟后的测试日程，断开蓝牙、重启解锁，并在到点前保持 Schedule 关闭。

平台文档见 [Android RFCOMM](https://developer.android.com/develop/connectivity/bluetooth/connect-bluetooth-devices)、[Windows RFCOMM](https://learn.microsoft.com/windows/win32/bluetooth/bluetooth-and-connect)、[Android 闹钟](https://developer.android.com/develop/background-work/services/alarms/schedule)和[小米澎湃 OS 自启动](https://dev.mi.com/xiaomihyperos/documentation/detail?pId=1624)。

## English

### Install and sync

1. Open `Schedule.Android-1.1.13.apk` on the phone and install over the existing app. The app requires Android 8.0 (API 26) or later and targets Android 16 (API 36).
2. Pair the phone and Windows PC in their system Bluetooth settings. In Schedule on Android, open **Sync**, grant Nearby devices, select the paired PC, and enable **Automatic background sync**. Approve **Allow background reconnection** once for system companion wake-up. The listener remains available after leaving this screen.
3. In the updated desktop Schedule app, open **Bluetooth sync**, select the phone and start **Two-way sync**. The separate `Schedule.Windows.Sync.exe` retained in this source package is a legacy shared-event-only client.
4. Automatic sync checks periodically and after reconnecting; Windows can also start a manual sync. Android keeps the last synced events and their alarm schedules when the Bluetooth link closes.

Updated apps use authenticated, encrypted Bluetooth Classic RFCOMM to merge notes, ideas, projects, original images and all events, including previously phone-only events. Stable IDs and a common baseline distinguish updates, deletions and conflicts. With Windows 0.0.14, concurrent edits pause the entire transaction. Review both versions on Windows and confirm before reconnecting. The phone keeps its data and baseline unchanged while waiting. Disconnected transfers can be retried without duplicate records. Original images are checked and chunked without recompression; metadata is limited to 100 MiB and originals transfer separately without a fixed aggregate quota. Older computers retain the shared-event protocol with a visible scope notice. Linked and legacy Windows events remain protected, and event dates/times must match the Windows time zone.

Turn on app notifications and exact alarms under **Sync → Reminder permissions**. Android may delay an inexact alarm. The app restores alarms after a reboot and unlock, an app update, or a fresh launch. HyperOS provides **Settings → Apps → Background autostart** to let Schedule recover on boot. Open Schedule again after a system force-stop. A reminder is deduplicated on Android by the event, start time and lead time. Previously armed reminders can catch up for 24 hours. Reminders already past at first import stay silent. Windows and Android can each surface their own notifications.

### Journal and files

The calendar starts with the selected week. Pull down within the dates to expand the month. Once expanded, vertical swipes within date cells only scroll content. To collapse, tap the month title or bottom handle, or swipe upward on either control. Swipe horizontally within the date grid to change months; adjacent-month dates can also be selected. Outside the calendar, swipe horizontally through Calendar, Tasks, Projects and Sync, or use the bottom buttons. Vertical content scrolling, editing, text selection, image gestures and horizontal formula scrolling keep their own behavior.

The month header and bottom handle support expand/collapse pulls with drag feedback. Date cells also support pulling down while collapsed, but always retain vertical scrolling once expanded, including diagonal browsing gestures. Clear horizontal swipes still change months.

The expanded month uses wider, taller cells with up to two event, task or note summaries per day and a `+N` overflow count. Unfinished and important items come first; equivalent events are ordered by time. Important entries use red accents, while completed entries are muted and struck through. Tasks with a deadline appear on their due date. Tap a date to scroll to its full agenda; longer months remain vertically scrollable.

Pages and months follow the finger, short drags ease back, and completed swipes transition with movement and fading. Bottom tabs and month buttons use the same transitions; calendar expansion also eases into place. Drag updates use `requestAnimationFrame`, transform and opacity without rebuilding content on every move. Navigation animation is skipped when reduced motion is requested. Actual frame rate depends on the device display mode and Android WebView; 120 FPS is not forced or guaranteed.

The calendar heatmap uses the current month's maximum number of manually added ideas on a day. Daily notes, ideas, tasks, projects and attachments are stored on Android. Tasks can be completed, flagged important, assigned a deadline, and linked to several projects. Project views include cross-day ideas, open-task sorting, an unassigned view, and inline edits.

Project creation, renaming, deletion and multi-project idea bindings sync in both directions. Concurrent project edits keep both versions for review. Windows folder paths and Android document grants remain device-local.

Touch controls provide indentation, Markdown formatting, KaTeX, links, image attachment and Android document or folder grants. Tap an image to open the image-only preview. Pinch to zoom, drag to pan, and tap the surrounding area to close it. Files selected in the picker are retained byte-for-byte. For paste, the app stores the bytes supplied by the clipboard. Use **Save original image** in the editor to export an attachment.

Markdown carries text, task metadata and project names; event listings are readable summaries. It is not a complete backup. **Sync → Complete backup (original images)** exports journal data, project bindings, event state, original image bytes and reminder deduplication state. Restore validates the archive and saves the current version first. The first launch after upgrading saves a complete recovery copy. Interrupted multi-file writes roll back at the next launch. External files, folder contents and system grants remain device-local and may need relinking on another device. The Windows Codex/Claude Code CLI remains available.

Version 1.1.5 was tested with month summaries, native touch gestures and an in-place emulator upgrade from the same-signed previous APK, comparing existing records and image bytes. Bidirectional project sync retains the 1.1.1 implementation. The user's phone was not used for these tests. Keep the existing app and signing identity; do not uninstall it as an upgrade step.

### Build and verify

Install Python 3, JDK 17, Android SDK `platforms;android-36` and `build-tools;36.0.0`. The Windows build uses the .NET Framework C# compiler in Windows 10/11. Run the PowerShell commands in the Chinese build section above. Keep the same keystore for upgrades to your own builds. The supplied APK is locally signed for sideloading and the source archive excludes the private signing key.

Build the Android instrumentation app with `build.py android-tests` and the app's SDK, JDK and keystore. Install both APKs on a clean test device, enable notifications and exact alarms, then run the instrumentation command above. Verify the physical Bluetooth link and HyperOS lock-screen delivery with a disposable event before relying on reminders.

See the platform documentation for [Android RFCOMM](https://developer.android.com/develop/connectivity/bluetooth/connect-bluetooth-devices), [Windows RFCOMM](https://learn.microsoft.com/windows/win32/bluetooth/bluetooth-and-connect), [Android alarms](https://developer.android.com/develop/background-work/services/alarms/schedule), and the [HyperOS 3 user guide](https://www.mi.com/uk/support/user-guide-pdf/generic-user-guide-for-hyperos-3/).


## 历史版本 / Version history

### 1.1.6 同步确认 / Sync review

配套 Windows 0.0.8，冲突在电脑确认。旧版仅共享日程协议保持原有行为。安装包延续原签名，直接覆盖安装。

Use Windows 0.0.8 for desktop conflict review. The legacy shared-event protocol retains its existing behavior. Install this same-signed APK over the existing app.

### 1.1.7 · 自动 Wi-Fi 加速

配套 Windows 0.0.9。蓝牙自动交换连接信息，优先局域网，不可达时尝试临时本地热点。请允许附近 Wi-Fi 设备。电脑可能临时切换无线网络，结束后恢复。只补传缺少的原图，持续传输不受四分钟限制。首次新图仍需传输全部字节，现有单次完整日志 100 MiB 限制保留。真实手机热点兼容性尚待验证，失败时明确回退蓝牙。

With Windows 0.0.9, Bluetooth negotiates encrypted LAN or temporary local-hotspot transfer automatically. Grant Nearby Wi-Fi permission. The PC may temporarily switch wireless networks and restore the previous connection afterward. Only missing originals are sent; active transfers are not limited to four minutes. The existing 100 MiB full-journal limit remains. Physical phone hotspot interoperability is not yet verified; unavailable Wi-Fi visibly falls back to Bluetooth.

### 1.1.8 · 原图分批同步 / Batched originals

配套 Windows 0.0.10。两端更新后，原图按 192 KiB 分块单独传输和校验，累计图片不再受 100 MiB JSON 限制。已完成的原图保留，重试跳过已有文件，未完成的一张重新传输。文字元数据仍限 100 MiB，单张原图最多 64 MiB，需足够磁盘空间。同步提交改为元数据备份与恢复，不再触发旧的 256 MiB 整包备份限制。手动 ZIP 导入导出仍沿用原有备份容量限制。

Update both devices (Windows 0.0.10). Originals transfer in 192 KiB chunks as independently verified files. Aggregate images no longer count toward the 100 MiB JSON limit. Completed originals survive interrupted sessions; retries skip them and restart an incomplete image. Metadata remains limited to 100 MiB, each original to 64 MiB, subject to available storage. Sync commits back up and recover metadata without the previous 256 MiB whole-backup cap. Manual ZIP import/export retains its existing backup size limits.

This version keeps the existing app ID and signing identity. Install over the current app; do not uninstall or clear phone data. Conflict decisions remain on Windows.
