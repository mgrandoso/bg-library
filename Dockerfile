# Ludoteca (bg-library) — app FastAPI.
FROM python:3.12-slim

WORKDIR /app

# Dependencias primero (capa cacheable entre builds de código)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Código de la app
COPY . .

EXPOSE 8778

# uvicorn con --app-dir server: los imports del server son planos (import db, import bgg, ...)
CMD ["uvicorn", "app:app", "--app-dir", "server", "--host", "0.0.0.0", "--port", "8778"]
