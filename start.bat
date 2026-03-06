@echo off
chcp 65001 >nul
echo ========================================
echo   주식 분석기 시작
echo ========================================
echo.

if not exist node_modules (
    echo 패키지 설치 중...
    call npm install
    echo.
)

echo 서버 시작 중... (http://localhost:8120)
start http://localhost:8120
node server.js
pause
