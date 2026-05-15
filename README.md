# Rezepte

Single-User Rezeptverwaltung mit Rezeptideen-Tab. Stack: Angular 21 (zoneless, SignalStore, Reactive Forms, Tailwind 4) + NestJS + PostgreSQL + Prisma.

## Quickstart

```bash
unzip rezepte.zip
cd rezepte
cp .env.example .env       # optional: Passwort/Port anpassen
docker compose up --build
```

Frontend: <http://localhost:8080>
Backend (intern): `backend:3000` (vom Frontend-Container per Nginx-Proxy auf `/api` weitergereicht)

Beim ersten Start:
- DB-Container fährt hoch
- `bls-init`-Container lädt einmalig die BLS-Nährwertdatenbank (~14 MB) von blsdb.de nach `./data/`. Falls die Datei dort schon liegt, wird übersprungen.
- Backend führt `prisma migrate deploy` aus (oder bei leerer DB `prisma db push`) und startet
- Frontend wird gebaut und durch Nginx ausgeliefert

## BLS-Nährwertdaten

Der Calorie-Estimator nutzt den **Bundeslebensmittelschlüssel (BLS) 4.0** des Max Rubner-Instituts (CC BY 4.0). Die Datei wird beim ersten `docker compose up` automatisch von <https://blsdb.de> heruntergeladen und in `./data/` abgelegt; das Backend importiert die 7140 Einträge mit Makros (Protein, Kohlenhydrate, Fett, Ballaststoffe) ins Postgres.

Manueller Re-Download (z.B. nach Update):

```bash
rm data/BLS_4_0_Daten_2025_DE.xlsx
docker compose up -d bls-init
```

Falls blsdb.de die Direkt-URL ändert oder einen Token verlangt, in `.env` setzen:

```
BLS_DOWNLOAD_URL=https://blsdb.de/assets/uploads/BLS_4_0_2025_DE.zip?token=…
```

Zitierweise (Lizenz-Auflage): Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0 — Deutsche Nährstoffdatenbank.

## App-Bereiche

- `/rezepte` — Liste mit Filter (Suche, max. Dauer, Schwierigkeit, Mind.-Bewertung, Tags)
- `/rezepte/neu`, `/rezepte/:id`, `/rezepte/:id/bearbeiten`
- `/ideen` — Schnelle Notizen oder Fotos zum späteren Nachkochen
- `/ideen/neu`, `/ideen/:id/bearbeiten`

## Daten-Persistenz

Zwei Docker-Volumes:
- `db-data` — PostgreSQL-Daten
- `uploads-data` — hochgeladene Bilder

Beide bleiben über Container-Neubau hinweg erhalten. Komplett zurücksetzen:

```bash
docker compose down -v
```

## Lokale Entwicklung ohne Docker

```bash
# Backend
cd rezepte-rest-api
npm install                        # zieht das in package.json fixierte Prisma 7
cp .env.example .env               # DATABASE_URL anpassen
npx prisma generate
npx prisma db push                 # bzw. migrate dev wenn du Migrations-History willst
npm run start:dev

# Frontend (zweites Terminal)
cd rezepte-frontend
npm install
npm start                          # serviert auf http://localhost:4200
```

> Wichtig: `npx prisma ...` immer aus `rezepte-rest-api/` aufrufen, damit `prisma.config.ts`
> gefunden wird. Niemals `npx prisma@latest ...` — das zieht die neueste Version statt der
> in `package.json` fixierten und kann zu Versions-Konflikten führen.

## Struktur

```
.
├── docker-compose.yml
├── libs/                          ← geteilte Interfaces & DTOs
│   ├── interfaces/
│   ├── dto/
│   └── return-dto/
├── rezepte-rest-api/              ← NestJS-Backend
│   ├── prisma/schema.prisma
│   ├── src/
│   │   ├── prisma/
│   │   ├── upload/                ← Multer + ServeStatic für /uploads
│   │   ├── recipes/
│   │   ├── recipe-ideas/
│   │   ├── app.module.ts
│   │   └── main.ts
│   ├── Dockerfile
│   └── package.json
└── rezepte-frontend/              ← Angular-Frontend
    ├── src/
    │   ├── app/
    │   │   ├── header, sidebar, notification
    │   │   ├── services, store
    │   │   ├── recipes/{list,form,detail}
    │   │   └── recipe-ideas/{list,form}
    │   ├── environments/
    │   ├── styles.css             ← Tailwind 4
    │   ├── index.html
    │   └── main.ts
    ├── nginx/default.conf         ← /api Proxy auf Backend
    ├── Dockerfile
    └── package.json
```
