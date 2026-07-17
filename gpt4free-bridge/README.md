# Puente GPT4Free para GLM-4

Mini-servicio en Python/Flask que expone `POST /v1/chat/completions` (formato OpenAI) y llama a **GLM-4** gratis. Diseñado para usarse con el endpoint `NewserPro` de VerboAI.

## Dos modos de uso

### Modo A: Zhipu AI oficial (RECOMENDADO, más confiable)

Zhipu AI (los creadores de GLM-4) ofrece una API con tier gratuito generoso.

1. **Registrarse** en https://open.bigmodel.cn/ (es gratis, dan tokens gratuitos al registrarse)
2. **Obtener API key**: Dashboard → API Keys → Create
3. **Deployar este puente en Render**:
   - Crear nuevo Web Service en https://render.com
   - Conectar este repositorio/carpeta
   - Runtime: **Python 3**
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `python bridge.py` (o dejar el Procfile)
   - Environment Variables:
     ```
     USE_ZHIPU=true
     ZHIPU_API_KEY=tu_api_key_de_bigmodel_cn
     ```
   - Plan: **Free** (alcanza para testing)
4. **Copiar la URL** del servicio (ej: `https://verboai-glm-bridge.onrender.com`)
5. **En tu `.env` de VerboAI** (el deploy principal, no este puente):
   ```
   GPT4FREE_ENABLED_PRO=true
   GPT4FREE_URL=https://verboai-glm-bridge.onrender.com
   GPT4FREE_MODEL=glm-4
   ```
6. Reiniciar VerboAI y probar con `curl`:
   ```bash
   curl -X POST https://verboai.duckdns.org/api/v1/pro-hybrid \
     -H "Authorization: Bearer verboai-XXXX" \
     -H "Content-Type: application/json" \
     -d '{"mensaje":"Hola, quien eres?"}'
   ```
   La respuesta debería tener `capaGlm: true`.

### Modo B: g4f gratis sin registro (menos confiable)

Si no querés registrarte en Zhipu, podés usar la librería `g4f` que scrapea providers públicos de GLM-4. **Es menos confiable** porque los providers se caen seguido, pero funciona sin API key.

1. **Deployar este puente en Render** (igual que arriba, pero SIN setear `USE_ZHIPU` ni `ZHIPU_API_KEY`).
2. El puente usará `g4f` automáticamente.
3. Setear `GPT4FREE_URL` en tu `.env` de VerboAI apuntando al puente.

## Verificar que el puente funciona

Una vez deployado, probá:

```bash
curl https://tu-bridge.onrender.com/health
```

Debería devolver:
```json
{"status":"ok","service":"gpt4free-bridge","mode":"zhipu","model":"glm-4","zhipu_configured":true}
```

Y una prueba de chat:

```bash
curl -X POST https://tu-bridge.onrender.com/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"glm-4","messages":[{"role":"user","content":"Hola"}]}'
```

## Notas

- El puente es **stateless** — no guarda nada, solo pasa la petición a GLM-4.
- Render Free Tier puede dormir el servicio después de 15 min de inactividad. La primera petición después de dormir tarda ~30s extra. Para evitarlo, considerá un plan pago o un keep-alive (cron-job.org que pegue a `/health` cada 10 min).
- Si usás modo g4f y falla seguido, cambiá a modo Zhipu (oficial) — es mucho más estable.
