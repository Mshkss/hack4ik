# 14. Треугольный navmesh для водной навигации

## Проблема

Равномерная квадратная сетка плохо подходит для карты воды:

- узкие протоки выпадают, если шаг сетки больше ширины протоки;
- крупные маркеры узлов визуально перекрывают карту;
- если не учитывать `inner`-кольца OSM multipolygon, острова и городские участки ошибочно становятся водой;
- линейные реки OSM (`waterway=river`) могут существовать без широкого полигона воды.

## Что обычно используют

Для навигации по проходимой области обычно строят navmesh:

1. Берут геометрию проходимой зоны.
2. Вырезают препятствия и внутренние дырки.
3. Разбивают область на полигоны, часто на треугольники.
4. Строят граф смежности.
5. Запускают A*/Dijkstra по центрам, вершинам или порталам сетки.

В более зрелых системах используют constrained Delaunay triangulation или Recast-style pipeline: geometry -> regions -> contours -> polygon mesh. Для MVP без тяжелых зависимостей выбран упрощенный вариант: равносторонняя треугольная lattice-сетка с проверкой попадания в OSM-полигоны и запретом пересечения барьеров.

## Реализация в MVP

Текущая реализация:

- строит треугольный navmesh с шагом `0.16 км`;
- проверяет точки mesh через `surfaceAt`;
- учитывает `inner`-кольца multipolygon как дырки;
- проверяет ребра по нескольким точкам на отрезке, чтобы не пересекать сушу;
- добавляет OSM `waterway=river` как линейный водный скелет с шагом `0.12 км`;
- соединяет линейные реки с polygon-navmesh, если они рядом;
- добавляет safety-barrier КрасГЭС и удаляет ребра, пересекающие его буфер;
- исключает пользовательские тестовые `map.edges` из runtime-графа.

## Почему не полный CDT пока

Полный constrained Delaunay triangulation требует отдельной геометрической библиотеки и аккуратной обработки:

- самопересечений OSM;
- multipolygon с несколькими outer и inner;
- топологических ошибок;
- узких щелей;
- островов и береговых касаний.

Для хакатонного MVP надежнее иметь простой воспроизводимый mesh, который можно объяснить и отладить. Следующий технический шаг - заменить lattice-сетку на CDT через библиотеку, например CGAL/Triangle/poly2tri, если появится время на зависимость и тесты геометрии.

## Источники

- Recast Navigation: https://github.com/recastnavigation/recastnavigation
- Triangle / Delaunay refinement: https://www.cs.cmu.edu/~quake/triangle.html
- OpenStreetMap `natural=water`: https://wiki.openstreetmap.org/wiki/Tag:natural%3Dwater
- OpenStreetMap multipolygon relation: https://wiki.openstreetmap.org/wiki/Relation:multipolygon
- OpenStreetMap waterway: https://wiki.openstreetmap.org/wiki/Key:waterway
- Overpass API / QL: https://wiki.openstreetmap.org/wiki/Overpass_API/Overpass_QL
