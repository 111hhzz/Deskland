#!/usr/bin/env pwsh
# pre-commit hook：提交前编译 + 运行测试
# 安装：cp .githooks/pre-commit.ps1 .git/hooks/pre-commit.ps1

$ErrorActionPreference = "Stop"

# 加载 .NET SDK 路径
$env:Path = "$env:LOCALAPPDATA\Microsoft\dotnet;$env:Path"

Write-Host "=== pre-commit: 编译宿主 ===" -ForegroundColor Cyan
Set-Location host
& powershell -ExecutionPolicy Bypass -File build.ps1
Set-Location ..

Write-Host ""
Write-Host "=== pre-commit: 编译测试项目 ===" -ForegroundColor Cyan
Set-Location test/Deskland.Tests
& dotnet build --no-restore
Set-Location ../..

Write-Host ""
Write-Host "=== pre-commit: 运行测试 ===" -ForegroundColor Cyan
Set-Location test/Deskland.Tests
& dotnet test --no-build

Write-Host ""
Write-Host "=== pre-commit: 全部通过 ===" -ForegroundColorColor Green
