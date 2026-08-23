@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"

echo.
echo  ===============================================================
echo   BOT 5 - Fuzzing y validacion de inputs
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
echo  Con PERMITIR_ESCRITURA=0 (por defecto^) no se inserta nada:
echo  la base de cada payload lleva dos campos invalidos a proposito.
echo.
echo  Son unos 1000 pedidos. Tarda un par de minutos.
echo.

node bots/5-fuzzing.mjs %*
set CODIGO=%ERRORLEVEL%

echo.
if "%CODIGO%"=="0" (
  echo  [OK] Ningun input rompio la validacion.
) else (
  echo  [HALLAZGOS] Codigo de salida: %CODIGO%
  echo              El detalle esta en  reportes\  y en  logs\5-fuzzing.log
)

:fin
echo.
popd
pause
exit /b %CODIGO%
