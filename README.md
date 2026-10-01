<p align="center"><img src="assets/schedule-icon.png" width="88" alt="Schedule 图标" /></p>
<h1 align="center">Schedule</h1>
<p align="center"><b>把想法留在今天。</b></p>
<p align="center">一个轻量的 Windows 本地日历日志。记录想法，关联项目，把资料留在原来的位置。</p>
<p align="center"><b>简体中文</b> · <a href="README.en.md">English</a></p>
<p align="center">
  <a href="https://github.com/ARC0127/Schedule/releases/tag/v0.0.6">下载 v0.0.6</a> ·
  <a href="docs/releases/0.0.6.md">版本说明</a> ·
  <a href="https://arc0127.github.io/">ARCLIGHT</a> · <a href="LICENSE">MIT</a>
</p>

![Windows build](https://github.com/ARC0127/Schedule/actions/workflows/build.yml/badge.svg)

![Schedule 首页：日历、项目与当天想法](docs/images/home.png)

<p align="center"><sub>使用演示数据的界面预览。桌面版直接打开，无需启动 localhost 服务。</sub></p>

## v0.0.6 · 从想法到完成

普通想法安静地留在日记里，需要行动时再设为待办。重要标记、截止日期和关联日程围绕同一个事项展开，完成一次，各处同步。

- **专注今天**：双击日期展开当天，文字样式与链接在写作时就能使用。
- **看清下一步**：待办区分未完成与已完成，可筛选普通、重要和带日程的事项。
- **放心积累**：自动快照、恢复预览、完整备份，以及 Codex / Claude Code 本地读写接口。

<details>
<summary>查看新版待办总览</summary>

![Schedule 待办总览：按日期整理事项与日程](docs/images/tasks.png)

</details>

## 一眼看见日常，一处收好想法

| | Schedule 可以做什么 |
| --- | --- |
| **日历里的积累** | 月历与年度热力图按有效想法数量显示绿色深浅，在当前显示范围内归一化。重要事项用偏红色标记。 |
| **轻松记录** | Enter 换行，Shift+Enter 添加想法。直接粘贴文字或图片，用完成状态记录进展。 |
| **跨项目整理** | 每个想法可关联多个项目。点击左侧项目查看不同日期的想法，也有独立的“未绑定”入口。总览直接显示图片，可打开网页链接与按天共享的关联资料。 |
| **连接本地资料** | 拖入文件或文件夹，或粘贴路径。资料保留在原位置，可从桌面版直接打开。 |
| **及时提醒** | 同一天可添加多条日程，每条独立设置时间、提醒、重要标记和完成状态。 |
| **数据可恢复** | 每日快照、手动备份、恢复前差异预览，以及完整备份包和 Markdown 与图片导出。 |
| **助手可联动** | Codex 与 Claude Code 共用本地命令接口和 skill，按版本号检查写入冲突。 |
| **随手可见** | 透明桌面悬浮图标、悬停查看今天、点击恢复主窗口，以及托盘和可选开机启动。 |

## 下载与开始

1. 在 [v0.0.6 发布页](https://github.com/ARC0127/Schedule/releases/tag/v0.0.6) 下载 **`Schedule-0.0.6-windows-x64.zip`**。
2. 将压缩包完整解压到一个固定、可写的文件夹。
3. 双击 **`Journal.exe`**，窗口和应用显示名为 **Schedule**。程序无需安装，保留此文件名用于兼容已有快捷方式和通知身份。

支持 **Windows 10/11 x64**，需要 **.NET Framework 4.8** 和 [Microsoft Edge WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/)。运行下载包无需 Python、Node.js 或开发工具。

> 下载 Windows 压缩包即可运行；GitHub 自动生成的 “Source code” 是源码。当前程序未做代码签名，Windows 可能显示发布者验证提示。

## 最常用的操作

| 操作 | 用法 |
| --- | --- |
| 写当天记录 | 点击日历中的日期，在右侧输入；点击浅色的相邻月份日期，会自动切换月份并打开那天 |
| 展开当天安排 | 双击日期，合并日历与右侧记录区域；点击左箭头或按 Esc 返回，单击仍切换右侧记录 |
| 查看重要事项 | 点击左侧“重要事项”，按日期逐行查看全部星标记录；点击一行展开当天安排，左箭头或 Esc 返回列表 |
| 添加想法 | **Shift+Enter**；**Enter** 只换行 |
| 选择项目 | 光标位于想法内时，顶部项目选择器即时绑定、解绑或改为多项目；光标不在想法内时，选择后续新想法的默认项目 |
| 项目数量与排序 | 项目名后括号显示总想法数，默认按未完成想法数量降序排列，同数保持原顺序；普通笔记也计入未完成想法，但不会因此进入待办 |
| 标记完成 | 光标位于某个想法中，**单按 Ctrl** 标为已完成，再按回到待办；普通想法也可直接完成，Ctrl+C/V 不会误触 |
| 插入图片 | 在编辑区 **Ctrl+V** |
| 设置文字样式 | 选中文字显示格式栏，也可点击文字图标主动展开，为接下来的输入设置格式。支持字号、粗体、斜体、下划线、颜色和清除格式；**Ctrl+B / I / U** 切换粗体 / 斜体 / 下划线 |
| 写公式 | 使用 `\(...\)`、`\[...\]` 或 `$$...$$`；编辑时显示源码，移开焦点后显示公式，项目总览也会渲染 |
| 添加日程 | 点击日期下方的时钟或“添加日程”入口 |
| 想法操作 | 光标放在想法中，点击 **…**，选择普通想法／待办／已完成，设置项目、重要程度、截止日期或关联日程，也可删除想法 |
| 集中处理待办 | 左侧“待办”切换未完成与已完成，按全部／普通／重要／日程筛选。未完成事项按已逾期、今天、之后、无日期分组，组内重要事项优先；普通笔记不计入 |
| 撤销操作 | 删除想法、修改项目绑定、切换想法或日程完成状态后，提示中提供 10 秒“撤销”。之后的新修改不会被强行覆盖，正文仍支持 Ctrl+Z |
| 保留浏览位置 | 项目、搜索等视图分别记住分页和滚动位置，返回时继续查看；侧栏宽度、开合状态和当天展开状态随应用保存 |
| 全局搜索 | 点击顶栏搜索，跨日期查找正文、项目、日程与资料；点击结果打开对应想法 |
| 备份与导出 | 顶栏归档图标打开“数据与备份”；恢复前先预览差异，再确认替换 |
| 桌面悬浮 | 点击顶栏的悬浮入口按钮；靠近查看今天，点击回到主窗口 |
| 托盘与退出 | 关闭主窗口会收至托盘；在托盘菜单中选择退出才会结束程序 |
| 调整侧栏 | 拖动左侧栏与内容区之间的分隔线 |

HTTP/HTTPS 网址、Markdown 网页链接和 Windows 路径在编辑区与总览中都会识别。编辑时用 **Ctrl+单击** 打开，移开编辑焦点后可直接单击；Markdown 链接编辑时保留源码，阅读时显示链接文字。含空格的路径请用双引号括起。“当天资料”属于该日期的记录，由这一天的项目总览共享。

粘贴多行文字或公式不会自动拆分想法。换行与空行仍属于当前想法，使用 Shift+Enter 才添加下一个想法。公式在本机离线渲染，保存和复制保留原始 TeX。

新想法默认是普通笔记，手动设为待办后可标为重要或关联日程。日程设置可选择关联任意日期的想法，关联后完成状态跟随想法，在待办里只显示一项；从日程、项目或日历完成它，其他位置同步，关联提醒也取消。转回普通想法会清除截止日期并解除关联，日程保留为独立日程。旧版本已经打勾的想法归入已完成，有截止日期或待办标记的归入待办。

文字样式会随记录保存，并显示在项目总览和展开的当天页面中。应用内复制粘贴保留样式，纯文本复制保留正文。以上功能均已包含在 v0.0.6 Windows 下载包中。

桌面版启动时打开当天。跨过午夜、从托盘恢复或唤醒后会更新“今天”；停留在当天且未输入时自动进入新一天，正在编辑或浏览历史日期时保留当前日期。点击“今天”随时返回系统当前日期。

窗口在不同缩放比例的显示器之间移动时，会按当前屏幕 DPI 重新渲染文字和界面；悬浮图标与今日预览也随屏幕缩放。

## 你的数据，留在本机

数据保存在 `%USERPROFILE%\.schedule\journal.json`，包含正文、想法、项目关系、图片、日程与悬浮位置。关联的文件仍留在原路径。保存采用临时文件和原子替换，`.bak` 保存上一版。界面每次加载都会重新读取文件，读取失败时禁止编辑。保存前检查文件是否已被修改，过期状态不会覆盖磁盘内容；未变化的保存不会轮换备份。

首次升级会自动检查旧 AppData 和 MSIX 包缓存中的日志，先备份至新目录的 `legacy-backups`，再迁入有内容的副本。若有多份不同的有效日志，会提示冲突而不覆盖。旧文件保留；新目录已有日志时不会重新导入。此位置避免 Codex 与桌面启动因 Windows AppData 重定向而读到不同数据。

**备份：** 从托盘退出程序，再复制整个 `%USERPROFILE%\.schedule` 文件夹。

也可在“数据与备份”中直接操作：保存前自动保留每日快照，最多保留 30 个每日快照；手动备份与恢复前备份一直保留。恢复会替换全部记录、项目、图片和日程，先显示差异并备份当前版本。Windows 通知仍受系统权限影响，恢复后会重新安排提醒。

完整 ZIP 备份包含原始 JSON 和内嵌图片，可在另一台电脑导入。关联文件仅保留路径，不复制外部文件。Markdown ZIP 按日期导出正文、日程、完成状态、项目、截止日期和图片，适合阅读；完整保留格式与内部 ID 请使用完整备份。导入 `.md` 会追加到当前日期，识别列表与任务勾选，并读取同目录内引用的本地图片。

## Codex 与 Claude Code

两者使用同一套 Windows 本地接口，无需 localhost 或额外运行时。`Schedule.Cli.exe` 会在必要时启动托盘进程，读取界面当前内容；写入需要读取结果里的 `revision`，过期版本会明确拒绝覆盖。

在新版程序目录运行以下命令即可安装两种助手的 skill（已有同名 skill 时会停止，避免覆盖）：

```powershell
powershell -NoProfile -File .\Install-AssistantSkills.ps1 -AppDirectory . -Target Both
```

Codex 可使用 `$schedule-local`，Claude Code 可使用 `/schedule-local`。也可以直接写 UTF-8 请求文件并运行 `Schedule.Cli.exe --request request.json`。例如 `{"op":"get_day","date":"2026-10-01"}`。参见 [API 操作与冲突处理](integrations/schedule-local/references/api.md)。WSL 会话需要通过 Windows PowerShell 调用这个 Windows 程序。

**升级：** 先退出并备份，将新版解压到原程序文件夹，覆盖程序文件。保留原安装位置与数据目录，可以继续使用已有快捷方式和 Windows 提醒身份。旧版 `points` / `newPointProjects` 字段会迁移为 `ideas` / `newIdeaProjects`，保留原 ID、正文、项目关系和完成状态。

## 从源码构建

在 Windows 上安装 Python 3.10+，运行：

```powershell
py -3 scripts/build.py
.\dist\Schedule\Journal.exe
```

首次构建联网下载固定版本的 NuGet 依赖，使用 Windows 自带的 .NET Framework 编译器。无需 Rust 或 .NET SDK。生成正式压缩包：

```powershell
py -3 scripts/package_release.py
```

输出为 `dist/Schedule-0.0.6-windows-x64.zip`，包含程序、中英文 README、首页图、许可证及本版发布说明。

开发测试另需 Node.js 与 npm：

```powershell
npm ci
npm test
npm run test:native
npm run test:overview
npm run test:restart
npm run test:math
npm run test:calendar
npm run test:day-view
npm run test:important
npm run test:core
npm run test:cli
npm run test:usability
npm run test:tasks
npm run test:editor-links-dpi
npm run test:math-svg
py -3 scripts/test_native_models.py
```

原生测试需要桌面会话和 WebView2，启动前设置独立数据目录。CI 执行状态迁移测试和 Windows 构建。发布流程从 `v0.0.6` 标签构建压缩包，并使用 [保存在仓库中的发布说明](docs/releases/0.0.6.md) 创建 Release。

## 当前边界

界面目前为中文，数据使用单用户 JSON 存储。助手通过本地 CLI 与桌面进程通信，不支持远程网络写入或直接编辑运行中的日志文件。Markdown 是可读导出格式，完整恢复应使用备份包。Windows 通知设置、免打扰、关机或休眠可能影响提醒投递。

## 开源与制作

由 [**ARCLIGHT**](https://arc0127.github.io/) 制作，使用 [MIT 许可证](LICENSE)。欢迎通过 [Issues](https://github.com/ARC0127/Schedule/issues) 反馈问题。

[架构与数据说明](docs/architecture.md) · [第三方许可](THIRD_PARTY_NOTICES.md) · [v0.0.6 发布说明](docs/releases/0.0.6.md)
