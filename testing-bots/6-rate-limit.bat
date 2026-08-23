@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"

echo.
echo  ===============================================================
echo   BOT 6 - Rate limiting y abuso
echo  ===============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [FALTA] Node.js no esta en el PATH.
  echo  Instalalo desde https://nodejs.org (version 20 o mayor^).
  goto :fin
)

echo  SOLO LOCALHOST. Si ENTORNO no es "local", el bot aborta.
echo.
echo  Los tres dev servers tienen que estar levantados:
echo    npm run dev             (sitio,    http://localhost:8000^)
echo    npm run dev:pago        (checkout, http://localhost:3000^)
echo    npm run dev:dashboard   (panel,    http://localhost:3100^)
echo.
echo  Cada endpoint se prueba desde una IP simulada distinta, nueva en
echo  cada corrida: el cupo arranca limpio y no te bloqueas tu propia IP.
echo.
echo  Los topes viven en memoria del proceso: si reiniciaste el dev server,
echo  los contadores arrancan de cero.
echo.

node bots/6-rate-limit.mjs %*
set CODIGO=%ERRORLEVEL%

echo.
if "%CODIGO%"=="0" (
  echo  [OK] Los frenos que tienen que estar, estan.
) else (
  echo  [SIN FRENO] Codigo de salida: %CODIGO%
  echo              Hay un endpoint sensible sin ningun limite.
  echo              El detalle esta en  reportes\  y en  logs\6-rate-limit.log
)

:fin
echo.
popd
pause
exit /b %CODIGO%
