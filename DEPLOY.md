# Despliegue

Inspector se despliega como contenedor en **Google Cloud Run**. La imagen la
construye el [`Dockerfile`](Dockerfile) del repositorio: tres etapas, arranque
con el servidor mínimo de `output: 'standalone'` y ejecución como `pwuser` (no
root).

Lo que sigue es la parte que **no** está en el código y hay que configurar a mano.

---

## 1. Variables de entorno

| Variable | Obligatoria | Qué hace |
| --- | --- | --- |
| `SESSION_SECRET` | **Sí** | Clave con la que se sella la cookie de sesión (AES-256-GCM). Mínimo 32 caracteres. Si falta, la app falla al leer o escribir sesiones en lugar de degradar en silencio. |
| `EXTRACTOR_CONCURRENCIA` | No (4) | Pestañas en paralelo durante la extracción. Subirlo acelera, pero cada pestaña consume RAM. |
| `PORT` | No (8080) | Ya lo fija el Dockerfile; Cloud Run lo inyecta. |

Genera el secreto y guárdalo en **Secret Manager**, nunca como variable en claro:

```bash
openssl rand -base64 48
```

```bash
gcloud secrets create inspector-session-secret --data-file=-
```

Al desplegar, móntalo:

```bash
gcloud run deploy inspector-edv-backend --set-secrets=SESSION_SECRET=inspector-session-secret:latest
```

> Rotar `SESSION_SECRET` invalida todas las sesiones abiertas: los usuarios
> tendrán que volver a entrar. No pasa nada más.

Para desarrollo local, crea un `.env.local` a partir de [`.env.example`](.env.example).

---

## 2. Ajustes de Cloud Run

Cada petición de scraping abre su propio Chromium, y de eso se derivan casi
todos los ajustes:

| Ajuste | Valor | Por qué |
| --- | --- | --- |
| Memoria | **≥ 2 GiB** | Chromium con varias pestañas no cabe cómodo en menos. |
| CPU | **≥ 2 vCPU** | Por debajo de 2, el pool de pestañas se pelea por CPU y no gana nada. |
| Concurrencia | **1** | Dos peticiones simultáneas en una instancia son dos Chromium: la tumban. Con 1, Cloud Run escala a lo ancho, que es lo correcto aquí. |
| Timeout | **3600 s** | El valor por defecto son 300 s y un libro grande los pasa. Es también el máximo que admite Cloud Run. |
| Región | `europe-west1` o `europe-southwest1` | Hoy está en `us-central1`; para un equipo en España es latencia regalada. |

```bash
gcloud run deploy inspector-edv-backend \
  --region=europe-southwest1 \
  --memory=2Gi \
  --cpu=2 \
  --concurrency=1 \
  --timeout=3600
```

Las rutas de scraping declaran `export const maxDuration = 3600`, pero eso solo
le dice a Next que no corte: **el timeout de Cloud Run manda**, y si no lo subes
la petición muere igual.

---

## 3. Aviso: Firebase Hosting y el streaming

[`firebase.json`](firebase.json) reescribe todo el tráfico a Cloud Run a través
de Firebase Hosting. **Hay que comprobar que ese camino sirve**, porque Hosting
impone un límite de en torno a 60 segundos a las peticiones que proxea y tiende
a bufferizar la respuesta — dos cosas que rompen el progreso NDJSON en vivo, que
es justamente la razón de ser de la terminal de la interfaz.

Cómo verificarlo: lanza una recolección contra el dominio de Hosting y otra
contra la URL directa de Cloud Run, y compara. Si los logs solo aparecen de
golpe al final (o la petición se corta al minuto) por Hosting:

- **Solución inmediata:** acceder directamente a la URL de Cloud Run y dejar
  Hosting solo para lo estático (o retirarlo).
- **Si hace falta mantener Hosting delante:** entonces el scrape no puede vivir
  dentro de la petición HTTP y hay que sacarlo a un job asíncrono con estado
  persistido (Cloud Tasks / Cloud Run Jobs), que el front consulte por progreso.
  Es el siguiente escalón de arquitectura, deliberadamente fuera del alcance
  actual.

Recuerda también actualizar la región del rewrite en `firebase.json` si mueves
el servicio.

---

## 4. Antes de desplegar: `headless`

[`lib/publisher/navegador.ts`](lib/publisher/navegador.ts) lanza Chromium con
`headless: false`, que es útil en local para ver lo que hace el robot pero **no
funciona en Cloud Run**: no hay display. Antes de desplegar tiene que estar en
`headless: true`, o mejor condicionado por entorno:

```ts
headless: !process.env.PLAYWRIGHT_HEADFUL,
```

---

## 5. Comprobación después de desplegar

1. `whoami` dentro del contenedor devuelve `pwuser`, no `root`.
2. Login con credenciales correctas → panel. Con incorrectas → *"Usuario o
   contraseña incorrectos"*, no un timeout.
3. `curl -X POST https://<url>/api/recolector` sin cookie → `401`.
4. Una recolección completa: los logs de la terminal llegan **goteando**, no de
   golpe al final. Si llegan de golpe, algo está bufferizando (ver punto 3).
5. Una extracción de ~20 actividades: comprobar en las métricas que la memoria
   vuelve a bajar al terminar. Si no baja, hay Chromium huérfanos.
