@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo SemiData needs its Python environment. See docs\installation.md.
  pause
  exit /b 1
)
".venv\Scripts\python.exe" -m semidata --workspace "%~dp0workspace" %*
if errorlevel 1 pause
