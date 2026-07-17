# Puente GPT4Free — Qwen3-235B-Thinking (SIN API KEY)

Puente Python/Flask que expone `POST /v1/chat/completions` (formato OpenAI) y llama a **Qwen3-235B-Thinking** gratis usando la librería `g4f` (https://github.com/xtekky/gpt4free). **No requiere token, no requiere registro, no requiere API key.**

## Modelo por defecto
- **Modelo**: `Qwen/Qwen3-235B-A22B-Thinking-2507`
- **Provider**: Modelscope AI (gratis, sin auth)
- **Parámetros**: 235B (235 billones) — el más potente disponible gratis en g4f
- **Razonamiento**: Sí (variante "Thinking" con razonamiento interno)

## Deploy en Render (5 minutos)

1. **Subí estos archivos a un repo nuevo de GitHub** (`verboai-glm-bridge`):
   - `bridge.py`
   - `requirements.txt`
   - `Procfile`
   - `README.md`

2. **En Render** (https://dashboard.render.com):
   - **"New +"** → **"Web Service"**
   - Conectá tu repo `verboai-glm-bridge`
   - **Name**: `verboai-glm-bridge`
   - **Runtime**: Python 3
   - **Build Command**: `pip install -r requirements.txt`
   - **Start Command**: `python bridge.py`
   - **Plan**: Free
   - **NO hace falta ninguna Environment Variable** ← sin token, sin config
   - Click **"Create Web Service"**

3. **Esperá 2-3 minutos** a que deploye

4. **Copiá la URL** (algo como `https://verboai-glm-bridge.onrender.com`)

5. **Probá que funciona**:
   ```bash
   curl https://verboai-glm-bridge.onrender.com/health
   ```
   Debería devolver:
   ```json
   {"status":"ok","service":"glm-bridge","mode":"g4f-free","model_default":"Qwen/Qwen3-235B-A22B-Thinking-2507","api_key_required":false,"g4f_available":true}
   ```

6. **Probá el chat directamente**:
   ```bash
   curl -X POST https://verboai-glm-bridge.onrender.com/v1/chat/completions \
     -H "Content-Type: application/json" \
     -d '{"model":"Qwen/Qwen3-235B-A22B-Thinking-2507","messages":[{"role":"user","content":"Hola, quien eres?"}]}'
   ```

## Conectar con tu VerboAI

En tu servicio de VerboAI en Render → **Environment** → agregá estas 3 variables:
```
GPT4FREE_ENABLED_PRO=true
GPT4FREE_URL=https://verboai-glm-bridge.onrender.com
GPT4FREE_MODEL=Qwen/Qwen3-235B-A22B-Thinking-2507
```

Reiniciá VerboAI y probá:
```powershell
$body = @{ mensaje = "Hola, ¿quién eres?" } | ConvertTo-Json
Invoke-RestMethod -Uri "https://verboai.duckdns.org/api/v1/pro-hybrid" -Method Post -Headers $headers -Body $body
```
Deberías ver `capaGlm: True` y `modeloReal: Qwen/Qwen3-235B-A22B-Thinking-2507` ✅

## Fallback automático
Si el modelo principal falla, el puente prueba automáticamente estos en orden:
1. `Qwen/Qwen3-235B-A22B-Thinking-2507` (235B Thinking — el principal)
2. `Qwen/Qwen-3-25B-A22B-Thinking-2507` (25B Thinking — más liviano)
3. `gpt-4o-mini` (clásico de fallback)

Así que aunque uno se caiga, siempre responde con algo.

## Variables opcionales (en el puente, no en VerboAI)
- `G4F_MODEL_OVERRIDE`: cambia el modelo por defecto (ej: `gpt-4o`)
- `G4F_PROVIDER`: fuerza un provider específico (ej: `Modelscope`, `Puter`, `Airforce`)

## Notas
- **100% gratis, sin token, sin registro** — usa g4f con Modelscope.
- Render Free Tier duerme el servicio después de 15 min sin actividad. La primera petición después de dormir tarda ~30s extra.
- Si algún modelo se cae, el puente prueba el siguiente automáticamente (no falla).
- Para ver qué modelo respondió: el campo `model` en la respuesta JSON siempre muestra el modelo real que se usó.
