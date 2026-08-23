@echo off
setlocal
chcp 65001 >nul
pushd "%~dp0"

echo.
echo  ===============================================================
echo   BOT 1 - Funcional (E2E con Playwright)
echo  ===============================================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo  [FALTA] Node.js no esta en el PATH.
  echo.
  echo  Instalalo desde https://nodejs.org (version 20 o mayor^)
  echo  y volve a abrir esta ventana.
  goto :fin
)

if not exist "node_modules\@playwright\test" (
  echo  [FALTA] Las dependencias no estan instaladas.
  echo.
  echo  Corriendo "npm install"...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  [ERROR] npm install fallo. Revisa el mensaje de arriba.
    goto :fin
  )
)

set NAVEGADORES=%USERPROFILE%\AppData\Local\ms-playwright
dir /b "%NAVEGADORES%\chromium-*" >nul 2>nul
if errorlevel 1 (
  echo  [FALTA] El navegador Chromium de Playwright.
  echo.
  echo  Bajandolo (una sola vez, unos 150 MB^)...
  echo.
  call npx playwright install chromium
  if errorlevel 1 (
    echo.
    echo  [ERROR] No se pudo bajar Chromium.
    echo  Probalo a mano:  npx playwright install chromium
    goto :fin
  )
)

if not exist ".env" (
  echo  [AVISO] No hay .env. Se usan los valores de config.json.
  echo          Para configurarlo:  copy .env.example .env
  echo.
)

echo  Los dev servers tienen que estar levantados. Desde la raiz del repo:
echo    npm run dev             (sitio,    http://localhost:8000^)
echo    npm run dev:pago        (checkout, http://localhost:3000^)
echo    npm run dev:dashboard   (panel,    http://localhost:3100^)
echo.

call npx playwright test %*
set CODIGO=%ERRORLEVEL%

echo.
if "%CODIGO%"=="0" (
  echo  [OK] Todos los flujos pasaron.
) else (
  echo  [FALLO] Algun paso no se completo. Codigo de salida: %CODIGO%
  echo.
  echo  Las capturas de pantalla de los pasos que fallaron estan en:
  echo    reportes\funcional\
  echo.
  echo  Para ver el reporte navegable:
  echo    npx playwright show-report reportes\funcional-html
)

:fin
echo.
popd
pause
exit /b %CODIGO%
