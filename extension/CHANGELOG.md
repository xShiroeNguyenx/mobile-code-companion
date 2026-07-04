# Changelog

Tất cả thay đổi đáng chú ý của Mobile Code Companion được ghi tại đây.
All notable changes to Mobile Code Companion are documented here.

## [0.1.0] — 2026-07-04

Phiên bản đầu tiên / Initial release. 🎉

### Tính năng / Features

- **Điều khiển Claude Code từ điện thoại** qua web app (quét QR, không cần cài app) — gửi prompt, xem chat stream realtime, xem tool call + diff sửa file.
  *Control Claude Code from your phone via a QR-paired web app — send prompts, watch the chat stream live, inspect tool calls and file diffs.*
- **Duyệt quyền từ xa (Allow/Deny)**: hosted session qua Agent SDK `canUseTool`, kèm rung + đếm ngược; mặc định Deny khi hết giờ.
  *Remote permission approval with vibration and countdown; denies by default on timeout.*
- **Trả lời câu hỏi trắc nghiệm** (`AskUserQuestion`) từ điện thoại, hỗ trợ multi-select.
- **Companion mode**: session chạy trong panel Claude Code chính thức / terminal CLI cũng duyệt quyền từ xa được (hook `PermissionRequest`), nhận thông báo khi agent xong việc (hook `Notification`/`Stop`), mirror chat chỉ đọc qua transcript; hết giờ chờ → hộp thoại desktop hiện như bình thường.
- **Resume session** (kể cả session tạo từ panel chính thức/CLI), đổi permission mode lúc chạy, nút Dừng (interrupt).
- **Panel desktop**: QR pairing, trạng thái server, duyệt quyền/trả lời câu hỏi ngay trên VS Code (ai bấm trước thắng).
- **Tiện ích**: nhập giọng nói (vi-VN), lịch sử prompt, push notification tuỳ chọn qua ntfy khi app đóng, VS Code bridge (mở file, git status, run task, save all).
- **Bảo mật**: token pairing bắt buộc (đổi/thu hồi được), server chỉ bật thủ công, hook endpoint chỉ nhận từ localhost.

### Đã biết / Known limitations

- LAN dùng `http://` → không có Web Push/Service Worker; dùng ntfy hoặc Tailscale.
- Session panel chính thức: chỉ xem + duyệt quyền (bấm Resume để điều khiển đầy đủ).
- `.vsix` hiện đóng gói cho **win32-x64** (Agent SDK bundle CLI theo nền tảng).
