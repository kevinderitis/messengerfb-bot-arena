@echo off
REM Messenger Bot Arena - Lanzador Windows
echo ====================================
echo   Messenger Bot Arena
echo ====================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js no esta instalado.
    echo Instale Node.js 20.14+ desde https://nodejs.org
    pause
    exit /b 1
)

if not exist node_modules (
    echo Instalando dependencias...
    call npm install
)

echo.
echo Iniciando servidor en http://localhost:3000/admin
echo.
start "" "http://localhost:3000/admin"
call npm start
