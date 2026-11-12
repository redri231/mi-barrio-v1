-- Temporary MVP test coverage only; these are not official neighborhood boundaries.
-- Centers are OpenStreetMap place=neighbourhood label points:
-- Miguel Grau IV Etapa Zona B: https://www.openstreetmap.org/node/4313327940
-- 15 de Agosto: https://www.openstreetmap.org/node/4317072652
-- Data © OpenStreetMap contributors, ODbL 1.0.
-- Each test area is an 800 m buffer so GPS checks can be exercised in person.
-- Replace with validated municipal polygons before using residency verification operationally.

WITH demo_quadrants (district_name, quadrant_code, center_lon, center_lat) AS (
  VALUES
    ('Paucarpata', 'MG-IV-ZB-TEST', -71.4824810::double precision, -16.4091679::double precision),
    ('Paucarpata', '15-AGOSTO-TEST', -71.5006152::double precision, -16.4116458::double precision)
),
new_quadrants AS (
  SELECT
    demo.district_name,
    demo.quadrant_code,
    ST_Buffer(
      ST_SetSRID(ST_MakePoint(demo.center_lon, demo.center_lat), 4326)::geography,
      800
    )::geometry AS polygon_geom
  FROM demo_quadrants AS demo
  WHERE NOT EXISTS (
    SELECT 1
    FROM neighborhood_quadrants AS existing
    WHERE existing.district_name = demo.district_name
      AND existing.quadrant_code = demo.quadrant_code
  )
)
INSERT INTO neighborhood_quadrants (district_name, quadrant_code, polygon_geom)
SELECT district_name, quadrant_code, polygon_geom
FROM new_quadrants
RETURNING quadrant_id, district_name, quadrant_code;
