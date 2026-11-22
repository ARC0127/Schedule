# 代码架构

Schedule 使用 .NET Framework 4.8 + WinForms + WebView2。业务界面为原生 JavaScript/CSS，不需要前端开发服务器。

```text
src/native/
  Program.cs              进程入口、单实例、数据读写
  app.config / app.manifest  .NET Framework PerMonitorV2 与 Windows 兼容性声明
  StoragePaths.cs         统一用户目录、旧 AppData / MSIX 日志迁移
  Models.cs               日程与存储信封
  JournalArchive.cs       每日/手动快照、预览恢复、完整备份与 Markdown 文件操作
  LocalApi.cs             当前 Windows 用户专属命名管道、串行请求
  JournalWindow.cs        WebView2 消息桥、主窗口与托盘生命周期
  BluetoothRfcomm.cs      已配对设备枚举、认证加密的 Classic RFCOMM 连接
  BluetoothProtocol.cs    安卓 v1 帧、日程字段与改动校验
  BluetoothSync.cs        完整日程快照、更新删除、冲突与重试去重
  BluetoothTransport.cs   蓝牙流创建与隔离测试传输入口
  JournalSyncTransfer.cs  在 v1 握手中协商完整记录同步，分块收发与内容校验
  JournalSyncCommit.cs    完整合并结果的校验、备份、原子保存及提醒重排
  WindowsReminders.cs     Windows 提醒注册、取消及诊断
  TaskLinks.cs            关联日程的完成投影与引用校验
  LocalPaths.cs           路径检查、系统打开与定位
  ExternalLinks.cs        HTTP/HTTPS 校验及默认浏览器打开
  DockWindow.cs           透明悬浮图标、今日预览与拖动
  StartupRegistration.cs  用户级可选启动项
src/web/
  app.html / app.css      布局与样式
  app.js                  日历、想法编辑、项目、图片及日程交互
  state.js                旧数据字段升级，保留稳定 ID
  content.js              手动想法边界、TeX、图片、网页链接与本地路径分词
  formatting.js           文字格式范围、编辑偏移映射与安全样式白名单
  features.js             跨日期搜索、待办分组与 Markdown 投影
  bridge.js               有超时和错误返回的原生消息请求
assets/                   应用图标
src/cli/ScheduleCli.cs     Codex / Claude Code 共用的 JSON 命令客户端
src/shared/ApiProtocol.cs  有长度限制的 UTF-8 管道消息
integrations/             共用 skill、API 参考与调用脚本
third_party/              Lucide 与依赖许可
scripts/build.py          固定版本依赖恢复与本地打包
tests/                    合成数据迁移和原生行为测试
```

## 数据与术语

手动创建的条目称为“想法 / idea”，内部数组为 `ideas`，每项保存 `{id, offset, done, projectIds}`。`offset` 只定位当前正文，`id` 是稳定身份。一个想法可属于零个或多个项目。正文行首 `• ` 标记想法，其后的普通行、空行和缩进续行都属于同一想法，直到下一个手动标记。字数不影响热力图。总览、热力图、光标绑定和完成状态共用 `content.js` 的边界解析，悬浮窗遵循同样的边界。

`state.js` 只迁移旧字段名，不改写原 ID、正文、完成状态或项目关系；重复迁移结果不变。历史 ID 中的 `point` 是不透明字符串，不能替换，否则会破坏外部引用。原生悬浮窗也兼容读取旧字段，直到界面完成下一次保存。

当前根存储仍为 `WidgetState`、`Schedules`、`Dock`。日程带稳定 `Id`、`Date` 和 `Done`，旧日期键保留，新日程使用 `日期/ID` 键。同一天多条日程分别设置提醒和完成状态，通知标签按事件键区分。旧日期通知标签保持兼容。想法新增可选 `important`、`dueDate`，保留稳定 ID；想法完成不会自动取消独立日程。

`ScheduleState.taskState` 将兼容字段解释为普通想法、待办、已完成：`done` 优先，其次 `todo` 或 `dueDate`，否则为普通想法。完成及有截止日期的旧想法会规范为 `todo:true`，保留正文和 ID。Ctrl 完成同时设置待办身份，取消完成仍是待办。显式转为普通想法会清除截止日期和完成状态。CLI 接受 `taskState: note|todo|done`，也兼容旧 `todo`／`done` 写入，不混用两种命令。

待办视图支持未完成／已完成，以及全部／普通／重要／日程筛选。普通笔记不计入；未完成按已逾期、今天、之后、无日期分组，组内重要事项优先。`important` 表示重要程度，关联日程表示时间安排，两者可以同时存在。Markdown 导出保留普通列表与任务复选框的区别，导入 `[ ]` 不会变成普通笔记。

日程可带 `IdeaDate` 和 `IdeaId`，指向任意日期的既有任务。想法的 `done` 是唯一完成来源，日程 `Done` 只是 Windows 排程使用的投影。原生 `saveState` 在同次文件保存中同步该投影，然后更新受影响提醒并返回日程结果，前端刷新缓存；独立修改关联日程的完成状态会被拒绝。完成日程按钮直接调用关联想法的完成操作及撤销。普通想法或已删除想法的关联解除，日程作为独立项保留；删除日程保留想法。一个想法关联多个日程或项目时，待办投影仍只有一行。加载和恢复备份也按想法完成状态校正日程。

`tests/tasks.test.cjs` 覆盖迁移、状态转换、去重和 Markdown 语义。`tests/task-workflow.cjs` 验证实际编辑器 Ctrl、状态与优先级筛选、关联日程完成／撤销、跨日关系、同一 CLI 接口及重启保存；原生模型测试校验完成投影幂等及拒绝反向覆盖。

格式工具按选区或手动展开显示，当前想法操作集中在菜单。10 秒撤销只保存受影响字段及操作后的值：完成与绑定按稳定想法 ID 修改，删除恢复正文、想法元数据及格式。执行前检查相关字段未发生新变化，避免覆盖后续 GUI 或助手写入；标题等无关字段保留。日程撤销通过原生接口同步提醒，过期提醒不重新投递。

`privateContent.navigation` 按视图保存分页与滚动位置，`dayExpanded`、`sidebarWidth`、`sidebar` 与 `sidebarScroll` 保存布局偏好。这些不参与内容版本比较。启动仍选中今天，保留用户展开偏好；加载完成前仅恢复界面，不发起保存。`tests/usability.cjs` 覆盖四项交互、冲突撤销、公式图片恢复、视图返回和重启。

图片在正文中用标记引用 `nativeImages`，总览与编辑区读取同一份数据。纯图片想法也计为一个想法。`files` 仍属于日期记录，总览按日期展示“当天资料”，不把旧资料推断成单个想法的附件。打开资料时使用资料卡自己的日期与索引。

日期记录可选的 `formats` 保存 `{start, end, bold?, italic?, underline?, size?, color?}` 范围，偏移使用正文 UTF-16 索引，正文仍为原始纯文本。`formatting.js` 统一处理替换、粘贴、范围合并和总览偏移；撤销快照同时保存正文与格式。字号和颜色采用固定白名单，不保存任意 CSS 或 HTML。无选区时的格式仅作为当前输入状态，实际输入后才写入记录。应用内剪贴板携带经过同一白名单检查的格式范围，外部 HTML 不直接执行。

双击月历或年历日期通过布局状态展开现有日期编辑器，保留侧栏，不复制编辑实例；返回箭头或 Esc 恢复原日历视图。单击同一网格中的日期只更新选中状态，避免重建按钮中断浏览器双击事件。`tests/day-view.cjs` 验证展开/返回、窄窗布局、格式选区与连续输入、中文组合输入、复制粘贴和原生重启保存，`tests/formatting.test.cjs` 验证格式范围算法。

TeX 支持 `\(...\)`、`\[...\]` 和 `$$...$$`，先识别完整公式再识别路径，避免矩阵的 `\\` 被当作 UNC 路径。KaTeX 及字体随应用离线分发。项目总览始终渲染公式；编辑区获得焦点显示源码，失去焦点显示公式。公式 DOM 保存原始定界符与源码，序列化、复制和保存不使用渲染后的文字。语法错误保留可编辑原文，`trust: false` 禁止公式发起外部链接或图片请求。`tests/math.cjs` 覆盖多行粘贴、公式渲染、编辑/复制/撤销、绑定/完成和重开。

## 原生边界

编辑区与总览共用链接分词，TeX 优先识别，避免公式中的反斜杠或 URL 被解析为链接。编辑时链接保留原始文本并支持 Ctrl+单击；阅读时 Markdown 标签与带引号路径通过 `data-link-source` 保留源码。选区、格式与保存均按原文偏移计算，点击打开不会触发 Ctrl 完成操作。`tests/editor-links-dpi.cjs` 验证即时识别、编辑、打开、格式及冷启动。

图标尺寸仅作用于 `[data-lucide]`，不能用通用 `svg` 选择器覆盖 KaTeX 的伸缩符号。`tests/math-svg.cjs` 将宽帽、根号、长箭头等与界面样式范围之外的 KaTeX 对比，验证编辑区与总览的 SVG 几何尺寸、源码保存及重启。

原生入口在创建窗口前启用 WinForms 视觉样式，程序配置启用 `PerMonitorV2`，清单声明 Windows 10 兼容。主窗口使用 DPI 自动缩放，WebView2 保留自动检测显示器缩放；悬浮窗按 `DeviceDpi / 96` 绘制并在 DPI 改变后重新定位。`tests/editor-links-dpi.cjs` 只移动隔离测试窗口，使用 `tests/display_probe.py` 比较实际显示器比例、窗口 DPI、WebView 像素比例与悬浮尺寸。测试需 Python，可用 `SCHEDULE_PYTHON` 指定路径；只有一个显示器时不构成跨屏验证。

主界面的“今天”使用本地日期，按下一次午夜计时，并最多每分钟复核一次，恢复焦点、页面可见和原生 `journal:resume` 时立即复核。跨天只在选中原来的今天、日历仍处于原月份且没有编辑或对话框时自动切日；其余情况仅更新日历与星期标签，不重建编辑区。桌面文档启动默认打开当天，日期通知可通过 `journal:open-date` 覆盖。`tests/calendar.cjs` 使用独立原生数据目录和可控 WebView2 时钟验证跨月、跨年、闰日、托盘恢复、编辑保存与冷启动。

只有本地 `https://journal.local/index.html` 可发起受支持的消息操作。网页不能任意导航；外部打开支持明确的本地路径、经过原生校验的 HTTP/HTTPS 网页以及固定的制作人主页。正文作为文本处理，识别到的图片与链接单独渲染，不执行正文中的 HTML。拖入文件通过 WebView2 原生文件对象取得真实路径。程序、脚本和未知类型默认在资源管理器中定位。

收起的悬浮窗使用预乘 Alpha 图像和 `UpdateLayeredWindow`，避免颜色键产生红边。展开时恢复普通内容面板。最小化显示悬浮图标，关闭按钮进入托盘，托盘“退出”先保存再结束进程。开机启动默认关闭。

## 开发约束

发布构建只读取 `src`、`assets` 和许可文件，不读取用户日志。`SCHEDULE_TEST_DATA` 必须由父进程在启动测试前设置，不能在测试 Main 内才设置，防止 CLR 提前初始化静态路径。测试只用合成数据，不借用开发者实际项目。

`Schedule.Cli.exe` 经命名管道调用桌面进程，不监听 HTTP。管道 ACL 仅允许当前用户并拒绝网络登录，单次请求上限 2 MB。桌面界面先保存当前编辑，再检查请求的内容版本，执行有限操作并保存；输入法组合输入、打开的弹窗和数据操作返回 BUSY。版本过期返回 CONFLICT，不自动覆盖。写入超时后客户端不能盲目重试，应先读取确认是否已生效。Codex 与 Claude Code 使用同一 skill 和 CLI，不直接修改日志文件。

保存前在 `history` 中保留当天首次修改前的完整快照，最多保留 30 个每日快照。手动和恢复前快照不自动删除。恢复先验证完整存储、预览变化并备份当前数据，再原子保存并重新加载界面。恢复后逐条重新安排日程提醒；旧提醒取消失败会明确显示警告。

完整 ZIP 保存 JSON 与引用的 `images/<sha256>.<ext>` 原图，保留旧内嵌图片。导入仅提取清单引用且名称合法的原图，流式校验后落盘，不解压任意 ZIP 路径。Markdown 导出按日期生成文档和图片目录，导入只读取所选 Markdown 同目录内的图片。关联外部文件保留原路径。Markdown 用于阅读与追加，精确迁移格式和内部标识使用完整备份。

## 蓝牙同步

完整同步在原有 `hello` / `changes` 中协商 `journalSync: 2`。未协商时维持 v1 日程协议。协商成功后，使用 `journal-start`（字节长度、SHA-256）与有序 `journal-part`（最多 384 KiB 二进制的 Base64）交换 JSON，文字清单单份最多 100 MiB，最终以同来源 `ack` 确认。新增 `assetSync:2` 能力协商后，原图从 JSON 分离：清单之后发送 `assets-start`，每张图片使用 `asset-start`、有序 `asset-part`（192 KiB）与校验落盘后的 `asset-ack`。单图最多 64 MiB，累计原图没有固定额度。失败保留完整原图，临时半张丢弃，重试清单省略已完成文件。新旧混用时保持 `assetSync:1` 整包路径，并在提交前检查回复大小。服务 UUID 不变。

`src/web/sync.js` 与 Android 的同名模块保持一致。两端转换为项目、日期笔记、独立想法、日程实体，原图按内容摘要引用。以手机保存的共同版本做三方合并，不用修改时间决定覆盖。冲突时整次事务不写入合并内容，电脑将待确认版本保存到独立的 `sync-review.json` 并发送托盘通知。用户逐项确认后重新连接；仅当设备与 base/desktop/phone 三份内容仍一致时应用选择。手机收到 `pending-review` 只确认收包并释放编辑锁，不更新共同版本。电脑收到完成确认后清除待确认文件；断线保留审批记录供重试。等待期间继续编辑会使相应选择失效。纯重试使用稳定标识，不新增副本。项目被并发删除但仍有想法引用时保留项目并提示冲突。Windows 正文中独立 `•` 是想法结构标记。转换时为手机正文中的字面列表添加内部缩进，并记录未修改文本的映射，往返恢复原文，避免拆分想法编号。

完整同步通过 `sync_journal` 在现有 UI 编辑锁内刷新并合并当前状态。它使用共同基线而非普通 API 的单个修订号。所有原图及记录验证完成后，`commitSync` 通过 `Program.Restore` 一次原子替换完整存储，并保留恢复前快照。手机提交前只备份 journal、events 和 alarms 元数据，写 `pending-metadata.json` 恢复标记；原图不可变并保留，启动时恢复未完成的多文件写入。Windows 通过仅映射图片目录的 `schedule-images.local` 虚拟域渲染原图，CSP 只额外允许该图片来源。同步错误使用 `sync-error` 返回阶段与原因，断线时展示最后传输进度。Android 完整备份包含 journal、事件状态、原图及提醒去重状态；不包含设备外部文件内容、系统授权或签名私钥。

桌面标题栏的“蓝牙同步”通过 `bluetoothDevices` 和 `bluetoothSync` 调用当前 `Journal.exe`。必须手动选择已配对设备。设备枚举、连接及帧收发在工作线程执行。旧版日程路径回到 UI 线程异步调用 `ExecuteApi`，依次读取日程及修订号、执行 `save_event`／`delete_event`；完整同步使用上述 `sync_journal` 路径。两者均不启动 CLI 子进程。同步对话框本身不阻止 API，其他对话框、组合输入、数据操作与并发 API 的 BUSY 检查仍保留。

与安卓旧版共用 Classic RFCOMM 服务 UUID `eb703723-8f0f-4b98-aa19-be0423b0a0c6`。每帧为 4 字节大端长度加 UTF-8 JSON，上限 4 MiB；旧版帧顺序为 `hello → changes → snapshot → ack`，版本 `v:1`。来源标识继续使用 Windows 用户 SID 与规范日志绝对路径计算，避免集成后被手机识别为另一个数据源。旧版事件标识和字段保持不变。手机改动按基准值比较；当前值已等于目标时重试返回 applied，基准不符或关联/旧日程写入返回 conflict，保存失败返回 retry。最终日程快照表达删除，ack 验证同一来源。

`python scripts/test_bluetooth.py` 运行从安卓配套实现迁入的协议与合并测试，附加 `--hardware` 可验证本机加密 socket 与设备枚举。`npm run test:bluetooth` 用后台原生窗口和隔离日志跑完整收发、真实内部事件 API、断线重试、冲突、文件写保护与重启。该测试仅在 `SCHEDULE_TEST_DATA` 非空且指定合法 `SCHEDULE_TEST_BLUETOOTH_PIPE` 时以本地管道替代无线传输，普通用户配置始终使用真实 RFCOMM。模拟传输测试不等于真机无线同步验证。

## 加载与保存一致性

原生桥接只注册消息接口，不嵌入一次性的启动数据快照。每个文档通过 `loadState` 重新读盘，再通过 `uiReady` 通知宿主可以编辑、恢复窗口和处理退出。读取失败时界面显示错误且保持不可编辑，宿主拒绝加载完成前的 `saveState`。

`Program.Load` 记录实际读入的文件文本。`Save` 在写入前比较当前磁盘内容，发现外部变化则显式拒绝覆盖；这不是外部并发写入的事务接口。相同内容不重复写盘或轮换备份。`tests/restart.cjs` 验证文档重载、关闭到托盘、第二次启动激活、完全退出重开和失败恢复。

## 启动环境与数据位置

默认目录为 `%USERPROFILE%\.schedule`，独立测试仍使用 `SCHEDULE_TEST_DATA`。不要改回 AppData：MSIX 宿主（包括 Codex）的子进程会继承文件重定向，字面相同的路径可能对应不同文件。定位此类问题必须通过文件句柄的 `GetFinalPathNameByHandle` 对比实际路径，且测试必须覆盖资源管理器启动。参见 [Microsoft 的 AppData 重定向说明](https://learn.microsoft.com/en-us/windows/msix/desktop/flexible-virtualization)。

`StoragePaths` 仅在新日志不存在时检查旧 AppData 和 `Packages/*/LocalCache/Local/CodexJournal`。迁移先保留来源及 `.bak`，选择唯一有内容的文本副本；多个不同的有效副本或不可读数据使启动显式失败，不猜测哪份较新。新目录存在后不再导入，避免复活已删除记录。图片内嵌在 JSON，迁移保留整个信封。WebView2 缓存无需迁移。

### 原图增量与 Wi-Fi 协商（0.0.9 / Android 1.1.7）

`assetSync:1` 在 `changes` 后协商 `asset-inventory`。发送端省略接收端已有的图片；合并前用本机原图补齐并重新校验。手机保留完整发送快照供回复补齐，不推进未确认冲突的基准。

`wifiSync:1` 经认证加密 RFCOMM 交换 `wifi-offer` 和 `wifi-result`。先尝试现有局域网，再协商 Android LocalOnlyHotspot。Windows 使用 Native WLAN temporary profile，密码不写入持久配置，关闭时恢复原连接。Wi-Fi 服务仅在当前同步会话开放，TLS 证书指纹和随机令牌经已配对蓝牙提供。连通失败明确回退蓝牙，已开始数据交换后不自动切换通道重试。原有冲突审阅/提交保持共用。

手机用单调时钟的进展监视器替代固定 240 秒计时器；输入/输出成功后刷新活动时间。Windows socket 同样使用 120 秒读写空闲超时，桥接不再提前在五分钟结束调用。关闭/切后台释放连接和临时热点。


## 后台自动同步（Windows 0.0.11 / Android 1.1.9）

Windows `AutoSyncPolicy` 由托盘进程的定时器驱动，默认两小时，连接恢复与保存后空闲十秒也可触发。每三十秒向用户选定的已配对手机发送状态探测，不在探测中导出日志或传图。失败采用最多五分钟的退避。`auto-sync.json` 保存开关、设备、周期和上次成功时间，与日志文件分离。待确认冲突阻止后续自动提交。

Android `SyncService` 是 `connectedDevice` 前台服务，使用持续通知和暂停入口。`SyncEngine` 在独立 WebView 中执行共享 `sync-engine.js` / `sync.js`，不依赖 Activity。`JournalAccess` 共用保存锁与元数据事务。可见编辑器有未保存草稿时拒绝开始，原有草稿保留；页面销毁后由服务继续交换。前台编辑器写入还核对所加载的日志，过期页面不能覆盖后台同步结果。

自动交换在 hello 中标记 `automatic`，只尝试已有 LAN，禁止请求临时热点。手动交换保留热点路径。原图仍使用相同的分块校验和重试协议。Android 服务关闭不等于用户数据删除。系统强行停止应用、后台限制或电脑休眠可能延后尝试，不承诺精确到点执行。
