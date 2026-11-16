#!/bin/bash
# Запуск демо одним подвійним кліком (macOS): сервер + браузер
cd "$(dirname "$0")"
[ -d .venv ] && source .venv/bin/activate
(sleep 2; open http://localhost:8000) &
python api.py
