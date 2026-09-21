using System;
using System.IO.Ports;
using Travkin.Connector.Legacy;

internal static class Tests
{
    private static int checks;
    private static void Check(bool value, string name) { if (!value) throw new Exception(name); checks++; }
    public static int Main()
    {
        var buffer = new CaptureBuffer();
        Check(buffer.TotalBytes == 0 && buffer.LastAt == null, "No fake initial measurement");
        var timestamp = new DateTime(2026, 9, 21, 0, 0, 0, DateTimeKind.Utc);
        buffer.Add(new byte[] { 0, 13, 10, 92, 255, 49, 46, 48 }, 8, timestamp);
        var sample = buffer.Snapshot()[0];
        Check(sample.Contains("00-0D-0A-5C-FF-31-2E-30"), "Binary bytes preserved");
        Check(sample.Contains("\\x00\\x0D\\x0A\\x5C\\xFF1.0"), "Non printable bytes escaped");
        Check(buffer.TotalBytes == 8 && buffer.LastAt == timestamp, "Counts and UTC time");
        for (int i = 0; i < 500; i++) buffer.Add(new byte[] { 65 }, 1, timestamp);
        Check(buffer.Snapshot().Length == CaptureBuffer.Capacity, "Capture memory bounded");
        Check(buffer.TotalBytes == 508, "Total includes evicted chunks");
        var copy = buffer.Snapshot(); copy[0] = "modified";
        Check(buffer.Snapshot()[0] != "modified", "Snapshot isolation");
        bool rejected = false;
        try { buffer.Add(new byte[2048], 2048, timestamp); } catch (ArgumentOutOfRangeException) { rejected = true; }
        Check(rejected, "Oversized chunk rejected");
        buffer.Clear(); Check(buffer.TotalBytes == 0 && buffer.Snapshot().Length == 0 && buffer.LastAt == null, "New connection resets prior capture");
        CaptureSession.ValidateSettings("COM1", 9600, 8, Parity.None, StopBits.One);
        Check(true, "Valid serial settings");
        foreach (string name in new[] { "", "TCP:example.com", "COM0", "COMX", "\\\\.\\COM1" })
        {
            rejected = false;
            try { CaptureSession.ValidateSettings(name, 9600, 8, Parity.None, StopBits.One); } catch (ArgumentException) { rejected = true; }
            Check(rejected, "Invalid port rejected: " + name);
        }
        using (var session = new CaptureSession())
        {
            Check(!session.Connected, "No automatic COM open");
            session.Buffer.Add(new byte[] { 83, 84 }, 2, timestamp);
            Check(session.ExportText().Contains("protocol NOT verified"), "Export does not claim verified protocol");
            session.Stop(); Check(!session.Connected, "Stop without connection is safe");
        }
        Console.WriteLine("PASS " + checks + " checks; no COM ports opened, no business data accessed.");
        return 0;
    }
}
