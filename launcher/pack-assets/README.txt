DeepSeek Harness 便携版（Windows）
================================

1. 双击 dsh-web.exe 启动，会自动打开独立应用窗口（首次运行需联网初始化，
   约几分钟；之后每次启动自动检查 dsh 更新）。
2. 在界面里配置你的模型 API Key（设置页）。
3. （可选）双击 setup.cmd：
   - 创建桌面快捷方式
   - 开机自启 / 托盘常驻
   - 安装 Codex 同步插件（需先运行过一次 dsh-web.exe）

说明：
- 本包不含任何使用者的个人数据；所有数据都存放在本文件夹
  runtime\dsh-home 下，整体拷贝即备份/迁移。
- 未签名 exe 首次运行 Windows 可能提示 SmartScreen，点“仍要运行”。
- Mac 版请使用 build.sh 在 Mac 上构建（构建脚本在 launcher 目录）。
