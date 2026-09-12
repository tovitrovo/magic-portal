@echo off
rem ---------------------------------------------------------------------
rem  Sincroniza o catálogo do portal com a planilha do fornecedor.
rem
rem  Use de um destes jeitos:
rem    - arraste o arquivo .xlsx e solte em cima deste .bat;
rem    - ou dê dois cliques, que ele pega a planilha .xlsx mais recente
rem      da sua pasta Downloads.
rem
rem  Antes do primeiro uso, guarde a chave uma única vez, no PowerShell:
rem      setx SB_SERVICE_ROLE_KEY "sua-service-role-key"
rem  Depois disso feche o PowerShell — a chave fica salva no seu usuário
rem  do Windows e este .bat passa a funcionar sozinho.
rem ---------------------------------------------------------------------
setlocal
chcp 65001 >nul
cd /d "%~dp0"

rem UTF-8 no Python, para nome de carta em japonês não quebrar o log.
set PYTHONUTF8=1
set PYTHONIOENCODING=utf-8

echo.
echo ===============================================
echo   Sincronizar catalogo - Cartas para Jogar
echo ===============================================
echo.

rem --- interpretador -------------------------------------------------
set "PY=py"
where py >nul 2>nul || set "PY=python"
%PY% --version >nul 2>nul
if errorlevel 1 (
  echo [X] Nao encontrei o Python nesta maquina.
  echo     Instale em https://www.python.org/downloads/ marcando
  echo     "Add python.exe to PATH" na primeira tela.
  goto :fim
)

rem --- chave ---------------------------------------------------------
if "%SB_SERVICE_ROLE_KEY%"=="" (
  echo [X] A chave de acesso nao esta configurada neste computador.
  echo.
  echo     Abra o PowerShell e rode UMA VEZ, com a sua service_role:
  echo.
  echo         setx SB_SERVICE_ROLE_KEY "cole-a-chave-aqui"
  echo.
  echo     Pegue a chave em: Supabase - Project Settings - API - service_role
  echo     Depois feche o PowerShell e rode este arquivo de novo.
  goto :fim
)

rem --- planilha: arrastada, ou a mais recente de Downloads -----------
set "PLANILHA=%~1"
if not "%PLANILHA%"=="" goto :tem_planilha

echo Nenhum arquivo arrastado - procurando a planilha mais recente em Downloads...
for /f "delims=" %%f in ('dir /b /o-d "%USERPROFILE%\Downloads\*.xlsx" 2^>nul') do (
  set "PLANILHA=%USERPROFILE%\Downloads\%%f"
  goto :tem_planilha
)

echo [X] Nao achei nenhum arquivo .xlsx na pasta Downloads.
echo.
echo     Baixe a planilha do Google Sheets em
echo     Arquivo - Fazer download - Microsoft Excel (.xlsx)
echo     e rode este arquivo de novo.
goto :fim

:tem_planilha
if not exist "%PLANILHA%" (
  echo [X] Arquivo nao encontrado: %PLANILHA%
  goto :fim
)

echo Planilha: %PLANILHA%
echo.

rem --- roda ----------------------------------------------------------
%PY% scripts\sync_catalogo.py "%PLANILHA%"
set "CODIGO=%errorlevel%"

echo.
if "%CODIGO%"=="0" (
  echo === Terminou sem erros. ===
) else (
  echo === Terminou com pendencias. ===
  echo Rode este mesmo arquivo de novo: ele retoma de onde parou
  echo e tenta so as cartas que faltaram.
)

:fim
echo.
echo Pressione qualquer tecla para fechar.
pause >nul
endlocal
