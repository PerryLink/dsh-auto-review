<!-- links de idioma -->
[English](README.md) · [中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

<div align="center">

# 🤖 dsh-auto-review

**Aprovação automática por segundo modelo para o DeepSeek Harness** — o padrão `approvals_reviewer=auto_review` do Codex / *auto mode* do Claude Code, implementado como um plugin Cordis puro.

Quando uma ação do agente cruza o limite do sandbox, um **subagente revisor somente leitura** decide allow/deny — com um motivo — para que humanos não aprovem nada enquanto nada inseguro passa despercebido.

[![license](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.1.0--rc.6-4c51bf.svg)](https://www.npmjs.com/package/@deepseek-ai/dsh)
[![tests](https://img.shields.io/badge/tests-61%20passing-brightgreen.svg)](test)
[![typescript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](src)
[![type](https://img.shields.io/badge/type-cordis%20bundle-8a5cf6.svg)](cordis.patch.yml)

**Zero operações humanas.** A solicitação vai ao revisor de IA, o veredicto é allow/deny + motivo + nível de risco, e toda decisão pode ser reconstruída a partir do log da sessão: `approval/asked` → `autoReview/verdict` → `approval/decided`.

<img src="docs/demo-auto-review.gif" alt="demo do dsh-auto-review" width="720"/>

*Uma execução real de evidência (servidor real, chave de API real, duas rodadas de modelo reais): o revisor de IA **permite** uma escrita escalada dentro do workspace (risco baixo, 5,2 s) e depois **nega** uma exclusão recursiva fora do workspace (risco alto, 8,9 s) — o motivo da negação é devolvido ao modelo, visível na transcrição.*

</div>

## Por que um segundo modelo em vez de regras?

Aprovadores automáticos baseados em padrões decidem antes do despacho, sem evidência. O `dsh-auto-review` entrega a decisão a um **subagente revisor** que lê o workspace real (com sua face de ferramentas somente leitura), os argumentos da chamada já apresentados (valores sensíveis redigidos), o motivo da solicitação e suas regras de risco — e devolve um veredicto estruturado. Um veredicto de negação devolve seu **motivo ao modelo chamador**, para que o agente aprenda o porquê em vez de tentar de novo às cegas.

## ✨ Recursos

| | |
|---|---|
| 🔌 **Seam oficial** | Um answerer no waterfall `approval/request`. Solicitações que não são dele são delegadas via `next()` — o fluxo de aprovação humana nunca é interrompido. |
| 🧠 **Veredicto de segundo modelo** | Subagente fork de uso único com lista de permissões somente leitura (`read`/`glob`/`grep`) e schema de veredicto estruturado `{ decision, reason, riskLevel }`. |
| 🛡️ **Fail closed** | Falha, timeout ou schema inválido do revisor nunca abre a porta: aplica-se `fallbackPolicy`, padrão `rejected`. |
| 🧩 **Roteamento por configuração** | Políticas por ferramenta (`ai`/`human`/`never`) + regras de risco com regex, tudo alterável pelo cordis.yml. |
| 💬 **Motivos de negação chegam ao modelo** | O motivo do revisor é injetado no resultado da ferramenta negada (vinculado por callId), para o agente se adaptar. |
| 📜 **Trilha de auditoria completa** | Eventos de sessão `autoReview/verdict` (identidade do revisor, veredicto, motivo, risco, duração) + um companion de invariantes que exige *model-visible ⟺ logged*. |
| 🔁 **Sem recursão** | Solicitações do próprio revisor são reconhecidas por identidade e delegadas; `maxDepth` + a lista de permissões mantêm o revisor sem delegar. |
| ⌨️ **Comando de sessão** | `/auto-review on|off|status` com uma sobrescrita durável por sessão que sobrevive à restauração. |

## Como funciona

```text
                       waterfall approval/request (cadeia de answerers)
                        │
┌───────────────────────┴──────────────────────┐
│ answerer dsh-auto-review                     │
│  · sessão ativada?  · política = ai?        │   não ── next() ──▶ answerer humano (UI)
│  · regras de risco → toolsPolicy → padrão   │
└───────────────────────┬──────────────────────┘
                        │ sim
                        ▼
        ┌───────────────────────────────────┐
        │ subagente revisor (fork, uso único)│
        │  · toolFilter: read/glob/grep     │
        │  · outputSchema: {decision,       │
        │    reason, riskLevel}             │
        │  · timeout + abort de req.signal  │
        └───────────────┬───────────────────┘
                        │ veredicto / falha (fallback fail-closed)
                        ▼
 allow → allowed-once        deny → rejected + motivo injetado no
                                       resultado da ferramenta negada
                        │
                        ▼
 auditoria: approval/asked → autoReview/verdict → approval/decided
            (eventos de sessão, log-only, verificados por invariantes)
```

## 🚀 Início rápido

Três canais de instalação; o plugin é um **bundle** (`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`).

```sh
# 1. tarball npm (artefatos compilados, sem permissão de build)
pnpm pack                       # → dsh-auto-review-0.1.0.tgz
dsh plugin --profile web add ./dsh-auto-review-0.1.0.tgz
dsh --profile web               # reiniciar

# 2. fonte git (fixe o commit; o `prepare` autocontido compila)
#    pnpm ≥ 10 bloqueia builds de ciclo de vida: adicione primeiro a chave
#    allowBuilds impressa ao pnpm-workspace.yaml do perfil.
dsh plugin --profile web add "github:<owner>/dsh-auto-review#<commit>"

# 3. link local (desenvolvimento)
dsh plugin --profile web add link:/path/to/dsh-auto-review
```

Verifique:

```sh
dsh --profile web --dump-config | grep -A4 'id: auto-review'
```

De fábrica, o patch enviado submete `bash`, `write` e `edit` à revisão de IA; as demais ferramentas são delegadas à cadeia humana.

## ⚙️ Configuração

Todos os ajustes são campos `Config` de Schemastery (alteráveis pelo cordis.yml). Uma sobrescrita direcionada por `id` **substitui a linha de config inteira** — repita toda chave de que precisar.

| Chave | Padrão | Significado |
|---|---|---|
| `enableByDefault` | `true` | As sessões iniciam com auto-review ativado; `/auto-review on\|off` grava uma sobrescrita durável com prioridade |
| `toolsPolicy.default` | `human` | Política para ferramentas não listadas (delegar ao answerer humano) |
| `toolsPolicy.overrides` | `{}` | Política por ferramenta: `ai` (o revisor decide), `human` (forçar humano), `never` (rejeição determinística) |
| `riskRules` | `[]` | `{pattern, policy}` casado (primeira ocorrência vence) contra o motivo da solicitação, **antes** da tabela de ferramentas |
| `reviewerProvider` | `fork` | Provider de subagente do revisor (backend fork em processo) |
| `reviewerModel` | *(herdar)* | Id do modelo do revisor; sem valor herda a rota do agente da sessão |
| `reviewerTimeoutMs` | `60000` | Prazo do veredicto; ao expirar aplica-se a política de fallback |
| `reviewerTools` | `[read, glob, grep]` | Lista de permissões de ferramentas do filho revisor — todo o resto é invisível lá |
| `fallbackPolicy` | `rejected` | Falha do revisor: `rejected` (fail closed), `delegate` (continua a cadeia), `allow-readonly` (concede — ver Segurança) |
| `maxReviewsPerTurn` | `10` | Orçamento de veredictos por turno aberto; esgotado, delega-se a humanos |
| `reasonMaxChars` | `2000` | Limite para motivos do revisor e a prévia de argumentos redigida |
| `reviewerGuidance` | *(nenhuma)* | Orientação opcional anexada ao prompt do revisor (consultiva, não regra rígida) |

Exemplo (forma completa comentada: `fixtures/config/config-full.yaml`):

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

## ⌨️ Comando de sessão

```
/auto-review on|off|status
```

`on`/`off` anexam a sobrescrita durável `autoReview/state` (o fold sobrevive a reinícios/restauração — a reprodução É o estado) e injetam um aviso de troca visível ao modelo (registrado como evento `user/message`). `status` mostra o estado efetivo e o orçamento de veredictos do turno.

## 🔒 Segurança

- O revisor roda com uma **face de ferramentas somente leitura** (lista de permissões `toolFilter`). Ele não pode escrever, editar, executar shell, acessar a rede nem delegar (`maxDepth` = sua própria profundidade). Seu log de sessão persiste e é auditável.
- **Argumentos sensíveis são redigidos** (casamento por nome de chave: `token`, `password`, `api_key`, `Authorization`, credenciais, chaves privadas …) antes de entrar no prompt do revisor; o plugin nunca executa os argumentos revisados. A redação é por chave, não por conteúdo — não submeta à revisão de IA ferramentas cujos valores você não possa mostrar a um modelo.
- **Fail closed por padrão.** Todo caminho anômalo (provider ausente, início rejeitado, timeout, stopReason não `completed`, veredicto ausente/malformado, falha de correlação de auditoria) resolve-se pela `fallbackPolicy`, padrão `rejected`. `allow-readonly` concede incondicionalmente — existe apenas para implantações não assistidas cujo administrador aceita esse risco.
- **`never` é de mão única nesta camada.** Uma ferramenta ou regra de risco `never` rejeita antes de a cadeia humana ver a solicitação — é um cadeado, não um valor padrão.
- **O revisor é um modelo.** Seus veredictos são política consultiva, não um kernel de segurança. Prefira regras `human`/`never` para operações irreversíveis.

## ⚠️ Limitações conhecidas

- O revisor precisa de uma rota LLM operante (herdada do agente da sessão por padrão); sem ela, cada revisão cai no `fallbackPolicy` — nunca uma concessão silenciosa.
- Os nomes de `reviewerTools` devem existir como ferramentas globais do perfil; um nome desconhecido faz o filho revisor falhar em voz alta no ponto mais cedo e cair no fallback.
- Regras de risco casam apenas o `reason` da solicitação; condições por nome de ferramenta ficam em `toolsPolicy.overrides`.
- O evento de veredicto é log-only; o painel de auditoria da Web UI renderiza os eventos de sessão como estão (sem painel dedicado).
- `typescript` + `tsdown` são `dependencies` regulares de propósito: o pnpm não instala devDependencies de pacotes hospedados em git, e o `prepare` do canal git precisa compilar apenas com dependências de produção.
- O companion de invariantes opcional (`dsh-auto-review/invariant`) precisa do serviço `invariants` (composições agent-spine como headless/ACP); o perfil web simples não o fornece, por isso a linha é publicada comentada no patch do bundle.

## 🏷️ Tópicos do GitHub

Recomendados ao publicar: `dsh` · `dsh-plugin` · `deepseek-harness` · `deepseek` · `cordis` · `ai-safety` · `approval` · `sandbox` · `subagent` · `llm`

## 🔗 Trabalho relacionado

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) — classificador binário allow/deny no waterfall `tools/pre-execute` com auditoria em arquivo de log. O `dsh-auto-review` difere de propósito: cadeia de **answerers** oficial, sempre delega o que não possui, segundo modelo somente leitura com veredicto estruturado, motivos de negação devolvidos ao modelo, auditoria no log de sessão.
- [ACP automation bridge](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/acp/acp) — decisões de máquina de uso único para seus próprios agentes ACP. O `dsh-auto-review` é orientado a sessões e políticas de ferramentas do harness interativo; nunca infere concessões duradouras.

## 🧑‍💻 Desenvolvimento

```sh
pnpm install                # node ^22.19 || >=24
pnpm run typecheck          # tsc, src + testes
pnpm test                   # vitest: 61 testes, 6 suítes
pnpm run build              # declarações tsc + bundles tsdown (lib/)
pnpm run verify:self-contained
pnpm pack                   # artefato de publicação
```

Estrutura do repositório (estrutura plugin-template): `src/index.ts` (contrato do plugin) · `src/config.ts` (schema Schemastery + resolução) · `src/runtime.ts` (answerer, comando, injeção do motivo de negação) · `src/review.ts` (orquestração do revisor, prompt, redação) · `src/events.ts` (vocabulário de eventos de sessão + folds) · `src/invariant.ts` (companion de invariantes) · `test/` · `fixtures/`.

## 📄 Licença

[Apache License 2.0](LICENSE)
