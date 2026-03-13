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
start /b node server.js
timeout /t 2 /nobreak >nul
start http://localhost:8120
echo 브라우저가 열렸습니다. 이 창을 닫으면 서버가 종료됩니다.
echo 종료하려면 아무 키나 누르세요.
pause >nul
