<#
.SYNOPSIS
    Crea un certificado auto-firmado "hlabinteractive" para firma de código (code signing)
    e importa el .pfx al almacén CurrentUser\My para que electron-builder lo use.

.NOTES
    - Solo para DESARROLLO/PRUEBAS. No válido para distribución real (SmartScreen lo bloquea).
    - Para producción: usa un .pfx de una CA (DigiCert, Sectigo, GlobalSign...) y variables de entorno:
      CSC_LINK, CSC_KEY_PASSWORD, CSC_NAME, CSC_TIMESTAMP_SERVER
#>

param(
    [string]$Subject = "CN=hlabinteractive",
    [string]$FriendlyName = "hlabinteractive (dev)",
    [string]$PfxPath = "build\cert.pfx",
    [string]$Password = "hlabinteractive-dev",   # cámbialo si quieres
    [int]$YearsValid = 1
)

$ErrorActionPreference = "Stop"

# 1. Crear certificado auto-firmado con EKU Code Signing
Write-Host "Creando certificado auto-firmado..." -ForegroundColor Cyan
$cert = New-SelfSignedCertificate `
    -Subject $Subject `
    -FriendlyName $FriendlyName `
    -CertStoreLocation "Cert:\CurrentUser\My" `
    -KeyUsage DigitalSignature `
    -KeyAlgorithm RSA `
    -KeyLength 2048 `
    -Provider "Microsoft Enhanced Cryptographic Provider v1.0" `
    -TextExtension @(
        "2.5.29.37={text}1.3.6.1.5.5.7.3.3"  # EKU: Code Signing
    ) `
    -NotAfter (Get-Date).AddYears($YearsValid) `
    -HashAlgorithm SHA256

Write-Host "Certificado creado: $($cert.Thumbprint)" -ForegroundColor Green

# 2. Exportar a .pfx con contraseña (usa .NET API para compatibilidad)
Write-Host "Exportando a $PfxPath..." -ForegroundColor Cyan
$securePwd = ConvertTo-SecureString -String $Password -Force -AsPlainText
$pfxBytes = $cert.Export([System.Security.Cryptography.X509Certificates.X509ContentType]::Pkcs12, $securePwd)
[System.IO.File]::WriteAllBytes($PfxPath, $pfxBytes)
Write-Host "PFX exportado." -ForegroundColor Green

# 3. Verificar que tiene EKU Code Signing
$eku = $cert.Extensions | Where-Object { $_.Oid.Value -eq '1.3.6.1.5.5.7.3.3' }
if ($eku) {
    Write-Host "✓ EKU Code Signing presente" -ForegroundColor Green
} else {
    Write-Warning "⚠ EKU Code Signing NO encontrado (puede fallar la firma)"
}

# 4. Instrucciones para electron-builder
Write-Host ""
Write-Host "=== CONFIG PARA electron-builder ===" -ForegroundColor Yellow
Write-Host "En PowerShell ANTES de compilar:"
Write-Host '$env:CSC_LINK = "' + (Resolve-Path $PfxPath).Path + '"'
Write-Host '$env:CSC_KEY_PASSWORD = "' + $Password + '"'
Write-Host '$env:CSC_NAME = "hlabinteractive"'
Write-Host '$env:CSC_TIMESTAMP_SERVER = "http://timestamp.sectigo.com"  # opcional'
Write-Host ""
Write-Host "Luego: npm run dist"
Write-Host ""

# 5. Opcional: confiar en el cert para evitar警告 de SmartScreen (solo tu máquina)
Write-Host "¿Quieres confiar en este certificado localmente (evita 'Editor desconocido')? [S/N]"
$ans = Read-Host
if ($ans -imatch '^s') {
    $store = New-Object System.Security.Cryptography.X509Certificates.X509Store("TrustedPublisher", "CurrentUser")
    $store.Open("ReadWrite")
    $store.Add($cert)
    $store.Close()
    Write-Host "✓ Certificado añadido a TrustedPublisher (CurrentUser)." -ForegroundColor Green
}