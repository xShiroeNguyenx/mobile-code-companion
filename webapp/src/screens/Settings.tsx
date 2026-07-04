import { useState } from 'react';
import type { Ctx } from '../App';
import { clearHistory, clearPairing, loadPairing } from '../store';

export default function Settings({ ctx }: { ctx: Ctx }) {
  const { state, navigate } = ctx;
  const pairing = loadPairing();
  const [showToken, setShowToken] = useState(false);

  const forget = () => {
    if (!window.confirm('Quên thiết bị này? Bạn sẽ phải quét QR lại để kết nối.')) return;
    clearPairing();
    window.location.hash = '#/pair';
    window.location.reload();
  };

  return (
    <>
      <div className="header">
        <button className="btn btn-ghost btn-icon" onClick={() => navigate('chat')}>
          ‹
        </button>
        <div className="title">Cài đặt</div>
      </div>
      <div className="content">
        <div className="card">
          <div className="section-title" style={{ margin: '0 0 8px' }}>
            Kết nối
          </div>
          <div className="muted">Server</div>
          <div className="mono">{pairing?.server ?? '—'}</div>
          <div className="muted" style={{ marginTop: 8 }}>
            Trạng thái
          </div>
          <span className={`pill ${state.conn}`}>{state.conn}</span>
          <div className="muted" style={{ marginTop: 8 }}>
            Workspace
          </div>
          <div>{state.workspaceName || '—'}</div>
          <div className="muted" style={{ marginTop: 8 }}>
            Token
          </div>
          <div className="mono" onClick={() => setShowToken(!showToken)}>
            {showToken ? pairing?.token : '••••••••••••  (chạm để hiện)'}
          </div>
        </div>

        <div className="card">
          <div className="section-title" style={{ margin: '0 0 8px' }}>
            Thiết bị
          </div>
          <div className="btn-row" style={{ flexDirection: 'column' }}>
            <button className="btn" onClick={() => clearHistory()}>
              Xoá lịch sử prompt
            </button>
            <button className="btn btn-deny" onClick={forget}>
              Quên thiết bị này
            </button>
          </div>
        </div>

        <div className="card muted" style={{ fontSize: 13, lineHeight: 1.5 }}>
          <b>Mẹo:</b>
          <br />• Đang dùng mạng LAN (http) nên push notification khi đóng app không khả dụng — giữ
          app mở, hoặc cấu hình <span className="mono">mobileCompanion.ntfyUrl</span> trong VS Code
          và cài app ntfy để nhận push.
          <br />• Muốn dùng ngoài Wi-Fi nhà: cài Tailscale trên cả 2 máy rồi kết nối qua IP
          Tailscale (có HTTPS, an toàn hơn).
          <br />• Session "panel/CLI" chỉ xem được; cài hooks (lệnh{' '}
          <span className="mono">Mobile Companion: Install Claude Code Hooks</span> trong VS Code)
          để duyệt quyền từ xa cho chúng.
        </div>
      </div>
    </>
  );
}
