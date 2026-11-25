#!/bin/sh
# deslop：屎山代码检查（TODO/FIXME、调试输出、空 catch、硬编码密钥、PowerShell BOM）。
# 由 tools/ci/run-gates.ps1 在仓库根调用；逻辑与 .githooks/pre-commit 中的原段保持一致，
# 使本地 hook 与 CI 共用同一份判定，避免两套门禁漂移。
#
# 用法：sh tools/ci/gates-deslop.sh   （需在仓库根执行）
# 退出码非 0 表示发现违规。

DESLOP_FOUND=0

# 检查 TODO/FIXME/HACK/XXX 注释（排除 bin/obj/.playwright 和 .md/.json）
echo "   检查 TODO/FIXME/HACK/XXX..."
DESLOP_HITS=$(grep -rn --include="*.cs" --include="*.html" --include="*.js" \
    --exclude-dir="bin" --exclude-dir="obj" --exclude-dir=".playwright" \
    -E "//\s*(TODO|FIXME|HACK|XXX|BUG|临时|暂时|先这样)" \
    host/ frontend/src/ test/ 2>/dev/null || true)
if [ -n "$DESLOP_HITS" ]; then
    echo "   ⚠️  发现待办注释："
    echo "$DESLOP_HITS" | head -5 | sed 's/^/      /'
    DESLOP_FOUND=1
fi

# 检查调试输出 Console.WriteLine / System.Diagnostics.Debug.WriteLine
# 排除测试项目和 Probe（它们用 Console.WriteLine 输出报告是正常的）
echo "   检查调试输出..."
DEBUG_HITS=$(grep -rn --include="*.cs" \
    --exclude-dir="bin" --exclude-dir="obj" --exclude-dir=".playwright" \
    -E "(Console\.WriteLine|System\.Diagnostics\.Debug\.WriteLine)" \
    host/ 2>/dev/null | grep -v "Log\." || true)
if [ -n "$DEBUG_HITS" ]; then
    echo "   ⚠️  发现调试输出："
    echo "$DEBUG_HITS" | head -5 | sed 's/^/      /'
    DESLOP_FOUND=1
fi

# 检查空 catch 块：catch 的 {} 内只有空白即违规（// 理由注释豁免）。
# 检测器 = tools/deslop-catch.awk（词法状态机跳过字符串/注释后配平花括号）。
# 老实现 grep -A1 "catch" | grep -B1 '^\s*}$' 只匹配多行写法，对本仓库通行的单行 `catch { }` 完全无效。
echo "   检查空 catch 块..."
if ! command -v awk >/dev/null 2>&1; then
    echo "   ⚠️  找不到 awk，无法检查空 catch"
    DESLOP_FOUND=1
else
    EMPTY_CATCH=""
    for f in host/*.cs; do
        [ -f "$f" ] || continue
        case "$f" in */bin/* | */obj/*) continue ;; esac
        EMPTY_CATCH="$EMPTY_CATCH$(awk -f tools/deslop-catch.awk "$f")"
    done
fi
if [ -n "$EMPTY_CATCH" ]; then
    echo "   ⚠️  发现空 catch 块："
    echo "$EMPTY_CATCH" | head -5 | sed 's/^/      /'
    DESLOP_FOUND=1
fi

# 检查硬编码敏感信息
echo "   检查敏感信息泄露..."
SECRET_HITS=$(grep -rn --include="*.cs" --include="*.json" --include="*.html" --include="*.js" \
    -E "(password\s*=\s*[\"'][^\"']+[\"']|secret\s*=\s*[\"'][^\"']+[\"']|token\s*=\s*[\"'][^\"']+[\"'])" \
    host/ frontend/src/ test/ 2>/dev/null | grep -v "example\|placeholder\|sample\|\.md" || true)
if [ -n "$SECRET_HITS" ]; then
    echo "   ⚠️  发现硬编码敏感信息："
    echo "$SECRET_HITS" | head -5 | sed 's/^/      /'
    DESLOP_FOUND=1
fi

# 检查 PowerShell 脚本编码：无 UTF-8 BOM 时 PowerShell 5.1 会按系统 ANSI 解析，中文导致 ParserError
echo "   检查 PowerShell 脚本编码..."
# 只检查 git 跟踪的脚本（避免扫到 bin/obj 下的构建产物）
BOM_MISSING=$(git ls-files -z -- '*.ps1' | while IFS= read -r -d '' f; do
  if [ "$(head -c 3 "$f" | od -An -tx1 | tr -d ' \n')" != "efbbbf" ]; then echo "$f"; fi
done)
if [ -n "$BOM_MISSING" ]; then
    echo "   ⚠️  缺少 UTF-8 BOM："
    echo "$BOM_MISSING" | head -5 | sed 's/^/      /'
    DESLOP_FOUND=1
fi

if [ "$DESLOP_FOUND" -eq 1 ]; then
    echo ""
    echo "❌ Deslop 失败：发现屎山代码，请清理后重试"
    exit 1
fi
echo "   ✅ Deslop 检查通过"
exit 0
