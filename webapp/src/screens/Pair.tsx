import { useEffect, useState } from 'react';
import type { Ctx } from '../App';
import { requestNotifyPermission } from '../notify';
import { savePairing } from '../store';

export default function Pair({ ctx, params }: { ctx: Ctx; params: URLSearchParams }) {
  const urlToken = params.get('token') ?? '';
  const [server, setServer] = useState(
    window.location.origin.startsWith('http') ? window.location.origin : '',
  );
  const [token, setToken] = useState(urlToken);

  const connect = (srv: string, tok: string) => {
    if (!srv.trim() || !tok.trim()) return;
    savePairing({ server: srv.trim().replace(/\/$/, ''), token: tok.trim() });
    requestNotifyPermission();
    ctx.reconnect();
    ctx.navigate('chat');
  };

  // QR flow: token arrives in the URL → pair with zero taps.
  useEffect(() => {
    if (urlToken) connect(server, urlToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="content">
      <div className="pair-wrap">
        <div className="pair-logo">📱↔💻</div>
        <h1>Mobile Code Companion</h1>
        <p className="muted" style={{ textAlign: 'center' }}>
          Điều khiển Claude Code trong VS Code từ điện thoại. Quét QR trong panel
          "Mobile Companion" trên VS Code, hoặc nhập thủ công bên dưới.
        </p>
        <div className="field">
          <label>Địa chỉ server (máy chạy VS Code)</label>
          <input
            className="input"
            value={server}
            onChange={(e) => setServer(e.target.value)}
            placeholder="http://192.168.1.10:7777"
            autoCapitalize="off"
            autoCorrect="off"
          />
        </div>
        <div className="field">
          <label>Token ghép nối</label>
          <input
            className="input"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="dán token từ VS Code"
            autoCapitalize="off"
            autoCorrect="off"
          />
        </div>
        <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => connect(server, token)}>
          Kết nối
        </button>
        {ctx.state.conn === 'unauthorized' && (
          <p className="muted" style={{ color: 'var(--red)', textAlign: 'center' }}>
            Token không đúng hoặc đã bị đổi — copy link pairing mới từ VS Code.
          </p>
        )}
      </div>
    </div>
  );
}
