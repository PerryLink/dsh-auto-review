<div align="center">

# 🤖 dsh-auto-review

**Aprobación con IA de segundo modelo para DeepSeek Harness: un subagente revisor de solo lectura decide permitir/denegar en la cadena de aprobación, con cierre en fallo por defecto.**

*Cuando una acción cruza el límite del sandbox, un segundo modelo lee la evidencia y devuelve un veredicto con su razón — para que los humanos no aprueben nada y nada inseguro se cuele.*

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![DSH plugin](https://img.shields.io/badge/dsh-plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-auto-review/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-auto-review/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-auto-review?label=version)](https://github.com/PerryLink/dsh-auto-review/releases)
[![npm version](https://img.shields.io/npm/v/dsh-auto-review)](https://www.npmjs.com/package/dsh-auto-review)
[![npm downloads](https://img.shields.io/npm/dm/dsh-auto-review)](https://www.npmjs.com/package/dsh-auto-review)

[English](README.md) · [简体中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

</div>

---

## Compatibilidad

| Superficie | Estado |
|---|---|
| Harness | DeepSeek Harness `0.1.0-rc.6` (peers fijados a `0.1.0-rc.6`) |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Plataformas | Todas (answerer de host; panel web opcional mediante la capacidad de proyección de sesión) |
| Modelo | Cualquiera (el revisor hereda la ruta del agente de sesión; `reviewerModel` la reemplaza) |

## Qué obtienes

`dsh-auto-review` pone un segundo modelo en la cadena de answerers de `approval/request`:

1. **Costura oficial** — un answerer que solo reclama las solicitudes que le pertenecen (política `ai`) y delega todo lo demás con `next()`; el flujo de aprobación humana nunca se cortocircuita.
2. **Subagente revisor de solo lectura** — un fork de un solo uso con lista blanca de herramientas `read`/`glob`/`grep` devuelve un veredicto estructurado `{ decision, reason, riskLevel }`.
3. **Cierre en fallo** — un fallo, un timeout o un desajuste de esquema del revisor se resuelve con `fallbackPolicy` (por defecto `rejected`); un veredicto de denegación devuelve su razón al modelo que llama.
4. **Enrutamiento por configuración** — políticas por herramienta (`ai`/`human`/`never`) más reglas de riesgo con regex, todo modificable desde cordis.yml.
5. **Rastro de auditoría completo** — eventos de sesión solo-registro `autoReview/verdict` + `autoReview/rejection` (sobre `ignorable: true`) más un compañero invariant opcional.
6. **Controles de seguridad** — disyuntor de rechazos, política por nivel de riesgo, anulación de un solo uso `/auto-review approve`, y una desactivación dura `never` que se explica a sí misma al modelo.

Cada decisión se reconstruye desde el registro de sesión: `approval/asked` → `autoReview/verdict` (o `autoReview/rejection`) → `approval/decided`.

## Inicio rápido

```sh
# 1. instala el bundle en tu perfil
dsh plugin --profile web add "github:PerryLink/dsh-auto-review#main"

# o desde npm (versiones publicadas)
dsh plugin --profile web add dsh-auto-review

# 2. reinicia y verifica la fila
dsh --profile web --dump-config | grep -A4 'id: auto-review'
```

De fábrica, el parche revisa con IA `bash` y `write`; todas las demás herramientas delegan a la cadena humana.

## Instalación y desinstalación

- **Canal git** (último `main`): `dsh plugin --profile web add "github:PerryLink/dsh-auto-review#main"` — la compilación aislada de `prepare` necesita la única clave `allowBuilds: { esbuild: true }` que imprime el CLI de `dsh` para `dsh-auto-review`.
- **Canal npm** (versiones publicadas): `dsh plugin --profile web add dsh-auto-review`.
- **Canal tarball**: `pnpm pack` en este repo y luego `dsh plugin --profile web add ./dsh-auto-review-<version>.tgz`.
- **Desinstalación**: `dsh plugin --profile web remove dsh-auto-review` (o elimina la fila del parche de perfil).

## Configuración

Todas las opciones son campos Schemastery `Config` (modificables desde cordis.yml). Una anulación dirigida por id reemplaza toda la fila — repite cada clave que necesites.

| Clave | Por defecto | Significado |
|---|---|---|
| `enableByDefault` | `true` | Las sesiones arrancan con auto-review activo; `/auto-review on\|off` escribe una anulación duradera que gana a esto |
| `toolsPolicy.default` | `human` | Política para herramientas no listadas (delega al answerer humano) |
| `toolsPolicy.overrides` | `{}` | Política por herramienta: `ai` / `human` / `never` |
| `riskRules` | `[]` | `{pattern, policy, field?}` emparejado antes de la tabla de herramientas; `field` elige `reason` (por defecto), `toolName` o `arguments` |
| `reviewerProvider` | `fork` | Proveedor de subagente para el revisor (backend fork en proceso) |
| `reviewerModel` | *(heredado)* | Id del modelo revisor; si no se define, hereda la ruta del agente de sesión |
| `reviewerTimeoutMs` | `60000` | Plazo del veredicto; al vencer se aplica la política de fallback |
| `reviewerTools` | `[read, glob, grep]` | Lista blanca de herramientas del hijo revisor (debe ser no vacía) |
| `fallbackPolicy` | `rejected` | Ante fallo del revisor: `rejected` (cierre en fallo) / `delegate` / `allow-once` |
| `maxReviewsPerTurn` | `10` | Presupuesto de veredictos de IA reales por turno abierto; superado, se delega |
| `maxFailuresPerTurn` | `10` | Presupuesto de fallos del revisor por turno abierto |
| `reasonMaxChars` | `2000` | Límite para las razones del revisor y la vista previa de argumentos redactados |
| `reviewerGuidance` | *(ninguna)* | Orientación opcional añadida al prompt del revisor |
| `reviewerPolicyText` | *(ninguna)* | Política Markdown inyectada en el prompt del revisor (estilo Codex) |
| `denyGuidance` | *(texto anti-elusión)* | Orientación añadida a cada razón de denegación inyectada |
| `contextBudget` | `{turns: 0, maxChars: 4000}` | Presupuesto de transcripción compacta para el prompt del revisor; `turns: 0` lo desactiva |
| `riskPolicy` | `{maxAutoAllow: high, onHighRisk: delegate}` | Los veredictos `allow` por encima de `maxAutoAllow` delegan o deniegan |
| `circuitBreaker` | `{consecutiveDenies: 3, windowDenies: 6, windowSize: 10, action: delegate}` | Disyuntor de rechazos |
| `overrideTtlMs` | `300000` | Cuánto dura una anulación de `/auto-review approve` |
| `language` | `en` | Idioma de la UI de la salida del comando `/auto-review` (`en` \| `zh`) |

## Herramientas y superficies

| Superficie | Tipo | Notas |
|---|---|---|
| `auto-review` | answerer | Answerer de la cascada `approval/request` — reclama solicitudes de política `ai`, delega el resto con `next()` |
| `/auto-review` | comando | `on\|off\|status\|approve [n]` — anulación durable, presupuestos y estadísticas acumuladas |
| Inyección de razón de denegación | listener | `tools/post-execute` — razones de veredicto / fallback / `never` devueltas al resultado denegado |
| `autoReview` | proyección de sesión | Plegada desde los eventos solo-registro `autoReview/*` |
| Panel web de revisión | cliente | Acción en la cabecera de sesión: interruptor, presupuestos, estadísticas, veredictos recientes, aprobación de un solo uso |
| `dsh-eval` | CLI | Motor de evaluación de agentes basado en YAML (`bin/dsh-eval.mjs`) |
| Compañero invariant | invariant | `dsh-auto-review/invariant` (opcional; necesita el servicio `invariants`) |

## dsh-eval — motor de evaluación de agentes

Además del revisor de aprobación, `dsh-auto-review` incluye `dsh-eval`: una plataforma de evaluación de agentes basada en YAML que ejecuta sesiones DSH headless reales (un agente aislado + espacio de trabajo temporal por caso), recoge el rastro de llamadas a herramientas del registro de eventos y evalúa aserciones estructuradas más una revisión opcional de segundo modelo — la misma costura del revisor de aprobación.

```sh
dsh-eval eval/cases --model deepseek-v4-flash --timeout-ms 240000 --out .eval-reports
```

Puerta de CI: el proceso sale con 0 solo cuando todos los casos de todas las suites pasan. Cada caso deja un JSONL de sesión reproducible y un JSON de rastro junto a `report.md`/`report.json`.

## Permisos y datos

- **Permisos**: el manifiesto del workshop declara `session:append`, `approval:answer`, `subagent:spawn`, `command:register` y `tools:observe`.
- **Datos**: nada se guarda en disco; el búfer circular de informes está en memoria y acotado. Sin peticiones de red propias.
- **Registro de sesión**: los eventos `autoReview/*` llevan identidad del revisor, veredicto, razón, riesgo y duración — añadidos con el marcador de sobre `ignorable: true`.

## Límites de seguridad

- **El revisor es un modelo.** Sus veredictos son política consultiva, no un núcleo de seguridad; prefiere reglas `human`/`never` para operaciones irreversibles.
- **Cierre en fallo.** Cada camino anómalo se resuelve con `fallbackPolicy`, por defecto `rejected` — y el rechazo devuelve una razón auditable al modelo.
- **Revisor de solo lectura.** La lista blanca `toolFilter` del revisor (`read`/`glob`/`grep`) no puede escribir, editar, ejecutar bash, acceder a la red ni delegar.
- **Los argumentos sensibles se redactan** (por nombre de clave) antes de entrar al prompt del revisor; el plugin nunca ejecuta los argumentos revisados.
- **`never` es unidireccional.** Una herramienta o regla de riesgo `never` rechaza antes de que la cadena humana vea la solicitud.

## Limitaciones conocidas

- El revisor necesita una ruta LLM funcional (heredada por defecto); sin ella, cada revisión cae según `fallbackPolicy` — nunca una concesión silenciosa.
- Los nombres de `reviewerTools` deben existir como herramientas globales en el perfil; un nombre desconocido hace fallar al hijo revisor en voz alta.
- Las reglas de riesgo emparejan el `reason`, el `toolName` o los `arguments` redactados según su `field`; otras condiciones van en `toolsPolicy.overrides`.
- La anulación `/auto-review approve` autoriza la siguiente revisión de la misma herramienta, no la llamada histórica exacta.
- Los eventos de veredicto son solo-registro; el panel web lee la proyección `autoReview` plegada (el flujo de eventos crudo nunca llega a los plugins del navegador).
- El compañero invariant opcional necesita el servicio `invariants` (composiciones agent-spine); el perfil web plano no lo proporciona.

## Desarrollo

```sh
pnpm install                # node ^22.19 || >=24
pnpm run typecheck          # tsc: src + tests contra el checkout local del harness
pnpm test                   # vitest: 190 tests, 14 archivos
pnpm run build              # declaraciones tsc + bundles tsdown (lib/, incluido el bundle de cliente)
pnpm run verify:self-contained
pnpm pack                   # el tarball publicado
```

## Temas

`deepseek-harness`, `dsh`, `dsh-plugin`, `cordis`, `approval`, `auto-review`, `second-model`, `ai-safety`, `sandbox`, `subagent`

## Contribuidores

- [@PerryLink](https://github.com/PerryLink) — creador y mantenedor: el answerer de aprobación, el subagente revisor, la política de riesgo y el disyuntor, el panel de revisión por proyección de sesión, el compañero invariant, dsh-eval y la documentación en cinco idiomas.

## Licencia

[Apache License 2.0](LICENSE) © 2026 dsh-auto-review contributors
