@echo off
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 echo Install Node.js LTS, then launch ETryRoom again. & pause & exit /b 1
where python >nul 2>nul
if errorlevel 1 echo Install Python 3.11 or newer, then launch ETryRoom again. & pause & exit /b 1
call npm ci
if errorlevel 1 pause & exit /b 1
call npm run build
if errorlevel 1 pause & exit /b 1
python -m pip install -r requirements-mvp.txt
if errorlevel 1 pause & exit /b 1
python app.py
if errorlevel 1 pause
