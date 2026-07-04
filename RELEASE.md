# Release flow (tag-based) — note nội bộ

Publish **tự động bằng cách push git tag** `vX.Y.Z`. Không publish thủ công bằng `vsce publish` (trừ trường hợp khẩn — xem [docs/PUBLISHING.md](docs/PUBLISHING.md)).

Workflow: [.github/workflows/release.yml](.github/workflows/release.yml) — trigger khi push tag khớp `v*.*.*`.
Nó sẽ tự: typecheck + unit test → kiểm tra tag khớp `version` trong `extension/package.json` → build **4 VSIX platform-specific** (`win32-x64`, `linux-x64`, `darwin-x64`, `darwin-arm64` — vsix chứa CLI Claude Code theo nền tảng nên không có bản universal) → publish **Marketplace** (nếu có secret `VSCE_PAT`) + **Open VSX** (nếu có `OVSX_PAT`) → tạo **GitHub Release** đính kèm cả 4 `.vsix`.

> Quy ước tag: `v0.1.0`, `v0.1.1`, `v0.2.0`… (chữ `v` thường + `MAJOR.MINOR.PATCH`).
> Publisher: **`shiroenguyen`** (dùng chung với anime-companion-vscode — cùng PAT/token).

---

## Chuẩn bị trước khi release

- [ ] Bump `version` trong [extension/package.json](extension/package.json) (vd `0.1.1`).
- [ ] Thêm mục mới vào [extension/CHANGELOG.md](extension/CHANGELOG.md) (`## [X.Y.Z] — YYYY-MM-DD`).
- [ ] Cập nhật [extension/README.md](extension/README.md) nếu có tính năng/setting mới (README + CHANGELOG được đóng gói vào VSIX → sửa docs *trước* khi tag).
- [ ] `npm run typecheck && npm test` pass; `npm run build` sạch.
- [ ] (Tùy chọn) `npm run package` build thử VSIX local (bản win32-x64) và cài thử.

> ⚠️ Tag **bắt buộc** khớp version trong `extension/package.json` — lệch là workflow fail ở bước "Verify tag matches".

---

## Các lệnh release (tuần tự)

Thay `0.1.0` bằng version thật.

```bash
# 1. Kiểm tra trạng thái
git branch --show-current                                  # phải: main
git status --short
node -p "require('./extension/package.json').version"      # phải khớp tag sắp tạo

# 2. Stage CHỈ file tracked đã sửa (.vsix đã gitignore, không dính)
git add -u

# 3. Commit
git commit -m "release: v0.1.0 — <mô tả ngắn>"

# 4. Push commit lên main TRƯỚC (workflow checkout theo tag → tag phải trỏ commit đã có trên remote)
git push origin main

# 5. Tạo annotated tag
git tag -a v0.1.0 -m "v0.1.0 — <mô tả ngắn>"

# 6. Push tag → kích hoạt workflow Release
git push origin v0.1.0
```

**Thứ tự sống còn:** push commit (bước 4) **trước** push tag (bước 6).

---

## Theo dõi & kiểm tra (cần `gh` CLI đã đăng nhập)

```bash
gh run watch                                    # xem workflow chạy realtime
gh run list --workflow=release.yml --limit 3    # các run gần nhất
gh release view v0.1.0                          # GitHub Release vừa tạo (4 file .vsix đính kèm)
```

Trong log run, kiểm tra job **package** từng target có bước **"Publish to Marketplace"** / **"Publish to Open VSX"** chạy không — nếu bị *skip* nghĩa là repo chưa cấu hình secret tương ứng (xem Ghi chú).

Trang Marketplace sau khi publish: `https://marketplace.visualstudio.com/items?itemName=shiroenguyen.mobile-code-companion`

---

## Làm lại tag khi lỡ sai

```bash
git tag -d v0.1.0                       # xóa tag local
git push origin :refs/tags/v0.1.0       # xóa tag trên remote
# sửa code/docs → commit thêm → push main → tạo lại tag v0.1.0 → push tag
```

> Lưu ý: Marketplace **không cho publish đè version đã lên store** — nếu đã publish thành công rồi mới phát hiện lỗi thì phải bump version mới (vd `0.1.1`), không re-tag version cũ.

---

## Ghi chú

- **Secrets publish:** repo cần secret `VSCE_PAT` (Azure DevOps PAT, scope Marketplace → Manage) và `OVSX_PAT` (token open-vsx.org) trong Settings → Secrets and variables → Actions. **Dùng lại đúng token của anime-companion-vscode** (cùng publisher `shiroenguyen`). Thiếu secret thì workflow vẫn tạo GitHub Release + đính `.vsix`, chỉ bỏ qua bước publish store.
- **VSIX local không commit:** `*.vsix` đã gitignore; CI tự build từ source.
- **Platform-specific:** workflow cài lại deps với `npm install --os=<os> --cpu=<cpu>` cho từng target để vsix chứa đúng binary CLI (~82 MB/bản). Muốn thêm/bớt target thì sửa `strategy.matrix` trong workflow.
- **Setup lần đầu (một lần duy nhất):** tạo repo GitHub + đặt 2 secret + (nếu chưa có) namespace Open VSX — chi tiết ở [docs/PUBLISHING.md](docs/PUBLISHING.md).
