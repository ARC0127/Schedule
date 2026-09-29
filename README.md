# Schedule

一个轻量的 Windows 本地日历日志：记录想法，关联项目，把资料留在原来的位置。

制作人：[ARCLIGHT](https://arc0127.github.io/) · [MIT License](LICENSE)

## 功能

- 月历与年度热力图，按当前显示范围内的有效想法数量归一化。
- Enter 换行，Shift+Enter 新建想法。Ctrl+V 粘贴文字或图片。
- 想法支持多个项目、未绑定入口、跨日期总览与完成状态。
- 在想法内单按 Ctrl 切换完成。Ctrl+C/V 等组合键不误触。
- 文件／文件夹路径关联与拖入，原生打开、失效路径提示。
- 每天一条日程、重要标记与 Windows 系统提醒。
- 透明桌面图标、悬停预览、边缘吸附、托盘和可选开机启动。
- 左侧栏可拖动调宽，左下角制作信息可打开作者主页。

## 运行与构建

Windows 10/11 x64，需要 .NET Framework 4.8 和 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。程序使用本地资源映射，不运行 localhost 服务。发布目录解压后双击 `Journal.exe`（显示名 Schedule）。

构建另需 Python 3.10+，首次构建联网下载固定版本 NuGet 依赖：

```powershell
py -3 scripts/build.py
.\dist\Schedule\Journal.exe
```

无需安装 Rust、Node 或 .NET SDK 来构建桌面程序。构建使用 Windows 自带的 .NET Framework 编译器，输出目录必须可写。运行时无需 Python。

测试需要 Node.js 和 npm：

```powershell
npm ci
npm test
npm run test:native
```

原生测试需桌面会话和已安装的 Edge/WebView2。测试在启动进程前设置独立数据目录，拒绝使用实际日志目录。无桌面环境的 CI 只执行构建和状态迁移测试。

## 本地数据与升级

数据位于 `%LOCALAPPDATA%\CodexJournal\journal.json`，包括正文、想法关系、图片、日程与悬浮位置。保存采用临时文件和原子替换，`.bak` 保存上一版。备份时先从托盘退出，再复制整个数据目录。

升级保留原来的程序位置和数据目录，避免改变 Windows 提醒身份与已有快捷方式。旧字段 `points` / `newPointProjects` 在读取时迁移为 `ideas` / `newIdeaProjects`，想法 ID、内容、项目绑定和完成状态保留。

这是单用户 JSON 存储，尚未实现 SQLite、Markdown 导入导出或正式 Codex skill/CLI 并发接口。不要让外部工具直接覆盖运行中的日志文件。Windows 免打扰、关机或休眠可能影响提醒投递。

## 源码

见 [架构与数据说明](docs/architecture.md) 和 [第三方许可](THIRD_PARTY_NOTICES.md)。仓库只包含应用源码、图标、依赖许可和合成测试，不包含作者的日志、项目目录、浏览器数据或开发机凭据。
