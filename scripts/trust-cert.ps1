$cert = Get-Item Cert:\CurrentUser\My\56FE1F2AEF7F39546170CF201F0376A2E605F6DE
$store = New-Object System.Security.Cryptography.X509Certificates.X509Store('TrustedPublisher','CurrentUser')
$store.Open('ReadWrite')
$store.Add($cert)
$store.Close()
Write-Host 'Certificado confiado en TrustedPublisher'