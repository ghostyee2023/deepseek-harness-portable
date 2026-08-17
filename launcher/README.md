# dsh-web launcher

`dsh-web.exe` 是一个自包含、可便携（绿色版）的 DeepSeek Harness Web 启动器：

- 首次运行：自动把 `@deepseek-ai/dsh` 安装到 exe 同级的 `runtime\` 目录
- 每次启动：自动对比 npm registry，发现新版本就先升级再启动
- 启动 `dsh web` 后自动打开浏览器

## 绿色版布局

把整个文件夹拷到任何位置（含 U 盘）都能直接运行：

```text
DeepSeekHarness\
├── dsh-web.exe          启动器（本身可执行）
├── launcher.json        可选配置（放在 exe 旁边）
└── runtime\             自动维护，别手动改
    ├── node_modules\    dsh 包本体（自动升级）
    └── dsh-home\        Harness 用户数据：聊天记录 sessions\、
                         配置 settings.yaml、凭据 .credentials.yaml、profiles\
```

数据不写注册表、不依赖 `%APPDATA%`；换机器/换目录只要整个文件夹一起拷。

> U 盘/换机器提示：`profiles\` 是按路径初始化的，位置变了之后首次运行会重新
> 初始化 profile（需要联网，几分钟），聊天记录、设置、凭据不受影响。如果
> `launcher.json` 里的 `workspace` 指向的目录在新机器上不存在，会自动回退到
> exe 所在目录。

## 使用

```text
dsh-web.exe                      启动（自动检查升级、自动开浏览器）
dsh-web.exe --port 8080          换端口
dsh-web.exe --cwd D:\work\opc    指定工作区（决定聊天记录归哪个目录）
dsh-web.exe --no-update          本次跳过升级检查
dsh-web.exe --no-open            不自动打开浏览器
dsh-web.exe --open-mode app      以独立应用窗口打开（Edge/Chrome 应用模式）
dsh-web.exe --open-mode browser  用默认浏览器打开
dsh-web.exe --open-mode none     只启动服务，不打开任何窗口
dsh-web.exe --window-size 1920x1080   应用窗口尺寸（或 max 最大化）
dsh-web.exe --migrate-home       一次性把 ~/.dsh 的旧数据迁进便携目录
dsh-web.exe -- ...               后续参数原样传给 dsh web
dsh-web.exe --version            查看版本
```

## 显示方式（openMode）

默认 `app`（独立应用窗口）：启动器用 Edge/Chrome 的 `--app` 模式打开一个
无标签页、无地址栏的独立窗口，并配独立配置目录 `runtime\edge-profile\`，
完全不占用浏览器、不影响浏览器里的登录态。改回默认浏览器则设
`"openMode": "browser"`。

也可以利用 UI 自带的 PWA manifest（`display: fullscreen`）：在 Edge 里打开
地址后点「应用」→「将此站点作为应用安装」，会得到桌面图标，双击即独立窗口。

### Windows 与 macOS 的差异

- **Windows**：Edge 系统自带，`app` 模式开箱即用；另附 `setup.cmd` 可选安装
  （桌面快捷方式、开机自启、托盘常驻 `tools\dsh-tray.exe`，托盘为 Windows 专属）。
- **macOS**：`app` 模式需要已安装 Microsoft Edge / Google Chrome / Brave；
  都没有时自动回退到默认浏览器（Safari 可用「文件 → 添加到程序坞」得到类似
  独立窗口）。没有托盘，改用 `setup.sh`：桌面启动器（.command）+ launchd
  开机自启（服务后台运行，不弹窗口）。
- **大屏/高分屏**：默认窗口 1440x900，可在 `launcher.json` 设
  `"windowSize": "1920x1080"` 或 `"windowSize": "max"` 最大化。

## 配置

放在 exe 旁边的 `launcher.json`：

```json
{
  "workspace": "D:\\work\\opc-deepseek-harness",
  "port": 3080,
  "openBrowser": true,
  "openMode": "app",
  "windowSize": "max",
  "update": true,
  "dshHome": "D:\\work\\opc-deepseek-harness\\runtime\\dsh-home"
}
```

命令行参数优先于配置文件。不想用 exe 同级的默认位置时：

- `DSH_HOME` 环境变量：改变 Harness 数据根目录（聊天记录/配置/凭据）
- `DSH_APP_DIR` 环境变量：改变 dsh 包安装目录
- `launcher.json` 的 `dshHome`：两者之一，优先级最高

> 注意：`runtime\dsh-home\profiles\` 是按目录初始化的，换新目录后首次启动会
> 重新初始化 profile（需要联网，几分钟）。`--migrate-home` 只会迁移用户数据
> （聊天记录、设置、凭据、工作区索引），不会迁移 profile 的安装产物。

## 重新构建

需要 Node.js 和网络（下载 postject）：

```powershell
.\build.ps1
```

Windows 产物在 `..\dist\dsh-web.exe`。exe 未签名，首次运行 Windows SmartScreen
可能提示（点“仍要运行”）。

## Mac / Linux

当前 `dsh-web.exe` 是 Windows 二进制，Mac 上不能直接跑。但启动器源码是跨平台的，
在 Mac 上装好 Node.js 后运行：

```bash
chmod +x build.sh && ./build.sh
```

产物为 `../dist/dsh-web`（macOS 可执行文件），目录结构、`launcher.json`、
自动升级逻辑与 Windows 完全一致。`dsh-home` 里的聊天记录文件格式跨平台通用，
可以直接从 Windows 拷过来用（profile 会在首次运行时按新路径重建；工作区路径
映射以新机器为准）。macOS 未签名会触发 Gatekeeper：右键 → 打开。

## 双平台支持一览

一份源码、两个构建产物、数据目录互通：

| | Windows | macOS |
|---|---|---|
| 构建 | `build.ps1` → `dist\dsh-web.exe` | `build.sh` → `dist/dsh-web`（自动 ad-hoc 签名） |
| 应用窗口 | Edge 系统自带，开箱即用 | 需装 Edge/Chrome/Brave，否则回退默认浏览器 |
| 关窗自停 | 支持（PowerShell 检测） | 支持（ps 检测） |
| 托盘常驻 | `tools\dsh-tray.exe`，`setup.cmd` 安装 | 无托盘，用 launchd 后台服务 |
| 开机自启 | `setup.cmd`（启动文件夹快捷方式） | `setup.sh`（LaunchAgent plist） |
| 安装菜单 | `setup.cmd` | `setup.sh` |
| 聊天记录互通 | — | `runtime\dsh-home` 整个拷过去即可（profile 首次自动重建） |

平台差异只在“外壳”层（构建、窗口、常驻方式）；启动器逻辑、配置格式、数据
格式完全一致，同一份 `launcher.json` 两边通用。

## 数据位置

- 便携模式下全部在 exe 同级：`runtime\`（dsh 包）和 `runtime\dsh-home\`（用户数据）
- 旧版默认位置：`C:\Users\<你>\\.dsh`（可用 `DSH_HOME` 改）
