@echo off
setlocal
title PDF to JSON converter

call :find_py
if not defined PY (
  echo.
  echo Could not find Python 3. Install it from https://www.python.org/downloads/
  echo or the Microsoft Store, then double-click this file again.
  echo.
  pause
  exit /b 1
)

echo Using Python: %PY%
echo Installing / checking dependencies ^(pymupdf, Pillow^)...
%PY% -m pip install --disable-pip-version-check -q pymupdf Pillow
if errorlevel 1 (
  echo.
  echo Could not install dependencies automatically. Run this yourself:
  echo     %PY% -m pip install pymupdf Pillow
  echo.
  pause
  exit /b 1
)

echo.
echo Starting converter ^(a file picker opens; or drag PDFs onto this file^)...
echo.
%PY% "%~dp0pdf_to_json.py" %*

echo.
pause
exit /b 0

:find_py
set "PY="
py -3 --version >nul 2>&1 && set "PY=py -3" && goto :eof
python --version >nul 2>&1 && set "PY=python" && goto :eof
python3.13 --version >nul 2>&1 && set "PY=python3.13" && goto :eof
python3 --version >nul 2>&1 && set "PY=python3" && goto :eof
goto :eof
