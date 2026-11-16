@echo off
rem Запуск демо одним подвійним кліком (Windows): сервер + браузер
cd /d "%~dp0"
if exist .venv\Scripts\activate.bat call .venv\Scripts\activate.bat
start "" http://localhost:8000
python api.py
