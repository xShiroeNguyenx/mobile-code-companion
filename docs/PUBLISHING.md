# Publish Mobile Code Companion — setup một lần & fallback thủ công

> **Quy trình release thường ngày (tag-based, tự động qua GitHub Actions) nằm ở [RELEASE.md](../RELEASE.md)** — giống hệt anime-companion-vscode. File này chỉ gồm: setup một lần, checklist QA, và cách publish thủ công khi khẩn cấp.

Publisher: **`shiroenguyen`** — dùng chung với [anime-companion-vscode](https://github.com/xShiroeNguyenx/anime-companion-vscode), nên **không cần tạo publisher/token mới**, chỉ cần gắn secret vào repo mới.

---

## 1. Setup một lần (trước release đầu tiên)

### 1.1. Tạo GitHub repo

```bash
cd d:/NGUYENKHANH/GLOBAL_WORKSPACE/mobile-code-companion
git init
git add -A
git commit -m "feat: Mobile Code Companion v0.1.0 — control VS Code + Claude Code from your phone"
git remote add origin https://github.com/xShiroeNguyenx/mobile-code-companion.git
git branch -M main
git push -u origin main
```

(`repository`/`bugs`/`homepage` trong `extension/package.json` đã trỏ sẵn về repo này.)

### 1.2. Gắn secrets cho GitHub Actions

Vào repo → **Settings → Secrets and variables → Actions** → New repository secret, dùng lại đúng token của anime-companion-vscode:

| Secret | Lấy từ đâu |
|---|---|
| `VSCE_PAT` | Azure DevOps PAT (scope Marketplace → **Manage**, org: *All accessible organizations*) — token đang dùng cho anime-companion. Nếu hết hạn: https://dev.azure.com → Personal Access Tokens → tạo lại |
| `OVSX_PAT` | Token open-vsx.org của tài khoản đã có namespace `shiroenguyen` |

> Namespace Open VSX `shiroenguyen` đã tồn tại (anime-companion đã publish) → không cần `ovsx create-namespace` nữa.

### 1.3. Checklist QA trước release đầu tiên

- [ ] Cài `.vsix` local → `Start Server` → quét QR từ điện thoại → pairing OK, QR ra đúng IP LAN.
- [ ] Gửi prompt từ điện thoại → thấy stream, Allow ít nhất 1 lần, agent hoàn thành, có thông báo.
- [ ] `AskUserQuestion`: trả lời từ điện thoại OK (VD prompt: "Hỏi tôi muốn dùng thư viện nào trước khi làm").
- [ ] Companion mode: `Install Claude Code Hooks` → chạy Claude Code trong panel chính thức → duyệt quyền từ điện thoại OK; hết giờ → dialog desktop hiện lại.
- [ ] Interrupt, Resume session cũ, reconnect khi khoá màn hình.
- [ ] `Regenerate Pairing Token` → thiết bị cũ bị ngắt.
- [ ] (Khuyến khích) Chụp 2–3 ảnh màn hình điện thoại (Chat + ApprovalCard) → `extension/media/` → nhúng vào README bằng URL tuyệt đối `https://raw.githubusercontent.com/xShiroeNguyenx/mobile-code-companion/main/extension/media/<file>.png`.

### 1.4. Release đầu tiên

Theo [RELEASE.md](../RELEASE.md): commit → push main → tag `v0.1.0` → push tag. Workflow tự build 4 vsix platform-specific, publish 2 store, tạo GitHub Release.

---

## 2. Publish thủ công (fallback khẩn cấp)

Chỉ dùng khi CI hỏng. Chạy trên máy Windows (vsix build local là bản `win32-x64`):

```bash
cd extension
npm run package                          # → ../mobile-code-companion-<version>-win32-x64.vsix

npx vsce login shiroenguyen              # dán VSCE_PAT khi được hỏi
npm run publish:vsce                     # Marketplace

set OVSX_PAT=<token>                     # PowerShell: $env:OVSX_PAT='<token>'
npm run publish:ovsx                     # Open VSX
```

Muốn publish thủ công cho nền tảng khác (macOS/Linux):

```bash
cd extension
npm install --force --os=darwin --cpu=arm64      # đổi os/cpu theo target
npx vsce package --target darwin-arm64 -o ../mcc-darwin-arm64.vsix
npx vsce publish --packagePath ../mcc-darwin-arm64.vsix
npx ovsx publish ../mcc-darwin-arm64.vsix
npm install --force                              # cài lại cho máy mình (win32-x64)
```

---

## 3. Sự cố thường gặp

| Lỗi | Nguyên nhân / cách xử lý |
|---|---|
| `401 Unauthorized` khi publish | PAT sai scope (cần Marketplace → Manage) hoặc thiếu "All accessible organizations"; token hết hạn → tạo lại và cập nhật secret |
| `The publisher 'shiroenguyen' is not known` | Chưa `vsce login` (thủ công) hoặc PAT không thuộc tài khoản sở hữu publisher |
| Workflow fail "Verify tag matches" | Tag không khớp `version` trong `extension/package.json` — xoá tag, bump/sửa rồi tag lại (xem RELEASE.md) |
| Bước Publish bị *skip* trong CI | Repo chưa có secret `VSCE_PAT`/`OVSX_PAT` |
| `version already exists` | Marketplace không cho đè version — bump version mới rồi release lại |
| Ảnh README không hiện trên Marketplace | Phải dùng URL `raw.githubusercontent.com` tuyệt đối, không dùng đường dẫn tương đối |
| Người dùng cài xong không chạy được session | Máy họ thiếu Claude Code / chưa đăng nhập — đã ghi ở Requirements trong README |
