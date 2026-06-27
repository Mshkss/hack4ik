# Открытые источники данных для MVP

## Уже зафиксированные источники

| Источник | Ссылка | Что берем | Статус |
| --- | --- | --- | --- |
| OpenStreetMap | https://www.openstreetmap.org/ | водные объекты, берег, острова, POI | источник выбран |
| Overpass API | https://wiki.openstreetmap.org/wiki/Overpass_API | выгрузка OSM по bbox | источник выбран |
| OSM copyright | https://www.openstreetmap.org/copyright | условия использования и атрибуция | источник выбран |
| GeoJSON RFC 7946 | https://datatracker.ietf.org/doc/html/rfc7946 | формат хранения геоданных | источник выбран |
| OGC GeoPackage | https://www.geopackage.org/ | будущий офлайн-контейнер | источник выбран |
| Signal K | https://signalk.org/specification/1.7.0/doc/ | будущая модель бортовых данных | источник выбран |
| GPSD | https://gpsd.io/client-howto.html | будущий GPS-вход | источник выбран |
| CANboat | https://github.com/canboat/canboat | будущий bridge NMEA 2000 | источник выбран |

## План первой реальной выгрузки

## Статус на 2026-06-26

Первая выгрузка уже выполнена для стартового bbox.

Созданы файлы:

- `data/raw/osm_krasnoyarsk_yenisei_overpass.json` - сырая выгрузка Overpass;
- `data/collected/osm_krasnoyarsk_yenisei_summary.json` - сводка по выгрузке;
- `data/collected/osm_water_features_preview.geojson` - первичный preview-слой водных объектов и инфраструктуры.

Краткая сводка:

| Метрика | Значение |
| --- | ---: |
| OSM-элементов всего | 16010 |
| Preview GeoJSON-объектов | 195 |
| `natural=water` | 63 |
| `waterway=river` | 30 |
| `water=river` | 12 |
| `man_made=pier` | 122 |
| `amenity=ferry_terminal` | 3 |

Эта выгрузка не является навигационной картой. Она нужна как стартовый слой для MVP и последующей ручной/экспертной разметки.

### Демо-область

Для стартовой заготовки выбрана демонстрационная зона на Енисее около Красноярска.

Пример bbox:

```text
south=55.950
west=92.730
north=56.050
east=92.980
```

Этот bbox нужен только для начала сбора. Перед продуктовой реализацией его нужно заменить на фактическую зону кейса.

### Что выгружать из OSM/Overpass

1. `natural=water`
2. `waterway=river`
3. `waterway=riverbank`
4. `water=river`
5. `landuse=reservoir`
6. `man_made=pier`
7. `amenity=ferry_terminal`
8. `seamark:*`, если есть в регионе

### Черновой Overpass-запрос

```text
[out:json][timeout:60];
(
  way["natural"="water"](55.950,92.730,56.050,92.980);
  relation["natural"="water"](55.950,92.730,56.050,92.980);
  way["waterway"="river"](55.950,92.730,56.050,92.980);
  way["waterway"="riverbank"](55.950,92.730,56.050,92.980);
  way["water"="river"](55.950,92.730,56.050,92.980);
  way["man_made"="pier"](55.950,92.730,56.050,92.980);
  node["amenity"="ferry_terminal"](55.950,92.730,56.050,92.980);
);
out body;
>;
out skel qt;
```

## Что нужно сделать дальше

1. Выгрузить OSM-данные по bbox.
2. Сохранить сырую выгрузку в `data/raw/osm_krasnoyarsk_yenisei_overpass.json`.
3. Преобразовать ее в GeoJSON-слои.
4. Отделить воду, берег, острова, инфраструктуру и потенциальные препятствия.
5. Сопоставить эти слои с ручным `route_graph.geojson`.
6. Обновить `collection_manifest.json`.

## Ограничения

- OSM не является официальной навигационной картой.
- В OSM может не быть глубин, сезонных мелей и проходимости камыша.
- Для маршрута аэролодки все равно нужна ручная экспертная разметка.
- Все внешние данные должны сохранять атрибуцию.
