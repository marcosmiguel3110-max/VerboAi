$MiCookie = "verbo_auth=marcos.miguel.3110%40gmail.com.94f9d4aa4de18e2eb9c6967ca096ecbe012a37d6eeb9ab827cc6227344b99e10"
$Url = "https://verboai.duckdns.org/api/test-btatesters"

Write-Host "Consultando endpoint de pruebas en Verbo AI..." -ForegroundColor Yellow
try {
    $Response = Invoke-WebRequest -Uri $Url -Method Get -Headers @{"Cookie" = $MiCookie} -UseBasicParsing
    Write-Host "Respuesta exitosa del servidor:" -ForegroundColor Green
    $Response.Content
} catch {
    Write-Host "Error en la autenticación: $_" -ForegroundColor Red
}
