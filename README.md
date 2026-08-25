# Inspector

Herramienta interna de Edelvives para la revisión editorial de contenidos
digitales.

Automatiza el trabajo manual de entrar al backoffice (*publisher*) de **Edelvives
Digital Plus** o **ByME Digital**, buscar las actividades de un libro una por una
y copiar sus enunciados a mano. Inspector lo hace con un navegador headless
(Playwright) usando **las credenciales del propio usuario**, y devuelve un Excel
con los códigos y un Word con los enunciados listos para revisar.

## Cómo se usa

```
Login → 1. Recolección → Excel → 2. Extracción → Word
```

1. **Login.** Usuario y contraseña del backoffice, más la plataforma. Las
   credenciales se validan de verdad contra el publisher: si son incorrectas, no
   se entra.

2. **Recolección.** Se introduce el *código padre* del libro (por ejemplo
   `225253_MAT1`). El robot busca en el listado de actividades, recorre todas las
   páginas de resultados y devuelve la lista de actividades, descargable como
   `.xlsx` con dos columnas:

   | Columna | Contenido |
   | --- | --- |
   | `GUID/ERP` | Identificador de la actividad en la plataforma |
   | `Name` | Código de la actividad |

3. **Extracción.** Se sube ese Excel (o uno exportado desde **Tangerine**: las
   columnas de sobra como `Position`, `Type` o `Page` se ignoran). El robot entra
   al editor de cada actividad y extrae el HTML del enunciado. El resultado se
   descarga como `.docx`.

   Las imágenes de los enunciados no se pueden reproducir y aparecen como
   `[IMAGEN]`. Las actividades sin enunciado o inaccesibles aparecen marcadas
   como `[SIN ENUNCIADO EN EL EDITOR]` o `[ERROR DE NAVEGACIÓN]` en lugar de
   desaparecer.

4. **Análisis IA.** Todavía no implementado; la vista es una maqueta.

Los resultados sobreviven a una recarga de la pestaña (`sessionStorage`), y
cualquier ejecución en curso se puede cancelar: el servidor lo detecta y cierra
su navegador.

## Desarrollo

Requiere **Node ≥ 20.9** (los tests necesitan Node ≥ 22, que ejecuta TypeScript
sin transpilador).

```bash
npm install
```

```bash
npx playwright install chromium
```

Crea un `.env.local` a partir de `.env.example` — `SESSION_SECRET` es
obligatorio:

```bash
openssl rand -base64 48
```

```bash
npm run dev
```

| Comando | Qué hace |
| --- | --- |
| `npm run dev` | Servidor de desarrollo en http://localhost:3000 |
| `npm run build` | Build de producción (`output: 'standalone'`) |
| `npm test` | Tests del conversor HTML → Word |
| `npm run lint` | ESLint |

> `xlsx` se instala desde `cdn.sheetjs.com`, no desde npm: la última versión
> publicada en npm (0.18.5) arrastra vulnerabilidades sin corregir. Instalar
> requiere salida a ese host.

## Estructura

```
app/
  page.tsx            Server Component: lee la sesión → login o panel
  api/auth/*          Login (valida contra el publisher) y logout
  api/recolector      Capa fina: valida y delega
  api/extractor
  api/generar-word
components/           Vistas y piezas de interfaz
hooks/
  useNdjsonStream     Único lector del stream de progreso
  useEstadoPersistido Estado que sobrevive a una recarga
lib/
  session.ts          Cookie de sesión sellada (AES-256-GCM)
  plataformas.ts      Catálogo de plataformas; la URL la decide el servidor
  ndjson.ts           Canal de progreso hacia el cliente
  publisher/
    selectores.ts     TODOS los selectores del backoffice, en un solo sitio
    navegador.ts      Ciclo de vida del navegador
    login.ts          Autenticación y detección de sesión caducada
    recolector.ts     Motor del paso 1
    extractor.ts      Motor del paso 2 (pool de pestañas)
  html/
    sanear.ts         Lista blanca antes de mostrar HTML de la plataforma
    parseEnunciado.ts HTML → bloques (función pura, con tests)
    aDocx.ts          Bloques → párrafos de Word
proxy.ts              Puerta de entrada (no es la frontera de seguridad)
```

Tres notas para quien mantenga esto:

- **Los selectores del publisher cambian sin avisar.** Cuando la extracción
  empiece a fallar, el sitio a mirar es `lib/publisher/selectores.ts`, y debería
  ser el único archivo que haya que tocar.
- **La sesión no guarda la contraseña.** Guarda el `storageState` que devolvió la
  plataforma, sellado en una cookie `httpOnly`. La contraseña solo existe durante
  la petición de login.
- **Ese `storageState` viene recortado, y el recorte se valida.** El publisher
  devuelve 118 KB de estado, de los que el 96 % es caché de Redux-persist y
  analítica que no autentica nada; en cookies eso provocaba un `431 Request
  Header Fields Too Large` que dejaba la aplicación inutilizable. `lib/publisher/
  estadoSesion.ts` se queda con la cookie y las claves que parecen de sesión, y
  **comprueba abriendo un contexto nuevo que el recorte sigue entrando** antes de
  guardarlo. Si algún día el publisher renombra su clave de sesión, el fallo
  aparece en el login con las claves conservadas en el log, no a mitad de una
  extracción.

## Despliegue

Cloud Run, con ajustes que no son los de por defecto (memoria, concurrencia 1,
timeout). Está todo en [`DEPLOY.md`](DEPLOY.md), incluidos dos avisos que hay que
leer antes de desplegar.
