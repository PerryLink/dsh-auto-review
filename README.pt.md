<div align="center">

# 🤖 dsh-auto-review

**Aprovação por IA de segundo modelo para o DeepSeek Harness — um subagente revisor somente leitura decide permitir/negar na cadeia de aprovação, com falha fechada por padrão.**

*Quando uma ação cruza a fronteira do sandbox, um segundo modelo lê as evidências e devolve um veredito com a razão — para que humanos não aprovem nada e nada inseguro passe despercebido.*

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

## Compatibilidade

| Superfície | Status |
|---|---|
| Harness | DeepSeek Harness `0.1.1-rc.2` (dependências fixadas em `0.1.1-rc.2`; peers `>=0.1.0-rc.8 <0.2.0`) |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Plataformas | Todas (answerer de host; painel web opcional via capacidade de projeção de sessão) |
| Modelo | Qualquer (o revisor herda a rota do agente da sessão; `reviewerModel` sobrescreve) |

## O que você recebe

O `dsh-auto-review` coloca um segundo modelo na cadeia de answerers de `approval/request`:

1. **Costura oficial** — um answerer que reivindica apenas as solicitações que lhe pertencem (política `ai`) e delega todo o resto via `next()`; o fluxo de aprovação humana nunca é curto-circuitado.
2. **Subagente revisor somente leitura** — um fork de uso único com uma lista de permissões de ferramentas `read`/`glob`/`grep` devolve um veredito estruturado `{ decision, reason, riskLevel }`. As solicitações do revisor são reconhecidas por identidade e delegadas; `maxDepth` + a lista de permissões mantêm o revisor sem delegar.
3. **Falha fechada** — falha, timeout ou incompatibilidade de esquema do revisor se resolvem via `fallbackPolicy` (padrão `rejected`); um veredito de negação devolve a razão ao modelo chamador.
4. **Roteamento por configuração** — políticas por ferramenta (`ai`/`human`/`never`) mais regras de risco com regex, tudo alterável no cordis.yml.
5. **Razões de negação chegam ao modelo** — a razão do revisor é injetada no resultado da ferramenta negada (vinculada por callId); rejeições de fallback e de política `never` também injetam marcadores auditáveis (`[auto-review]` / `[auto-review-fallback]` / `[auto-review-never]`).
6. **Trilha de auditoria completa** — eventos de sessão somente-log `autoReview/verdict` + `autoReview/rejection` (envelope `ignorable: true`) mais um companheiro invariant opcional que impõe marcador ⟺ evento.
7. **Controles de segurança** — um disjuntor de rejeições (3 negações consecutivas, ou 6 dos últimos 10 vereditos, por turno), uma política por nível de risco, uma anulação de uso único `/auto-review approve` e uma desativação dura de política `never` que se explica ao modelo.
8. **Contexto opcional do revisor** — uma transcrição compacta limitada (`contextBudget`) mais uma política de decisão em Markdown estilo Codex (`reviewerPolicyText`).

Cada decisão se reconstrói a partir do log da sessão: `approval/asked` → `autoReview/verdict` (ou `autoReview/rejection`) → `approval/decided`.

## Por que um segundo modelo em vez de regras?

Aprovadores automáticos baseados em padrões decidem antes do despacho, sem evidências. O `dsh-auto-review` entrega a decisão a um **subagente revisor** que lê o workspace real (por meio de sua interface de ferramentas somente leitura), os argumentos da chamada de ferramenta já transmitidos (valores sensíveis redigidos), a razão da solicitação e suas regras de risco — e devolve um veredito estruturado. Um veredito de negação devolve a **razão ao modelo chamador**, para que o agente aprenda o porquê em vez de tentar novamente às cegas.

## Início rápido

```sh
# 1. instale o bundle no seu perfil
dsh plugin --profile web add "github:PerryLink/dsh-auto-review#main"

# ou pelo npm (versões publicadas)
dsh plugin --profile web add dsh-auto-review

# 2. reinicie e verifique a linha
dsh --profile web --dump-config | grep -A4 'id: auto-review'
```

Pronto para uso, o patch enviado revisa com IA `bash` e `write`; todas as outras ferramentas (incluindo `edit` — modificação no local) delegam para a cadeia humana. Adicione `edit: ai` explicitamente se você aceitar edições no local sem um humano no loop.

## Instalar e desinstalar

- **Canal git** (último `main`): `dsh plugin --profile web add "github:PerryLink/dsh-auto-review#main"` — o build isolado do `prepare` precisa da única chave `allowBuilds: { esbuild: true }` que o CLI do `dsh` imprime para o `dsh-auto-review`.
- **Canal npm** (versões publicadas): `dsh plugin --profile web add dsh-auto-review`.
- **Canal tarball**: `pnpm pack` neste repo e depois `dsh plugin --profile web add ./dsh-auto-review-<version>.tgz`.
- **Desinstalar**: `dsh plugin --profile web remove dsh-auto-review` (ou remova a linha do patch de perfil).

## Configuração

Todos os ajustes são campos Schemastery `Config` (alteráveis no cordis.yml). Uma anulação direcionada por id substitui a linha inteira — repita cada chave de que você precisa.

| Chave | Padrão | Significado |
|---|---|---|
| `enableByDefault` | `true` | Sessões começam com auto-review ativo; `/auto-review on\|off` grava uma anulação durável que prevalece sobre isto |
| `toolsPolicy.default` | `human` | Política para ferramentas não listadas (delega ao answerer humano) |
| `toolsPolicy.overrides` | `{}` | Política por ferramenta: `ai` / `human` / `never` |
| `riskRules` | `[]` | `{pattern, policy, field?}` emparelhado antes da tabela de ferramentas; `field` escolhe `reason` (padrão), `toolName` ou `arguments` |
| `reviewerProvider` | `fork` | Provedor de subagente do revisor (backend fork em processo) |
| `reviewerModel` | *(herdado)* | Id do modelo revisor; se vazio, herda a rota do agente da sessão |
| `reviewerTimeoutMs` | `60000` | Prazo do veredito; ao expirar, aplica-se a política de fallback |
| `reviewerTools` | `[read, glob, grep]` | Lista de permissões de ferramentas do filho revisor (deve ser não vazia) |
| `fallbackPolicy` | `rejected` | Falha do revisor: `rejected` (falha fechada) / `delegate` / `allow-once` |
| `maxReviewsPerTurn` | `10` | Orçamento de vereditos de IA reais por turno aberto; além disso, as solicitações delegam |
| `maxFailuresPerTurn` | `10` | Orçamento de falhas do revisor por turno aberto |
| `reasonMaxChars` | `2000` | Limite para razões do revisor e a prévia de argumentos redigida |
| `reviewerGuidance` | *(nenhuma)* | Orientação opcional anexada ao prompt do revisor |
| `reviewerPolicyText` | *(nenhuma)* | Política de decisão em Markdown injetada no prompt do revisor (estilo Codex) |
| `denyGuidance` | *(texto anti-elusão)* | Orientação anexada a cada razão de negação injetada |
| `contextBudget` | `{turns: 0, maxChars: 4000}` | Orçamento de transcrição compacta para o prompt do revisor; `turns: 0` desativa |
| `riskPolicy` | `{maxAutoAllow: high, onHighRisk: delegate}` | Vereditos `allow` acima de `maxAutoAllow` delegam ou negam |
| `circuitBreaker` | `{consecutiveDenies: 3, windowDenies: 6, windowSize: 10, action: delegate}` | Disjuntor de rejeições |
| `overrideTtlMs` | `300000` | Quanto tempo dura uma anulação de `/auto-review approve` |
| `language` | `en` | Idioma da UI da saída do comando `/auto-review` (`en` \| `zh`) |
| `allowUnmarkedAudit` | `false` | Força a auditoria do registro de sessão em hosts que descartam o marcador `ignorable` (perigoso: eventos sem marcador tornam sessões irrecuperáveis em outros hosts); o padrão é detectar e degradar |

Exemplo (forma completa anotada: `fixtures/config/config-full.yaml`):

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

## Ferramentas e superfícies

| Superfície | Tipo | Notas |
|---|---|---|
| `auto-review` | answerer | Answerer da cascata `approval/request` — reivindica solicitações de política `ai`, delega o resto via `next()` |
| `/auto-review` | comando | `on\|off\|status\|approve [n]` — anulação durável por sessão, orçamentos e estatísticas acumuladas |
| Injeção de razão de negação | listener | `tools/post-execute` — razões de veredito / fallback / `never` devolvidas ao resultado da ferramenta negada |
| `autoReview` | projeção de sessão | Dobrada a partir dos eventos somente-log `autoReview/*` |
| Painel web de revisão | cliente | Ação no cabeçalho da sessão: interruptor, orçamentos, estatísticas, vereditos recentes, aprovação de uso único |
| `dsh-eval` | CLI | Motor de avaliação de agentes baseado em YAML (`bin/dsh-eval.mjs`) |
| Companheiro invariant | invariant | `dsh-auto-review/invariant` (opcional; precisa do serviço `invariants`) |

## Comando de sessão

```
/auto-review on|off|status|approve [n]
```

`on`/`off` anexam a anulação durável `autoReview/state` (a dobra sobrevive a reinício/retomada — a repetição É o estado) e injetam um aviso de mudança que o modelo vê (registrado como um evento `user/message`). `status` relata o estado efetivo, ambos os orçamentos por turno (vereditos de IA e falhas do revisor), um disjuntor disparado quando há um ativo e as estatísticas acumuladas da sessão (permissões/negações/fallbacks/rejeições `never`, duração média, vereditos recentes). `approve [n]` registra uma anulação `autoReview/override` de uso único para a n-ésima negação mais recente (1 = mais recente): a próxima revisão da mesma ferramenta dentro de `overrideTtlMs` carrega a autorização como contexto do revisor — o revisor ainda decide, e a anulação é consumida por essa revisão independentemente do resultado.

## Painel web de revisão

Na GUI web (perfil web), o pacote contribui uma ação no cabeçalho da sessão (**AI Review**) que abre um painel com o estado de auto-review da sessão: o interruptor com botões on/off (eles executam `/auto-review on|off`), ambos os orçamentos por turno, estatísticas acumuladas (incluindo rejeições por desativação dura), o disparo do disjuntor, os vereditos recentes e botões **approve** de uso único para negações recentes (eles executam `/auto-review approve [n]`).

Como está conectado:

- O host registra uma **projeção de sessão** `autoReview` (dobrada a partir dos eventos somente-log `autoReview/*`) e a serve pelo canal de projeção de sessão.
- A metade do navegador é um **módulo cliente** (auto-descoberto a partir da declaração `dsh.client`) registrado no assento `conversation.session.header.actions`.
- Nenhuma linha de patch extra é necessária: o painel carrega sempre que o plugin está instalado em um perfil cujo build web fornece a capacidade de projeção de sessão (o perfil web fornece). Sem essa capacidade, o painel se declara indisponível; o answerer não é afetado.

O painel lê apenas valores inteiros da projeção — ele nunca recebe o fluxo bruto de eventos da sessão.

## Como funciona

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

**Ordem de composição.** O answerer roda em sua posição de registro na cascata: se um answerer de UI humana for composto ANTES da linha `auto-review`, os humanos respondem primeiro e o revisor só vê o que é delegado adiante. Verifique com `dsh --profile <name> --dump-config` e coloque a linha `auto-review` antes de suas linhas de answerer humano quando quiser que as ferramentas de política ai sejam roteadas primeiro ao revisor.

## dsh-eval — motor de avaliação de agentes

Além do revisor de aprovação, o `dsh-auto-review` envia o `dsh-eval`: uma plataforma de avaliação de agentes baseada em YAML que roda sessões DSH headless reais (um agente isolado + workspace temporário por caso, a persona oficial Minimal como prompt de sistema de base), coleta o rastro de chamadas de ferramenta do log de eventos da sessão e avalia asserções estruturadas mais uma revisão opcional de segundo modelo — a mesma costura de revisor do answerer de aprovação.

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

Execute-o (uma chave de API da DeepSeek deve estar no ambiente):

```sh
dsh-eval eval/cases --model deepseek-v4-flash --timeout-ms 240000 --out .eval-reports
```

### Famílias de asserção

O bloco `expect` suporta seis famílias de asserção; cada asserção é avaliada de forma independente e informa seu próprio aprovação/falha com valores esperados/reais, de modo que um caso que falha se explica sozinho sem nova execução.

| Família | Chaves DSL | O que valida |
|---|---|---|
| Rastro de ferramentas | `toolCalls`, `toolCallsExact`, `noToolCalls`, `results` | sequência ordenada de chamadas (subsequência com saltos), sequência exata de nomes, resultado por ferramenta (`isError`/`contains`/`regex`) |
| Saída e orçamento | `output`, `turnEnds`, `maxTokens` | substring/regex da saída final, resultado do turno, orçamento de tokens |
| Regressão de prompt | `prompt` | o prompt de sistema renderizado deve corresponder a um `baseline` confirmado (ou um arquivo `baselineFrom`); qualquer deriva é relatada como um **diff lado a lado**, com regex `allowedChanges` para permitir edições intencionais |
| Métricas de estresse | `stress` | latência de passo P99 (`maxP99Ms`), pior tempo até o primeiro token (`maxTtftMs`), velocidade agregada de geração de tokens (`minTokensPerSecond`) |
| Equidade | `bias` | radar de viés sobre a saída final: contagens por categoria com regex (`categories`), padrões `forbid` rígidos, tetos `maxHits`/`maxCategoryHits` |
| Revisão de segundo modelo | `review` | um veredito aprovação/falha complementar do subagente revisor (camada separada, a mesma costura do revisor de aprovação) |

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

Portão de CI: o processo sai com 0 somente quando todos os casos de todas as suítes passam — avaliações que falharem fazem o build falhar. Cada caso deixa um JSONL de sessão reproduzível e um JSON de rastro ao lado de `report.md`/`report.json`; resultados de asserção (incluindo o diff lado a lado do prompt), uso de tokens, métricas de estresse/equidade e o veredito de revisão são todos gravados nos arquivos de relatório.

```yaml
- name: dsh-eval
  run: npx dsh-eval eval/cases --model deepseek-v4-flash --timeout-ms 240000 --out .eval-reports
  env:
    DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
```

`dsh-eval` difere de [openai/codex-research](https://github.com/openai/codex-research): o codex-research pontua trajetórias de agentes para comparação de pesquisa; `dsh-eval` é um harness declarativo de regressão aprovação/falha — casos YAML, asserções estruturadas de rastro/prompt/estresse/equidade, uma revisão opcional de segundo modelo e um código de saída de CI — para gatear qualquer agente DSH, não para ranking de pesquisa.

## Permissões e dados

- **Permissões**: o manifesto do workshop declara `session:append`, `approval:answer`, `subagent:spawn`, `command:register` e `tools:observe`.
- **Dados**: nada é gravado em disco; o buffer circular de relatórios fica em memória e é limitado. Sem requisições de rede próprias.
- **Log de sessão**: os eventos `autoReview/*` carregam identidade do revisor, veredito, razão, risco e duração — anexados com o marcador de envelope `ignorable: true` para que qualquer build carregue o log. Hosts cujo `Session.append` é anterior ao marcador (todas as linhas rc publicadas até `0.1.1-rc.2` — nenhuma versão o estampa ainda) são detectados antes do primeiro append (pré-checagem da versão do peer e, em seguida, sondagem do envelope retornado) e a auditoria degrada para um espelho em memória com feedback sem marcador, mantendo as sessões carregáveis em qualquer lugar.

## Limites de segurança

- **O revisor é um modelo.** Seus vereditos são política consultiva, não um núcleo de segurança; prefira regras `human`/`never` para operações irreversíveis.
- **Falha fechada.** Todo caminho anômalo (provedor ausente, lacunas de capacidade, rejeição ao iniciar, timeout, razão de parada não `completed`, veredito ausente/malformado, falha de correlação de auditoria) se resolve via `fallbackPolicy`, padrão `rejected` — e a rejeição devolve uma razão auditável ao modelo. `allow-once` concede incondicionalmente; existe apenas para implantações desatendidas cujo administrador aceita esse risco.
- **Revisor somente leitura.** A lista de permissões `toolFilter` do revisor (`read`/`glob`/`grep`) não pode escrever, editar, executar bash, acessar a rede nem delegar (`maxDepth` = sua própria profundidade). Seu log de sessão é persistido e auditável.
- **Argumentos sensíveis são redigidos** (correspondência por nome de chave: `token`, `password`, `api_key`, `Authorization`, credenciais, chaves privadas …) antes de entrar no prompt do revisor; o plugin nunca executa os argumentos revisados. A redação é baseada em chave, não em conteúdo — não revise com IA ferramentas cujos valores de argumento você não pode se dar ao luxo de mostrar a um modelo.
- **Desativações duras se explicam.** Uma ferramenta ou regra de risco `never` rejeita de forma determinística E registra um evento somente-log `autoReview/rejection`, e então injeta um marcador `[auto-review-never]` no resultado da ferramenta negada — o modelo aprende que a ação está duramente desativada em vez de tentar novamente (verificado por invariant: marcador ⟺ evento).
- **Disjuntor de rejeições.** Uma sequência de negações em um turno dispara o disjuntor (`consecutiveDenies` / `windowDenies` dentro de `windowSize`), registrada como um evento somente-log `autoReview/circuit`; solicitações posteriores seguem sua `action` (`delegate` / `reject` / `abort-turn`).
- **O contexto do revisor é transcrição apresentada.** `contextBudget` alimenta o revisor com conteúdo de sessão já apresentado. Com o modelo revisor da mesma rota por padrão, esse conteúdo permanece dentro de um provedor; configure `reviewerModel` para um provedor diferente apenas se você aceitar apresentar essa transcrição a ele.
- **`never` é unidirecional nesta camada.** Uma ferramenta ou regra de risco `never` rejeita antes que a cadeia humana veja a solicitação — um controle de bloqueio, não um padrão.

## Limitações conhecidas

- O revisor precisa de uma rota LLM funcional (herdada por padrão); sem ela, cada revisão cai conforme `fallbackPolicy` — nunca uma concessão silenciosa.
- Os nomes em `reviewerTools` devem existir como ferramentas globais no perfil; um nome desconhecido faz o filho revisor falhar em voz alta no ponto mais cedo e cai em fallback.
- Regras de risco emparelham o `reason` da solicitação, o `toolName` ou os `arguments` redigidos da chamada conforme seu `field`; outras condições pertencem a `toolsPolicy.overrides`.
- A anulação `/auto-review approve` autoriza a próxima revisão da mesma ferramenta, não a chamada histórica exata; uma ação diferente na mesma ferramenta a consome.
- Os eventos de veredito são somente-log; o painel web de revisão lê a projeção `autoReview` dobrada (o fluxo bruto de eventos nunca chega aos plugins do navegador).
- `autoReview/state` e `autoReview/verdict` são anexados com o marcador de envelope `ignorable: true` em hosts que o respeitam, para que qualquer build do harness carregue o log — leitores que não conhecem os tipos fora do repo simplesmente pulam esses registros. Em hosts rc publicados (rc.1–rc.8) o runtime detecta o marcador descartado e nunca escreve esses eventos (o espelho em memória mantém o comando, os orçamentos, o disjuntor e `approve` durante a sessão); sessões já poluídas por versões anteriores a 0.5.1 podem ser reparadas com `scripts/repair-session-logs.mjs` de `dsh-permission-rules` (seu conjunto padrão cobre os cinco tipos de evento `autoReview/*`).
- O canal git precisa da única chave `allowBuilds` que o CLI do `dsh` imprime para o próprio `dsh-auto-review`. O repo envia seu próprio `pnpm-workspace.yaml` com `allowBuilds: { esbuild: true }`; `typescript` + `tsdown` são `dependencies` regulares.
- O companheiro invariant opcional precisa do serviço `invariants` (composições agent-spine como headless/ACP); o perfil web simples não o fornece, então a linha é enviada comentada no patch do bundle.

## Trabalho relacionado

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) — classificador allow/deny de dois estados na cascata `tools/pre-execute` com auditoria em arquivo de log. O `dsh-auto-review` difere deliberadamente: cadeia de **answerer** oficial, sempre delega o que não lhe pertence, segundo modelo somente leitura com veredito estruturado, razões de negação devolvidas ao modelo, auditoria no log de sessão.
- [ACP automation bridge](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/acp/acp) — decisões de máquina de uso único para seus próprios agentes de ACP. O `dsh-auto-review` é escopado por sessão e política de ferramenta para o harness interativo; ele nunca infere concessões duráveis.

## Desenvolvimento

```sh
pnpm install                # node ^22.19 || >=24
pnpm run typecheck          # tsc: src + tests contra o checkout local do harness
pnpm test                   # vitest: 190 testes, 14 arquivos
pnpm run build              # declarações tsc + bundles tsdown (lib/, incluindo o bundle de cliente)
pnpm run verify:self-contained
pnpm pack                   # o tarball publicado
```

Layout do repositório: `src/index.ts` (contrato do plugin) · `src/config.ts` (esquema Schemastery + resolução) · `src/runtime.ts` (answerer, comando, injeção de razão de negação) · `src/review.ts` (orquestração do revisor, prompt, sanitização) · `src/events.ts` (vocabulário de eventos de sessão + dobras) · `src/projection.ts` + `src/projection-types.ts` (a projeção de sessão `autoReview`) · `src/invariant.ts` (companheiro invariant) · `src/eval/` (o motor dsh-eval) · `eval/` (composição de avaliação enviada) · `bin/dsh-eval.mjs` (lançador CLI) · `src/client/` (metade do navegador) · `test/` · `fixtures/`.

## Tópicos

`deepseek-harness`, `dsh`, `dsh-plugin`, `cordis`, `approval`, `auto-review`, `second-model`, `ai-safety`, `sandbox`, `subagent`

## Contribuidores

- [@PerryLink](https://github.com/PerryLink) — criador e mantenedor: o answerer de aprovação, o subagente revisor, a política de risco e o disjuntor, o painel de revisão por projeção de sessão, o companheiro invariant, o dsh-eval e a documentação em cinco idiomas.

## Família de Plugins DSH PerryLink

Este projeto é um dos plugins do DeepSeek Harness mantidos por [PerryLink](https://github.com/PerryLink). Se este ajuda você, os outros provavelmente também ajudarão:

| Plugin | Em uma linha |
|---|---|
| [dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel) | Painel de tempo de execução MCP somente leitura: comando /mcp + aba Settings com status, ferramentas e erros |
| [dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck) | Guardião de disciplina de engenharia: sabatina de requisitos, portões de teste, revisão adversária |
| [dsh-background-agents](https://github.com/PerryLink/dsh-background-agents) | Agentes filhos em segundo plano duráveis com barra lateral de UI web, mensagens e interrupção |
| [dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions) | Diagnósticos, formatação, autocompletar, ações de código e renomeação LSP sobre servidores de linguagem |
| [dsh-output-styles](https://github.com/PerryLink/dsh-output-styles) | Troca de estilo em tempo de execução equivalente ao outputStyles do Claude Code |
| [dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind) | Equivalente ao /rewind do Claude Code: instantâneos, bifurcações de sessão, restauração de uso único |
| [dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules) | Regras de permissão declarativas allow/deny/ask estilo Claude Code com auditoria |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | Auto-revisão de segundo modelo na cadeia de aprovação, com falha fechada por padrão |
| [dsh-memento](https://github.com/PerryLink/dsh-memento) | Memória entre sessões controlada por aprovação: costura ctx.memory + SQLite + ferramenta de memória |
| [dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security) | Pacote de habilidades de auditoria de segurança: varredura de segredos, revisão de dependências e cadeia de suprimentos |
| [dsh-session-pin](https://github.com/PerryLink/dsh-session-pin) | Fixe sessões na barra lateral web com ordenação durável |
| [dsh-composer-history](https://github.com/PerryLink/dsh-composer-history) | Histórico de entrada estilo terminal para o compositor web: setas, busca Ctrl+R |
| [dsh-github](https://github.com/PerryLink/dsh-github) | Integração de PR/issues do GitHub para o DSH, cada escrita controlada por aprovação |
| [dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide) | Base de conhecimento de desenvolvimento de plugins como habilidade de agente sob demanda |
| [dsh-claude-move](https://github.com/PerryLink/dsh-claude-move) | Migre sessões, memória, habilidades e CLAUDE.md do Claude Code para o DSH |

## Licença

[Apache License 2.0](LICENSE) © 2026 dsh-auto-review contributors
