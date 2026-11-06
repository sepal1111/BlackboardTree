// 教室電腦端的遙控連線：向轉送伺服器取得代碼、推送白板狀態、接收手機的指令
// 也負責學生投票：開放投票時另外取得一組投票代碼，學生只能送出投票
// 代碼只在這次開啟期間有效（SS），每次開啟黑板樹都會換新代碼；新的手機要老師按「允許」（join-request 事件）
// 白板內容、指令、提示訊息都加密（remote-crypto.js），金鑰放在 QR Code 網址裡，遙控伺服器看不到內容
import { SS } from './store.js';
import { newKey, seal, open, wrapKey, KEY_RE } from './remote-crypto.js';

export class RemoteHost extends EventTarget {
  // base：轉送伺服器網址，例如 http://192.168.1.5:8080
  // publicBase：給手機的網址（內建伺服器時，電腦自己連 127.0.0.1，手機要用校內 IP）
  constructor(base, { getState, onCmd, onVote, publicBase }) {
    super();
    this.base = base.replace(/\/+$/, '');
    this.publicBase = (publicBase || base).replace(/\/+$/, '');
    this.getState = getState;
    this.onCmd = onCmd;
    this.onVote = onVote;
    this.poll = null;      // 開放學生投票中的題目 { id, question, options }；null 代表沒有開放
    this.voteCode = '';
    this.voters = 0;       // 連線中的學生數
    this.ws = null;
    this.code = '';
    this.key = '';         // 這組代碼的加密金鑰（換代碼就換金鑰）
    this.joinPk = new Map(); // 等待允許的手機 id → 手機的公鑰（手動輸入代碼、沒有金鑰的手機）
    this.remotes = 0;
    this.status = 'off'; // off | connecting | online | error
    this.started = false;
    this.pushTimer = null;
    this.retry = 0;
  }

  get url() { return `${this.publicBase}/remote.html#${this.code}.${this.key}`; }
  get voteUrl() { return `${this.publicBase}/vote.html#${this.voteCode}`; }

  setStatus(s) { this.status = s; this.dispatchEvent(new Event('change')); }

  start() {
    if (this.started) return;
    this.started = true;
    this.connect();
  }

  connect() {
    if (!this.started) return;
    this.setStatus('connecting');
    let ws;
    try {
      ws = new WebSocket(this.base.replace(/^http/, 'ws') + '/ws/screen');
    } catch {
      this.setStatus('error');
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      const saved = SS.get('ms:remote', {});
      ws.send(JSON.stringify({ type: 'hello', code: saved.code, secret: saved.secret }));
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'room') {
        const saved = SS.get('ms:remote', {});
        if (m.code !== this.code || !this.key) this.key = saved.code === m.code && KEY_RE.test(saved.key || '') ? saved.key : newKey();
        this.code = m.code;
        this.remotes = m.remotes || 0;
        this.retry = 0;
        this.joinPk.clear();
        SS.set('ms:remote', { code: m.code, secret: m.secret, key: this.key });
        this.setStatus('online');
        this.push(true);
        if (this.poll) this.sendPoll(); // 重新連線後恢復投票，沿用原本的投票代碼
      } else if (m.type === 'remotes') {
        this.remotes = m.count;
        if (m.joined) this.dispatchEvent(new Event('joined'));
        this.dispatchEvent(new Event('change'));
        this.push(true);
      } else if (m.type === 'join-request') {
        // 新的手機要求遙控：由畫面詢問老師，再呼叫 answerJoin()
        if (KEY_RE.test(m.pk || '')) this.joinPk.set(String(m.id), m.pk);
        this.dispatchEvent(new CustomEvent('join-request', { detail: { id: String(m.id), device: String(m.device || ''), ip: String(m.ip || '') } }));
      } else if (m.type === 'join-gone') {
        this.joinPk.delete(String(m.id));
        this.dispatchEvent(new CustomEvent('join-gone', { detail: { id: String(m.id) } }));
      } else if (m.type === 'cmd') {
        // 只接受用這組金鑰加密的指令（沒加密、金鑰不對都不理會）
        const c = open(m.box, this.key);
        if (!c || typeof c !== 'object') return;
        const cmd = { type: 'cmd', target: c.target, action: c.action, widgetId: c.widgetId, args: c.args && typeof c.args === 'object' ? c.args : {} };
        Promise.resolve(this.onCmd(cmd)).catch((err) => this.notice('執行失敗：' + err.message)).finally(() => this.push());
      } else if (m.type === 'vote-room') {
        if (!this.poll && m.code) { this.send({ type: 'vote-close' }); return; } // 已經關閉了
        this.voteCode = m.code || '';
        this.voters = m.voters || 0;
        if (this.voteCode) SS.set('ms:voteCode', this.voteCode);
        this.dispatchEvent(new Event('vote'));
      } else if (m.type === 'voters') {
        this.voters = m.count || 0;
        this.dispatchEvent(new Event('vote'));
      } else if (m.type === 'vote') {
        let res;
        try { res = this.onVote?.(m) || { ok: false, text: '目前沒有開放投票' }; } catch (err) { res = { ok: false, text: '投票失敗：' + err.message }; }
        this.send({ type: 'vote-ack', to: m.from, ...res });
      } else if (m.type === 'replaced') {
        this.started = false; // 同一組代碼在別的視窗開啟了
        this.setStatus('off');
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      if (!this.started) return;
      this.setStatus('error');
      this.retry = Math.min(this.retry + 1, 6);
      setTimeout(() => this.connect(), 1000 * this.retry);
    };
  }

  send(msg) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(msg)); }

  // 白板有變化時呼叫；短時間內多次變化只送一次
  push(now = false) {
    if (this.status !== 'online') return;
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => this.send({ type: 'state', state: seal(this.getState(), this.key) }), now ? 0 : 120);
  }

  notice(text) { if (this.key) this.send({ type: 'notice', box: seal({ text: String(text) }, this.key) }); }

  // 開放學生投票，或更新題目（poll：{ id, question, options: [文字] }）
  openPoll(poll) {
    this.poll = poll;
    this.sendPoll();
    this.dispatchEvent(new Event('vote'));
  }

  sendPoll() {
    // 沿用上次的投票代碼，學生的頁面斷線後可以自動連回
    this.send({ type: 'vote-open', code: this.voteCode || SS.get('ms:voteCode', ''), poll: this.poll });
  }

  closePoll() {
    if (!this.poll) return;
    this.poll = null;
    this.voteCode = '';
    this.voters = 0;
    this.send({ type: 'vote-close' });
    this.dispatchEvent(new Event('vote'));
  }

  // 回答新手機的連線要求
  // 手動輸入代碼的手機：允許時把金鑰用手機的公鑰加密後交給它
  answerJoin(id, ok) {
    const pk = this.joinPk.get(String(id));
    this.joinPk.delete(String(id));
    const msg = { type: 'join-answer', id, ok: !!ok };
    if (ok && pk) msg.box = wrapKey(this.key, pk);
    this.send(msg);
  }

  // 中斷所有遙控裝置並更換代碼
  kick() { this.send({ type: 'kick' }); }

  stop() {
    this.started = false;
    const ws = this.ws;
    this.ws = null;
    ws?.close();
    this.remotes = 0;
    this.setStatus('off');
  }
}
