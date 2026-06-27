# 04. Расчётная модель маршрута

## Зачем этот блок

Экспертам нужно увидеть, что маршрут выбирается не магически, а по понятной логике. В постановке прямо разрешена упрощённая модель, если команда объяснит факторы и покажет влияние карты, лодки, режима и загрузки.

## Базовая единица расчёта

Маршрут стоит считать как набор участков:

```json
{
  "segment_id": "s12",
  "length_km": 1.8,
  "surface": "shuga",
  "speed_kmh": 12,
  "fuel_factor": 1.8,
  "risk_level": 4,
  "planing_possible": false
}
```

## Формулы для MVP

Время участка:

```text
segment_time_h = segment_length_km / segment_speed_kmh
```

Расход участка:

```text
segment_fuel_l =
  segment_length_km
  * base_fuel_l_per_km
  * surface_fuel_factor
  * load_factor
  * mode_factor
  * configuration_factor
```

Итоги маршрута:

```text
total_time_h = sum(segment_time_h)
total_fuel_l = sum(segment_fuel_l)
fuel_left_l = tank_l - total_fuel_l
range_left_km = fuel_left_l / average_route_fuel_l_per_km
```

Топливный резерв:

```text
reserve_l = tank_l * reserve_percent
route_is_safe_by_fuel = fuel_left_l >= reserve_l
```

Для MVP можно использовать резерв `20%` как середину диапазона `15-25%`, указанного в постановке.

## Функция стоимости маршрута

Чтобы один алгоритм мог строить разные режимы, каждому ребру графа можно назначить стоимость:

```text
edge_cost =
  w_time * normalized_time
  + w_fuel * normalized_fuel
  + w_length * normalized_length
  + w_risk * normalized_risk
  + planing_penalty
  + impassable_penalty
```

Режимы отличаются весами:

| Режим | Главный вес |
| --- | --- |
| Быстрый | `w_time` |
| Экономичный | `w_fuel` |
| Кратчайший | `w_length` |
| Безопасный | `w_risk` |
| Сохранить глиссирование | `planing_penalty` |

## Объяснимость

Каждый маршрут должен возвращать не только итоговые числа, но и причины:

```json
{
  "explanation": [
    "Маршрут обходит участок с риском 5",
    "Расход выше из-за 1.2 км шуги",
    "Глиссирование потеряно на участке s12",
    "Остаток топлива ниже рекомендуемого резерва"
  ]
}
```

## Что важно не забыть

- Не считать маршрут безопасным, если топливо заканчивается ровно в точке Б.
- Показывать риск не только суммарно, но и по участкам.
- Если маршрут совпадает в двух режимах, объяснять почему: например, этот путь одновременно самый короткий и безопасный.
- Не скрывать условность модели: коэффициенты должны быть видны в README.

## Источники

- [Постановка кейса: Postanovka.pdf](/Users/nikitanazarov/Downloads/Postanovka.pdf)
- [Dijkstra's algorithm](https://en.wikipedia.org/wiki/Dijkstra%27s_algorithm)
- [A* search algorithm](https://en.wikipedia.org/wiki/A%2A_search_algorithm)
- [OSRM API Documentation](https://project-osrm.org/docs/v5.24.0/api/)

