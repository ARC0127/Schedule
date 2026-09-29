# 代码架构

Schedule 使用 .NET Framework 4.8 + WinForms + WebView2。业务界面为原生 JavaScript/CSS，不需要前端开发服务器。

```text
src/native/
  Program.cs              进程入口、单实例、数据读写
  Models.cs               日程与存储信封
  JournalWindow.cs        WebView2 消息桥、主窗口与托盘生命周期
  WindowsReminders.cs     Windows 提醒注册、取消及诊断
  LocalPaths.cs           路径检查、系统打开与定位
  ExternalLinks.cs        HTTP/HTTPS 校验及默认浏览器打开
  DockWindow.cs           透明悬浮图标、今日预览与拖动
  StartupRegistration.cs  用户级可选启动项
src/web/
  app.html / app.css      布局与样式
  app.js                  日历、想法编辑、项目、图片及日程交互
  state.js                旧数据字段升级，保留稳定 ID
  content.js              想法总览的图片、网页链接与本地路径分词
  bridge.js               有超时和错误返回的原生消息请求
assets/                   应用图标
third_party/              Lucide 与依赖许可
scripts/build.py          固定版本依赖恢复与本地打包
tests/                    合成数据迁移和原生行为测试
```

## 数据与术语

手动创建的条目称为“想法 / idea”，内部数组为 `ideas`，每项保存 `{id, offset, done, projectIds}`。`offset` 只定位当前正文，`id` 是稳定身份。一个想法可属于零个或多个项目。正文 `• ` 标记想法，缩进续行属于同一想法，字数不影响热力图。

`state.js` 只迁移旧字段名，不改写原 ID、正文、完成状态或项目关系；重复迁移结果不变。历史 ID 中的 `point` 是不透明字符串，不能替换，否则会破坏外部引用。原生悬浮窗也兼容读取旧字段，直到界面完成下一次保存。

当前根存储仍为 `WidgetState`、`Schedules`、`Dock`，保留旧数据和通知身份。想法完成不会自动取消独立日程。原生进程串行提交 JSON 快照，外部并发写入尚不受支持。

图片在正文中用标记引用 `nativeImages`，总览与编辑区读取同一份数据。纯图片想法也计为一个想法。`files` 仍属于日期记录，总览按日期展示“当天资料”，不把旧资料推断成单个想法的附件。打开资料时使用资料卡自己的日期与索引。

## 原生边界

只有本地 `https://journal.local/index.html` 可发起受支持的消息操作。网页不能任意导航；外部打开支持明确的本地路径、经过原生校验的 HTTP/HTTPS 网页以及固定的制作人主页。正文作为文本处理，识别到的图片与链接单独渲染，不执行正文中的 HTML。拖入文件通过 WebView2 原生文件对象取得真实路径。程序、脚本和未知类型默认在资源管理器中定位。

收起的悬浮窗使用预乘 Alpha 图像和 `UpdateLayeredWindow`，避免颜色键产生红边。展开时恢复普通内容面板。最小化显示悬浮图标，关闭按钮进入托盘，托盘“退出”先保存再结束进程。开机启动默认关闭。

## 开发约束

发布构建只读取 `src`、`assets` 和许可文件，不读取用户日志。`SCHEDULE_TEST_DATA` 必须由父进程在启动测试前设置，不能在测试 Main 内才设置，防止 CLR 提前初始化静态路径。测试只用合成数据，不借用开发者实际项目。

后续 Codex skill 应调用正式读写接口，具备版本冲突处理后再支持与 GUI 并发编辑。当前不把这一设计计划写成已实现功能。
