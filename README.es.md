<!-- enlaces de idioma -->
[English](README.md) · [中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

<div align="center">

# 🤖 dsh-auto-review

**Aprobación automática por segundo modelo para DeepSeek Harness** — el patrón `approvals_reviewer=auto_review` de Codex / *auto mode* de Claude Code, implementado como un plugin puro de Cordis.

Cuando una acción del agente cruza el límite del sandbox, un **subagente revisor de solo lectura** decide allow/deny — con un motivo — para que los humanos no aprueben nada mientras nada inseguro se cuela.

[![license](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.1.0--rc.6-4c51bf.svg)](https://www.npmjs.com/package/@deepseek-ai/dsh)
[![tests](https://img.shields.io/badge/tests-61%20passing-brightgreen.svg)](test)
[![typescript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](src)
[![type](https://img.shields.io/badge/type-cordis%20bundle-8a5cf6.svg)](cordis.patch.yml)
[![repo](https://img.shields.io/badge/repo-PerryLink%2Fdsh--auto--review-181717.svg)](https://github.com/PerryLink/dsh-auto-review)

**Cero operaciones humanas.** La petición va al revisor de IA, el veredicto es allow/deny + motivo + nivel de riesgo, y cada decisión se puede reconstruir desde el registro de sesión: `approval/asked` → `autoReview/verdict` → `approval/decided`.

<img src="docs/demo-auto-review.gif" alt="demo de dsh-auto-review" width="720"/>

*Una ejecución real de evidencia (servidor real, clave de API real, dos rondas de modelo reales): el revisor de IA **permite** una escritura con escalado dentro del workspace (riesgo bajo, 5,2 s) y luego **deniega** un borrado recursivo fuera del workspace (riesgo alto, 8,9 s) — el motivo de la denegación se devuelve al modelo, visible en la transcripción.*

</div>

## ¿Por qué un segundo modelo en lugar de reglas?

Los auto-aprobadores basados en patrones deciden antes del despacho, sin evidencia. `dsh-auto-review` entrega la decisión a un **subagente revisor** que lee el workspace real (con su cara de herramientas de solo lectura), los argumentos de la llamada ya presentados (valores sensibles redactados), el motivo de la petición y tus reglas de riesgo — y devuelve un veredicto estructurado. Un veredicto de denegación devuelve su **motivo al modelo que llama**, para que el agente aprenda el porqué en lugar de reintentar a ciegas.

## ✨ Características

| | |
|---|---|
| 🔌 **Seam oficial** | Un answerer en el waterfall `approval/request`. Las peticiones que no le pertenecen se delegan con `next()` — el flujo de aprobación humana nunca se corta. |
| 🧠 **Veredicto de segundo modelo** | Subagente fork de un solo uso con lista blanca de herramientas de solo lectura (`read`/`glob`/`grep`) y esquema de veredicto estructurado `{ decision, reason, riskLevel }`. |
| 🛡️ **Fail closed** | Un fallo, timeout o esquema inválido del revisor nunca abre la puerta: se aplica `fallbackPolicy`, por defecto `rejected`. |
| 🧩 **Enrutado por configuración** | Políticas por herramienta (`ai`/`human`/`never`) + reglas de riesgo con regex, todo cambiable desde cordis.yml. |
| 💬 **Los motivos de denegación llegan al modelo** | El motivo del revisor se inyecta en el resultado de la herramienta denegada (vinculado por callId), para que el agente se adapte. |
| 📜 **Auditoría completa** | Eventos de sesión `autoReview/verdict` (identidad del revisor, veredicto, motivo, riesgo, duración) + un companion de invariantes que exige *model-visible ⟺ logged*. |
| 🔁 **Sin recursión** | Las peticiones del propio revisor se reconocen por identidad y se delegan; `maxDepth` + la lista blanca mantienen al revisor sin delegar. |
| ⌨️ **Comando de sesión** | `/auto-review on|off|status` con una anulación duradera por sesión que sobrevive a la restauración. |

## Cómo funciona

```text
                       waterfall approval/request (cadena de answerers)
                        │
┌───────────────────────┴──────────────────────┐
│ answerer dsh-auto-review                     │
│  · ¿sesión activada?  · ¿política = ai?     │   no ── next() ──▶ answerer humano (UI)
│  · reglas de riesgo → toolsPolicy → defecto │
└───────────────────────┬──────────────────────┘
                        │ sí
                        ▼
        ┌───────────────────────────────────┐
        │ subagente revisor (fork, un uso)  │
        │  · toolFilter: read/glob/grep     │
        │  · outputSchema: {decision,       │
        │    reason, riskLevel}             │
        │  · timeout + abort de req.signal  │
        └───────────────┬───────────────────┘
                        │ veredicto / fallo (fallback fail-closed)
                        ▼
 allow → allowed-once        deny → rejected + motivo inyectado en el
                                       resultado de la herramienta denegada
                        │
                        ▼
 auditoría: approval/asked → autoReview/verdict → approval/decided
            (eventos de sesión, log-only, verificados por invariantes)
```

## 🚀 Inicio rápido

Tres canales de instalación; el plugin es un **bundle** (`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`).

```sh
# 1. tarball de npm (artefactos compilados, sin permiso de build)
pnpm pack                       # → dsh-auto-review-0.1.0.tgz
dsh plugin --profile web add ./dsh-auto-review-0.1.0.tgz
dsh --profile web               # reiniciar

# 2. fuente git (fija el commit; el `prepare` autocontenido lo compila)
#    pnpm ≥ 10 bloquea los builds de ciclo de vida: añade primero la clave
#    allowBuilds impresa al pnpm-workspace.yaml del perfil.
dsh plugin --profile web add "github:PerryLink/dsh-auto-review#<commit>"

# 3. enlace local (desarrollo)
dsh plugin --profile web add link:/path/to/dsh-auto-review
```

Verifica:

```sh
dsh --profile web --dump-config | grep -A4 'id: auto-review'
```

De serie, el patch enviado somete `bash`, `write` y `edit` a revisión de IA; el resto de herramientas se delega a la cadena humana.

## ⚙️ Configuración

Todos los parámetros son campos `Config` de Schemastery (cambiables desde cordis.yml). Una anulación dirigida por `id` **reemplaza toda la fila de config** — repite toda clave que necesites.

| Clave | Defecto | Significado |
|---|---|---|
| `enableByDefault` | `true` | Las sesiones arrancan con auto-review activado; `/auto-review on\|off` escribe una anulación duradera con prioridad |
| `toolsPolicy.default` | `human` | Política para herramientas no listadas (delegar al answerer humano) |
| `toolsPolicy.overrides` | `{}` | Política por herramienta: `ai` (decide el revisor), `human` (forzar humano), `never` (rechazo determinista) |
| `riskRules` | `[]` | `{pattern, policy}` emparejado (gana la primera coincidencia) contra el motivo de la petición, **antes** de la tabla de herramientas |
| `reviewerProvider` | `fork` | Provider de subagente para el revisor (backend fork en proceso) |
| `reviewerModel` | *(heredar)* | Id del modelo del revisor; sin valor hereda la ruta del agente de sesión |
| `reviewerTimeoutMs` | `60000` | Plazo del veredicto; al vencer se aplica la política de fallback |
| `reviewerTools` | `[read, glob, grep]` | Lista blanca de herramientas del hijo revisor — todo lo demás es invisible allí |
| `fallbackPolicy` | `rejected` | Ante fallo del revisor: `rejected` (fail closed), `delegate` (continúa la cadena), `allow-readonly` (concede — ver Seguridad) |
| `maxReviewsPerTurn` | `10` | Presupuesto de veredictos por turno abierto; agotado, se delega a humanos |
| `reasonMaxChars` | `2000` | Tope para los motivos del revisor y la vista previa de argumentos redactada |
| `reviewerGuidance` | *(ninguna)* | Guía opcional añadida al prompt del revisor (consultiva, no regla dura) |

Ejemplo (forma completa comentada: `fixtures/config/config-full.yaml`):

```yaml
- insert:
    - id: auto-review
      name: dsh-auto-review
      config:
        toolsPolicy:
          overrides: { bash: ai, write: ai, edit: ai }
        riskRules:
          - pattern: '(?i)(rm\s+(-[a-z]+\s+)*/|git\s+push\s+--force)'
            policy: never
        reviewerTimeoutMs: 30000
        fallbackPolicy: delegate
```

## ⌨️ Comando de sesión

```
/auto-review on|off|status
```

`on`/`off` añaden la anulación duradera `autoReview/state` (el fold sobrevive a reinicios/restauración — la reproducción ES el estado) e inyectan un aviso de cambio visible para el modelo (registrado como evento `user/message`). `status` muestra el estado efectivo y el presupuesto de veredictos del turno.

## 🔒 Seguridad

- El revisor corre con una **cara de herramientas de solo lectura** (lista blanca `toolFilter`). No puede escribir, editar, ejecutar shell, acceder a la red ni delegar (`maxDepth` = su propia profundidad). Su registro de sesión persiste y es auditable.
- **Los argumentos sensibles se redactan** (coincidencia por nombre de clave: `token`, `password`, `api_key`, `Authorization`, credenciales, claves privadas …) antes de entrar en el prompt del revisor; el plugin nunca ejecuta los argumentos revisados. La redacción es por clave, no por contenido — no sometas a revisión de IA herramientas cuyos valores no puedas mostrar a un modelo.
- **Fail closed por defecto.** Toda ruta anómala (provider ausente, arranque rechazado, timeout, stopReason no `completed`, veredicto ausente/malformado, fallo de correlación de auditoría) se resuelve con `fallbackPolicy`, por defecto `rejected`. `allow-readonly` concede incondicionalmente — solo para despliegues desatendidos cuyo administrador acepta ese riesgo.
- **`never` es unidireccional en esta capa.** Una herramienta o regla de riesgo `never` rechaza antes de que la cadena humana vea la petición — es un candado, no un valor por defecto.
- **El revisor es un modelo.** Sus veredictos son política consultiva, no un kernel de seguridad. Prefiere reglas `human`/`never` para operaciones irreversibles.

## ⚠️ Limitaciones conocidas

- El revisor necesita una ruta LLM operativa (heredada del agente de sesión por defecto); sin ella, cada revisión cae al `fallbackPolicy` — nunca una concesión silenciosa.
- Los nombres de `reviewerTools` deben existir como herramientas globales del perfil; un nombre desconocido hace fallar al hijo revisor en voz alta en el punto más temprano y cae al fallback.
- Las reglas de riesgo solo emparejan el `reason` de la petición; las condiciones por nombre de herramienta van en `toolsPolicy.overrides`.
- El evento de veredicto es log-only; el panel de auditoría de la Web UI renderiza los eventos de sesión tal cual (sin panel dedicado).
- El canal git solo necesita la clave `allowBuilds` que imprime el CLI `dsh` para `dsh-auto-review`. El repo trae su propio `pnpm-workspace.yaml` con `allowBuilds: { esbuild: true }` para que el entorno de prepare aislado no falle por el postinstall de esbuild (validación inofensiva del binario de plataforma); `typescript` + `tsdown` son `dependencies` regulares para que ese entorno siempre tenga las herramientas de build.
- El companion de invariantes opcional (`dsh-auto-review/invariant`) necesita el servicio `invariants` (composiciones agent-spine como headless/ACP); el perfil web simple no lo proporciona, por eso la fila se publica comentada en el patch del bundle.

## 🏷️ Topics de GitHub

Recomendados al publicar: `dsh` · `dsh-plugin` · `deepseek-harness` · `deepseek` · `cordis` · `ai-safety` · `approval` · `sandbox` · `subagent` · `llm`

## 🔗 Trabajo relacionado

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) — clasificador binario allow/deny en el waterfall `tools/pre-execute` con auditoría en archivo de log. `dsh-auto-review` difiere a propósito: cadena de **answerers** oficial, siempre delega lo que no posee, segundo modelo de solo lectura con veredicto estructurado, motivos de denegación devueltos al modelo, auditoría en el registro de sesión.
- [ACP automation bridge](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/acp/acp) — decisiones de máquina de un solo uso para sus propios agentes ACP. `dsh-auto-review` está orientado a sesiones y políticas de herramientas del harness interactivo; nunca infiere concesiones duraderas.

## 🧑‍💻 Desarrollo

```sh
pnpm install                # node ^22.19 || >=24
pnpm run typecheck          # tsc, src + tests
pnpm test                   # vitest: 61 tests, 6 suites
pnpm run build              # declaraciones tsc + bundles tsdown (lib/)
pnpm run verify:self-contained
pnpm pack                   # artefacto de publicación
```

Estructura del repositorio (estructura plugin-template): `src/index.ts` (contrato del plugin) · `src/config.ts` (esquema Schemastery + resolución) · `src/runtime.ts` (answerer, comando, inyección del motivo de denegación) · `src/review.ts` (orquestación del revisor, prompt, redacción) · `src/events.ts` (vocabulario de eventos de sesión + folds) · `src/invariant.ts` (companion de invariantes) · `test/` · `fixtures/`.

## 📄 Licencia

[Apache License 2.0](LICENSE)
