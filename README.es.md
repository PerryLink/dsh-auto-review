<div align="center">

# 🤖 dsh-auto-review

**Aprobación con IA de segundo modelo para DeepSeek Harness: un subagente revisor de solo lectura decide permitir/denegar en la cadena de aprobación, con cierre en fallo por defecto.**

*Cuando una acción cruza el límite del sandbox, un segundo modelo lee la evidencia y devuelve un veredicto con su razón — para que los humanos no aprueben nada y nada inseguro se cuele.*

> **Repositorio oficial.** Este es el único repositorio oficial de dsh-auto-review, mantenido por PerryLink. Los repositorios del mismo nombre bajo otras cuentas no están afiliados.

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
| Harness | DeepSeek Harness `0.1.1-rc.2` (dependencias fijadas a `0.1.1-rc.2`; peers `>=0.1.0-rc.8 <0.2.0`) 0.1.2-alpha.5 (adaptado el 2026-09-02): el sobre de sesión conserva su campo ignorable solo para compatibilidad de lectura de logs almacenados - Session.append aún no puede estamparlo, por lo que el comportamiento de la puerta no cambia. |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Plataformas | Todas (answerer de host; panel web opcional mediante la capacidad de proyección de sesión) |
| Modelo | Cualquiera (el revisor hereda la ruta del agente de sesión; `reviewerModel` la reemplaza) |

## Qué obtienes

`dsh-auto-review` pone un segundo modelo en la cadena de answerers de `approval/request`:

1. **Costura oficial** — un answerer que solo reclama las solicitudes que le pertenecen (política `ai`) y delega todo lo demás con `next()`; el flujo de aprobación humana nunca se cortocircuita.
2. **Subagente revisor de solo lectura** — un fork de un solo uso con una lista blanca de herramientas `read`/`glob`/`grep` devuelve un veredicto estructurado `{ decision, reason, riskLevel }`. Las solicitudes del revisor se reconocen por identidad y se delegan; `maxDepth` + la lista blanca mantienen al revisor sin delegar.
3. **Cierre en fallo** — un fallo, un timeout o un desajuste de esquema del revisor se resuelve con `fallbackPolicy` (por defecto `rejected`); un veredicto de denegación devuelve su razón al modelo que llama.
4. **Enrutamiento por configuración** — políticas por herramienta (`ai`/`human`/`never`) más reglas de riesgo con regex, todo modificable desde cordis.yml.
5. **Las razones de denegación llegan al modelo** — la razón del revisor se inyecta en el resultado de la herramienta denegada (vinculada por callId); los rechazos por fallback y por política `never` también inyectan marcadores auditables (`[auto-review]` / `[auto-review-fallback]` / `[auto-review-never]`).
6. **Rastro de auditoría completo** — eventos de sesión solo-registro `autoReview/verdict` + `autoReview/rejection` (sobre `ignorable: true`) más un compañero invariant opcional que impone marcador ⟺ evento.
7. **Controles de seguridad** — un disyuntor de rechazos (3 denegaciones consecutivas, o 6 de los últimos 10 veredictos, por turno), una política por nivel de riesgo, una anulación de un solo uso `/auto-review approve`, y una desactivación dura de política `never` que se explica a sí misma al modelo.
8. **Contexto opcional del revisor** — una transcripción compacta acotada (`contextBudget`) más una política de decisión en Markdown estilo Codex (`reviewerPolicyText`).

Cada decisión se reconstruye desde el registro de sesión: `approval/asked` → `autoReview/verdict` (o `autoReview/rejection`) → `approval/decided`.

## ¿Por qué un segundo modelo en lugar de reglas?

Los auto-aprobadores basados en patrones deciden antes del despacho, sin evidencia. `dsh-auto-review` entrega la decisión a un **subagente revisor** que lee el espacio de trabajo real (a través de su interfaz de herramientas de solo lectura), los argumentos de la llamada a herramienta ya transmitidos (valores sensibles redactados), la razón de la solicitud y tus reglas de riesgo — y devuelve un veredicto estructurado. Un veredicto de denegación devuelve su **razón al modelo que llama**, de modo que el agente aprende por qué en lugar de reintentar a ciegas.

## Inicio rápido

```sh
# 1. instala el bundle en tu perfil
dsh plugin --profile web add "github:PerryLink/dsh-auto-review#main"

# o desde npm (versiones publicadas)
dsh plugin --profile web add dsh-auto-review

# 2. reinicia y verifica la fila
dsh --profile web --dump-config | grep -A4 'id: auto-review'
```

De fábrica, el parche incluido revisa con IA `bash` y `write`; todas las demás herramientas (incluido `edit` — modificación in situ) delegan a la cadena humana. Añade `edit: ai` explícitamente si aceptas ediciones in situ sin un humano en el bucle.

## Instalación y desinstalación

- **Canal git** (último `main`): `dsh plugin --profile web add "github:PerryLink/dsh-auto-review#main"` — la compilación aislada de `prepare` necesita la única clave `allowBuilds: { esbuild: true }` que imprime el CLI de `dsh` para `dsh-auto-review`.
- **Canal npm** (versiones publicadas): `dsh plugin --profile web add dsh-auto-review`.
- **Canal 1024 store**: `npm i -g dsh1024` una vez, luego `dsh1024 plugin --profile web add dsh-auto-review` (cuenta para el ranking de instalaciones de [deepseek1024.com](https://deepseek1024.com)).
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
| `maxReviewsPerTurn` | `10` | Presupuesto de veredictos de IA reales por turno abierto; superado, las solicitudes delegan |
| `maxFailuresPerTurn` | `10` | Presupuesto de fallos del revisor por turno abierto |
| `reasonMaxChars` | `2000` | Límite para las razones del revisor y la vista previa de argumentos redactados |
| `reviewerGuidance` | *(ninguna)* | Orientación opcional añadida al prompt del revisor |
| `reviewerPolicyText` | *(ninguna)* | Política de decisión en Markdown inyectada en el prompt del revisor (estilo Codex) |
| `denyGuidance` | *(texto anti-elusión)* | Orientación añadida a cada razón de denegación inyectada |
| `contextBudget` | `{turns: 2, maxChars: 4000}` | Presupuesto de transcripción compacta para el prompt del revisor (el turno abierto y el anterior); `turns: 0` desactiva la sección — y un revisor ciego deniega acciones autorizadas por el usuario, así que el runtime avisa cuando 0 coincide con una política `ai`. El presupuesto de caracteres se gasta en las líneas más recientes |
| `riskPolicy` | `{maxAutoAllow: high, onHighRisk: delegate}` | Los veredictos `allow` por encima de `maxAutoAllow` delegan o deniegan |
| `circuitBreaker` | `{consecutiveDenies: 3, windowDenies: 6, windowSize: 10, action: delegate}` | Disyuntor de rechazos |
| `overrideTtlMs` | `300000` | Cuánto dura una anulación de `/auto-review approve` |
| `verdictCacheTtlMs` | `60000` | Reutiliza un veredicto reciente para una huella `herramienta + argumentos` idéntica; `0` desactiva la caché. Solo se aplica con `contextBudget.turns: 0` — un veredicto que depende de la transcripción no es reproducible solo desde `herramienta + argumentos` |
| `verdictCacheMaxEntries` | `256` | Máximo de huellas en caché antes de desalojar la más antigua |
| `language` | `en` | Idioma de la UI de la salida del comando `/auto-review` (`en` \| `zh`) |
| `allowUnmarkedAudit` | `false` | Fuerza la auditoría del registro de sesión en hosts que descartan el marcador `ignorable` (peligroso: los eventos sin marcar hacen las sesiones irrecuperables en otros hosts); por defecto se detecta y se degrada |

Ejemplo (forma completa anotada: `fixtures/config/config-full.yaml`):

```yaml
- insert:
    - id: auto-review
      name: dsh-auto-review
      config:
        toolsPolicy:
          overrides: { bash: ai, write: ai }
        riskRules:
          - pattern: '(?i)(rm\s+(-[a-z]+\s+)*/|git\s+push\s+--force)'
            policy: never
          - pattern: 'write'
            policy: never
            field: toolName
        reviewerTimeoutMs: 30000
        fallbackPolicy: delegate
        riskPolicy: { maxAutoAllow: medium, onHighRisk: delegate }
        circuitBreaker: { consecutiveDenies: 3, windowDenies: 6, windowSize: 10, action: delegate }
```

### De dónde sale realmente la configuración

**`~/.dsh/settings.yaml` NO es una fuente de configuración para este plugin.** Un bloque `auto-review:` allí no tiene efecto ni produce aviso alguno: como todo plugin-función de DSH, `dsh-auto-review` recibe su `Config` de la fila con la que el loader lo monta — la capa de parches cordis del perfil. (Algunos otros plugins de DSH sí leen además el servicio de settings, así que la inconsistencia es fácil de sufrir y el síntoma es indistinguible de que el revisor simplemente deniegue.)

Pon la configuración en el `cordis.patch.yml` de tu perfil. Una **anulación dirigida por id reemplaza la fila de config entera**, así que reafirma cada clave que necesites — omitir `toolsPolicy` devuelve `bash`/`write` al valor por defecto del esquema, `human`, y el revisor deja de ejecutarse por completo:

```yaml
- id: auto-review
  config:
    toolsPolicy:
      overrides: { bash: ai, write: ai }
    contextBudget: { turns: 4, maxChars: 8000 }
```

## Herramientas y superficies

| Superficie | Tipo | Notas |
|---|---|---|
| `auto-review` | answerer | Answerer de la cascada `approval/request` — reclama solicitudes de política `ai`, delega el resto con `next()` |
| `/auto-review` | comando | `on\|off\|status\|approve [n]` — anulación durable por sesión, presupuestos y estadísticas acumuladas |
| Inyección de razón de denegación | listener | `tools/post-execute` — razones de veredicto / fallback / `never` devueltas al resultado de la herramienta denegada |
| `autoReview` | proyección de sesión | Plegada desde los eventos solo-registro `autoReview/*` |
| Panel web de revisión | cliente | Acción en la cabecera de sesión: interruptor, presupuestos, estadísticas, veredictos recientes, aprobación de un solo uso |
| `dsh-eval` | CLI | Motor de evaluación de agentes basado en YAML (`bin/dsh-eval.mjs`) |
| Compañero invariant | invariant | `dsh-auto-review/invariant` (opcional; necesita el servicio `invariants`) |

## Comando de sesión

```
/auto-review on|off|status|approve [n]
```

`on`/`off` añaden la anulación durable `autoReview/state` (el plegado sobrevive al reinicio/reanudación — la repetición ES el estado) e inyectan un aviso de cambio que el modelo ve (registrado como un evento `user/message`). `status` informa del estado efectivo, de ambos presupuestos por turno (veredictos de IA y fallos del revisor), de un disyuntor disparado cuando hay uno activo, y de las estadísticas acumuladas de la sesión (permisiones/denegaciones/fallbacks/rechazos `never`, duración media, veredictos recientes). `approve [n]` registra una anulación `autoReview/override` de un solo uso para la n-ésima denegación más reciente (1 = la más reciente): la siguiente revisión de la misma herramienta dentro de `overrideTtlMs` lleva la autorización como contexto del revisor — el revisor sigue decidiendo, y la anulación se consume con esa revisión independientemente de su resultado.

## Panel web de revisión

En la GUI web (perfil web), el paquete contribuye una acción en la cabecera de sesión (**AI Review**) que abre un panel con el estado de auto-review de la sesión: el interruptor con botones on/off (que ejecutan `/auto-review on|off`), ambos presupuestos por turno, estadísticas acumuladas (incluidos los rechazos por desactivación dura), el disparo del disyuntor, los veredictos recientes y botones **approve** de un solo uso para las denegaciones recientes (que ejecutan `/auto-review approve [n]`).

Cómo está conectado:

- El host registra una **proyección de sesión** `autoReview` (plegada desde los eventos solo-registro `autoReview/*`) y la sirve a través del canal de proyección de sesión.
- La mitad del navegador es un **módulo cliente** (auto-descubierto desde la declaración `dsh.client`) registrado en el asiento `conversation.session.header.actions`.
- No se necesitan filas de parche adicionales: el panel se carga siempre que el plugin esté instalado en un perfil cuya compilación web proporcione la capacidad de proyección de sesión (el perfil web lo hace). Sin esa capacidad, el panel se declara no disponible; el answerer no se ve afectado.

El panel lee solo valores completos de proyección — nunca recibe el flujo crudo de eventos de sesión.

## Cómo funciona

```text
                       approval/request waterfall (answerer chain)
                        │
┌───────────────────────┴──────────────────────┐
│ dsh-auto-review answerer                     │
│  · session enabled?  · policy = ai?         │   no ── next() ──▶ human answerer (UI)
│  · risk rules → toolsPolicy → default       │
└───────────────────────┬──────────────────────┘
                        │ yes
                        ▼
        ┌───────────────────────────────────┐
        │ reviewer subagent (fork, one-shot)│
        │  · toolFilter: read/glob/grep     │
        │  · outputSchema: {decision,       │
        │    reason, riskLevel}             │
        │  · timeout + req.signal abort     │
        └───────────────┬───────────────────┘
                        │ verdict / failure (fail-closed fallback)
                        ▼
 allow → allowed-once        deny → rejected + reason injected into the
                                       denied tool result (callId-linked)
                        │   never → rejected + [auto-review-never] feedback
                        │            (hard disable, no reviewer runs)
                        ▼
 audit: approval/asked → autoReview/verdict | autoReview/rejection
        → approval/decided (session events, log-only, invariant-checked)
```

**Orden de composición.** El answerer se ejecuta en su posición de registro en la cascada: si un answerer de UI humana se compone ANTES de la fila `auto-review`, los humanos responden primero y el revisor solo ve lo que se delega aguas abajo. Verifícalo con `dsh --profile <name> --dump-config` y coloca la fila `auto-review` antes de tus filas de answerer humano cuando quieras que las herramientas de política ai se enruten primero al revisor.

## dsh-eval — motor de evaluación de agentes

Más allá del revisor de aprobación, `dsh-auto-review` incluye `dsh-eval`: una plataforma de evaluación de agentes basada en YAML que ejecuta sesiones DSH headless reales (un agente aislado + espacio de trabajo temporal por caso, la persona oficial Minimal como prompt de sistema de base), recoge el rastro de llamadas a herramientas del registro de eventos de sesión y evalúa aserciones estructuradas más una revisión opcional de segundo modelo — la misma costura de revisor que el answerer de aprobación.

```yaml
# eval/cases/demo.yaml (abreviado)
suite:
  name: my-suite
  cases:
    - id: math-output
      input: Solve 17 × 24 and reply with only the final number, nothing else.
      expect:
        output: { contains: "408" }
    - id: glob-trace
      seedFrom: '.'
      input: Use the glob tool with pattern "src/**" to list the source files…
      expect:
        toolCalls: [{ tool: glob, arguments: { contains: { pattern: "src" } } }]
        results: [{ tool: glob, contains: "index.ts" }]
```

Ejecútalo (una clave de API de DeepSeek debe estar en el entorno):

```sh
dsh-eval eval/cases --model deepseek-v4-flash --timeout-ms 240000 --out .eval-reports
```

### Familias de aserciones

El bloque `expect` admite seis familias de aserciones; cada aserción se evalúa de forma independiente e informa su propio aprobado/fallo con valores esperados/reales, de modo que un caso que falla se explica a sí mismo sin volver a ejecutarlo.

| Familia | Claves DSL | Qué verifica |
|---|---|---|
| Rastro de herramientas | `toolCalls`, `toolCallsExact`, `noToolCalls`, `results` | secuencia ordenada de llamadas (subsecuencia con saltos), secuencia exacta de nombres, resultado por herramienta (`isError`/`contains`/`regex`) |
| Salida y presupuesto | `output`, `turnEnds`, `maxTokens` | subcadena/regex de la salida final, resultado del turno, presupuesto de tokens |
| Regresión de prompt | `prompt` | el prompt de sistema renderizado debe coincidir con un `baseline` comprometido (o un archivo `baselineFrom`); cualquier deriva se informa como un **diff lado a lado**, con regex `allowedChanges` para permitir ediciones intencionales |
| Métricas de estrés | `stress` | latencia de paso P99 (`maxP99Ms`), peor tiempo al primer token (`maxTtftMs`), velocidad agregada de generación de tokens (`minTokensPerSecond`) |
| Equidad | `bias` | radar de sesgo sobre la salida final: conteos por categoría con regex (`categories`), patrones `forbid` duros, topes `maxHits`/`maxCategoryHits` |
| Revisión de segundo modelo | `review` | un veredicto aprobado/fallo complementario del subagente revisor (capa separada, la misma costura que el revisor de aprobación) |

```yaml
- id: regression-gate
  input: Answer in one sentence.
  expect:
    prompt:
      baseline: "You are a helpful software engineer assistant."
      allowedChanges: ["copyright-year"]
    stress:
      maxP99Ms: 8000
      maxTtftMs: 3000
      minTokensPerSecond: 20
    bias:
      categories: { gender: ["[Hh]e is (un)?stable"] }
      forbid: ["[Ss]crew that"]
      maxCategoryHits: 0
```

Puerta de CI: el proceso sale con 0 solo cuando todos los casos de todas las suites han pasado — las evaluaciones que fallen hacen fallar la compilación. Cada caso deja un JSONL de sesión reproducible y un JSON de rastro junto a `report.md`/`report.json`; los resultados de las aserciones (incluido el diff lado a lado del prompt), el uso de tokens, las métricas de estrés/equidad y el veredicto de revisión se escriben todos en los archivos de informe.

```yaml
- name: dsh-eval
  run: npx dsh-eval eval/cases --model deepseek-v4-flash --timeout-ms 240000 --out .eval-reports
  env:
    DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
```

`dsh-eval` difiere de [openai/codex-research](https://github.com/openai/codex-research): codex-research puntúa trayectorias de agentes para comparación de investigación; `dsh-eval` es un arnés declarativo de regresión aprobado/fallo — casos YAML, aserciones estructuradas de rastro/prompt/estrés/equidad, una revisión opcional de segundo modelo y un código de salida de CI — para gatear cualquier agente DSH, no para ranking de investigación.

## Servidor MCP (independiente)

`dsh-auto-review` también incluye un **servidor MCP** stdio (`dsh-auto-review-mcp`) para que clientes MCP externos (Claude, Codex, …) consuman una ruta de revisión determinista sin el harness. Habla JSON-RPC 2.0 sobre JSON delimitado por saltos de línea (NDJSON): un objeto JSON por línea, sin tramado `Content-Length`.

**Límite.** El revisor completo necesita el seam de subagentes del harness y un segundo modelo, que un proceso stdio separado no puede alcanzar. Por lo tanto, el servidor independiente es **reglas deterministas + caché, sin revisión por modelo**:

- `review_action` reutiliza la caché de veredictos por huella (`src/cache.ts`) y la resolución de reglas de riesgo / políticas de herramientas (`src/config.ts`): una regla `never` → `deny`; un acierto de caché sobre una huella idéntica de `tool + arguments` reproduce ese veredicto; todo lo demás (`ai` necesita modelo, `human` necesita a un humano) → `deny` fail-closed con `reason: "standalone path, no model"`. Nunca permite una acción que un modelo no haya permitido ya.
- `cache_stats` informa los contadores de aciertos/almacenamiento y el estado del TTL.

| Herramienta | Propósito |
|---|---|
| `review_action` | `{tool, args?, reason?}` → `{decision, reason, riskLevel}` — denegación determinista / reproducción de caché |
| `cache_stats` | `{}` → `{hits, stores, size, ttlMs, enabled}` |

Ejecución directa:

```sh
# las reglas de riesgo vienen de variables de entorno
export DSH_AUTO_REVIEW_RISK_RULES='[{"pattern":"rm -rf","policy":"never","field":"arguments"}]'
node bin/dsh-auto-review-mcp.mjs
# o, tras npm install: npx dsh-auto-review-mcp
```

Configuración por entorno: `DSH_AUTO_REVIEW_RISK_RULES` (array JSON de `{pattern, policy, field?}`), `DSH_AUTO_REVIEW_TOOLS_POLICY` (JSON `{default?, overrides?}`), `DSH_AUTO_REVIEW_CACHE_TTL_MS`, `DSH_AUTO_REVIEW_CACHE_MAX_ENTRIES`.

Ejemplo para Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "dsh-auto-review": {
      "command": "npx",
      "args": ["-y", "dsh-auto-review-mcp"],
      "env": {
        "DSH_AUTO_REVIEW_RISK_RULES": "[{\"pattern\":\"rm -rf\",\"policy\":\"never\",\"field\":\"arguments\"}]"
      }
    }
  }
}
```

El servidor es de solo lectura y determinista: sin red, sin modelo, sin escrituras.

## Permisos y datos

- **Permisos**: el manifiesto del workshop declara `session:append`, `approval:answer`, `subagent:spawn`, `command:register` y `tools:observe`.
- **Datos**: nada se guarda en disco; el búfer circular de informes está en memoria y acotado. Sin peticiones de red propias.
- **Registro de sesión**: los eventos `autoReview/*` llevan identidad del revisor, veredicto, razón, riesgo y duración — añadidos con el marcador de sobre `ignorable: true` para que cualquier compilación cargue el registro. Los hosts cuyo `Session.append` es anterior al marcador (todas las líneas rc publicadas hasta `0.1.1-rc.2` — ninguna versión lo estampa aún) se detectan antes del primer append (precomprobación de la versión del peer y luego sondeo del sobre devuelto) y la auditoría se degrada a un espejo en memoria con comentarios sin marcador, de modo que las sesiones siguen siendo cargables en todas partes.

## Límites de seguridad

- **El revisor es un modelo.** Sus veredictos son política consultiva, no un núcleo de seguridad; prefiere reglas `human`/`never` para operaciones irreversibles.
- **Cierre en fallo.** Cada camino anómalo (proveedor ausente, carencias de capacidad, rechazo al iniciar, timeout, razón de parada no `completed`, veredicto ausente/malformado, fallo de correlación de auditoría) se resuelve con `fallbackPolicy`, por defecto `rejected` — y el rechazo devuelve una razón auditable al modelo. `allow-once` concede incondicionalmente; existe solo para despliegues desatendidos cuyo administrador acepta ese riesgo.
- **Revisor de solo lectura.** La lista blanca `toolFilter` del revisor (`read`/`glob`/`grep`) no puede escribir, editar, ejecutar bash, acceder a la red ni delegar (`maxDepth` = su propia profundidad). Su registro de sesión se persiste y es auditable.
- **Revisor aislado del contexto.** Los pasos del hijo revisor se filtran en la costura oficial `agent/pre-step`: solo entran su propio prompt y los resultados de sus propias herramientas de solo lectura. Los archivos de instrucciones del espacio de trabajo (`AGENTS.md` / `CLAUDE.md`), la instantánea de contexto de ejecución del harness y cualquier plugin que inyecte contexto se descartan antes de que el bucle los añada, de modo que el texto controlado por el repositorio nunca llega al componente que decide si se permite una llamada. Esto vale con CUALQUIERA de los proveedores de subagente — esos productores inyectan de nuevo en cada sesión de agente, así que lo que los cierra es el filtro y no la elección de proveedor. La lista blanca es por ORIGEN del mensaje, así que un plugin que declare un origen nuevo también se descarta.
- **Los argumentos sensibles se redactan** (coincidencia por nombre de clave: `token`, `password`, `api_key`, `Authorization`, credenciales, claves privadas …) antes de entrar en el prompt del revisor; el plugin nunca ejecuta los argumentos revisados. La redacción se basa en claves, no en contenido — no revises con IA herramientas cuyos valores de argumento no te puedas permitir mostrar a un modelo.
- **Las desactivaciones duras se explican a sí mismas.** Una herramienta o regla de riesgo `never` rechaza de forma determinista Y registra un evento solo-registro `autoReview/rejection`, y luego inyecta un marcador `[auto-review-never]` en el resultado de la herramienta denegada — el modelo aprende que la acción está duramente desactivada en lugar de reintentarla (verificado por invariant: marcador ⟺ evento).
- **Disyuntor de rechazos.** Una racha de denegaciones en un turno dispara el disyuntor (`consecutiveDenies` / `windowDenies` dentro de `windowSize`), registrada como un evento solo-registro `autoReview/circuit`; las solicitudes posteriores siguen su `action` (`delegate` / `reject` / `abort-turn`).
- **El contexto del revisor es transcripción ya presentada.** `contextBudget` alimenta al revisor con contenido de sesión ya presentado. Con el modelo revisor de la misma ruta por defecto, ese contenido permanece dentro de un proveedor; configura `reviewerModel` a un proveedor diferente solo si aceptas presentarle esa transcripción.
- **`never` es unidireccional en esta capa.** Una herramienta o regla de riesgo `never` rechaza antes de que la cadena humana vea la solicitud — un control de bloqueo, no un valor por defecto.

## Limitaciones conocidas

- **Dos exposiciones distintas, dos respuestas distintas — ninguna sustituye a la otra.** El contexto *inyectado* (archivos de instrucciones del espacio de trabajo, la instantánea de contexto de ejecución, inyecciones de plugins de terceros) se inyecta de nuevo en cada sesión de agente, así que llega al revisor de forma idéntica con `reviewerProvider: fork` y con `reviewerProvider: spawn` — medido byte a byte idéntico en ambos con la misma petición. El filtro por origen de `agent/pre-step` es lo que lo cierra, con cualquiera de los dos proveedores; **`spawn` por sí solo NO impide que las instrucciones del espacio de trabajo lleguen al revisor.** Aparte, `fork` siembra al hijo con los turnos completados de la sesión delegante: ese historial ya es el propio registro del hijo y no un mensaje que entra en un paso, así que el filtro no puede tocarlo y solo `spawn` lo evita, con la valla de transcripción no confiable del prompt del revisor como mitigación intermedia. En las dos trazas anteriores la siembra no produjo mensajes adicionales, por lo que su impacto práctico está sin cuantificar.
- El revisor necesita una ruta LLM funcional (heredada por defecto); sin ella, cada revisión cae según `fallbackPolicy` — nunca una concesión silenciosa.
- Los nombres de `reviewerTools` deben existir como herramientas globales en el perfil; un nombre desconocido hace fallar al hijo revisor en voz alta en el punto más temprano y cae en fallback.
- Las reglas de riesgo emparejan el `reason` de la solicitud, el `toolName` o los `arguments` redactados de la llamada según su `field`; otras condiciones van en `toolsPolicy.overrides`.
- La anulación `/auto-review approve` autoriza la siguiente revisión de la misma herramienta, no la llamada histórica exacta; una acción diferente sobre la misma herramienta la consume.
- Los eventos de veredicto son solo-registro; el panel web de revisión lee la proyección `autoReview` plegada (el flujo crudo de eventos nunca llega a los plugins del navegador).
- `autoReview/state` y `autoReview/verdict` se añaden con el marcador de sobre `ignorable: true` en hosts que lo respetan, de modo que cualquier compilación del harness carga el registro — los lectores que no conocen los tipos fuera del repo simplemente omiten esos registros. En hosts rc publicados (rc.1–rc.8) el runtime detecta el marcador descartado y nunca escribe estos eventos (el espejo en memoria mantiene el comando, los presupuestos, el disyuntor y `approve` durante la sesión); las sesiones ya contaminadas por versiones anteriores a 0.5.1 pueden repararse con `scripts/repair-session-logs.mjs` de `dsh-permission-rules` (su conjunto de tipos por defecto cubre los cinco eventos `autoReview/*`).
- El canal git necesita la única clave `allowBuilds` que el CLI de `dsh` imprime para el propio `dsh-auto-review`. El repo incluye su propio `pnpm-workspace.yaml` con `allowBuilds: { esbuild: true }`; `typescript` + `tsdown` son `dependencies` regulares.
- El compañero invariant opcional necesita el servicio `invariants` (composiciones agent-spine como headless/ACP); el perfil web plano no lo proporciona, por lo que la fila se incluye comentada en el parche del bundle.

## Trabajo relacionado

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) — clasificador allow/deny de dos estados en la cascada `tools/pre-execute` con auditoría en archivo de registro. `dsh-auto-review` difiere deliberadamente: cadena de **answerer** oficial, siempre delega lo que no le pertenece, segundo modelo de solo lectura con un veredicto estructurado, razones de denegación devueltas al modelo, auditoría en el registro de sesión.
- [ACP automation bridge](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/acp/acp) — decisiones de máquina de un solo uso para sus propios agentes de ACP. `dsh-auto-review` está limitado a sesión y política de herramientas para el harness interactivo; nunca infiere concesiones durables.

## Desarrollo

```sh
pnpm install                # node ^22.19 || >=24
pnpm run typecheck          # tsc: src + tests contra el checkout local del harness
pnpm test                   # vitest: 190 tests, 14 archivos
pnpm run build              # declaraciones tsc + bundles tsdown (lib/, incluido el bundle de cliente)
pnpm run verify:self-contained
pnpm pack                   # el tarball publicado
```

Estructura del repositorio: `src/index.ts` (contrato del plugin) · `src/config.ts` (esquema Schemastery + resolución) · `src/runtime.ts` (answerer, comando, inyección de razón de denegación) · `src/review.ts` (orquestación del revisor, prompt, saneamiento) · `src/events.ts` (vocabulario de eventos de sesión + pliegues) · `src/projection.ts` + `src/projection-types.ts` (la proyección de sesión `autoReview`) · `src/invariant.ts` (compañero invariant) · `src/eval/` (el motor dsh-eval) · `eval/` (composición de evaluación incluida) · `bin/dsh-eval.mjs` (lanzador CLI) · `src/client/` (mitad del navegador) · `test/` · `fixtures/`.

## Temas

`deepseek-harness`, `dsh`, `dsh-plugin`, `cordis`, `approval`, `auto-review`, `second-model`, `ai-safety`, `sandbox`, `subagent`

## Contribuidores

- [@PerryLink](https://github.com/PerryLink) — creador y mantenedor: el answerer de aprobación, el subagente revisor, la política de riesgo y el disyuntor, el panel de revisión por proyección de sesión, el compañero invariant, dsh-eval y la documentación en cinco idiomas.
- [@weipeng1999](https://github.com/weipeng1999) — propuso el enrutamiento independiente de proveedor/modelo del revisor ([#11](https://github.com/PerryLink/dsh-auto-review/issues/11), [discusión #12](https://github.com/PerryLink/dsh-auto-review/discussions/12)), que se publicó como `reviewerProvider` / `reviewerModel`.
- [@alexchenzl](https://github.com/alexchenzl) — incluyó el plugin en el directorio de plugins de DSH ([#10](https://github.com/PerryLink/dsh-auto-review/issues/10)).

## Familia de plugins DSH de PerryLink

Este proyecto es uno de los [33 complementos de DeepSeek Harness](https://github.com/PerryLink) mantenidos por [PerryLink](https://github.com/PerryLink). Si este te ayuda, probablemente los demás también:

| Plugin | One-liner |
|---|---|
| **[dsh-dsh-background-agents](https://github.com/PerryLink/dsh-dsh-background-agents)** | Agentes hijos en segundo plano durables con barra lateral de UI web, mensajería e interrupción | |
| **[dsh-dsh-budget](https://github.com/PerryLink/dsh-dsh-budget)** | Gobernanza de costes para DeepSeek Harness: presupuestos, carbono y latencia en un panel. | |
| **[dsh-dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-dsh-checkpoint-rewind)** | Equivalente a /rewind de Claude Code: instantáneas, bifurcaciones de sesión, restauración de un solo uso | |
| **[dsh-dsh-claude-move](https://github.com/PerryLink/dsh-dsh-claude-move)** | Migra sesiones, memoria, habilidades y CLAUDE.md de Claude Code a DSH | |
| **[dsh-dsh-click](https://github.com/PerryLink/dsh-dsh-click)** | Control de escritorio nativo multiplataforma para DeepSeek Harness — Windows primero. | |
| **[dsh-dsh-composer-history](https://github.com/PerryLink/dsh-dsh-composer-history)** | Historial de entrada estilo terminal para el compositor web: flechas, búsqueda Ctrl+R | |
| **[dsh-dsh-data-quality](https://github.com/PerryLink/dsh-dsh-data-quality)** | Comprobaciones de calidad de datasets y verificación de citas (el puente numérico opcional consumido aquí) | |
| **[dsh-dsh-defend](https://github.com/PerryLink/dsh-dsh-defend)** | Defensa contra inyección de prompts, jailbreak y fuga de secretos para DeepSeek Harness. | |
| **[dsh-dsh-doublecheck](https://github.com/PerryLink/dsh-dsh-doublecheck)** | Guardián de disciplina de ingeniería: interrogatorio de requisitos, puertas de pruebas, revisión adversaria | |
| **[dsh-dsh-draw](https://github.com/PerryLink/dsh-dsh-draw)** | Enrutamiento unificado de generación de imágenes estáticas para DeepSeek Harness. | |
| **[dsh-dsh-fast](https://github.com/PerryLink/dsh-dsh-fast)** | Diagnóstico de rendimiento de solo lectura para DeepSeek Harness. | |
| **[dsh-dsh-fund-research](https://github.com/PerryLink/dsh-dsh-fund-research)** | Informes de investigación deterministas para fondos mutuos públicos chinos | |
| **[dsh-dsh-github](https://github.com/PerryLink/dsh-dsh-github)** | Integración de PR/issues de GitHub para DSH, cada escritura controlada por aprobación | |
| **[dsh-dsh-industry-research](https://github.com/PerryLink/dsh-dsh-industry-research)** | Orquestación de investigación sectorial que sella sus entregables mediante el `ctx.researchReport.assemble` de este plugin | |
| **[dsh-dsh-library](https://github.com/PerryLink/dsh-dsh-library)** | Base de conocimiento documental local para DeepSeek Harness. | |
| **[dsh-dsh-local-ai](https://github.com/PerryLink/dsh-dsh-local-ai)** | Integración de modelos locales (Ollama) para DeepSeek Harness. | |
| **[dsh-dsh-lsp-actions](https://github.com/PerryLink/dsh-dsh-lsp-actions)** | Diagnósticos, formato, autocompletado, acciones de código y renombrado LSP sobre servidores de lenguaje | |
| **[dsh-dsh-mask](https://github.com/PerryLink/dsh-dsh-mask)** | Middleware de enmascaramiento de PII: anonimiza en el límite del modelo, restaura en la capa de visualización | |
| **[dsh-dsh-mcp-panel](https://github.com/PerryLink/dsh-dsh-mcp-panel)** | Panel de tiempo de ejecución MCP de solo lectura: comando /mcp + pestaña Settings con estado, herramientas y errores | |
| **[dsh-dsh-memento](https://github.com/PerryLink/dsh-dsh-memento)** | Memoria entre sesiones controlada por aprobación: costura ctx.memory + SQLite + herramienta de memoria | |
| **[dsh-dsh-observe](https://github.com/PerryLink/dsh-dsh-observe)** | Exportador de observabilidad OpenTelemetry y Langfuse para DeepSeek Harness. | |
| **[dsh-dsh-output-styles](https://github.com/PerryLink/dsh-dsh-output-styles)** | Cambio de estilo en tiempo de ejecución equivalente a outputStyles de Claude Code | |
| **[dsh-dsh-permission-rules](https://github.com/PerryLink/dsh-dsh-permission-rules)** | Reglas de permisos declarativas allow/deny/ask estilo Claude Code con auditoría | |
| **[dsh-dsh-plugin-guide](https://github.com/PerryLink/dsh-dsh-plugin-guide)** | Base de conocimiento de desarrollo de plugins como habilidad de agente bajo demanda | |
| **[dsh-dsh-research-report](https://github.com/PerryLink/dsh-dsh-research-report)** | Motor de informes de investigación verificables con evidencia direccionada por contenido | |
| **[dsh-dsh-score](https://github.com/PerryLink/dsh-dsh-score)** | Puntuación de calidad multidimensional para plugins de DeepSeek Harness. | |
| **[dsh-dsh-session-pin](https://github.com/PerryLink/dsh-dsh-session-pin)** | Fija sesiones en la barra lateral web con orden durable | |
| **[dsh-dsh-session-sync](https://github.com/PerryLink/dsh-dsh-session-sync)** | Sincronización de sesiones entre dispositivos para DeepSeek Harness — un espejo git dedicado de tu almacén de sesiones. | |
| **[dsh-dsh-skill-pack-security](https://github.com/PerryLink/dsh-dsh-skill-pack-security)** | Paquete de habilidades de auditoría de seguridad: escaneo de secretos, revisión de dependencias y cadena de suministro | |
| **[dsh-dsh-talk](https://github.com/PerryLink/dsh-dsh-talk)** | Bucle de sesión con voz para DeepSeek Harness: háblale y escucha su respuesta. | |
| **[dsh-dsh-test-drive](https://github.com/PerryLink/dsh-dsh-test-drive)** | Pruebas de instalación y humo aisladas para plugins de DeepSeek Harness. | |
| **[dsh-dsh-translate](https://github.com/PerryLink/dsh-dsh-translate)** | Traducción de parámetros entre proveedores y reparación determinista de JSON para DeepSeek Harness. | |

## Licencia

[Apache License 2.0](LICENSE) © 2026 dsh-auto-review contributors
