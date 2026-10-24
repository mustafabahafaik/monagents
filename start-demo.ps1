# MONAGENT: starts the agent server + dashboard in two windows and opens the browser.
#   powershell -ExecutionPolicy Bypass -File .\start-demo.ps1
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='MONAGENT agent server'; cd '$root\agent'; npm run server"
Start-Process powershell -ArgumentList "-NoExit", "-Command", "`$host.UI.RawUI.WindowTitle='MONAGENT dashboard'; cd '$root\frontend'; npm run dev -- --port 5555 --strictPort"
Start-Sleep -Seconds 4
Start-Process "http://localhost:5555/#/"
