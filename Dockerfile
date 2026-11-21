FROM node:22-alpine AS web-build
WORKDIR /source
COPY package.json package-lock.json ./
RUN npm ci
COPY static ./static
COPY vite.config.js ./
RUN npm run build

FROM python:3.12-slim AS app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 ETRYROOM_DB=/data/etryroom.sqlite3 ETRYROOM_COOKIE_SECURE=1
WORKDIR /app
COPY requirements-mvp.txt ./
RUN pip install --no-cache-dir -r requirements-mvp.txt
COPY app.py ./
COPY core ./core
COPY assets ./assets
COPY static/privacy.html ./static/privacy.html
COPY --from=web-build /source/public/static ./dist
COPY scripts/backup.py ./scripts/backup.py
RUN useradd --create-home --uid 10001 etryroom && mkdir /data /backups && chown etryroom:etryroom /data /backups
USER etryroom
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=4s --retries=3 CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/healthz', timeout=2)" || exit 1
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers"]
