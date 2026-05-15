# BLS — Bundeslebensmittelschlüssel Setup

Das Rezeptbuch nutzt für präzise Kalorienberechnung den **Bundeslebensmittelschlüssel** (BLS) Version 4.0 vom Max Rubner-Institut.

Lizenz: **CC BY 4.0** — frei nutzbar mit Quellenangabe.

## Einmalige Einrichtung

1. **Datei herunterladen** von <https://blsdb.de/download>
   - Im Menü "Download BLS-Daten" anklicken
   - Datei `BLS_4_0_Daten_2025_DE.xlsx` herunterladen (~10 MB)

2. **Ablegen** im Projektverzeichnis:
   ```
   rezepte/
   └── data/
       └── BLS_4_0_Daten_2025_DE.xlsx     ← hier
   ```

3. **Backend neu starten:**
   ```bash
   sudo docker compose up -d --build backend
   sudo docker compose logs -f backend | grep -i bls
   ```
   
   Du solltest sehen:
   ```
   Importiere BLS aus /app/data/BLS_4_0_Daten_2025_DE.xlsx…
   7140 Einträge gelesen, schreibe in DB…
   BLS-Import abgeschlossen: 7140 Einträge in DB.
   ```

   Beim **nächsten** Start wird der Import übersprungen (idempotent).

## Was passiert ohne BLS-Datei?

Backend startet trotzdem. Calorie-Estimator nutzt **nur LLM-Pfad mit Self-Consistency** (3× rechnen, Median). Funktioniert, ist aber ungenauer (~±25-40%).

## Re-Import erzwingen

Wenn neue BLS-Version herauskommt oder Daten korrupt sind:

```bash
sudo docker compose exec db psql -U rezepte -d rezepte -c "TRUNCATE TABLE \"Bls\";"
sudo docker compose restart backend
```

## Lizenz / Zitation

Bei Veröffentlichung von Auswertungen aus dem Rezeptbuch zitieren:

> Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0 – Deutsche Nährstoffdatenbank. Karlsruhe. DOI: 10.25826/Data20251217-134202-0
