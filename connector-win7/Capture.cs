using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Ports;
using System.Linq;
using System.Text;

namespace Travkin.Connector.Legacy
{
    // Diagnostic capture only. Never interpret a number as a weight without a verified protocol.
    public sealed class CaptureBuffer
    {
        public const int Capacity = 200;
        public const int MaxChunkBytes = 1024;
        private readonly object gate = new object();
        private readonly Queue<string> chunks = new Queue<string>();
        private long totalBytes;
        private DateTime? lastAt;

        public long TotalBytes { get { lock (gate) return totalBytes; } }
        public DateTime? LastAt { get { lock (gate) return lastAt; } }
        public string[] Snapshot() { lock (gate) return chunks.ToArray(); }
        public void Clear() { lock (gate) { chunks.Clear(); totalBytes = 0; lastAt = null; } }

        public void Add(byte[] bytes, int count, DateTime at)
        {
            if (bytes == null || count < 1 || count > bytes.Length || count > MaxChunkBytes)
                throw new ArgumentOutOfRangeException("count");
            var text = new StringBuilder();
            for (var i = 0; i < count; i++)
            {
                var b = bytes[i];
                if (b >= 32 && b <= 126 && b != 92) text.Append((char)b);
                else text.Append("\\x").Append(b.ToString("X2", CultureInfo.InvariantCulture));
            }
            var entry = at.ToUniversalTime().ToString("O", CultureInfo.InvariantCulture)
                + " | HEX " + BitConverter.ToString(bytes, 0, count)
                + Environment.NewLine + "ASCII " + text;
            lock (gate)
            {
                totalBytes += count;
                lastAt = at.ToUniversalTime();
                chunks.Enqueue(entry);
                while (chunks.Count > Capacity) chunks.Dequeue();
            }
        }
    }

    public sealed class CaptureSession : IDisposable
    {
        private readonly object gate = new object();
        private SerialPort port;
        private string error;
        public readonly CaptureBuffer Buffer = new CaptureBuffer();
        public string SettingsDescription { get; private set; }
        public string Error { get { lock (gate) return error; } }
        public bool Connected { get { lock (gate) return port != null && port.IsOpen; } }

        public static void ValidateSettings(string portName, int speed, int bits, Parity parity, StopBits stop)
        {
            int portNumber;
            if (portName == null || !portName.StartsWith("COM", StringComparison.OrdinalIgnoreCase)
                || !int.TryParse(portName.Substring(3), out portNumber) || portNumber < 1)
                throw new ArgumentException("Выберите COM-порт из списка.");
            if (!new[] { 1200, 2400, 4800, 9600, 19200, 38400, 57600, 115200 }.Contains(speed))
                throw new ArgumentException("Укажите скорость связи по настройкам прибора.");
            if (bits != 7 && bits != 8) throw new ArgumentException("Допустимо 7 или 8 бит данных.");
            if (parity != Parity.None && parity != Parity.Even && parity != Parity.Odd)
                throw new ArgumentException("Недопустимая чётность.");
            if (stop != StopBits.One && stop != StopBits.Two) throw new ArgumentException("Недопустимые стоп-биты.");
        }

        public void Start(string name, int speed, int bits, Parity parity, StopBits stop)
        {
            ValidateSettings(name, speed, bits, parity, stop);
            Stop();
            Buffer.Clear();
            SettingsDescription = name + ", " + speed + ", " + bits + ", " + parity + ", " + stop;
            // No DTR/RTS handshake, polling commands, zero, tare or calibration commands.
            var next = new SerialPort(name, speed, parity, bits, stop)
            {
                Handshake = Handshake.None, DtrEnable = false, RtsEnable = false,
                ReadTimeout = 200, ReceivedBytesThreshold = 1
            };
            try
            {
                next.Open();
                lock (gate) { port = next; error = null; }
                next.DataReceived += OnData;
                next.ErrorReceived += OnError;
                ReadAvailable(next);
            }
            catch
            {
                lock (gate) { if (ReferenceEquals(port, next)) port = null; }
                next.DataReceived -= OnData;
                next.ErrorReceived -= OnError;
                next.Dispose();
                throw;
            }
        }

        private void OnData(object sender, SerialDataReceivedEventArgs args) { ReadAvailable(sender as SerialPort); }
        private void OnError(object sender, SerialErrorReceivedEventArgs args)
        {
            lock (gate) if (ReferenceEquals(sender, port)) error = "Ошибка сигнала RS-232: " + args.EventType;
        }
        private void ReadAvailable(SerialPort current)
        {
            // Bounded reads tolerate arbitrary binary/text chunk boundaries, not just CRLF lines.
            try
            {
                lock (gate)
                {
                    if (current == null || !ReferenceEquals(current, port) || !current.IsOpen) return;
                    for (var pass = 0; pass < 32 && current.BytesToRead > 0; pass++)
                    {
                        var bytes = new byte[Math.Min(current.BytesToRead, CaptureBuffer.MaxChunkBytes)];
                        var read = current.Read(bytes, 0, bytes.Length);
                        if (read > 0) Buffer.Add(bytes, read, DateTime.UtcNow);
                    }
                }
            }
            catch (TimeoutException) { /* No complete chunk yet. Do not disconnect or discard prior bytes. */ }
            catch (Exception ex)
            {
                lock (gate) if (ReferenceEquals(current, port)) error = "Потеря связи: " + ex.Message;
            }
        }

        public void Stop()
        {
            SerialPort previous;
            lock (gate) { previous = port; port = null; }
            // Close outside the lock: SerialPort.Close can wait for a pending event callback.
            if (previous != null)
            {
                previous.DataReceived -= OnData;
                previous.ErrorReceived -= OnError;
                try { previous.Close(); } finally { previous.Dispose(); }
            }
        }
        public string ExportText()
        {
            return "Travkin Connector Windows 7 — RS-232 diagnostic capture v1.1.0\r\n"
                + "Device declared from photo: METRA M0601-BM-2.1 (2016); protocol NOT verified\r\n"
                + "Settings: " + (SettingsDescription ?? "not connected") + "\r\n"
                + "No weight interpretation. No scale commands. Last " + CaptureBuffer.Capacity + " chunks only.\r\n"
                + string.Join("\r\n", Buffer.Snapshot());
        }
        public void Dispose() { Stop(); }
    }
}
