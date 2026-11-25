# 分析与追问 / Analysis & questions

Windows 0.0.15 / Android 1.1.14 新增手动助手分析。安装包见 [v0.0.15 Release](https://github.com/ARC0127/Schedule/releases/tag/v0.0.15)。

## 使用

1. 电脑安装并登录 Codex CLI 或 Claude Code。Schedule 使用该 CLI 的账号与服务配置，不要求另存 API 密钥。
2. Windows 顶部点“分析与追问”，展开“绑定本地助手”，选择助手，勾选“允许处理手动请求”并保存。自动检测失败时选择 CLI 的 `.exe`。电脑需保持 Schedule 运行，放在托盘也可以。
3. 在 Windows 同一窗口，或 Android 底部“追问”页面，选择当天、最近 7 天或一个项目。展开来源预览，按需填写关注问题，再手动点“分析与追问”。
4. 手机发起的请求先保存在本机，随普通同步送到电脑。电脑完成后，结果随下一次同步回到手机。需两端都升级；旧版本不识别分析实体。

普通保存、每小时同步和重新连接均不会创建分析请求。只有你提交过的请求会在绑定的电脑上处理。失败或中断不自动重跑，点“重新分析”会创建新请求。重复同步不会重新调用已处理的请求。两端同时改变同一请求时，仍由电脑确认冲突。

仅分享预览中的文字。原图和关联文件内容不发送，助手不会改写原记录。所选文字会发送至 CLI 所使用的模型服务，适用该账号的用量与费用。模型工具、MCP 和 hooks 在本次分析中关闭。请仅绑定可信的 CLI 程序。

## 模型和输出

- Codex 每次运行前读取本地 CLI 的可用模型目录，选支持 `xhigh` 的最新 GPT 版本；同版本优先旗舰系列（astra/pro）。这是可用目录选择规则，不代表对所有模型的能力评测。不支持的目录或参数会报错，不静默降档。
- Claude 使用动态 `opus` 别名及 `xhigh`，由已安装 CLI 和账号提供对应模型；结果保存 CLI 报告的实际模型名称。保留用户认证配置，关闭本次工具与 hooks。
- 输出聚焦关键主张、具体追问、反例、适用条件和可验证的下一步，并引用来源编号。没有外部检索时明确标注需要验证的内容。

输入快照最多 20 万字符，结果最多 100 万字符。超过范围会显示错误，请缩小选区。每次调用最长 30 分钟，可手动取消。手机取消正在电脑执行的请求，需要先同步取消状态；若同时已有新结果，会进入冲突确认。

## 独立项目目录

Windows 点击“打开分析项目”，默认位于 `%USERPROFILE%\.schedule\analysis-project`（使用自定义数据目录时跟随该目录）。可以把它作为独立项目添加到 Codex 或 Claude Code。

```text
analysis-project/
  AGENTS.md
  CLAUDE.md
  README.md
  requests/<request-id>/
    source.md       # 本次来源快照
    request.json    # 范围、关注问题与状态
    run.json        # 模型、结果与执行状态，避免重复调用
    result.md       # 成功后的分析报告
```

目录是可阅读的输出，不是另一个双向编辑入口。不要手改 `run.json`。两端同步的是 Schedule 内的请求和报告，不是任意项目文件；本机路径、CLI 可执行文件和认证信息不传输。Android 可在报告中导出 Markdown。完整备份包含已保存在日志中的请求和报告。

## English

Windows 0.0.15 and Android 1.1.14 add **manual Analysis & questions**. Installers are available in [release v0.0.15](https://github.com/ARC0127/Schedule/releases/tag/v0.0.15).

On Windows, open **Analysis & questions → Bind local assistant**, choose an installed and signed-in Codex CLI or Claude Code, enable processing of manual requests, and save. The executable can be selected if detection fails. Keep Schedule running, including in the tray.

Choose a day, the last seven days, or a project on either device. Preview the shared text, optionally enter a focus question, and submit explicitly. Android queues requests for the next ordinary sync. Windows processes them, and a later sync carries reports back. Both apps must be upgraded to recognize analysis entities. Saving notes, periodic sync and reconnection never create requests. Failed/interrupted calls require manual retry; repeated synchronization does not regenerate a completed request. Concurrent edits retain desktop conflict confirmation.

Only the previewed text goes to the CLI's model service, under its account and usage charges. Images and linked file contents are excluded, original notes remain unchanged, and model tools, MCP servers and hooks are disabled for this call. Bind only a trusted CLI executable.

Codex discovers its available model catalog at execution time and selects the latest GPT version supporting `xhigh`, preferring astra/pro within that version. This is a catalog policy, not a comparative capability benchmark. Claude uses the dynamic `opus` alias with `xhigh`, retains user authentication settings and records the actual model reported by the CLI. Unsupported models/options fail visibly without silent downgrade. Input is limited to 200,000 characters, output to 1,000,000 characters, with a 30-minute timeout and manual cancellation.

**Open analysis project** opens the independent folder described above. Add it as a Codex or Claude Code project to read immutable snapshots and reports. It is a readable projection, not a second editing authority. Do not edit `run.json`. Schedule sync transfers requests and reports, not arbitrary project files or local paths/credentials. Android can export a report and its source snapshot as Markdown. Full journal backups retain stored requests and results.
