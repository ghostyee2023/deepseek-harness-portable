# dsh-codex-sync

把本机 Codex 对话同步进 DeepSeek Harness 的 dsh 插件。

## 功能

- **自动探测 Codex 位置**：依次检查配置项 `codexHome`、环境变量 `CODEX_HOME`、
  `~/.codex`（Windows/macOS/Linux 通用），无需用户手工指定路径。
- 读取 `state_5.sqlite` 的线程索引和 `rollout-*.jsonl` 消息记录。
- 导入为 Harness 会话（正确的消息 id/source、帧结构），并自动注册到对应
  工作区（按会话的 cwd 目录归属）。
- 增量导入：已存在的会话自动跳过。

## 安装（在 Harness 的 web profile 上启用）

```powershell
# 1) 安装插件包（发布到 npm 后直接：dsh plugin --profile web add dsh-codex-sync）
$env:DSH_HOME = "<你的 harness home>"
node <dsh-cli路径>/bin.js plugin --profile web add file:<本插件目录>

# 2) 编辑 <harness home>/profiles/web/cordis.patch.yml，追加：
#    - insert:
#        - id: codex-sync
#          name: 'dsh-codex-sync'
#          config:
#            defaultCount: 10

# 3) 重启 Harness
```

## 使用

在对话输入框里输入：

```text
/codex-sync            显示状态（Codex 目录、Harness 目录）
/codex-sync detect     重新探测 Codex 位置
/codex-sync list       列出最近的 Codex 会话
/codex-sync sync       同步最近 10 个
/codex-sync sync all   同步全部
/codex-sync sync recent:50
/codex-sync sync <会话ID 或标题关键字>
```

## 配置（cordis.patch.yml 的 config 段）

| 键 | 默认 | 说明 |
|---|---|---|
| `codexHome` | 自动 | 手动指定 Codex 数据目录（含 state_5.sqlite） |
| `defaultCount` | 10 | `sync` 不带参数时同步的最近数量 |
| `autoSyncOnStartup` | false | 启动时自动同步最近 N 个 |

## 兼容性

- 零 npm 依赖（只用 Node 内置模块），随 Harness 的 Node 运行时运行。
- 需要 Node 22.5+（`node:sqlite`）。
- Codex 数据要求：`~/.codex/state_5.sqlite` + `~/.codex/sessions/**/rollout-*.jsonl`
  （Codex CLI / 桌面版均写入该目录）。
