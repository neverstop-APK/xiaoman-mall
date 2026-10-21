@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

if "%PORT%"=="" set "PORT=3000"

where node >nul 2>nul
if errorlevel 1 goto :no_node

powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:%PORT%/' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } } catch {}; exit 1" >nul 2>nul
if not errorlevel 1 (
  echo.
  echo   小满商城已经在运行，正在打开浏览器...
  start "" "http://127.0.0.1:%PORT%/"
  exit /b 0
)

echo.
echo   ============================================
echo      小满商城 · 本地演示
echo   ============================================
echo   端口：%PORT%
echo   浏览器会自动打开；关闭本窗口即停止服务。
echo.
if not "%NO_BROWSER%"=="1" start "" /B powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:%PORT%/'"
node "server\index-服务入口.js"
echo.
echo   服务已停止。
pause
exit /b 0

:no_node
echo.
echo   [错误] 没有找到 Node.js。
echo   请先安装 Node.js 18 或更高版本：https://nodejs.org/zh-cn
echo   安装完成后重新双击本文件。
echo.
pause
exit /b 1
