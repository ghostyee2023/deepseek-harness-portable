# DeepSeek Harness 便携版 · 使用指南

> GitHub 仓库：<https://github.com/ghostyee2023/deepseek-harness-portable>
> 下载发布包：<https://github.com/ghostyee2023/deepseek-harness-portable/releases>

把 DeepSeek Harness 装进一个文件夹：**解压即用、免安装、自动升级、独立应用窗口，数据全在本地**。

## 特性

- **绿色便携**：不写注册表、不依赖系统目录，整个文件夹拷到 U 盘或任意位置即可运行
- **独立应用窗口**：用 Edge/Chrome 应用模式打开，无标签页、无地址栏，不占用浏览器
- **自动升级**：每次启动自动对比最新版本，有新版本先升级再启动
- **托盘常驻（可选）**：`setup.cmd` 一键启用托盘、开机自启、桌面快捷方式
- **Codex 会话同步（可选插件）**：把本机 Codex 对话导入 Harness，自动探测位置、按目录归类、增量导入
- **数据本地化**：聊天记录、配置、凭据都在 `runtime\dsh-home`，整个文件夹即备份
- **双平台**：Windows 现成 exe；macOS 用 `build.sh` 自行构建

## 快速开始

1. 从 [Releases](https://github.com/ghostyee2023/deepseek-harness-portable/releases) 下载
   `deepseek-harness-portable-win64-v0.1.0.zip` 并解压到任意目录
2. 双击 `dsh-web.exe`（首次运行需联网初始化，约几分钟；SmartScreen 提示点“仍要运行”）
3. 在界面设置里配置你的模型 API Key
4. 可选：双击 `setup.cmd` 安装快捷方式 / 开机自启 / 托盘 / Codex 同步插件

## 目录结构

```text
dsh-portable-win64\
├── dsh-web.exe       启动器（双击即用，自动升级）
├── setup.cmd         可选安装菜单（快捷方式/自启/托盘/插件）
├── usage.html        使用指南
├── runtime\
│   ├── node_modules\ dsh 包本体
│   └── dsh-home\     用户数据（聊天记录、配置、凭据）
├── tools\            托盘工具
└── plugins\          Codex 同步插件源码（可选安装）
```

## 可选功能（setup.cmd）

| 选项 | 作用 |
|---|---|
| 1 | 创建桌面快捷方式 |
| 2 | 开机自启（托盘常驻） |
| 3 | 取消开机自启 |
| 4 | 立即启动托盘 |
| 5 | 停止所有 DSH 服务 |
| 6 | 安装 Codex 同步插件（先运行过一次 dsh-web.exe） |

## Codex 会话同步插件

安装后在 Harness 对话里输入：

```text
/codex-sync                查看状态（Codex 目录、Harness 目录）
/codex-sync detect         重新探测 Codex 位置
/codex-sync list           列出最近会话
/codex-sync sync           同步最近 10 个（默认，增量）
/codex-sync sync all       全量同步
/codex-sync sync recent:50
/codex-sync sync <ID 或关键字>
```

插件自动查找 Codex（`codexHome` 配置 → `CODEX_HOME` → `~/.codex`），草稿会话自动跳过。

## 数据与备份

| 路径 | 内容 |
|---|---|
| `runtime\dsh-home\sessions` | 全部聊天记录（按工作区分目录） |
| `runtime\dsh-home\.credentials.yaml` | 模型 API 凭据 |
| `runtime\dsh-home\settings.yaml` | 界面与模型设置 |
| `runtime\dsh-home\profiles` | 插件与 profile 配置 |
| `runtime\dsh-home\storages` | 工作区与会话索引 |

- 备份 = 复制整个文件夹；迁移 = 整个文件夹拷到新位置，首次运行自动重建内部链接
- 发布包不包含任何个人数据
- 卸载 = 删除文件夹，不留残留

## 常见问题

**Windows 提示“已保护你的电脑”（SmartScreen）？**

exe 未做代码签名，点“更多信息 → 仍要运行”即可。

**首次运行需要联网吗？**

需要：首次启动会初始化 profile 并检查最新版本；之后断网也能用现有版本。

**关掉窗口后服务会停吗？**

应用窗口模式下关窗即停；托盘模式下服务由托盘托管，需在托盘菜单里停止。

**端口 3080 被占用或访问报 503？**

本机代理可能拦截 localhost 请求，但服务本身正常。可在 `launcher.json` 里改端口或用 `--port` 参数。

**历史加载失败 / 出现“未分组”？**

旧版导入的会话可能缺字段：用 `node fix-scripts\repair-sessions.cjs` 修复，`fix-scripts\fix-workspaces.cjs` 归位工作区。

**Mac 上能用吗？**

当前 exe 是 Windows 版；Mac 上装 Node.js 后运行 `launcher\build.sh` 构建，数据目录可跨平台拷贝。

## 源码构建

```powershell
# Windows
.\launcher\build.ps1        # 重建 dsh-web.exe + 托盘工具
.\pack.ps1                  # 生成干净的发布 zip
```

```bash
# macOS / Linux
chmod +x launcher/build.sh && launcher/build.sh
```

---

DeepSeek Harness 便携版 · 数据始终属于你 · [GitHub](https://github.com/ghostyee2023/deepseek-harness-portable)
