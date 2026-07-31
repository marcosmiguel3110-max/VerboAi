# Script para probar la integracion con DeepSeek V4 Pro via G4F Bridge
# Prueba en produccion (Render)

$token = "verboai-539963017246"
$baseUrl = "https://verboai.duckdns.org"

$headers = @{
    "Authorization" = "Bearer $token"
    "Content-Type" = "application/json"
}

$body = @{
    modelo = "verboaistudio/NewserLite"
    mensaje = "Hola, quien eres y que modelo estas usando?"
} | ConvertTo-Json

Write-Host "Probando integracion con DeepSeek V4 Pro via G4F Bridge (PRODUCCION)..."
Write-Host "URL: $baseUrl/api/v1/chat"
Write-Host "Modelo: verboaistudio/NewserLite (NewserPlus requiere permisos de admin)"
Write-Host ""

try {
    $response = Invoke-RestMethod -Uri "$baseUrl/api/v1/chat" -Method Post -Headers $headers -Body $body -TimeoutSec 120
    Write-Host "Respuesta:"
    Write-Host $response.respuesta
    Write-Host ""
    Write-Host "Modelo usado: $($response.modelo)"
    Write-Host "Creditos usados: $($response.creditos)"
} catch {
    Write-Host "Error: $($_.Exception.Message)"
    if ($_.Exception.Response) {
        Write-Host "Status: $($_.Exception.Response.StatusCode.value__)"
    }
}
