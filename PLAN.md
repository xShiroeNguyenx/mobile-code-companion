# Mobile Code Companion — Kế hoạch chi tiết

> VS Code Extension cho phép **điều khiển VS Code + Claude Code từ điện thoại**: xem hội thoại của agent, chọn Yes/No khi agent xin quyền, trả lời câu hỏi trắc nghiệm, và ra lệnh mới cho agent — mà không cần ngồi trực tiếp trên máy.

**Ngày lập plan:** 2026-07-03
**Trạng thái:** ✅ **Đã triển khai Phase 0 → 4 (v0.1.0, 2026-07-03)** — build sạch, 20/20 unit test pass, smoke test end-to-end pass, đã đóng gói `mobile-code-companion-0.1.0.vsix`. Xem checkbox chi tiết ở mục 7 và ghi chú as-built ở mục 10.

---

## 1. Mục tiêu & phạm vi

### Mục tiêu chính
1. **Xem từ xa**: theo dõi realtime khung chat của Claude Code (tin nhắn, tool call, kết quả) trên điện thoại.
2. **Duyệt quyền từ xa**: khi agent xin phép chạy lệnh / sửa file (permission prompt), điện thoại nhận thông báo và bấm **Allow / Deny**.
3. **Trả lời lựa chọn**: khi agent hỏi câu hỏi trắc nghiệm (`AskUserQuestion`), chọn đáp án từ điện thoại.
4. **Ra lệnh từ xa**: gõ prompt mới cho agent từ điện thoại.
5. **Điều khiển VS Code cơ bản**: xem file đang mở, git status, chạy task, save all… (mức độ phụ, làm sau).

### Ngoài phạm vi (ít nhất là giai đoạn đầu)
- Không stream màn hình VS Code (không phải remote desktop).
- Không thay thế claude.ai/code (cloud sessions) — sản phẩm này điều khiển **session chạy trên máy local**, dùng tài nguyên/filesystem/git của máy đó.
- Không xây app native iOS/Android ở giai đoạn đầu (dùng web app / PWA).

---

## 2. Ràng buộc kỹ thuật quan trọng (đã xác minh từ docs chính thức)

Đây là các fact quyết định kiến trúc, đã verify từ docs `code.claude.com` (07/2026):

| # | Fact | Hệ quả với thiết kế |
|---|------|---------------------|
| 1 | Extension Claude Code chính thức **KHÔNG có public API** cho extension khác đọc/điều khiển khung chat | Không thể "gắn" trực tiếp vào panel chat chính thức. Phải đi đường vòng (xem mục 3) |
| 2 | **Agent SDK** (`@anthropic-ai/claude-agent-sdk`) cho phép tự host một session Claude Code đầy đủ: `query()` với streaming input, `interrupt()`, `setPermissionMode()`, resume session | Extension của ta có thể **tự chạy session riêng** với toàn quyền điều khiển |
| 3 | Callback **`canUseTool`** của SDK được gọi mỗi khi cần hỏi quyền; trả về `{behavior: "allow"}` hoặc `{behavior: "deny", message}` | Đây chính là điểm móc để **chuyển câu hỏi Yes/No sang điện thoại** |
| 4 | Tool **`AskUserQuestion`** cũng intercept được qua `canUseTool` | Câu hỏi trắc nghiệm cũng forward sang điện thoại được |
| 5 | Hook **`PermissionRequest`** tồn tại: fire khi hiện dialog xin quyền, hook **có thể trả về quyết định** `allow/deny` (kèm `updatedInput`); hook hỗ trợ `type: "command"` và `type: "http"` (POST), timeout tới 600s | Có thể **duyệt quyền từ xa cho cả session đang chạy trong panel chính thức / terminal CLI** — không cần session của ta host |
| 6 | Các hook khác hữu ích: `Notification`, `Stop`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `SessionStart/End` | Đẩy notification sang điện thoại khi agent xong việc / cần chú ý |
| 7 | Transcript session lưu tại `~/.claude/projects/<encoded-path>/<session-id>.jsonl` (append-only JSONL) | Có thể **tail file này** để mirror nội dung chat của session chính thức lên điện thoại |
| 8 | SDK resume được session bằng `resume: "<session-id>"`, kể cả session do CLI/extension chính thức tạo; có `listSessions()`, `getSessionMessages()` | Cho phép **handoff**: đang làm trên desktop → cầm điện thoại resume tiếp |
| 9 | Extension chính thức có URI handler `vscode://anthropic.claude-code/open?prompt=...&session=...` | Từ điện thoại có thể mở panel chính thức kèm prompt điền sẵn (mức độ auto-submit chưa chắc chắn — cần test) |
| 10 | `permissionMode`: `default`, `acceptEdits`, `plan`, `bypassPermissions`, `dontAsk`, `auto`; đổi được lúc runtime qua `setPermissionMode()` | Điện thoại có nút chuyển mode nhanh (VD: "auto-accept edits") |

> ⚠️ Điểm chưa chắc chắn cần verify lại khi code: shape chính xác của input/output hook `PermissionRequest`; hành vi auto-submit của URI handler; env `CLAUDE_AFK_TIMEOUT_MS` cho AskUserQuestion (mặc định dialog tự đóng sau 60s — phải tính đến khi user cầm điện thoại trả lời chậm).

---

## 3. Hai chế độ hoạt động (kiến trúc lõi)

Vì không điều khiển trực tiếp được panel chính thức, hệ thống có **2 mode bổ trợ nhau**:

### Mode A — Hosted Session (điều khiển toàn phần) → **làm trước, MVP**
Extension của ta tự host session Claude Code bằng **Agent SDK**. Chat hiển thị đồng thời ở:
- Webview panel trong VS Code (cho người ngồi máy), và
- Web app trên điện thoại.

Toàn quyền: gửi prompt, xem stream, allow/deny, trả lời câu hỏi, interrupt, đổi permission mode, resume session cũ.

**Đánh đổi**: chat nằm trong panel của ta, không phải panel Claude Code chính thức. Nhưng vì cùng engine (SDK = Claude Code engine), cùng transcript format, session vẫn resume qua lại được với CLI.

### Mode B — Companion / Hook Bridge (bám vào session chính thức) → **Phase 2**
Với session user đang chạy trong **panel chính thức hoặc terminal CLI**:
- Hook `PermissionRequest` (type `http`, POST về server local của extension) → extension đẩy sang điện thoại → user bấm Allow/Deny → hook trả quyết định về Claude Code. **Duyệt quyền từ xa hoạt động với chính panel chính thức.**
- Hook `Notification` / `Stop` → push thông báo "agent xong việc / đang chờ" sang điện thoại.
- Tail transcript `.jsonl` → mirror nội dung chat (read-only) lên điện thoại.
- **Giới hạn**: không gõ prompt mới vào session interactive đang mở từ bên ngoài. Workaround: (a) URI handler mở panel với prompt điền sẵn, hoặc (b) khi session idle → resume bằng SDK ở Mode A.

```
┌─────────────── Máy dev (Windows) ────────────────────────────────┐
│                                                                  │
│  VS Code                                                         │
│  ┌────────────────────────────────────────────────┐              │
│  │  Mobile Code Companion Extension               │              │
│  │                                                │              │
│  │  ┌──────────────┐   ┌───────────────────────┐  │              │
│  │  │ Session Mgr  │   │ Local Server          │  │              │
│  │  │ (Agent SDK)  │◄─►│  - HTTP (serve PWA,   │  │              │
│  │  │  Mode A      │   │    hook endpoint)     │  │   LAN / Wi-Fi│
│  │  └──────────────┘   │  - WebSocket (realtime)│◄─┼──────────┐  │
│  │  ┌──────────────┐   │  - Auth (pair token)  │  │          │  │
│  │  │ Hook Bridge  │◄─►└───────────────────────┘  │          │  │
│  │  │ + JSONL tail │                               │          │  │
│  │  │  Mode B      │   ┌───────────────────────┐  │          │  │
│  │  └──────▲───────┘   │ Webview Panel (desktop│  │          │  │
│  │         │           │ mirror + QR pairing)  │  │          │  │
│  └─────────┼───────────┴───────────────────────┴──┘          │  │
│            │ hooks (http POST) + transcript files            │  │
│  ┌─────────┴─────────────┐                                   │  │
│  │ Claude Code chính thức│                                   │  │
│  │ (panel / terminal CLI)│                                   │  │
│  └───────────────────────┘                                   │  │
└──────────────────────────────────────────────────────────────┼──┘
                                                               │
                                              ┌────────────────▼───┐
                                              │ Điện thoại         │
                                              │ Web app (PWA)      │
                                              │ - Chat view        │
                                              │ - Allow/Deny cards │
                                              │ - Prompt input     │
                                              │ - Session list     │
                                              └────────────────────┘
```

---

## 4. Thành phần chi tiết

### 4.1. VS Code Extension (host)

| Module | Trách nhiệm |
|--------|-------------|
| `server/` | HTTP server (serve web app tĩnh cho điện thoại, endpoint nhận hook POST) + WebSocket server (realtime 2 chiều). Bind `0.0.0.0`, port cấu hình được (mặc định VD `7777`) |
| `server/auth` | Pairing bằng token: extension sinh token ngẫu nhiên → hiển thị **QR code** trong webview → điện thoại quét → mọi request/WS kèm token. Token lưu trong `globalState`, có nút revoke |
| `session/` | Wrapper quanh Agent SDK: tạo/resume session, streaming input, bơm message ra bus sự kiện; implement `canUseTool` → tạo `PendingApproval`, chờ trả lời từ client (desktop hoặc phone, ai bấm trước thắng), timeout + default action |
| `hooks/` | (Phase 2) Endpoint nhận `PermissionRequest`/`Notification`/`Stop` hook; lệnh cài hook tự động vào `.claude/settings.json` của workspace (có confirm); JSONL watcher tail transcript session chính thức |
| `protocol/` | Định nghĩa message types dùng chung (TypeScript, share với web app qua package chung) |
| `panel/` | Webview trong VS Code: hiển thị QR pairing, trạng thái kết nối, và mirror chat của Mode A (để người ngồi máy vẫn thấy) |
| `vscode-bridge/` | (Phase 3) Map lệnh từ điện thoại → VS Code API: mở file, git status, run task, save all |

### 4.2. Mobile client — Web app (PWA)

- **Không cần cài app**: extension serve web app qua HTTP, điện thoại mở bằng browser (quét QR chứa URL + token).
- Stack đề xuất: **Vite + React + TypeScript**, UI mobile-first, dark mode.
- Màn hình:
  1. **Pair** — quét QR / nhập URL+token thủ công.
  2. **Sessions** — danh sách session (đang chạy / gần đây, từ `listSessions()` + transcript dir), nút "New session".
  3. **Chat** — stream hội thoại: text, tool call (tên tool + input rút gọn, expand xem chi tiết), diff preview khi Edit/Write, kết quả. Ô nhập prompt + nút gửi. Nút **Interrupt** (Esc từ xa). Selector permission mode.
  4. **Approval card** (nổi lên trên cùng + rung/notification): tên tool, input (VD lệnh bash đầy đủ, file bị sửa + diff), 2 nút to **Allow / Deny**, ô lý do khi deny; với `AskUserQuestion` render danh sách option để chọn.
  5. **Settings** — server URL, thông báo, revoke pairing.

**Lưu ý secure context**: phone truy cập `http://<LAN-IP>` là non-secure context → Service Worker/Web Push **không chạy**. MVP chấp nhận: web app thuần (vẫn Add to Home Screen được), thông báo qua WebSocket khi app đang mở. Push notification thật để Phase 3 (xem 4.4).

### 4.3. Protocol (WebSocket, JSON)

Server → Client:
```jsonc
{ "type": "session.state",       "sessionId": "...", "status": "idle|thinking|streaming|awaiting_approval|awaiting_answer" }
{ "type": "chat.message",        "sessionId": "...", "role": "assistant|user|tool", "content": [...], "uuid": "..." }
{ "type": "chat.delta",          "sessionId": "...", "text": "..." }                       // token stream
{ "type": "approval.request",    "id": "req-1", "tool": "Bash", "input": {...}, "decisionReason": "...", "expiresAt": 1234567 }
{ "type": "question.request",    "id": "req-2", "questions": [{ "question": "...", "options": [...] }] }
{ "type": "approval.resolved",   "id": "req-1", "by": "phone|desktop|timeout", "behavior": "allow|deny" }
{ "type": "notification",        "kind": "stop|permission|error", "title": "...", "body": "..." }
{ "type": "sessions.list",       "sessions": [{ "id": "...", "cwd": "...", "lastActive": "...", "source": "hosted|external" }] }
```

Client → Server:
```jsonc
{ "type": "auth",                "token": "..." }
{ "type": "prompt.send",         "sessionId": "...", "text": "..." }
{ "type": "approval.respond",    "id": "req-1", "behavior": "allow" }                       // hoặc deny + message
{ "type": "question.respond",    "id": "req-2", "answers": ["option A"] }
{ "type": "session.interrupt",   "sessionId": "..." }
{ "type": "session.setMode",     "sessionId": "...", "mode": "acceptEdits" }
{ "type": "session.new" } / { "type": "session.resume", "sessionId": "..." }
```

### 4.4. Kết nối & thông báo

| Giai đoạn | Cách kết nối | Thông báo |
|-----------|-------------|-----------|
| MVP | Cùng Wi-Fi/LAN, `http://<LAN-IP>:7777`, QR pairing | In-app (WebSocket) + Web Notification API khi tab mở |
| Phase 3a | Ngoài LAN qua **Tailscale** (khuyên dùng — có HTTPS cert, zero-config) hoặc `cloudflared` tunnel | HTTPS → PWA đầy đủ + Web Push |
| Phase 3b (tuỳ chọn) | — | Kênh push độc lập qua **ntfy.sh** (self-host được): hook `Stop`/`Notification` bắn thẳng lên ntfy → phone nhận push kể cả khi web app đóng |

### 4.5. Bảo mật

1. **Token pairing** bắt buộc cho mọi HTTP request + WS handshake; token ≥ 32 bytes random; hiển thị qua QR, không log.
2. Server chỉ bật khi user chạy lệnh `Mobile Companion: Start Server` (không auto-start); status bar hiển thị rõ đang bật.
3. Rate limit + chỉ 1–N thiết bị paired; danh sách thiết bị xem/revoke được.
4. **Approval mặc định khi timeout = Deny** (an toàn), có thể cấu hình.
5. Cảnh báo rõ trong README: bật server = bất kỳ ai có token đều điều khiển được agent có quyền sửa file/chạy lệnh trên máy → khuyến nghị chỉ dùng LAN tin cậy hoặc Tailscale.
6. Không bao giờ gửi API key / secrets qua channel; web app không lưu gì ngoài URL+token (localStorage).

---

## 5. Tech stack

| Phần | Lựa chọn | Lý do |
|------|----------|-------|
| Extension | TypeScript, `esbuild` bundle | Chuẩn VS Code |
| Agent | `@anthropic-ai/claude-agent-sdk` | Engine Claude Code chính chủ, đủ API (mục 2) |
| Server | Node `http` + `ws` (chạy trong extension host) | Nhẹ, không cần framework |
| QR | `qrcode` (render trong webview) | |
| Web app | Vite + React + TS, Tailwind CSS | Nhanh, mobile-first |
| Monorepo | npm workspaces: `extension/`, `webapp/`, `shared/` | Share protocol types |
| Test | Vitest (unit protocol/session), test tay cho E2E | |

## 6. Cấu trúc thư mục dự kiến

```
mobile-code-companion/
├── PLAN.md
├── package.json                  # npm workspaces root
├── shared/                       # protocol types dùng chung
│   └── src/protocol.ts
├── extension/
│   ├── package.json              # extension manifest (commands, activation)
│   ├── src/
│   │   ├── extension.ts          # activate/deactivate, commands, status bar
│   │   ├── server/               # http + ws + auth/pairing
│   │   ├── session/              # Agent SDK wrapper, approval queue
│   │   ├── hooks/                # (P2) hook endpoint + installer + jsonl tailer
│   │   ├── panel/                # webview (QR + mirror chat)
│   │   └── vscode-bridge/        # (P3) điều khiển VS Code
│   └── media/                    # webview assets
└── webapp/
    ├── src/
    │   ├── screens/  (Pair, Sessions, Chat, Settings)
    │   ├── components/ (ApprovalCard, QuestionCard, MessageList, ...)
    │   └── ws/       (client, reconnect, store)
    └── dist/  → extension serve thư mục này
```

---

## 7. Roadmap & task breakdown

### Phase 0 — Khung sườn ✅
- [x] Scaffold monorepo (3 package độc lập — xem ghi chú as-built về việc bỏ npm workspaces), extension build được, webapp Vite build.
- [x] `shared/protocol.ts` v1.
- [x] HTTP server serve webapp build + WebSocket, bật/tắt bằng command, status bar item.
- [x] Pairing: sinh token, webview hiện QR (URL+token), webapp màn Pair lưu localStorage, WS auth (token qua query hoặc frame `auth`).

### Phase 1 — MVP: Hosted Session, điều khiển đầy đủ từ điện thoại ✅
- [x] `session/manager.ts` + `hostedSession.ts`: tạo session qua Agent SDK (streaming input mode), map stream SDK → `chat.message`/`chat.delta`/`session.state`.
- [x] `canUseTool` → approval queue → broadcast `approval.request` → nhận `approval.respond` (desktop hoặc phone, ai bấm trước thắng) → resolve; timeout 5 phút → Deny (cấu hình được); `AskUserQuestion` → `question.request`.
- [x] Webapp màn Chat: render stream, tool call collapse/expand, diff view cho Edit/Write, ô prompt, nút Dừng (interrupt), selector permission mode.
- [x] Webapp ApprovalCard + QuestionCard (bottom sheet), rung + beep khi có request, countdown theo `expiresAt`.
- [x] Resume: liệt kê session (hosted in-memory + quét transcript dir), resume từ điện thoại.
- [x] Webview desktop mirror: QR + trạng thái + duyệt quyền/trả lời câu hỏi được từ desktop.
- [x] Reconnect WS: backoff + wake khi mở lại app; server gửi `snapshot` (sessions + pending approvals/questions + N message cuối) ngay khi auth.

**Definition of done MVP**: ✅ vòng lặp đầy đủ đã chạy được (xác minh bằng smoke test end-to-end với server thật; bước cuối cần test tay với session Claude thật trên máy có đăng nhập).

### Phase 2 — Companion mode: bám vào session Claude Code chính thức ✅
- [x] Verify shape hook `PermissionRequest` (input/output JSON) — đã xác minh từ docs chính thức + smoke test round-trip pass.
- [x] Command `Mobile Companion: Install Claude Code Hooks`: ghi hook config (`type: "http"` → `http://127.0.0.1:<port>/hook`) vào `.claude/settings.local.json` (modal confirm trước khi ghi, có lệnh Uninstall gỡ sạch, idempotent).
- [x] Endpoint `/hook` (chỉ nhận từ loopback): PermissionRequest → approval → chờ phone/desktop → trả `hookSpecificOutput.decision`. Timeout (mặc định 120s) → trả `{}` → dialog desktop xử lý.
- [x] Hook `Notification` + `Stop` → notification sang phone + ntfy.
- [x] JSONL tailer: poll transcript của session được chọn, parse incremental, mirror read-only lên phone (badge "panel/CLI").
- [x] Nút "Mở panel PC": URI handler `vscode://anthropic.claude-code/open` (mức độ auto-submit prompt cần test tay thêm).

### Phase 3 — Truy cập từ xa & trải nghiệm ✅ (một phần)
- [x] Hướng dẫn Tailscale / ntfy trong README + màn Settings. *(Chưa làm: tự động detect Tailscale, Service Worker + Web Push khi có HTTPS.)*
- [x] Push qua ntfy khi app đóng (setting `mobileCompanion.ntfyUrl`).
- [ ] Multi-workspace / nhiều cửa sổ VS Code (mỗi instance 1 port, webapp chọn máy) — để v0.2.
- [x] `vscode-bridge`: workspace info, danh sách editor, mở file, save all, git status, list/run task, mở panel Claude chính thức.
- [x] Polish: voice input (Web Speech API, vi-VN), lịch sử prompt (localStorage), dark theme.

### Phase 4 — Đóng gói ✅
- [x] README (root + extension) với cảnh báo bảo mật. *(Chưa có ảnh chụp màn hình.)*
- [x] Đóng gói `mobile-code-companion-0.1.0.vsix` (81.9 MB — Agent SDK bundle sẵn CLI). Publish Marketplace / Open VSX: chưa, chờ test tay.

**Tổng ước lượng ban đầu: ~12–19 ngày công** — thực tế code + build + test tự động hoàn thành trong 1 phiên (2026-07-03); còn lại là test tay trên thiết bị thật.

---

## 8. Rủi ro & phương án giảm thiểu

| Rủi ro | Mức | Giảm thiểu |
|--------|-----|-----------|
| Shape hook `PermissionRequest` khác docs / thay đổi theo version | Cao | Viết integration test nhỏ chạy thật với CLI trước khi code Phase 2; pin version CLI đã test |
| `AskUserQuestion` auto-đóng sau 60s trong khi user cầm phone trả lời chậm | Trung | Set `CLAUDE_AFK_TIMEOUT_MS` lớn cho session hosted; hiển thị countdown trên ApprovalCard |
| Non-secure context trên LAN → không có push khi app đóng | Trung | Chấp nhận ở MVP (giữ màn hình mở); Phase 3 Tailscale HTTPS / ntfy |
| SDK version drift (API đổi nhanh) | Trung | Pin version, wrapper mỏng quanh SDK để cô lập thay đổi |
| Hai người (desktop + phone) cùng trả lời 1 approval | Thấp | First-write-wins, broadcast `approval.resolved` để UI bên kia khoá lại |
| Bảo mật: token lộ → điều khiển được máy | Cao | Mục 4.5: opt-in server, revoke, default-deny, khuyến cáo LAN/Tailscale |
| Resume session đang mở interactive ở nơi khác gây conflict | Trung | Chỉ resume khi session idle/stopped; dùng `forkSession: true` khi nghi ngờ |

## 9. Quyết định đã chốt & câu hỏi mở

**Đã chốt (đề xuất):**
- MVP đi theo **Mode A (Hosted Session qua Agent SDK)** vì cho vòng điều khiển đầy đủ nhanh nhất; Mode B (hook bridge cho panel chính thức) làm ở Phase 2.
- Mobile client là **web app serve từ extension** (không app store, không build native).
- Kết nối MVP: **LAN + QR pairing**; remote thật để Phase 3 (ưu tiên Tailscale).

**Câu hỏi mở (đã chốt khi triển khai):**
1. ~~Nhiều session song song?~~ → Hỗ trợ nhiều hosted session trong bộ nhớ, UI điều hướng theo 1 session active; đủ cho v0.1.
2. ~~Webview desktop mirror?~~ → Bản tối giản: QR + trạng thái + duyệt quyền/trả lời câu hỏi từ desktop.
3. ~~Tên?~~ → `mobile-code-companion`, command prefix `mobileCompanion.*`, publisher tạm `nguyenkhanh`.

## 10. Ghi chú as-built (v0.1.0 — 2026-07-03)

**Sai khác so với plan (có chủ đích):**
- **Bỏ npm workspaces** → 3 package độc lập + root scripts. Lý do: `vsce package` gom production `node_modules` của extension; hoisting của workspaces phá cơ chế này. `shared/` là thư mục source thuần, import qua alias `@shared/*` (tsconfig paths cho esbuild/tsc, `resolve.alias` cho Vite/Vitest).
- **`AskUserQuestion`**: docs chính thức có shape chuẩn (`updatedInput: { questions, answers: { "<câu hỏi>": label | labels[] } }`) → dùng làm mặc định; giữ fallback `denyWithAnswer` sau setting `askUserQuestionStrategy`.
- Hooks ghi vào `.claude/settings.local.json` (không phải `settings.json`) để không dính commit.
- Tailer dùng polling 1.2s thay vì `fs.watch` (ổn định hơn trên Windows).
- Hosted session đặt `CLAUDE_AFK_TIMEOUT_MS` = approval timeout để dialog câu hỏi không tự đóng sau 60s khi trả lời từ điện thoại.
- **Fix sau đóng gói lần đầu** (cùng ngày): `lanAddresses()` sắp xếp adapter ảo (VirtualBox/Hyper-V/WSL/VMware/Docker, dải `192.168.56.x`) xuống cuối để QR mã hoá IP LAN thật mà điện thoại truy cập được; panel liệt kê mọi URL để chọn thủ công. Đã rebuild + đóng gói lại `.vsix`.
- **Icon extension** (2026-07-04): thêm `media/icon.png` 256×256 (nguồn `media/icon.svg` — điện thoại + bubble terminal + bubble Allow ✓ + sóng kết nối, nền tối, accent cam san hô) + `galleryBanner` dark; khai báo `icon` trong manifest, đã đóng gói lại `.vsix`.

**Xác minh đã chạy:**
- `tsc --noEmit` sạch (extension + webapp), Vite build + esbuild bundle OK.
- 20/20 unit test (Vitest): queues (timeout/abort/double-response), transcript parser + encodeCwd, hook installer (merge/idempotent/uninstall), protocol.
- Smoke test end-to-end (`extension/dist-smoke/smoke.cjs`): server thật + client WS "điện thoại" + giả lập CLI POST hook → health ✅, serve webapp ✅, token sai bị từ chối (4001) ✅, PermissionRequest → phone Allow → decision đúng format ✅, Notification fan-out ✅.
- Đã đóng gói `mobile-code-companion-0.1.0.vsix` (81.9 MB).

**Việc còn lại cần test tay (không tự động được):**
1. Cài `.vsix` vào VS Code thật → Start Server → quét QR từ điện thoại thật (cùng Wi-Fi) → gửi prompt → xem stream + Allow/Deny + trả lời câu hỏi.
2. Companion mode với session panel chính thức thật (Install Hooks → chạy Claude Code trong panel → duyệt quyền từ điện thoại).
3. URI handler `vscode://anthropic.claude-code/open?prompt=...` — kiểm tra prompt có auto-submit không.
4. Firewall Windows: lần đầu bật server có thể phải cho phép Node/VS Code nhận kết nối LAN.

**Ý tưởng v0.2:** multi-workspace (nhiều cửa sổ VS Code), Web Push khi có HTTPS (Tailscale cert), ảnh chụp màn hình + publish Open VSX, đổi permission mode từ panel desktop, virtualize danh sách tin nhắn dài.
