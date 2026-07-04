# Mobile Code Companion

**Điều khiển VS Code + Claude Code từ điện thoại** — xem hội thoại của agent, bấm Allow/Deny khi agent xin quyền, trả lời câu hỏi trắc nghiệm, và ra lệnh mới, mà không cần ngồi trực tiếp trên máy.

> **English:** Control your local Claude Code agent from your phone. Scan a QR code in VS Code → a mobile web app opens (same Wi-Fi, no app install): watch the agent's chat stream live, **approve/deny permission prompts remotely**, answer multiple-choice questions, send new prompts, interrupt, resume sessions. Also works alongside the official Claude Code panel/CLI via hooks (companion mode). Requires Claude Code installed and signed in on the desktop.

## Tính năng

- 📱 **Web app trên điện thoại** — không cần cài app: quét QR trong VS Code là dùng được (cùng Wi-Fi).
- 💬 **Chat realtime** với session Claude Code chạy trên máy tính (stream từng chữ, xem tool call, diff sửa file).
- ✅ **Duyệt quyền từ xa** — agent xin chạy lệnh / sửa file → điện thoại rung, bấm Allow/Deny.
- ❓ **Trả lời câu hỏi trắc nghiệm** (AskUserQuestion) từ điện thoại.
- 🔁 **Resume session** — tiếp tục session cũ (kể cả session tạo từ panel Claude Code chính thức hoặc terminal CLI).
- 🪝 **Companion mode** — session đang chạy trong panel chính thức / terminal cũng duyệt quyền từ xa được, qua Claude Code hooks (lệnh `Mobile Companion: Install Claude Code Hooks`). Hết giờ chờ → hộp thoại desktop hiện như bình thường.
- 🎙 Nhập giọng nói, lịch sử prompt, đổi permission mode, nút Dừng (interrupt), thông báo push tuỳ chọn qua [ntfy](https://ntfy.sh).

## Bắt đầu nhanh

1. Cài extension, chạy lệnh **`Mobile Companion: Start Server`** (Ctrl+Shift+P).
2. Panel hiện **QR code** → quét bằng camera điện thoại (điện thoại cùng Wi-Fi với máy tính).
3. Gõ prompt từ điện thoại → Claude Code chạy trên máy tính của bạn, mọi yêu cầu duyệt quyền hiện trên điện thoại.

> Yêu cầu: đã cài và đăng nhập [Claude Code](https://code.claude.com) trên máy tính (extension dùng Claude Agent SDK, chung đăng nhập với Claude Code).

## Bảo mật — đọc kỹ

- Server chỉ chạy khi bạn bật thủ công (hoặc bật `mobileCompanion.autoStart`).
- Mọi kết nối phải có **token ghép nối** (nằm trong QR). Đổi token bất kỳ lúc nào bằng lệnh `Regenerate Pairing Token`.
- **Ai có token = điều khiển được agent có quyền sửa file/chạy lệnh trên máy bạn.** Chỉ dùng trong mạng Wi-Fi tin cậy, hoặc qua [Tailscale](https://tailscale.com) khi ra ngoài. Đặt `mobileCompanion.bindHost = 127.0.0.1` nếu chỉ dùng tunnel.
- Yêu cầu duyệt quyền hết giờ chờ → mặc định **Deny** (cấu hình được).

## Cấu hình chính

| Setting | Mặc định | Ý nghĩa |
|---|---|---|
| `mobileCompanion.port` | `7777` | Cổng HTTP/WebSocket |
| `mobileCompanion.bindHost` | `0.0.0.0` | Interface bind server. Đặt `127.0.0.1` để tắt truy cập LAN (chỉ dùng tunnel) |
| `mobileCompanion.autoStart` | `false` | Tự bật server khi mở VS Code |
| `mobileCompanion.approvalTimeoutSeconds` | `300` | Thời gian chờ duyệt quyền (session hosted) |
| `mobileCompanion.approvalTimeoutAction` | `deny` | Hành động khi duyệt quyền hosted hết giờ (`deny`/`allow`) |
| `mobileCompanion.hookApprovalTimeoutSeconds` | `120` | Thời gian chờ duyệt từ xa trước khi trả về hộp thoại desktop (companion mode) |
| `mobileCompanion.askUserQuestionStrategy` | `updatedInput` | Cách trả câu trả lời về AskUserQuestion (`updatedInput` theo docs SDK; `denyWithAnswer` là fallback) |
| `mobileCompanion.defaultPermissionMode` | `default` | Permission mode cho session mới |
| `mobileCompanion.model` | *(trống)* | Model override cho session hosted (trống = mặc định Claude Code) |
| `mobileCompanion.historyLimit` | `200` | Số message giữ lại mỗi session cho snapshot khi reconnect |
| `mobileCompanion.ntfyUrl` | *(trống)* | URL topic ntfy để nhận push khi web app đóng |

## Giới hạn đã biết

- Kết nối LAN dùng `http://` → trình duyệt không cho Web Push/Service Worker; giữ app mở hoặc dùng ntfy/Tailscale.
- Session trong panel Claude Code chính thức là **chỉ xem + duyệt quyền** (không gõ prompt trực tiếp vào panel từ xa — hạn chế của VS Code); bấm **Resume** trên điện thoại để chuyển sang session hosted điều khiển đầy đủ.

## Khắc phục sự cố

- **Điện thoại không kết nối được / QR ra IP lạ**: máy có adapter ảo (VirtualBox, Hyper-V/WSL, VMware, Docker…) — extension đã tự xếp các adapter này xuống cuối và ưu tiên IP Wi-Fi/LAN thật cho QR; nếu vẫn sai, xem danh sách URL đầy đủ trong panel và nhập thủ công ở màn hình Pair.
- **Lần đầu bật server**: Windows Firewall có thể hỏi quyền — cho phép Node/VS Code nhận kết nối mạng riêng (Private).

## License

MIT
