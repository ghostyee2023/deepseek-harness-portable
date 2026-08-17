using System;
using System.Diagnostics;
using System.Drawing;
using System.IO;
using System.Management;
using System.Net.Sockets;
using System.Threading;
using System.Windows.Forms;

static class Program
{
    [STAThread]
    static void Main()
    {
        using (var ctx = new TrayApp())
        {
            Application.Run(ctx);
        }
    }
}

sealed class TrayApp : ApplicationContext
{
    private NotifyIcon _icon;
    private readonly string _distDir;
    private readonly string _launcher;
    private readonly string _url = "http://127.0.0.1:3080";
    private string _windowSize = "1440,900";

    public TrayApp()
    {
        _distDir = Path.GetFullPath(Path.Combine(Path.GetDirectoryName(Application.ExecutablePath), ".."));
        _launcher = Path.Combine(_distDir, "dsh-web.exe");
        ReadConfig();
        EnsureServerRunning();

        _icon = new NotifyIcon();
        _icon.Icon = MakeIcon();
        _icon.Text = "DeepSeek Harness";
        _icon.ContextMenu = BuildMenu();
        _icon.DoubleClick += (s, e) => OpenUi();
        _icon.Visible = true;
    }

    private void EnsureServerRunning()
    {
        if (IsPortOpen()) return;
        StartLauncher();
    }

    private bool IsPortOpen()
    {
        try
        {
            using (var client = new TcpClient())
            {
                var ar = client.BeginConnect("127.0.0.1", 3080, null, null);
                if (ar.AsyncWaitHandle.WaitOne(1500))
                {
                    client.EndConnect(ar);
                    return true;
                }
            }
        }
        catch { }
        return false;
    }

    private void StartLauncher()
    {
        try
        {
            var psi = new ProcessStartInfo();
            psi.FileName = _launcher;
            psi.Arguments = "--open-mode none --no-open";
            psi.WorkingDirectory = _distDir;
            psi.UseShellExecute = false;
            psi.CreateNoWindow = true;
            psi.WindowStyle = ProcessWindowStyle.Hidden;
            Process.Start(psi);
        }
        catch (Exception ex)
        {
            MessageBox.Show("Failed to start dsh: " + ex.Message, "DSH");
        }
    }

    private ContextMenu BuildMenu()
    {
        var menu = new ContextMenu();
        menu.MenuItems.Add("Open UI", (s, e) => OpenUi());
        menu.MenuItems.Add("Restart server", (s, e) =>
        {
            StopServer();
            Thread.Sleep(1200);
            StartLauncher();
        });
        menu.MenuItems.Add("-");
        menu.MenuItems.Add("Stop server and exit", (s, e) =>
        {
            StopServer();
            ExitThread();
        });
        menu.MenuItems.Add("Exit (keep server running)", (s, e) => ExitThread());
        return menu;
    }

    private void OpenUi()
    {
        try
        {
            string browser = FindChromium();
            if (browser != null)
            {
                string profile = Path.Combine(_distDir, "runtime", "edge-profile");
                string args = "--app=" + _url + " --user-data-dir=\"" + profile + "\"";
                if (_windowSize == "max") args += " --start-maximized";
                else args += " --window-size=" + _windowSize;
                Process.Start(browser, args);
            }
            else
            {
                Process.Start(_url);
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show("Failed to open UI: " + ex.Message, "DSH");
        }
    }

    private void ReadConfig()
    {
        try
        {
            string config = Path.Combine(_distDir, "launcher.json");
            if (!File.Exists(config)) return;
            string text = File.ReadAllText(config);
            var m = System.Text.RegularExpressions.Regex.Match(text, "\"windowSize\"\\s*:\\s*\"([^\"]+)\"");
            if (m.Success) _windowSize = m.Groups[1].Value;
        }
        catch { }
    }

    private static string FindChromium()
    {
        string[] roots =
        {
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles),
            Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86)
        };
        string[] rels =
        {
            Path.Combine("Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine("Google", "Chrome", "Application", "chrome.exe")
        };
        foreach (string root in roots)
        {
            foreach (string rel in rels)
            {
                string p = Path.Combine(root, rel);
                if (File.Exists(p)) return p;
            }
        }
        return null;
    }

    private void StopServer()
    {
        try
        {
            foreach (Process p in Process.GetProcessesByName("dsh-web"))
            {
                try { p.Kill(); } catch { }
            }
            string like = _distDir.Replace("\\", "\\\\");
            using (var searcher = new ManagementObjectSearcher(
                "SELECT ProcessId FROM Win32_Process WHERE Name='node.exe' AND CommandLine LIKE '%" + like + "%'"))
            {
                foreach (ManagementObject o in searcher.Get())
                {
                    try
                    {
                        Process.GetProcessById((int)(uint)o["ProcessId"]).Kill();
                    }
                    catch { }
                }
            }
        }
        catch { }
    }

    private static Icon MakeIcon()
    {
        using (var bmp = new Bitmap(32, 32))
        {
            using (var g = Graphics.FromImage(bmp))
            {
                g.Clear(Color.Transparent);
                using (var bg = new SolidBrush(Color.FromArgb(30, 144, 255)))
                {
                    g.FillEllipse(bg, 2, 2, 28, 28);
                }
                using (var f = new Font("Arial", 15, FontStyle.Bold, GraphicsUnit.Pixel))
                using (var fg = new SolidBrush(Color.White))
                {
                    var sf = new StringFormat();
                    sf.Alignment = StringAlignment.Center;
                    sf.LineAlignment = StringAlignment.Center;
                    g.DrawString("D", f, fg, new RectangleF(2, 2, 28, 28), sf);
                }
            }
            return Icon.FromHandle(bmp.GetHicon());
        }
    }

    protected override void ExitThreadCore()
    {
        _icon.Visible = false;
        _icon.Dispose();
        base.ExitThreadCore();
    }
}
