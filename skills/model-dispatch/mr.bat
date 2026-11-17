@echo off
REM Model Router launcher for Windows (cmd)
REM 用法: mr.bat health
setlocal
set "SCRIPT_DIR=%~dp0"
node "%SCRIPT_DIR%lib\cli.mjs" %*
