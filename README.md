# Traffic Lab

Мини-проект для демонстрации платформы деплоя и наблюдаемости.

## Что умеет

- показывает небольшой UI со сводкой по нагрузке;
- генерирует HTTP-трафик, ошибки и медленные ответы;
- пишет JSON-логи в stdout для Loki/Promtail;
- отдаёт `/metrics` для Prometheus/Grafana;
- позволяет вручную переключать сценарии нагрузки.

## Быстрый старт

```bash
npm install
npm start
```

Сервис поднимется на `http://localhost:3000`.

## Docker

```bash
docker build -t traffic-lab .
docker run -p 3000:3000 traffic-lab
```

## Эндпоинты

- `GET /` — UI
- `GET /health` — healthcheck
- `GET /metrics` — Prometheus metrics
- `GET /api/stats` — состояние демо в JSON
- `POST /api/scenario/:name` — переключение сценария
- `POST /api/noise` — ручная генерация логов
- `GET /api/reports` — медленный отчёт с возможными ошибками

## Сценарии

- `steady` — базовая стабильная нагрузка
- `spiky` — пиковые всплески и повышенная latency
- `noisy` — много audit/info логов
- `chaos` — ошибки, таймауты и инциденты
- `idle` — почти спокойный режим
