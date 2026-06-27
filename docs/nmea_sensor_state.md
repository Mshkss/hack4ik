# Sensor State API и NMEA/CAN интеграция

## Runtime-схема

Текущий web UI читает состояние судна только через основной backend:

```text
web UI -> GET /api/v1/sensor-state -> server.js -> sensor source
```

Источник sensor source выбирается в UI через `Источник датчиков` или параметром API `mode`.

Для demo-режима:

```text
GET /api/v1/sensor-state?mode=demo
DEMO_SENSOR_STATE_URL=http://127.0.0.1:8081/api/v1/sensor-state
```

Для реального режима на Raspberry Pi:

```text
GET /api/v1/sensor-state?mode=real
REAL_SENSOR_STATE_URL=http://127.0.0.1:<adapter-port>/api/v1/sensor-state
```

Чтобы полностью отключить датчики:

```text
GET /api/v1/sensor-state?mode=off
```

В режиме `off` frontend не опрашивает API по таймеру, скрывает маркер судна и отключает кнопку использования GPS как старта. Ручной расчет маршрута продолжает работать.

## Контракт

`GET /api/v1/sensor-state` возвращает единый контракт:

```json
{
  "nmea": {
    "online": true,
    "source": "demo_simulator",
    "last_frame_age_ms": 0,
    "updated_at": "2026-06-27T12:00:00.000Z"
  },
  "position": {
    "valid": true,
    "lat": 55.9579,
    "lon": 92.3811,
    "age_ms": 0,
    "updated_at": "2026-06-27T12:00:00.000Z"
  },
  "motion": {
    "valid": true,
    "sog_mps": 8.5,
    "sog_kmh": 30.6,
    "cog_deg": 82.4,
    "heading_deg": 80.1,
    "updated_at": "2026-06-27T12:00:00.000Z"
  },
  "depth": {
    "valid": true,
    "depth_m": 6.4,
    "updated_at": "2026-06-27T12:00:00.000Z"
  },
  "engine": {
    "rpm_valid": true,
    "rpm": 2300,
    "fuel_rate_valid": true,
    "fuel_rate_lph": 14.5,
    "updated_at": "2026-06-27T12:00:00.000Z"
  }
}
```

Если источник недоступен, основной backend возвращает тот же контракт с `nmea.online=false` и `position.valid=false`.

## Demo simulator

Запуск:

```bash
npm run sensor:demo
```

Настройки:

```bash
PORT=8081 TICK_MS=500 SPEED_MPS=8.5 npm run sensor:demo
```

Simulator идет по точкам Дивногорск -> Красноярск, обновляет координаты каждые `TICK_MS`, имитирует скорость, курс, heading, глубину, обороты и расход топлива.

## Real CAN/NMEA adapter

Заготовка находится в `cpp/nmea/`.

Будущая схема:

```text
NMEA2000 / CAN -> SocketCAN -> CANboat analyzer JSON -> cpp/nmea adapter -> /api/v1/sensor-state
```

Рекомендуемые PGN для первого реального adapter:

- GNSS position: координаты и качество фиксации;
- COG/SOG: скорость и курс над грунтом;
- vessel heading: heading от компаса/датчика курса;
- water depth: глубина;
- engine dynamic params: RPM и fuel rate.

Frontend при переходе с demo на real менять не нужно.
