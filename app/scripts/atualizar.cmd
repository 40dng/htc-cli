@echo off
rem Atualiza o HTC: encerra o processo, instala dist\htc.exe e reabre NA MESMA
rem conversa, em janela nova. Nao pede tecla, nao segura terminal.
rem   atualizar.cmd
rem   atualizar.cmd -Fresh      (sessao nova)
rem   atualizar.cmd -NoLaunch   (so instala)
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0atualizar_e_reabrir.ps1" %*
exit /b %ERRORLEVEL%

