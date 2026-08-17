# DeepSeek Harness 便携版（DSH Portable）

把 DeepSeek Harness 装进一个文件夹：**解压即用、免安装、自动升级、独立应用窗口，数据全在本地**。

[![license](https://img.shields.io/badge/license-MIT-1e63f0)](LICENSE)
[![release](https://img.shields.io/badge/release-v0.1.0-1e63f0)](https://github.com/ghostyee2023/deepseek-harness-portable/releases)
[![platform](https://img.shields.io/badge/platform-win64%20%7C%20macOS-lightgrey)](launcher/build.ps1)
[![pages](https://img.shields.io/badge/pages-online-1e63f0)](https://ghostyee2023.github.io/deepseek-harness-portable/)

## 文档入口

| 内容 | 地址 |
|---|---|
| 使用指南（网页版） | https://ghostyee2023.github.io/deepseek-harness-portable/ |
| 职场实操课程（网页版） | https://ghostyee2023.github.io/deepseek-harness-portable/course.html |
| 使用指南（Markdown） | [docs/usage.md](docs/usage.md) |
| 下载发布包 | [Releases](https://github.com/ghostyee2023/deepseek-harness-portable/releases) |

## 特性

- **绿色便携**：不写注册表、不依赖系统目录，整个文件夹拷到 U 盘或任意位置即可运行
- **独立应用窗口**：用 Edge/Chrome 应用模式打开，无标签页、无地址栏，不占用浏览器
- **自动升级**：每次启动自动对比 npm 最新版，有新版本先升级再启动
- **托盘常驻（可选）**：`setup.cmd` 一键启用托盘、开机自启、桌面快捷方式
- **Codex 会话同步（可选插件）**：把本机 Codex 对话导入 Harness，自动探测位置、按目录归类、增量导入
- **数据本地化**：聊天记录、配置、凭据都在 `runtime\dsh-home`，整个文件夹即备份
- **双平台**：Windows 现成 exe；macOS 用 `build.sh` 自行构建

## 快速开始

1. 从 [Releases](https://github.com/ghostyee2023/deepseek-harness-portable/releases) 下载
   `deepseek-harness-portable-win64-v0.1.0.zip` 并解压
2. 双击 `dsh-web.exe`（首次运行需联网初始化，SmartScreen 提示点“仍要运行”）
3. 在界面设置里配置你的模型 API Key
4. 可选：双击 `setup.cmd`，按需选择快捷方式 / 开机自启 / 托盘 / Codex 插件

## 目录结构

```text
dsh-portable-win64\
├── dsh-web.exe       启动器（双击即用，自动升级）
├── setup.cmd         可选安装菜单
├── usage.html        使用指南
├── course.html       职场实操课程
├── runtime\
│   ├── node_modules\ dsh 包本体
│   └── dsh-home\     用户数据（聊天记录、配置、凭据）
├── tools\            托盘工具
└── plugins\          Codex 同步插件源码（可选安装）
```

## 源码构建

```powershell
# Windows
.\launcher\build.ps1        # 重建 dsh-web.exe（Node SEA 单文件 + 托盘工具）
.\pack.ps1                  # 生成干净的发布 zip（自动剔除个人数据）
```

```bash
# macOS / Linux
chmod +x launcher/build.sh && launcher/build.sh
```

## Codex 同步插件

安装后在 Harness 对话里输入：

```text
/codex-sync                查看状态
/codex-sync detect         重新探测 Codex 位置
/codex-sync list           列出最近会话
/codex-sync sync           同步最近 10 个（默认）
/codex-sync sync all       全量同步
/codex-sync sync recent:50
```

插件自动查找 Codex（`codexHome` 配置 → `CODEX_HOME` → `~/.codex`），草稿会话自动跳过。

## 数据与隐私

- 所有用户数据都在 `runtime\dsh-home`，整个文件夹拷贝即备份 / 迁移
- 发布包（`pack.ps1` 产物）不包含任何个人数据
- 卸载 = 删除文件夹，不留任何残留

## 常见问题

见 [使用指南](https://ghostyee2023.github.io/deepseek-harness-portable/) 的 FAQ 章节：SmartScreen、首次联网、关窗停服、端口 / 代理、历史加载失败修复、Mac 构建等。

## License

MIT
