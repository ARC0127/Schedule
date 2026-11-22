using System;
using System.Diagnostics;
using System.Drawing;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace ScheduleSync
{
    internal sealed class SyncWindow : Form
    {
        readonly ComboBox devices = new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Dock = DockStyle.Fill };
        readonly Label result = new Label { AutoSize = true, Dock = DockStyle.Fill };
        readonly Label cliLabel = new Label { AutoSize = true, AutoEllipsis = true, Dock = DockStyle.Fill };
        readonly Button send, refresh, locate;
        readonly bool zh = CultureInfo.CurrentUICulture.TwoLetterISOLanguageName == "zh";
        string cli;
        bool running;

        string T(string chinese, string english) { return zh ? chinese : english; }

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SyncWindow());
        }

        SyncWindow()
        {
            Text = "Schedule · " + T("蓝牙同步", "Bluetooth sync");
            Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);
            ClientSize = new Size(530, 255);
            MinimumSize = new Size(460, 280);
            BackColor = Color.FromArgb(248, 251, 248);
            ForeColor = Color.FromArgb(32, 51, 42);
            Font = new Font("Segoe UI", 10);
            AutoScaleMode = AutoScaleMode.Font;
            var layout = new TableLayoutPanel { ColumnCount = 2, RowCount = 6, Padding = new Padding(18), Dock = DockStyle.Fill };
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
            layout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
            for (int i = 0; i < 5; i++) layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
            var title = new Label { Text = T("先在系统设置配对。手机打开 Schedule 的同步页，选中本机后点击「等待电脑连接」。",
                "Pair in system settings. In Schedule on Android, select this PC and tap Wait for Windows."), AutoSize = true, MaximumSize = new Size(465, 0), Margin = new Padding(3, 4, 3, 12) };
            layout.Controls.Add(title, 0, 0); layout.SetColumnSpan(title, 2);
            layout.Controls.Add(devices, 0, 1);
            refresh = Button(T("刷新", "Refresh"));
            refresh.Click += (s, e) => RefreshDevices();
            layout.Controls.Add(refresh, 1, 1);
            cliLabel.Margin = new Padding(3, 7, 3, 3);
            layout.Controls.Add(cliLabel, 0, 2);
            locate = Button(T("选择 CLI", "Locate CLI"));
            locate.Click += (s, e) => ChooseCli();
            layout.Controls.Add(locate, 1, 2);
            send = Button(T("同步日程", "Sync events"));
            send.BackColor = Color.FromArgb(221, 239, 226);
            send.Click += async (s, e) => await Sync();
            layout.Controls.Add(send, 0, 3);
            result.MaximumSize = new Size(480, 0);
            result.Margin = new Padding(3, 8, 3, 3);
            layout.Controls.Add(result, 0, 4); layout.SetColumnSpan(result, 2);
            Controls.Add(layout);
            devices.SelectedIndexChanged += (s, e) => send.Enabled = devices.SelectedIndex >= 0 && !running;
            Shown += (s, e) => { SetCli(FindCli()); RefreshDevices(); };
        }

        static Button Button(string label)
        {
            return new Button { Text = label, AutoSize = true, Margin = new Padding(3, 4, 3, 4) };
        }

        void SetCli(string path)
        {
            cli = path;
            cliLabel.Text = path == null
                ? T("选填。接收手机改动需要 Schedule.Cli.exe。", "Locate Schedule.Cli.exe to apply Android edits.")
                : T("已找到 Schedule.Cli.exe", "Schedule.Cli.exe located");
        }

        string FindCli()
        {
            string beside = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Schedule.Cli.exe");
            if (File.Exists(beside)) return beside;
            foreach (var process in Process.GetProcessesByName("Journal"))
            {
                using (process)
                {
                    try
                    {
                        string path = Path.Combine(Path.GetDirectoryName(process.MainModule.FileName), "Schedule.Cli.exe");
                        if (File.Exists(path)) return path;
                    }
                    catch (Exception) {}
                }
            }
            return null;
        }

        void ChooseCli()
        {
            using (var dialog = new OpenFileDialog { Filter = "Schedule CLI (Schedule.Cli.exe)|Schedule.Cli.exe", CheckFileExists = true })
                if (dialog.ShowDialog(this) == DialogResult.OK) SetCli(dialog.FileName);
        }

        void RefreshDevices()
        {
            try
            {
                var previous = devices.SelectedItem as Rfcomm.Device;
                var list = Rfcomm.PairedDevices().OrderBy(device => device.Name).ToArray();
                devices.Items.Clear();
                devices.Items.AddRange(list);
                // A positive selection is required before sending any journal entries.
                if (previous != null) devices.SelectedItem = list.FirstOrDefault(device => device.Address == previous.Address);
                result.Text = list.Length == 0 ? T("没有已配对的蓝牙设备。", "No paired Bluetooth devices.") : "";
                send.Enabled = devices.SelectedIndex >= 0;
            }
            catch (Exception error) { result.Text = error.Message; }
        }

        async Task Sync()
        {
            var device = devices.SelectedItem as Rfcomm.Device;
            if (device == null || running) return;
            running = true;
            send.Enabled = refresh.Enabled = locate.Enabled = devices.Enabled = false;
            result.Text = T("正在连接并同步…", "Connecting and syncing…");
            string directory = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
            string data = Path.Combine(directory, ".schedule", "journal.json");
            string selectedCli = cli ?? FindCli();
            try
            {
                result.Text = await Task.Run(() => {
                    using (var link = Rfcomm.Open(device.Address))
                        return SyncSession.Run(link, new DesktopJournal(data, selectedCli));
                });
            }
            catch (Exception error)
            {
                result.Text = T("同步失败。请确认手机仍在等待连接。", "Sync failed. Check that the phone is waiting.") +
                    Environment.NewLine + error.GetBaseException().Message;
            }
            finally
            {
                running = false;
                send.Enabled = refresh.Enabled = locate.Enabled = devices.Enabled = true;
            }
        }

        protected override void OnFormClosing(FormClosingEventArgs e)
        {
            if (running) e.Cancel = true;
            base.OnFormClosing(e);
        }
    }
}

