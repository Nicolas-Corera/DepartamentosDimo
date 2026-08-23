@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"

echo.
echo  ===============================================================
echo   BOT 3 - Carga (k6)
echo  ===============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [FALTA] Node.js no esta en el PATH.
  echo  Instalalo desde https://nodejs.org (version 20 o mayor^).
  goto :fin
)

where k6 >nul 2>nul
if errorlevel 1 (
  echo  [FALTA] k6 no esta instalado.
  echo.
  echo  Instalalo con:
  echo.
  echo      winget install k6 --source winget
  echo.
  echo  o con Chocolatey:
  echo.
  echo      choco install k6
  echo.
  echo  o baja el .exe de https://github.com/grafana/k6/releases
  echo  y ponelo en una carpeta del PATH.
  echo.
  echo  Cerra y volve a abrir esta ventana despues de instalarlo.
  set CODIGO=1
  goto :fin
)

echo  SOLO LOCALHOST. Si ENTORNO no es "local", el bot aborta antes de
echo  mandar el primer pedido.
echo.
echo  Los dev servers tienen que estar levantados. Desde la raiz del repo:
echo    npm run dev        (sitio,    http://localhost:8000^)
echo    npm run dev:pago   (checkout, http://localhost:3000^)
echo.
echo  Usuarios, duracion y ramp-up se configuran en config.json
echo  o con CARGA_USUARIOS / CARGA_DURACION / CARGA_RAMP_UP en el .env
echo.

node bots/3-carga-lanzar.mjs %*
set CODIGO=%ERRORLEVEL%

echo.
if "%CODIGO%"=="0" (
  echo  [OK] La corrida cumplio todos los umbrales.
) else if "%CODIGO%"=="99" (
  echo  [UMBRAL] La app aguanto, pero alguna metrica se paso del limite.
) else (
  echo  [FALLO] Codigo de salida: %CODIGO%
)
echo.
echo  Reporte JSON en  reportes\

:fin
echo.
popd
pause
exit /b %CODIGO%
