# syntax=docker/dockerfile:1.7

# ---------- Builder ----------
FROM node:22-bookworm-slim AS builder
WORKDIR /workspace

# libs werden über Path-Alias eingebunden
COPY libs ./libs
COPY rezepte-frontend/package.json rezepte-frontend/package.json
WORKDIR /workspace/rezepte-frontend
RUN npm install --no-audit --no-fund --legacy-peer-deps

WORKDIR /workspace
COPY rezepte-frontend/tsconfig.json rezepte-frontend/tsconfig.json
COPY rezepte-frontend/tsconfig.app.json rezepte-frontend/tsconfig.app.json
COPY rezepte-frontend/angular.json rezepte-frontend/angular.json
COPY rezepte-frontend/postcss.config.json rezepte-frontend/postcss.config.json
COPY rezepte-frontend/ngsw-config.json rezepte-frontend/ngsw-config.json
COPY rezepte-frontend/public rezepte-frontend/public
COPY rezepte-frontend/src rezepte-frontend/src

WORKDIR /workspace/rezepte-frontend
RUN npm run build

# Sanity-Check: in der gebauten styles.css muss Tailwind-Output stehen.
# Wenn nicht, hat PostCSS Tailwind nicht verarbeitet -> Build hart abbrechen.
RUN ls -la dist/rezepte-frontend/browser/ \
 && CSS_FILE=$(ls dist/rezepte-frontend/browser/styles*.css | head -1) \
 && echo "Generated CSS: $CSS_FILE ($(wc -c < $CSS_FILE) bytes)" \
 && (grep -q "rounded-3xl\|rounded-2xl\|bg-card\|text-ink" "$CSS_FILE" \
     || (echo "FATAL: Tailwind classes missing in CSS output! Build failed."; exit 1))

# ---------- Runtime ----------
FROM nginx:1.27-alpine AS runtime

# Standard-Konfig entfernen
RUN rm -f /etc/nginx/conf.d/default.conf

COPY rezepte-frontend/nginx/default.conf /etc/nginx/conf.d/default.conf
COPY --from=builder /workspace/rezepte-frontend/dist/rezepte-frontend/browser /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
