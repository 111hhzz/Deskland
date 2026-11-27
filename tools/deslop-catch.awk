#!/usr/bin/awk -f
# 空 catch 检查（供 .githooks/pre-commit 调用）。
# 规则：catch 子句的花括号块内，除空白与 // 理由注释外必须有点东西（日志 / return / 处理），
#      不能只是 `catch { }` 或空的多行块。
# 实现：词法状态机先跳过字符串 / 字符 / 注释，再配平花括号——否则 JSON 字面量里的 {} 会让计数失真。
# 输出：文件:行号:该行原文（便于直接定位）
{
    text = $0
    n = length(text)
    if (state == "line") state = "code"            # 行注释不跨行
    else if (state == "bodyline") state = "body"
    i = 1
    while (i <= n) {
        c = substr(text, i, 1)
        if (state == "line" || state == "bodyline") break
        if (state == "block" || state == "blockc") {
            if (c == "*" && substr(text, i + 1, 1) == "/") {
                state = (state == "block") ? "code" : "body"
                i += 2; continue
            }
            i++; continue
        }
        if (state == "str") {
            if (c == "\\") { i += 2; continue }
            if (c == "\"") state = "code"
            i++; continue
        }
        if (state == "chr") {
            if (c == "\\") { i += 2; continue }
            if (c == "'") state = "code"
            i++; continue
        }
        if (state == "vstr") {
            if (c == "\"" && substr(text, i + 1, 1) == "\"") { i += 2; continue }
            if (c == "\"") state = "code"
            i++; continue
        }
        if (state == "findblock") {                   # 已见 catch，等它的 {
            if (c == "(") { pdepth++; i++; continue }
            if (c == ")") { pdepth--; i++; continue }
            if (c == "{") {
                state = "body"; bdepth = 1; has_code = 0; has_note = 0
                catch_line = NR; catch_text = text
            }
            i++; continue
        }
        if (state == "body") {                        # catch 块内部
            if (c == "/" && substr(text, i + 1, 1) == "/") { state = "bodyline"; has_note = 1; i += 2; continue }
            if (c == "/" && substr(text, i + 1, 1) == "*") { state = "blockc"; has_note = 1; i += 2; continue }
            if (c == "@" && substr(text, i + 1, 1) == "\"") { state = "vstr"; has_code = 1; i += 2; continue }
            if (c == "\"") { state = "str"; has_code = 1; i++; continue }
            if (c == "'") { state = "chr"; has_code = 1; i++; continue }
            if (c == "{") { bdepth++; i++; continue }
            if (c == "}") {
                bdepth--
                if (bdepth == 0) {
                    # 块尾同行注释（`catch { } // 理由`）与块内注释同义，视为「有理由」豁免
                    rest = substr(text, i + 1)
                    if (rest ~ /^[ \t]*\/\//) has_note = 1
                    if (!has_code && !has_note)
                        printf "%s:%d: %s\n", FILENAME, catch_line, catch_text
                    state = "code"
                }
                i++; continue
            }
            if (c != " " && c != "\t" && c != "\r") has_code = 1
            i++; continue
        }
        # state == "code"
        if (c == "/" && substr(text, i + 1, 1) == "/") { state = "line"; i += 2; continue }
        if (c == "/" && substr(text, i + 1, 1) == "*") { state = "block"; i += 2; continue }
        if (c == "@" && substr(text, i + 1, 1) == "\"") { state = "vstr"; i += 2; continue }
        if (c == "\"") { state = "str"; i++; continue }
        if (c == "'") { state = "chr"; i++; continue }
        if (c == "c" && substr(text, i, 5) == "catch") {
            prev = (i > 1) ? substr(text, i - 1, 1) : " "
            nxt = substr(text, i + 5, 1)
            if (prev !~ /[A-Za-z0-9_]/ && nxt !~ /[A-Za-z0-9_]/) {
                state = "findblock"; pdepth = 0; i += 5; continue
            }
        }
        i++
    }
}
