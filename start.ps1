# ============================================================
#  AKS Dashboard — Script de démarrage
#  Usage : cd C:\Users\ldard\aks-dashboard ; .\start.ps1
# ============================================================

Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
Set-Location "C:\Users\ldard\aks-dashboard"

Write-Host ""
Write-Host "============================================" -ForegroundColor Cyan
Write-Host "   AKS DASHBOARD — DEMARRAGE              " -ForegroundColor Cyan
Write-Host "============================================" -ForegroundColor Cyan

# --- Étape 1 : Vérifier Python ---
try {
    $pyVer = python --version 2>&1
    Write-Host "[OK] $pyVer" -ForegroundColor Green
} catch {
    Write-Host "[ERREUR] Python introuvable." -ForegroundColor Red; exit 1
}

# --- Étape 2 : Vérifier Flask ---
$flaskCheck = pip show flask 2>&1 | Select-String "Version"
if ($flaskCheck) {
    Write-Host "[OK] Flask : $flaskCheck" -ForegroundColor Green
} else {
    Write-Host "[INFO] Installation de Flask..." -ForegroundColor Yellow
    pip install flask --quiet
}

# --- Étape 3 : Vérifier kubectl + cluster ---
try {
    $nodes = kubectl get nodes --no-headers 2>&1
    if ($LASTEXITCODE -eq 0) {
        Write-Host "[OK] kubectl connecté au cluster AKS" -ForegroundColor Green
        Write-Host "     $nodes"
    } else {
        Write-Host "[WARN] kubectl : $nodes" -ForegroundColor Yellow
        Write-Host "       Le dashboard démarrera mais les données seront vides." -ForegroundColor Yellow
    }
} catch {
    Write-Host "[WARN] kubectl introuvable." -ForegroundColor Yellow
}

# --- Étape 4 : Arrêter tout processus Flask existant sur le port 5000 ---
$existing = Get-NetTCPConnection -LocalPort 5000 -ErrorAction SilentlyContinue
if ($existing) {
    $pid5000 = ($existing | Select-Object -First 1).OwningProcess
    Write-Host "[INFO] Port 5000 occupé (PID $pid5000) — fermeture en cours..." -ForegroundColor Yellow
    Stop-Process -Id $pid5000 -Force -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 1
}

# --- Étape 5 : Lancer Flask ---
Write-Host ""
Write-Host "Démarrage du serveur Flask..." -ForegroundColor Cyan
Write-Host "--------------------------------------------" -ForegroundColor DarkGray
Write-Host "  URL dashboard : http://localhost:5000" -ForegroundColor White
Write-Host "  URL nginx     : http://51.11.206.29" -ForegroundColor White
Write-Host "  Arrêt         : CTRL+C" -ForegroundColor White
Write-Host "--------------------------------------------" -ForegroundColor DarkGray
Write-Host ""

# Lancer Flask en mode visible (logs affichés dans la console)
python app.py
