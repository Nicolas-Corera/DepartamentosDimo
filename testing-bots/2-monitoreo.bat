@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"

echo.
echo  ===============================================================
echo   BOT 2 - Monitoreo sintetico
echo  ===============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [FALTA] Node.js no esta en el PATH.
  echo.
  echo  Instalalo desde https://nodejs.org (version 20 o mayor^).
  goto :fin
)

if not exist ".env" (
  echo  [AVISO] No hay .env: se usa el entorno "local" de config.json.
  echo          Para monitorear produccion:  copy .env.example .env
  echo          y despues poner  ENTORNO=produccion
  echo.
)

echo  Este bot solo hace lecturas: puede correr contra produccion.
echo  Para dejarlo dando vueltas:  2-monitoreo.bat --bucle
echo.

node bots/2-monitoreo.mjs %*
set CODIGO=%ERRORLEVEL%

echo.
if "%CODIGO%"=="0" (
  echo  [OK] Todo respondiendo.
) else (
  echo  [FALLO] Hay chequeos caidos. Codigo de salida: %CODIGO%
  echo          El detalle con timestamp quedo en  logs\2-monitoreo.log
)

:fin
echo.
popd
pause
exit /b %CODIGO%
