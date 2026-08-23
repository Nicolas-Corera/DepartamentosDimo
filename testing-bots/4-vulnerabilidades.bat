@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"

echo.
echo  ===============================================================
echo   BOT 4 - Escaneo de vulnerabilidades (OWASP ZAP baseline)
echo  ===============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [FALTA] Node.js no esta en el PATH.
  echo  Instalalo desde https://nodejs.org (version 20 o mayor^).
  goto :fin
)

where docker >nul 2>nul
if errorlevel 1 (
  echo  [FALTA] Docker no esta instalado.
  echo.
  echo  El baseline scan de ZAP corre dentro de un contenedor:
  echo.
  echo      winget install Docker.DockerDesktop
  echo.
  echo  Despues abri Docker Desktop y espera a que diga "Engine running".
  set CODIGO=1
  goto :fin
)

docker info >nul 2>nul
if errorlevel 1 (
  echo  [FALTA] Docker esta instalado pero el motor no esta corriendo.
  echo.
  echo  Abri Docker Desktop y espera a que el icono diga "Engine running".
  set CODIGO=1
  goto :fin
)

echo  SOLO LOCALHOST. Si ENTORNO no es "local", el bot aborta.
echo.
echo  Uso:
echo    4-vulnerabilidades.bat            escanea el sitio
echo    4-vulnerabilidades.bat pago       escanea el checkout
echo    4-vulnerabilidades.bat panel      escanea el panel
echo    4-vulnerabilidades.bat --todo     escanea los tres
echo.
echo  La primera vez baja la imagen de ZAP (unos 1.5 GB^). Paciencia.
echo.

node bots/4-vulnerabilidades.mjs %*
set CODIGO=%ERRORLEVEL%

echo.
if "%CODIGO%"=="0" (
  echo  [OK] Sin hallazgos de nivel FAIL.
) else (
  echo  [REVISAR] Codigo de salida: %CODIGO%
)
echo.
echo  Los reportes HTML estan en  reportes\
echo  Abrilos con doble click.

:fin
echo.
popd
pause
exit /b %CODIGO%
