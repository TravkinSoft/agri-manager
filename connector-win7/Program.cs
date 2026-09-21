using System;
using System.Drawing;
using System.IO;
using System.IO.Ports;
using System.Reflection;
using System.Runtime.Versioning;
using System.Text;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("Travkin Connector Windows 7")]
[assembly: AssemblyCompany("TravkinFlow")]
[assembly: AssemblyVersion("1.1.0.0")]
[assembly: AssemblyFileVersion("1.1.0.0")]
[assembly: TargetFramework(".NETFramework,Version=v4.8")]

namespace Travkin.Connector.Legacy
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            bool first;
            using (var single = new Mutex(true, "Local\\TravkinFlow.Connector.Win7.Diagnostics", out first))
            {
                if (!first) { MessageBox.Show("Travkin Connector уже открыт. Найдите его окно на панели задач."); return; }
                Application.EnableVisualStyles();
                Application.SetCompatibleTextRenderingDefault(false);
                Application.Run(new CaptureForm());
            }
        }
    }

    internal sealed class CaptureForm : Form
    {
        private readonly CaptureSession session = new CaptureSession();
        private readonly ComboBox port = Drop();
        private readonly ComboBox baud = Drop();
        private readonly ComboBox bits = Drop();
        private readonly ComboBox parity = Drop();
        private readonly ComboBox stops = Drop();
        private readonly CheckBox confirmed = new CheckBox { Text = "Параметры связи сверены с прибором / штатной программой", AutoSize = true };
        private readonly Label state = new Label { Text = "Весы не подключены", AutoSize = true };
        private readonly TextBox raw = new TextBox { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Both, WordWrap = false, Dock = DockStyle.Fill };
        private readonly Button start = new Button { Text = "Подключить", AutoSize = true };
        private readonly Button stop = new Button { Text = "Отключить", AutoSize = true, Enabled = false };
        private readonly Button refresh = new Button { Text = "Обновить порты", AutoSize = true };
        private readonly System.Windows.Forms.Timer timer = new System.Windows.Forms.Timer { Interval = 500 };
        private long renderedBytes = -1;

        protected override bool ShowWithoutActivation { get { return true; } }
        protected override void Dispose(bool disposing)
        {
            if (disposing) { timer.Stop(); timer.Dispose(); session.Dispose(); }
            base.Dispose(disposing);
        }

        private static ComboBox Drop() { return new ComboBox { DropDownStyle = ComboBoxStyle.DropDownList, Width = 96 }; }
        public CaptureForm()
        {
            Text = "Travkin Connector · Windows 7 · проверка весов";
            ClientSize = new Size(780, 620);
            MinimumSize = new Size(650, 520);
            Font = new Font("Segoe UI", 10);
            StartPosition = FormStartPosition.CenterScreen;
            BackColor = Color.FromArgb(24, 26, 20);
            ForeColor = Color.FromArgb(242, 238, 218);
            var root = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(18), ColumnCount = 1, RowCount = 7 };
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 46));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 85));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 64));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 38));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 42));
            root.RowStyles.Add(new RowStyle(SizeType.Absolute, 55));
            root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
            root.Controls.Add(new Label { Text = "Travkin Connector", AutoSize = true, Font = new Font("Segoe UI", 22, FontStyle.Bold), ForeColor = Color.FromArgb(215, 189, 101) }, 0, 0);
            root.Controls.Add(new Label { Dock = DockStyle.Fill, Text = "Микросим М0601-БМ-2.1 · RS-232 · только чтение\r\nПервое подключение: записываем сигнал, не меняем талоны и настройки весов.\r\nЕсли порт занят другой программой, не останавливайте рабочее взвешивание." }, 0, 1);
            var settings = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false, AutoScroll = true };
            AddField(settings, "COM-порт", port);
            AddField(settings, "Скорость", baud);
            AddField(settings, "Биты", bits);
            AddField(settings, "Чётность", parity);
            AddField(settings, "Стоп-биты", stops);
            baud.Items.AddRange(new object[] { 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200 });
            bits.Items.AddRange(new object[] { 7, 8 }); bits.SelectedIndex = 1;
            parity.Items.AddRange(new object[] { "Нет", "Чётная", "Нечётная" }); parity.SelectedIndex = 0;
            stops.Items.AddRange(new object[] { 1, 2 }); stops.SelectedIndex = 0;
            root.Controls.Add(settings, 0, 2);
            root.Controls.Add(confirmed, 0, 3);
            var actions = new FlowLayoutPanel { Dock = DockStyle.Fill, WrapContents = false, AutoScroll = true };
            var export = new Button { Text = "Сохранить диагностику", AutoSize = true };
            foreach (var button in new[] { refresh, start, stop, export })
            {
                button.ForeColor = Color.Black; button.BackColor = Color.FromArgb(194, 200, 136);
                actions.Controls.Add(button);
            }
            refresh.Click += delegate { RefreshPorts(); };
            start.Click += delegate { StartCapture(); };
            stop.Click += delegate { StopCapture(); };
            export.Click += delegate { ExportCapture(); };
            root.Controls.Add(actions, 0, 4);
            state.Dock = DockStyle.Fill; root.Controls.Add(state, 0, 5);
            raw.Font = new Font("Consolas", 9); raw.BackColor = Color.FromArgb(15, 17, 14); raw.ForeColor = ForeColor;
            root.Controls.Add(raw, 0, 6);
            Controls.Add(root);
            timer.Tick += delegate { RenderState(); };
            timer.Start();
            RefreshPorts();
        }
        private static void AddField(FlowLayoutPanel row, string name, Control control)
        {
            var field = new FlowLayoutPanel { Width = 106, Height = 60, FlowDirection = FlowDirection.TopDown, WrapContents = false };
            field.Controls.Add(new Label { Text = name, AutoSize = true }); field.Controls.Add(control); row.Controls.Add(field);
        }
        private void RefreshPorts()
        {
            try
            {
                var selected = port.SelectedItem as string;
                port.Items.Clear();
                var names = SerialPort.GetPortNames(); Array.Sort(names, StringComparer.OrdinalIgnoreCase);
                port.Items.AddRange(names);
                if (selected != null && port.Items.Contains(selected)) port.SelectedItem = selected;
                if (names.Length == 0) state.Text = "COM-порты не найдены. Проверьте кабель и драйвер переходника.\r\nПрограмма не устанавливает драйверы и не меняет настройки Windows.";
            }
            catch (Exception ex) { state.Text = "Не удалось прочитать список портов: " + ex.Message; }
        }
        private void SetEditing(bool enabled)
        {
            foreach (Control control in new Control[] { port, baud, bits, parity, stops, confirmed, start, refresh }) control.Enabled = enabled;
            stop.Enabled = !enabled;
        }
        private void StartCapture()
        {
            if (!confirmed.Checked || port.SelectedItem == null || baud.SelectedItem == null)
            {
                MessageBox.Show(this, "Выберите COM-порт и скорость. Подтвердите параметры из настроек прибора или штатной программы. Наугад перебор не выполняется.", Text); return;
            }
            try
            {
                session.Start((string)port.SelectedItem, (int)baud.SelectedItem, (int)bits.SelectedItem,
                    parity.SelectedIndex == 1 ? Parity.Even : parity.SelectedIndex == 2 ? Parity.Odd : Parity.None,
                    stops.SelectedIndex == 0 ? StopBits.One : StopBits.Two);
                renderedBytes = -1; SetEditing(false); RenderState();
            }
            catch (Exception ex)
            {
                SetEditing(true);
                state.Text = "Подключение не выполнено. Порт может быть занят или недоступен.";
                MessageBox.Show(this, state.Text + "\r\n" + ex.Message + "\r\nРабочую программу весов не закрывайте без согласования.", Text);
            }
        }
        private void StopCapture()
        {
            try { session.Stop(); } catch (Exception ex) { MessageBox.Show(this, ex.Message, Text); }
            SetEditing(true); state.Text = "Отключено. Запись сохранена в памяти; её можно экспортировать.";
        }
        private void RenderState()
        {
            var count = session.Buffer.TotalBytes;
            if (count != renderedBytes) { raw.Text = string.Join("\r\n", session.Buffer.Snapshot()); raw.SelectionStart = raw.TextLength; raw.ScrollToCaret(); renderedBytes = count; }
            if (!stop.Enabled) return;
            var last = session.Buffer.LastAt;
            var fresh = last.HasValue && (DateTime.UtcNow - last.Value).TotalSeconds <= 3;
            state.Text = session.Error ?? (!session.Connected ? "Связь потеряна. Нажмите «Отключить» и проверьте подключение."
                : count == 0 ? "Порт открыт, но данных ещё нет. Это НЕ подтверждение исправной связи с весами."
                : !fresh ? "Сигнал не поступает более 3 секунд. Последние данные не считаются текущим весом."
                : "Данные поступают: " + count + " байт. Формат и единицы веса ещё не подтверждены.");
        }
        private void ExportCapture()
        {
            if (session.Buffer.TotalBytes == 0) { MessageBox.Show(this, "Пока нет данных с прибора. Пустой файл не создаётся.", Text); return; }
            using (var dialog = new SaveFileDialog { FileName = "Travkin-Scale-" + DateTime.Now.ToString("yyyyMMdd-HHmmss") + ".txt", Filter = "Диагностика (*.txt)|*.txt", OverwritePrompt = true })
            {
                if (dialog.ShowDialog(this) != DialogResult.OK) return;
                try { File.WriteAllText(dialog.FileName, session.ExportText(), new UTF8Encoding(true)); MessageBox.Show(this, "Файл сохранён. Передайте его для настройки чтения веса.\r\nПароли, талоны и данные TF в файл не включаются.", Text); }
                catch (Exception ex) { MessageBox.Show(this, "Не удалось сохранить файл: " + ex.Message, Text); }
            }
        }
    }
}
