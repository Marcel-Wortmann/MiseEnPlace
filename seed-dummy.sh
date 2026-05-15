#!/usr/bin/env bash
# Seed-Skript: füllt die Rezepte-DB mit Dummy-Daten für den ersten User.
# Voraussetzungen: docker compose läuft, Backend ist gesund.
# Nutzung: bash seed-dummy.sh
set -euo pipefail

DB_SERVICE="${DB_SERVICE:-db}"
DB_USER="${DB_USER:-postgres}"
DB_NAME="${DB_NAME:-rezepte}"

echo "→ Lese ersten User aus DB…"
USER_ID=$(sudo docker compose exec -T "$DB_SERVICE" \
  psql -U "$DB_USER" -d "$DB_NAME" -tA \
  -c 'SELECT id FROM "User" ORDER BY "createdAt" LIMIT 1;')

if [[ -z "$USER_ID" ]]; then
  echo "Kein User gefunden. Erstelle dir zuerst einen Account."
  exit 1
fi
echo "  User-ID: $USER_ID"

echo "→ Schreibe Dummy-Daten…"
sudo docker compose exec -T "$DB_SERVICE" \
  psql -U "$DB_USER" -d "$DB_NAME" -v userid="$USER_ID" <<'SQL'

\set ON_ERROR_STOP on
BEGIN;

-- 30 Rezepte
INSERT INTO "Recipe" (id, "userId", title, description, "durationMinutes", difficulty, rating, servings,
                     "caloriesPerServing", "proteinPerServing", "carbsPerServing", "fatPerServing",
                     "isFavorite", "isPrivate", tags, ingredients, steps,
                     "analysisStatus", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  :'userid',
  'Dummy Rezept ' || g,
  'Beschreibung für Test-Rezept Nr. ' || g || '. Lorem ipsum dolor sit amet.',
  10 + (g * 7) % 90,
  (ARRAY['einfach','mittel','schwer'])[1 + (g % 3)],
  CASE WHEN g % 5 = 0 THEN NULL ELSE 1 + (g % 5) END,
  1 + (g % 6),
  300 + (g * 17) % 600,
  (10 + (g * 3) % 40)::float,
  (20 + (g * 5) % 80)::float,
  (5  + (g * 2) % 30)::float,
  (g % 7 = 0),
  false,
  ARRAY['dummy', (ARRAY['italienisch','asiatisch','vegetarisch','schnell','dessert'])[1 + (g % 5)]],
  '[{"name":"Mehl","amount":250,"unit":"g"},{"name":"Eier","amount":2,"unit":"Stk"},{"name":"Salz","amount":1,"unit":"Prise"}]'::jsonb,
  '[{"order":1,"text":"Zutaten vermengen."},{"order":2,"text":"In Form geben und backen."},{"order":3,"text":"Servieren."}]'::jsonb,
  'completed',
  now() - (g || ' hours')::interval,
  now() - (g || ' hours')::interval
FROM generate_series(1, 30) AS g;

-- 20 Weine
INSERT INTO "Wine" (id, "userId", "imagePath", rating, name, vintage, region, country, grape, winery,
                    "wineType", description, "tastingNotes", "analysisStatus",
                    "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  :'userid',
  '/api/uploads/dummy-wine.jpg',
  (ARRAY['schlecht','okay','gut','sehr_gut'])[1 + (g % 4)],
  'Dummy Wein ' || g,
  2015 + (g % 10),
  (ARRAY['Toskana','Bordeaux','Mosel','Rheingau','Rioja'])[1 + (g % 5)],
  (ARRAY['Italien','Frankreich','Deutschland','Spanien','Portugal'])[1 + (g % 5)],
  (ARRAY['Merlot','Riesling','Pinot Noir','Tempranillo','Chardonnay'])[1 + (g % 5)],
  'Weingut Test ' || g,
  (ARRAY['rot','weiss','rose','schaumwein'])[1 + (g % 4)],
  'Trockener Wein mit kräftigem Charakter. Nr. ' || g,
  'Aromen von dunklen Beeren, Vanille und Eiche.',
  'completed',
  now() - (g || ' days')::interval,
  now() - (g || ' days')::interval
FROM generate_series(1, 20) AS g;

-- 15 Restaurants
INSERT INTO "Restaurant" (id, "userId", name, cuisine, rating, "priceLevel", "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  :'userid',
  'Restaurant ' || g,
  (ARRAY['italienisch','japanisch','französisch','indisch','spanisch'])[1 + (g % 5)],
  (ARRAY['schlecht','okay','gut','sehr_gut'])[1 + (g % 4)],
  1 + (g % 4),
  now() - (g || ' days')::interval,
  now() - (g || ' days')::interval
FROM generate_series(1, 15) AS g;

-- 25 Rezept-Ideen
INSERT INTO "RecipeIdea" (id, "userId", title, note, "createdAt", "updatedAt")
SELECT
  gen_random_uuid(),
  :'userid',
  'Idee ' || g,
  'Notiz zur Idee Nr. ' || g || '. Vielleicht mal probieren.',
  now() - (g || ' hours')::interval,
  now() - (g || ' hours')::interval
FROM generate_series(1, 25) AS g;

COMMIT;
SQL

echo "✓ Fertig:"
echo "  30 Rezepte, 20 Weine, 15 Restaurants, 25 Ideen"
