# Mobile Code Companion — monorepo

Extension VS Code cho phép **điều khiển VS Code + Claude Code từ điện thoại**: xem chat của agent, duyệt quyền (Allow/Deny), trả lời câu hỏi trắc nghiệm, ra lệnh mới — không cần ngồi trực tiếp trên máy.

> Chi tiết thiết kế: [PLAN.md](PLAN.md) · README người dùng cuối: [extension/README.md](extension/README.md) · Changelog: [extension/CHANGELOG.md](extension/CHANGELOG.md) · **Quy trình release (tag-based): [RELEASE.md](RELEASE.md)** · Setup publish một lần: [docs/PUBLISHING.md](docs/PUBLISHING.md)

## Kiến trúc

```
Điện thoại (web app React, quét QR)
      │  WebSocket + HTTP (LAN, token pairing)
      ▼
VS Code Extension ("Mobile Code Companion")
 ├── Mode A – Hosted Session: tự chạy session Claude Code qua @anthropic-ai/claude-agent-sdk
 │            (điều khiển đầy đủ: prompt, stream, canUseTool → Allow/Deny, AskUserQuestion, interrupt, resume)
 └── Mode B – Companion: bám vào session ở panel chính thức / terminal CLI
              • hook PermissionRequest (HTTP → /hook) → duyệt quyền từ xa, timeout → dialog desktop
              • hook Notification/Stop → thông báo sang điện thoại + ntfy
              • tail transcript ~/.claude/projects/<cwd>/<session>.jsonl → mirror chat (chỉ đọc)
```

## Cấu trúc repo

| Thư mục | Nội dung |
|---|---|
| `shared/` | `protocol.ts` — message types WebSocket dùng chung (không dependency) |
| `extension/` | Extension VS Code (server HTTP/WS, session manager, hook bridge, panel QR) |
| `webapp/` | Web app mobile (Vite + React), được build và serve bởi extension |
| `scripts/` | copy-webapp.js — copy build của webapp vào extension |

Không dùng npm workspaces (cố ý — để `vsce package` gom `node_modules` của extension không bị hoisting phá).

## Build & phát triển

```bash
# cài dependencies (2 package độc lập)
npm run install:all

# build tất cả: webapp → copy vào extension → bundle extension
npm run build

# typecheck + unit test
npm run typecheck
npm test

# đóng gói .vsix (ra file mobile-code-companion-<version>-win32-x64.vsix ở gốc repo)
npm run package
```

Chạy thử khi phát triển: mở thư mục `extension/` trong VS Code → F5 (Extension Development Host) → lệnh `Mobile Companion: Start Server`.

**Smoke test end-to-end** (không cần VS Code — dựng server thật, giả lập hook CLI + client điện thoại):

```bash
cd extension
node esbuild.smoke.js && node dist-smoke/smoke.cjs
```

## Cài đặt & sử dụng

1. `npm run package` → cài file `.vsix`: VS Code → Extensions → `…` → *Install from VSIX*.
2. Chạy lệnh **`Mobile Companion: Start Server`** → panel hiện QR.
3. Điện thoại (cùng Wi-Fi) quét QR → web app mở, tự ghép nối.
4. Gõ prompt từ điện thoại. Muốn duyệt quyền từ xa cho cả session ở panel Claude Code chính thức / terminal: chạy thêm **`Mobile Companion: Install Claude Code Hooks`** (ghi vào `.claude/settings.local.json` của workspace, gỡ được bằng lệnh Uninstall).

### Dùng ngoài mạng LAN

- **Tailscale (khuyên dùng):** cài trên máy tính + điện thoại → kết nối bằng IP Tailscale của máy (`http://100.x.y.z:7777`). Nhập thủ công ở màn hình Pair.
- **Push khi app đóng:** đặt setting `mobileCompanion.ntfyUrl` = `https://ntfy.sh/<topic-bi-mat>` và cài app ntfy trên điện thoại — nhận thông báo "cần duyệt quyền / agent xong" kể cả khi không mở web app.

## Lưu ý kỹ thuật quan trọng

- File `.vsix` ~82 MB vì Agent SDK bundle sẵn CLI Claude Code (`claude.exe`).
- `AskUserQuestion` được trả lời qua `canUseTool` với shape chuẩn theo docs (`updatedInput.answers` keyed theo câu hỏi); có fallback `denyWithAnswer` qua setting nếu SDK đổi hành vi.
- Hosted session đặt `CLAUDE_AFK_TIMEOUT_MS` = approval timeout để dialog không tự đóng khi bạn trả lời chậm từ điện thoại.
- Hook approval hết giờ (mặc định 120s) → server trả `{}` → hộp thoại quyền trên desktop hiện như bình thường (không chặn ai đang ngồi máy).
- QR mã hoá **địa chỉ IPv4 LAN đầu tiên** sau khi sắp xếp: adapter ảo (VirtualBox, Hyper-V/WSL, VMware, Docker, dải `192.168.56.x`…) bị xếp cuối vì điện thoại không truy cập được; panel vẫn liệt kê đầy đủ mọi URL để chọn thủ công khi cần.
- Bảo mật: xem mục Security trong [extension/README.md](extension/README.md).
