# Skill: Python Backend (APIs, Django, FastAPI)

Trigger: el usuario pide una API REST, backend Python, servidor web, microservicio,
autenticación, base de datos, o integración con servicios externos.

- Preferí FastAPI para APIs modernas (async, type hints, auto docs) y Django para
  apps completas (admin panel, ORM integrado).
- Para APIs: usá Pydantic para validación, async/await para I/O, y dependency
  injection para configuración.
- Para autenticación: usá JWT (access + refresh tokens) con bcrypt para passwords,
  nunca passwords en texto plano.
- Para bases de datos: usá SQLAlchemy (Django) o Tortoise ORM (FastAPI) para
  SQL, Motor/Beanie para MongoDB.
- Para caching: usá Redis con redis-py (sesiones, rate limiting, caché de queries).
- Para tareas async: usá Celery + Redis para background jobs (emails, procesamiento).
- Para APIs externas: usá httpx (async) o requests (sync), con retry logic y timeout.
- Para logging: usá structlog (structured logging) con JSON format para producción.
- Para testing: usá pytest + pytest-asyncio, con fixtures para DB y APIs.
- Para deployment: usá Docker + gunicorn (Django) o uvicorn (FastAPI), con
  health checks y graceful shutdown.
- Para security: usá CORS, rate limiting, input validation, y never trust user input.
