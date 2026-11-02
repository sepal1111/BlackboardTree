// MyScreen 內建遙控伺服器：老師電腦開啟 MyScreen 時一起啟動，手機直接連到這台電腦
// 協定與 server/relay.py 相同：教室電腦連 /ws/screen，手機連 /ws/remote?code=xxxxxx，伺服器只轉送訊息
// 學生投票：教室電腦送 vote-open 取得另一組投票代碼，學生連 /ws/vote?code=xxxxxx，只能送出投票
// 也提供手機遙控網頁與學生投票網頁（remote.html、vote.html 等檔案編譯時嵌入）
// 用 Windows 內建的 .NET Framework 編譯（desktop\build.ps1），不需要另外安裝任何東西
//
// 參數：--port 52480（被占用時自動往後找）  --parent <MyScreen 的 PID，主程式結束時自動關閉>
// 啟動後在標準輸出印出：LISTEN <port> <ip1,ip2,...>；之後網路變動時印出：IPS <ip1,ip2,...>
using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Reflection;
using System.Security.Cryptography;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

[assembly: AssemblyTitle("MyScreen 手機遙控伺服器")]
[assembly: AssemblyProduct("MyScreen 教室白板")]
[assembly: AssemblyVersion("1.0.0.0")]

namespace MyScreen
{
    class WsConn
    {
        public TcpClient Client;
        public Stream Stream;
        public string Ip;
        readonly object sendLock = new object();
        public volatile bool Closed;

        public void SendText(string text)
        {
            if (Closed) return;
            byte[] data = Encoding.UTF8.GetBytes(text);
            byte[] head;
            if (data.Length < 126) head = new byte[] { 0x81, (byte)data.Length };
            else if (data.Length < 65536) head = new byte[] { 0x81, 126, (byte)(data.Length >> 8), (byte)data.Length };
            else
            {
                head = new byte[10];
                head[0] = 0x81; head[1] = 127;
                long len = data.Length;
                for (int i = 0; i < 8; i++) head[9 - i] = (byte)(len >> (8 * i));
            }
            try
            {
                lock (sendLock) { Stream.Write(head, 0, head.Length); Stream.Write(data, 0, data.Length); Stream.Flush(); }
            }
            catch { Close(); }
        }

        public void SendControl(byte opcode, byte[] payload)
        {
            if (Closed) return;
            payload = payload ?? new byte[0];
            try
            {
                lock (sendLock)
                {
                    Stream.Write(new byte[] { (byte)(0x80 | opcode), (byte)payload.Length }, 0, 2);
                    if (payload.Length > 0) Stream.Write(payload, 0, payload.Length);
                    Stream.Flush();
                }
            }
            catch { Close(); }
        }

        public void Close()
        {
            if (Closed) return;
            Closed = true;
            try { lock (sendLock) { Stream.Write(new byte[] { 0x88, 0 }, 0, 2); } } catch { }
            try { Client.Close(); } catch { }
        }

        static void ReadExact(Stream s, byte[] buf, int len)
        {
            int got = 0;
            while (got < len)
            {
                int n = s.Read(buf, got, len - got);
                if (n <= 0) throw new IOException("closed");
                got += n;
            }
        }

        // 讀一則文字訊息（處理分段、ping/pong）；連線結束回傳 null
        public string ReadMessage(int maxBytes)
        {
            var msg = new MemoryStream();
            var h = new byte[2];
            while (true)
            {
                ReadExact(Stream, h, 2);
                bool fin = (h[0] & 0x80) != 0;
                int op = h[0] & 0x0F;
                bool masked = (h[1] & 0x80) != 0;
                long len = h[1] & 0x7F;
                if (len == 126) { var b = new byte[2]; ReadExact(Stream, b, 2); len = (b[0] << 8) | b[1]; }
                else if (len == 127) { var b = new byte[8]; ReadExact(Stream, b, 8); len = 0; for (int i = 0; i < 8; i++) len = (len << 8) | b[i]; }
                if (len > maxBytes || msg.Length + len > maxBytes) throw new IOException("too large");
                var mask = new byte[4];
                if (masked) ReadExact(Stream, mask, 4);
                var payload = new byte[len];
                ReadExact(Stream, payload, (int)len);
                if (masked) for (int i = 0; i < payload.Length; i++) payload[i] ^= mask[i % 4];
                if (op == 0x8) return null;                         // close
                if (op == 0x9) { SendControl(0xA, payload); continue; } // ping → pong
                if (op == 0xA) continue;                            // pong
                msg.Write(payload, 0, payload.Length);
                if (fin) return Encoding.UTF8.GetString(msg.ToArray());
            }
        }
    }

    class Room
    {
        public string Code;
        public string Secret;
        public WsConn Screen;
        public HashSet<WsConn> Remotes = new HashSet<WsConn>();
        public object State;
        public DateTime? GoneAt;
        public string VoteCode;   // 學生投票代碼（沒有開放投票時為 null）
        public object Poll;
        public Dictionary<string, WsConn> Voters = new Dictionary<string, WsConn>();
        public int NextVoter;
    }

    static class Program
    {
        const int ROOM_KEEP_SEC = 600;
        const int MAX_REMOTES = 8;
        const int MAX_VOTERS = 200;
        const int MAX_MSG = 256 * 1024;
        static readonly object gate = new object();
        static readonly Dictionary<string, Room> rooms = new Dictionary<string, Room>();
        static readonly Dictionary<string, Room> voteRooms = new Dictionary<string, Room>();
        static readonly Dictionary<string, List<DateTime>> joinFail = new Dictionary<string, List<DateTime>>();
        static readonly RandomNumberGenerator rng = RandomNumberGenerator.Create();
        static readonly JavaScriptSerializer json = new JavaScriptSerializer { MaxJsonLength = MAX_MSG * 4 };
        static readonly Dictionary<string, byte[]> files = new Dictionary<string, byte[]>();

        static int Main(string[] args)
        {
            int port = 52480, parent = 0;
            for (int i = 0; i < args.Length - 1; i++)
            {
                if (args[i] == "--port") int.TryParse(args[i + 1], out port);
                if (args[i] == "--parent") int.TryParse(args[i + 1], out parent);
            }
            LoadFiles();
            TcpListener listener = null;
            for (int p = port; p < port + 20; p++)
            {
                try { listener = new TcpListener(IPAddress.Any, p); listener.Start(); port = p; break; }
                catch { listener = null; }
            }
            if (listener == null) { Console.WriteLine("ERROR 找不到可用的連接埠"); return 1; }
            var ips = string.Join(",", LanAddresses());
            Console.WriteLine("LISTEN " + port + " " + ips);
            Console.Out.Flush();

            // 網路變動（換 Wi-Fi、插拔網路線）時重新偵測 IP，印出 IPS <ip1,ip2,...> 讓 MyScreen 更新 QR Code
            new Thread(() =>
            {
                while (true)
                {
                    Thread.Sleep(5000);
                    string now;
                    try { now = string.Join(",", LanAddresses()); } catch { continue; }
                    if (now == ips) continue;
                    ips = now;
                    try { Console.WriteLine("IPS " + now); Console.Out.Flush(); } catch { }
                }
            }) { IsBackground = true }.Start();

            // MyScreen 結束時一起結束
            if (parent > 0)
            {
                new Thread(() =>
                {
                    while (true)
                    {
                        Thread.Sleep(3000);
                        try { if (System.Diagnostics.Process.GetProcessById(parent).HasExited) Environment.Exit(0); }
                        catch { Environment.Exit(0); }
                    }
                }) { IsBackground = true }.Start();
            }

            while (true)
            {
                TcpClient c;
                try { c = listener.AcceptTcpClient(); } catch { continue; }
                new Thread(() => Handle(c)) { IsBackground = true }.Start();
            }
        }

        // 這台電腦在校內網路的 IP（手機用這個連線），有預設閘道的網路卡排前面
        static List<string> LanAddresses()
        {
            var list = new List<KeyValuePair<int, string>>();
            foreach (var ni in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (ni.OperationalStatus != OperationalStatus.Up || ni.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
                var name = (ni.Name + " " + ni.Description).ToLowerInvariant();
                if (name.Contains("virtual") || name.Contains("vmware") || name.Contains("hyper-v") || name.Contains("vethernet") || name.Contains("wsl") || name.Contains("loopback") || name.Contains("bluetooth")) continue;
                var props = ni.GetIPProperties();
                bool gw = props.GatewayAddresses.Any(g => g.Address.AddressFamily == AddressFamily.InterNetwork && !g.Address.Equals(IPAddress.Any));
                foreach (var a in props.UnicastAddresses)
                {
                    if (a.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                    var s = a.Address.ToString();
                    if (s.StartsWith("169.254.") || s.StartsWith("127.")) continue;
                    list.Add(new KeyValuePair<int, string>(gw ? 0 : 1, s));
                }
            }
            return list.OrderBy(k => k.Key).Select(k => k.Value).Distinct().ToList();
        }

        static void LoadFiles()
        {
            var asm = Assembly.GetExecutingAssembly();
            foreach (var name in asm.GetManifestResourceNames())
            {
                using (var s = asm.GetManifestResourceStream(name))
                using (var m = new MemoryStream()) { s.CopyTo(m); files["/" + name] = m.ToArray(); }
            }
        }

        static string Mime(string path)
        {
            switch (Path.GetExtension(path).ToLowerInvariant())
            {
                case ".html": return "text/html; charset=utf-8";
                case ".js": return "text/javascript; charset=utf-8";
                case ".css": return "text/css; charset=utf-8";
                case ".json": return "application/json; charset=utf-8";
                case ".svg": return "image/svg+xml";
                case ".png": return "image/png";
                default: return "application/octet-stream";
            }
        }

        static void Handle(TcpClient c)
        {
            c.NoDelay = true;
            var stream = c.GetStream();
            string ip = ((IPEndPoint)c.Client.RemoteEndPoint).Address.ToString();
            try
            {
                // 讀 HTTP 標頭
                var head = new StringBuilder();
                var one = new byte[1];
                int guard = 0;
                while (!head.ToString().EndsWith("\r\n\r\n"))
                {
                    if (stream.Read(one, 0, 1) <= 0 || ++guard > 16384) { c.Close(); return; }
                    head.Append((char)one[0]);
                }
                var lines = head.ToString().Split(new[] { "\r\n" }, StringSplitOptions.None);
                var first = lines[0].Split(' ');
                if (first.Length < 2) { c.Close(); return; }
                string target = first[1];
                var headers = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
                foreach (var l in lines.Skip(1))
                {
                    int i = l.IndexOf(':');
                    if (i > 0) headers[l.Substring(0, i).Trim()] = l.Substring(i + 1).Trim();
                }
                string path = target, query = "";
                int q = target.IndexOf('?');
                if (q >= 0) { path = target.Substring(0, q); query = target.Substring(q + 1); }

                string upgrade;
                if (headers.TryGetValue("Upgrade", out upgrade) && upgrade.ToLowerInvariant() == "websocket")
                {
                    string key = headers.ContainsKey("Sec-WebSocket-Key") ? headers["Sec-WebSocket-Key"] : "";
                    string accept = Convert.ToBase64String(SHA1.Create().ComputeHash(Encoding.ASCII.GetBytes(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")));
                    var resp = "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: " + accept + "\r\n\r\n";
                    var rb = Encoding.ASCII.GetBytes(resp);
                    stream.Write(rb, 0, rb.Length);
                    var ws = new WsConn { Client = c, Stream = stream, Ip = ip };
                    if (path == "/ws/screen") ScreenLoop(ws);
                    else if (path == "/ws/remote") RemoteLoop(ws, QueryValue(query, "code"));
                    else if (path == "/ws/vote") VoteLoop(ws, QueryValue(query, "code"));
                    else ws.Close();
                    return;
                }
                ServeFile(stream, path);
            }
            catch { }
            finally { try { c.Close(); } catch { } }
        }

        static string QueryValue(string query, string key)
        {
            foreach (var part in query.Split('&'))
            {
                var kv = part.Split(new[] { '=' }, 2);
                if (kv[0] == key) return kv.Length > 1 ? Uri.UnescapeDataString(kv[1]) : "";
            }
            return "";
        }

        static void ServeFile(Stream stream, string path)
        {
            if (path == "/" || path == "") path = "/remote.html";
            byte[] body;
            string status = "200 OK", type;
            if (path == "/api/ping") { body = Encoding.UTF8.GetBytes("{\"ok\":true,\"relay\":\"local\"}"); type = Mime(".json"); }
            else if (files.TryGetValue(path, out body)) type = Mime(path);
            else { status = "404 Not Found"; body = Encoding.UTF8.GetBytes("Not found"); type = "text/plain; charset=utf-8"; }
            var head = "HTTP/1.1 " + status + "\r\nContent-Type: " + type + "\r\nContent-Length: " + body.Length +
                       "\r\nCache-Control: no-cache\r\nAccess-Control-Allow-Origin: *\r\nConnection: close\r\n\r\n";
            var hb = Encoding.ASCII.GetBytes(head);
            stream.Write(hb, 0, hb.Length);
            stream.Write(body, 0, body.Length);
            stream.Flush();
        }

        // ---------------------------------------------------------------- 轉送
        static string NewCode()
        {
            var b = new byte[4];
            while (true)
            {
                rng.GetBytes(b);
                var code = (BitConverter.ToUInt32(b, 0) % 1000000).ToString("D6");
                if (!rooms.ContainsKey(code) && !voteRooms.ContainsKey(code)) return code;
            }
        }

        static string NewSecret()
        {
            var b = new byte[24];
            rng.GetBytes(b);
            return Convert.ToBase64String(b).Replace('+', '-').Replace('/', '_').TrimEnd('=');
        }

        static void Send(WsConn ws, object msg) { if (ws != null) ws.SendText(json.Serialize(msg)); }

        static void Broadcast(Room room, object msg)
        {
            WsConn[] list;
            lock (gate) list = room.Remotes.ToArray();
            var text = json.Serialize(msg);
            foreach (var r in list) r.SendText(text);
        }

        static void BroadcastVoters(Room room, object msg)
        {
            WsConn[] list;
            lock (gate) list = room.Voters.Values.ToArray();
            var text = json.Serialize(msg);
            foreach (var v in list) v.SendText(text);
        }

        static bool IsCode(string v) { return v.Length == 6 && v.All(char.IsDigit); }

        // 結束學生投票：通知並中斷所有學生，投票代碼失效
        static void CloseVote(Room room)
        {
            WsConn[] list;
            lock (gate)
            {
                list = room.Voters.Values.ToArray();
                room.Voters.Clear();
                if (room.VoteCode != null) voteRooms.Remove(room.VoteCode);
                room.VoteCode = null;
                room.Poll = null;
            }
            foreach (var v in list) { Send(v, new { type = "closed" }); v.Close(); }
        }

        static Dictionary<string, object> Receive(WsConn ws)
        {
            var text = ws.ReadMessage(MAX_MSG);
            if (text == null) throw new IOException("closed");
            try { return json.DeserializeObject(text) as Dictionary<string, object>; } catch { return null; }
        }

        static string Str(Dictionary<string, object> m, string k)
        {
            object v;
            return m != null && m.TryGetValue(k, out v) && v != null ? v.ToString() : "";
        }

        static void Cleanup()
        {
            var now = DateTime.UtcNow;
            foreach (var kv in rooms.ToList())
            {
                var r = kv.Value;
                if (r.Screen == null && r.GoneAt.HasValue && (now - r.GoneAt.Value).TotalSeconds > ROOM_KEEP_SEC && r.Remotes.Count == 0 && r.Voters.Count == 0)
                {
                    rooms.Remove(kv.Key);
                    if (r.VoteCode != null) voteRooms.Remove(r.VoteCode);
                }
            }
        }

        static void ScreenLoop(WsConn ws)
        {
            Room room;
            Dictionary<string, object> hello;
            try { hello = Receive(ws) ?? new Dictionary<string, object>(); } catch { ws.Close(); return; }
            WsConn old = null;
            lock (gate)
            {
                Cleanup();
                string wantCode = Str(hello, "code"), wantSecret = Str(hello, "secret");
                rooms.TryGetValue(wantCode, out room);
                if (room == null && wantCode.Length == 6 && wantCode.All(char.IsDigit) && wantSecret.Length >= 24)
                {
                    // 伺服器重新啟動過：沿用教室電腦原本的代碼，手機會自動重新連上
                    room = new Room { Code = wantCode, Secret = wantSecret };
                    rooms[room.Code] = room;
                }
                else if (room == null || room.Secret != wantSecret)
                {
                    room = new Room { Code = NewCode(), Secret = NewSecret() };
                    rooms[room.Code] = room;
                }
                else old = room.Screen;
                room.Screen = ws;
                room.GoneAt = null;
            }
            if (old != null) { Send(old, new { type = "replaced" }); old.Close(); }
            Send(ws, new { type = "room", code = room.Code, secret = room.Secret, remotes = room.Remotes.Count });
            Broadcast(room, new { type = "screen", online = true });
            BroadcastVoters(room, new { type = "screen", online = true });
            try
            {
                while (true)
                {
                    var msg = Receive(ws);
                    if (msg == null) continue;
                    var t = Str(msg, "type");
                    if (t == "state")
                    {
                        object st; msg.TryGetValue("state", out st);
                        room.State = st;
                        Broadcast(room, new { type = "state", state = st });
                    }
                    else if (t == "notice")
                    {
                        var text = Str(msg, "text");
                        Broadcast(room, new { type = "notice", text = text.Length > 200 ? text.Substring(0, 200) : text });
                    }
                    else if (t == "kick")
                    {
                        // 中斷所有遙控並換一組新代碼，舊代碼立即失效
                        WsConn[] list;
                        lock (gate)
                        {
                            list = room.Remotes.ToArray();
                            room.Remotes.Clear();
                            rooms.Remove(room.Code);
                            room.Code = NewCode();
                            room.Secret = NewSecret();
                            rooms[room.Code] = room;
                        }
                        foreach (var r in list) { Send(r, new { type = "kicked" }); r.Close(); }
                        Send(ws, new { type = "room", code = room.Code, secret = room.Secret, remotes = 0 });
                    }
                    else if (t == "vote-open")
                    {
                        // 開放學生投票（或更新題目）；可指定沿用原本的投票代碼，讓學生斷線後自動連回
                        object poll; msg.TryGetValue("poll", out poll);
                        string code; int n;
                        lock (gate)
                        {
                            if (room.VoteCode == null)
                            {
                                var want = Str(msg, "code");
                                room.VoteCode = IsCode(want) && !rooms.ContainsKey(want) && !voteRooms.ContainsKey(want) ? want : NewCode();
                                voteRooms[room.VoteCode] = room;
                            }
                            room.Poll = poll as Dictionary<string, object>;
                            code = room.VoteCode; n = room.Voters.Count;
                        }
                        Send(ws, new { type = "vote-room", code = code, voters = n });
                        BroadcastVoters(room, new { type = "poll", poll = room.Poll });
                    }
                    else if (t == "vote-close")
                    {
                        CloseVote(room);
                        Send(ws, new { type = "vote-room", code = "", voters = 0 });
                    }
                    else if (t == "vote-ack")
                    {
                        WsConn voter;
                        lock (gate) room.Voters.TryGetValue(Str(msg, "to"), out voter);
                        object ok, choice; msg.TryGetValue("ok", out ok); msg.TryGetValue("choice", out choice);
                        var text = Str(msg, "text");
                        if (voter != null) Send(voter, new { type = "ack", ok = ok is bool && (bool)ok, text = text.Length > 200 ? text.Substring(0, 200) : text, choice = choice });
                    }
                }
            }
            catch { }
            finally
            {
                bool gone = false;
                lock (gate) if (room.Screen == ws) { room.Screen = null; room.GoneAt = DateTime.UtcNow; gone = true; }
                if (gone)
                {
                    Broadcast(room, new { type = "screen", online = false });
                    BroadcastVoters(room, new { type = "screen", online = false });
                }
                ws.Close();
            }
        }

        static void RemoteLoop(WsConn ws, string code)
        {
            Room room;
            lock (gate)
            {
                List<DateTime> fails;
                if (!joinFail.TryGetValue(ws.Ip, out fails)) joinFail[ws.Ip] = fails = new List<DateTime>();
                fails.RemoveAll(t => (DateTime.UtcNow - t).TotalSeconds >= 300);
                if (fails.Count >= 20) { room = null; code = null; }
                else
                {
                    rooms.TryGetValue(code ?? "", out room);
                    if (room == null) fails.Add(DateTime.UtcNow);
                }
            }
            if (code == null) { Send(ws, new { type = "error", message = "嘗試次數過多，請 5 分鐘後再試" }); ws.Close(); return; }
            if (room == null) { Send(ws, new { type = "error", message = "代碼錯誤或已失效，請重新掃描電視上的 QR Code" }); ws.Close(); return; }
            int count;
            lock (gate)
            {
                if (room.Remotes.Count >= MAX_REMOTES) count = -1;
                else { room.Remotes.Add(ws); count = room.Remotes.Count; }
            }
            if (count < 0) { Send(ws, new { type = "error", message = "連線的裝置太多了" }); ws.Close(); return; }
            Send(ws, new { type = "hello", online = room.Screen != null, state = room.State });
            Send(room.Screen, new { type = "remotes", count = count, joined = true });
            try
            {
                while (true)
                {
                    var msg = Receive(ws);
                    if (msg == null || Str(msg, "type") != "cmd") continue;
                    if (room.Code != code) break; // 代碼已更換（被中斷）
                    var screen = room.Screen;
                    if (screen != null)
                    {
                        object target, widgetId, action, args;
                        msg.TryGetValue("target", out target);
                        msg.TryGetValue("widgetId", out widgetId);
                        msg.TryGetValue("action", out action);
                        msg.TryGetValue("args", out args);
                        Send(screen, new { type = "cmd", target = target, widgetId = widgetId, action = action, args = args as Dictionary<string, object> ?? new Dictionary<string, object>() });
                    }
                    else Send(ws, new { type = "notice", text = "教室電腦目前沒有連線" });
                }
            }
            catch { }
            finally
            {
                lock (gate) { room.Remotes.Remove(ws); count = room.Remotes.Count; }
                Send(room.Screen, new { type = "remotes", count = count });
                ws.Close();
            }
        }

        // 學生投票：只能收到題目、送出 {type: vote, name, choice}
        static void VoteLoop(WsConn ws, string code)
        {
            Room room;
            lock (gate)
            {
                List<DateTime> fails;
                if (!joinFail.TryGetValue(ws.Ip, out fails)) joinFail[ws.Ip] = fails = new List<DateTime>();
                fails.RemoveAll(t => (DateTime.UtcNow - t).TotalSeconds >= 300);
                if (fails.Count >= 20) { room = null; code = null; }
                else
                {
                    voteRooms.TryGetValue(code ?? "", out room);
                    if (room == null) fails.Add(DateTime.UtcNow);
                }
            }
            if (code == null) { Send(ws, new { type = "error", message = "嘗試次數過多，請 5 分鐘後再試" }); ws.Close(); return; }
            if (room == null) { Send(ws, new { type = "error", message = "投票代碼錯誤，或老師已經結束投票" }); ws.Close(); return; }
            string id = null;
            int count;
            lock (gate)
            {
                if (room.Voters.Count >= MAX_VOTERS) count = -1;
                else { id = (++room.NextVoter).ToString(); room.Voters[id] = ws; count = room.Voters.Count; }
            }
            if (count < 0) { Send(ws, new { type = "error", message = "連線的人數太多了" }); ws.Close(); return; }
            Send(ws, new { type = "poll", poll = room.Poll, online = room.Screen != null });
            Send(room.Screen, new { type = "voters", count = count });
            try
            {
                while (true)
                {
                    var msg = Receive(ws);
                    if (msg == null || Str(msg, "type") != "vote") continue;
                    if (room.VoteCode != code) break; // 投票已結束
                    int choice;
                    if (!int.TryParse(Str(msg, "choice"), out choice)) continue;
                    var name = Str(msg, "name").Trim();
                    if (name.Length > 20) name = name.Substring(0, 20);
                    var screen = room.Screen;
                    if (screen != null) Send(screen, new { type = "vote", from = id, name = name, choice = choice });
                    else Send(ws, new { type = "ack", ok = false, text = "教室電腦目前沒有連線，請稍後再試" });
                }
            }
            catch { }
            finally
            {
                lock (gate)
                {
                    WsConn cur;
                    if (room.Voters.TryGetValue(id, out cur) && cur == ws) room.Voters.Remove(id);
                    count = room.Voters.Count;
                }
                Send(room.Screen, new { type = "voters", count = count });
                ws.Close();
            }
        }
    }
}
