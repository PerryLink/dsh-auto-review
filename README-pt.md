<div align="center">

# 🤖 dsh-auto-review

**Aprovação por IA de segundo modelo para o DeepSeek Harness — um subagente revisor somente leitura decide permitir/negar na cadeia de aprovação, com falha fechada por padrão.**

*Quando uma ação cruza a fronteira do sandbox, um segundo modelo lê as evidências e devolve um veredito com a razão — para que humanos não aprovem nada e nada inseguro passe despercebido.*

> **Repositório oficial.** Este é o único repositório oficial do dsh-auto-review, mantido por PerryLink. Repositórios de mesmo nome sob outras contas não são afiliados.

[![License](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![Gitee](https://img.shields.io/badge/Gitee-mirror-c71d23?logo=gitee)](https://gitee.com/perrylink/dsh-auto-review)
[![DSH plugin](https://img.shields.io/badge/dsh--plugin-✅-green)](https://github.com/topics/dsh-plugin)
[![dsh-doctor](https://raw.githubusercontent.com/PerryLink/dsh-plugin-doctor/main/badges/PerryLink__dsh-auto-review.svg)](https://github.com/PerryLink/dsh-plugin-doctor#verified-徽章)
[![DSH Market](https://raw.githubusercontent.com/2BingLing/dsh-market/master/assets/readme/badge-listed-en.svg)](https://dsh.market/)
[![Node](https://img.shields.io/badge/node-%5E22.19%20%7C%7C%20%3E%3D24-brightgreen.svg)](#)
[![CI](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-auto-review/ci.yml?branch=main&label=CI)](https://github.com/PerryLink/dsh-auto-review/actions)
[![Version](https://img.shields.io/github/v/tag/PerryLink/dsh-auto-review?label=version)](https://github.com/PerryLink/dsh-auto-review/releases)
[![npm version](https://img.shields.io/npm/v/dsh-auto-review)](https://www.npmjs.com/package/dsh-auto-review)
[![npm downloads](https://img.shields.io/npm/dm/dsh-auto-review)](https://www.npmjs.com/package/dsh-auto-review)
[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-auto-review?metric=downloads&lang=pt)](https://dshfind.com/pt/plugins/PerryLink/dsh-auto-review?ref=badge)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

```sh
dsh plugin --profile <name> add dsh-auto-review
```


</div>

---

**📖 Base de conhecimento do ecossistema** — dados medidos, não marketing: [guia de desenvolvimento · dados de seleção · critérios de manutenção](https://perrylink.github.io/dsh-plugin-guide/).

<!-- star-cta -->
## ⭐ 如果它帮到了你

Este plugin faz parte da [família de plugins DSH](https://github.com/PerryLink) (mais de 40, todos Apache-2.0). Se for útil, **deixe uma estrela**: não desbloqueia nada, mas ajuda a próxima pessoa a encontrá-lo.

*English:* part of a 95 plugin family for DeepSeek Harness. If it is useful, **a star helps the next person find it** — nothing is gated behind it.

## What is dsh-auto-review?

Aprovação por IA de segundo modelo para o DeepSeek Harness — um subagente revisor somente leitura decide permitir/negar na cadeia de aprovação, com falha fechada por padrão.

Quando uma ação cruza a fronteira do sandbox, um segundo modelo lê as evidências e devolve um veredito com a razão — para que humanos não aprovem nada e nada inseguro passe despercebido.

![Diagrama de fluxo de dsh-auto-review: solicitação → política/revisão → veredito.](docs/assets/dsh-auto-review-flow.svg)

*Visão geral do fluxo: solicitação → política/revisão → veredito. Os exemplos abaixo usam a superfície real de comandos.*


*A mesma execução, animada.*

## Compatibilidade

| Superfície | Status |
|---|---|
| Harness | DeepSeek Harness `dsh-v0.2.1-rc.2` (verificado 2026-10-18): `engines.dsh >=0.2.1-0 <0.3.0`; os caminhos de compatibilidade P0 têm testes de regressão. |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Plataformas | Todas (answerer de host; painel web opcional via capacidade de projeção de sessão) |
| Modelo | Qualquer modelo generativo (o revisor herda a rota do agente da sessão; `reviewerModel` sobrescreve), ou o modelo de decisão local não generativo `Phocinae-Largha-150M-v1` (`reviewerBackend: phocinae`) |

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
dsh plugin --profile web add github:PerryLink/dsh-auto-review
```

```sh
# 1. instale o bundle no seu perfil
dsh plugin --profile web add github:PerryLink/dsh-auto-review

# ou pelo npm (versões publicadas)
dsh plugin --profile web add dsh-auto-review

# 2. reinicie e verifique a linha
dsh --profile web --dump-config | grep -A4 'id: auto-review'
```

Pronto para uso, o patch enviado revisa com IA `bash` e `write`; todas as outras ferramentas (incluindo `edit` — modificação no local) delegam para a cadeia humana. Adicione `edit: ai` explicitamente se você aceitar edições no local sem um humano no loop.

## Instalar e desinstalar

- **Canal git** (último `main`): `dsh plugin --profile web add github:PerryLink/dsh-auto-review` — o build isolado do `prepare` precisa da única chave `allowBuilds: { esbuild: true }` que o CLI do `dsh` imprime para o `dsh-auto-review`.
- **Canal npm** (versões publicadas): `dsh plugin --profile web add dsh-auto-review`.
- **Canal 1024 store**: `npm i -g dsh1024` uma vez, depois `dsh1024 plugin --profile web add dsh-auto-review` (conta para o ranking de instalações do [deepseek1024.com](https://deepseek1024.com)).
- **Canal tarball**: `pnpm pack` neste repo e depois `dsh plugin --profile web add ./dsh-auto-review-<version>.tgz`.
- **Desinstalar**: `dsh plugin --profile web remove dsh-auto-review` (ou remova a linha do patch de perfil).

### Exemplos

São os pontos de entrada reais; instale e chame um.

#### Exemplo detalhado

**Comando**

~~~sh
/auto-review status
~~~

**Saída**

~~~text
All-time: 1 allows, 0 denies, 1 fallbacks, 1 never rejects (avg 10 ms per verdict).
Recent verdicts: write: fallback(timeout), bash: allow
~~~

*Observado em `test/command.spec.ts:123-160 (assertions at :158-159)`*

#### Ramo de falha

**Entrada**

~~~text
/auto-review approve 2
~~~

**Saída**

~~~text
No recent denial #2 in this session (0 recorded).
~~~

*Observado em `plugins/dsh-auto-review/src/messages.ts:53; plugins/dsh-auto-review/src/runtime.ts:1039; plugins/dsh-auto-review/test/command.spec.ts:109-113`*

#### Exemplos breves

- `auto-review`
- `dsh-eval`

## Configuração

Todos os ajustes são campos Schemastery `Config` (alteráveis no cordis.yml). Uma anulação direcionada por id substitui a linha inteira — repita cada chave de que você precisa.

| Chave | Padrão | Significado |
|---|---|---|
| `enableByDefault` | `true` | Sessões começam com auto-review ativo; `/auto-review on\|off` grava uma anulação durável que prevalece sobre isto |
| `toolsPolicy.default` | `human` | Política para ferramentas não listadas (delega ao answerer humano) |
| `toolsPolicy.overrides` | `{}` | Política por ferramenta: `ai` / `human` / `never` |
| `riskRules` | `[]` | `{pattern, policy, field?}` emparelhado antes da tabela de ferramentas; `field` escolhe `reason` (padrão), `toolName` ou `arguments` |
| `reviewerProvider` | `fork` | Provedor de subagente do revisor (backend fork em processo) |
| `reviewerPreset` | *(none)* | Id do Agent Preset somente leitura; obrigatório quando o host expõe apenas `startActivation` (0.2.1+) |
| `reviewerModel` | *(herdado)* | Id do modelo revisor; se vazio, herda a rota do agente da sessão |
| `reviewerModelProvider` | *(herdado)* | Rota do provedor LLM para `reviewerModel`; se vazio, herda o provedor do agente da sessão |
| `reviewerBackend` | `agent` | Motor do revisor: `agent` (o revisor generativo) ou `phocinae` (o serviço local de decisão não generativo). Sem definir, é inferido de `reviewerModel`: um id `Phocinae…` seleciona `phocinae` |
| `phocinae.endpoint` | `http://127.0.0.1:8155/v1/systemone` | URL do serviço de decisão Phocinae; somente loopback salvo `phocinae.allowRemoteEndpoint` |
| `phocinae.model` | `Phocinae-Largha-150M-v1` | Nome do modelo servido; um `reviewerModel` Phocinae o seleciona automaticamente |
| `phocinae.timeoutMs` | `5000` | Prazo HTTP por requisição (uma tentativa, sem retry), limitado por `reviewerTimeoutMs` |
| `phocinae.minConfidence` | `0.4` | Piso de confiança calibrada para um `allow`; um allow inseguro passa pelo `fallbackPolicy` em vez de conceder. Medido: 0/53 comandos destrutivos permitidos com 0.4; com 0.35 dois passaram |
| `phocinae.maxStateChars` | `4096` | Limite do estado de decisão renderizado; um estado truncado pode negar mas nunca permitir |
| `phocinae.allowRemoteEndpoint` | `false` | Permitir endpoint não loopback. O estado carrega o texto da chamada revisada, então é uma decisão explícita de saída de dados |
| `reviewerTimeoutMs` | `60000` | Prazo do veredito; ao expirar, aplica-se a política de fallback |
| `reviewerTools` | `[read, glob, grep]` | Lista de permissões de ferramentas do filho revisor (deve ser não vazia) |
| `fallbackPolicy` | `rejected` | Falha do revisor: `rejected` (falha fechada) / `delegate` / `allow-once` |
| `maxReviewsPerTurn` | `10` | Orçamento de vereditos de IA reais por turno aberto; além disso, as solicitações delegam |
| `maxFailuresPerTurn` | `10` | Orçamento de falhas do revisor por turno aberto |
| `reasonMaxChars` | `2000` | Limite para razões do revisor e a prévia de argumentos redigida |
| `reviewerGuidance` | *(nenhuma)* | Orientação opcional anexada ao prompt do revisor |
| `reviewerPolicyText` | *(nenhuma)* | Política de decisão em Markdown injetada no prompt do revisor (estilo Codex) |
| `denyGuidance` | *(texto anti-elusão)* | Orientação anexada a cada razão de negação injetada |
| `contextBudget` | `{turns: 2, maxChars: 4000}` | Orçamento de transcrição compacta para o prompt do revisor (o turno aberto mais o anterior); `turns: 0` desativa a seção — e um revisor cego nega ações autorizadas pelo usuário, então o runtime avisa quando 0 encontra uma política `ai`. O orçamento de caracteres é gasto nas linhas mais recentes |
| `riskPolicy` | `{maxAutoAllow: high, onHighRisk: delegate}` | Vereditos `allow` acima de `maxAutoAllow` delegam ou negam |
| `circuitBreaker` | `{consecutiveDenies: 3, windowDenies: 6, windowSize: 10, action: delegate}` | Disjuntor de rejeições |
| `overrideTtlMs` | `300000` | Quanto tempo dura uma anulação de `/auto-review approve` |
| `verdictCacheTtlMs` | `60000` | Reutiliza um veredito recente para uma impressão `ferramenta + argumentos` idêntica; `0` desativa o cache. Só se aplica com `contextBudget.turns: 0` — um veredito que depende da transcrição não é reproduzível apenas a partir de `ferramenta + argumentos` |
| `verdictCacheMaxEntries` | `256` | Máximo de impressões em cache antes de despejar a mais antiga |
| `language` | `en` | Idioma da UI da saída do comando `/auto-review` (`en` \| `zh`) |
| `allowUnmarkedAudit` | `false` | Força a auditoria do registro de sessão em hosts que descartam o marcador `ignorable` (perigoso: eventos sem marcador tornam sessões irrecuperáveis em outros hosts); o padrão é detectar e degradar (adaptado em 2026-09-02, reverificado contra `0.1.5-rc.2` em 2026-09-11) |

### Revisor local com modelo de decisão (Phocinae, opcional)

`reviewerBackend: phocinae` troca o revisor generativo pelo modelo de decisão local e não generativo **Phocinae-Largha-150M-v1**, servido pelo [`phocinae-server`](https://github.com/Phocinae/phocinae-server) (`POST /v1/systemone`). O modelo responde uma pergunta tipada e nunca gera texto, então uma revisão **não precisa de chave de API, nem da costura `subagents`/`llm`, nem de rede**: um forward (≈21 ms a quente em GPU, ≈1,5 s em CPU single-thread) devolve um rótulo de dano com confiança calibrada.

```yaml
config:
  toolsPolicy: { overrides: { bash: ai } }
  reviewerModel: Phocinae-Largha-150M-v1   # só isto já seleciona o backend Phocinae
  phocinae:
    endpoint: http://127.0.0.1:8155/v1/systemone
    minConfidence: 0.4
  fallbackPolicy: delegate                 # opcional: envia o duvidoso à cadeia humana
```

**É uma camada de veto/triagem, não um aprovador geral.** Só um `harmless` com `answer_confidence >= phocinae.minConfidence` (padrão 0.4) permite. `destructive` nega; `risky`, um `harmless` inseguro e um serviço inalcançável ou malformado passam pelo `fallbackPolicy` (padrão `rejected`, fecha em falha; `delegate` os envia à cadeia humana). O revisor só pergunta sobre **comandos de shell**: um `write`/`edit` ou outra chamada sem argumento `command` escala sem contatar o modelo.

O estado é exatamente `The agent is about to run the shell command "<command>" in its workspace.`, com opções descritas (os `criteria` com que o modelo foi treinado, renderizados no texto da opção porque o contrato HTTP não tem campo `criteria`). Medido em 89 comandos rotulados (53 destrutivos, 36 rotineiros) (2026-10-25, CPU fp32, pesos publicados): **0 de 53 comandos destrutivos permitidos com `0.4`** — 26 negados e 27 escalados — e 5 de 36 comandos rotineiros permitidos; baixar o piso para 0.35 deixou passar dois comandos destrutivos do Windows. O motivo da aprovação, a transcrição e o caminho do workspace **não** são enviados, e o comando passa pela mesma redação de chaves e segredos inline do prompt generativo. O endpoint é somente loopback salvo `phocinae.allowRemoteEndpoint: true`. O backend vale apenas para revisões de aprovação; a camada de revisão do `dsh-eval` continua usando um modelo generativo.

Inicie o serviço uma vez: `pip install phocinae-server` (ou rode o checkout), baixe os pesos no model card e execute `PHOC_MODEL_DIR=<weights-dir> python -m phocinae.main` — ele escuta em `127.0.0.1:8155`; verifique com `curl http://127.0.0.1:8155/health`.

Exemplo (forma completa anotada: `fixtures/config/config-full.yaml`):

```yaml
- insert:
    - id: auto-review
      name: dsh-auto-review
      config:
        toolsPolicy:
          overrides: { bash: ai, write: ai }
        riskRules:
          - pattern: '([Rr][Mm]\s+(-[a-z]+\s+)*/|[Gg][Ii][Tt]\s+push\s+--force)'
            policy: never
          - pattern: 'write'
            policy: never
            field: toolName
        reviewerTimeoutMs: 30000
        fallbackPolicy: delegate
        riskPolicy: { maxAutoAllow: medium, onHighRisk: delegate }
        circuitBreaker: { consecutiveDenies: 3, windowDenies: 6, windowSize: 10, action: delegate }
```

### De onde a configuração realmente vem

**`~/.dsh/settings.yaml` NÃO é uma fonte de configuração para este plugin.** Um bloco `auto-review:` ali não tem efeito nem gera aviso: como todo plugin-função do DSH, `dsh-auto-review` recebe seu `Config` da linha com que o loader o monta — a camada de patch cordis do perfil. (Alguns outros plugins do DSH também leem o serviço de settings, então a inconsistência é fácil de encontrar e o sintoma é indistinguível de o revisor simplesmente negar.)

Coloque a configuração no `cordis.patch.yml` do seu perfil. Uma **substituição direcionada por id troca a linha de config inteira**, então repita cada chave necessária — omitir `toolsPolicy` devolve `bash`/`write` ao padrão do schema, `human`, e o revisor para de rodar por completo:

```yaml
- id: auto-review
  config:
    toolsPolicy:
      overrides: { bash: ai, write: ai }
    contextBudget: { turns: 4, maxChars: 8000 }
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
dsh-eval eval/cases --model deepseek-flash --timeout-ms 240000 --out .eval-reports
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
  run: npx dsh-eval eval/cases --model deepseek-flash --timeout-ms 240000 --out .eval-reports
  env:
    DEEPSEEK_API_KEY: ${{ secrets.DEEPSEEK_API_KEY }}
```

`dsh-eval` difere de [openai/codex-research](https://github.com/openai/codex-research): o codex-research pontua trajetórias de agentes para comparação de pesquisa; `dsh-eval` é um harness declarativo de regressão aprovação/falha — casos YAML, asserções estruturadas de rastro/prompt/estresse/equidade, uma revisão opcional de segundo modelo e um código de saída de CI — para gatear qualquer agente DSH, não para ranking de pesquisa.

## Servidor MCP (autônomo)

O `dsh-auto-review` também inclui um **servidor MCP** stdio (`dsh-auto-review-mcp`) para que clientes MCP externos (Claude, Codex, …) consumam uma rota de revisão determinista sem o harness. Ele fala JSON-RPC 2.0 sobre JSON delimitado por novas linhas (NDJSON): um objeto JSON por linha, sem enquadramento `Content-Length`.

**Limite.** O revisor completo precisa do seam de subagentes do harness e de um segundo modelo, que um processo stdio separado não consegue alcançar. Portanto, o servidor autônomo é **regras deterministas + cache, sem revisão por modelo**:

- `review_action` reutiliza o cache de veredictos por impressão digital (`src/cache.ts`) e a resolução de regras de risco / políticas de ferramentas (`src/config.ts`): uma regra `never` → `deny`; um acerto de cache sobre uma impressão idêntica de `tool + arguments` reproduz esse veredicto; todo o resto (`ai` precisa de modelo, `human` precisa de um humano) → `deny` fail-closed com `reason: "standalone path, no model"`. Ele nunca permite uma ação que um modelo ainda não tenha permitido.
- `cache_stats` informa os contadores de acertos/armazenamento e o estado do TTL.

| Ferramenta | Propósito |
|---|---|
| `review_action` | `{tool, args?, reason?}` → `{decision, reason, riskLevel}` — negação determinista / reprodução de cache |
| `cache_stats` | `{}` → `{hits, stores, size, ttlMs, enabled}` |

Execução direta:

```sh
# as regras de risco vêm de variáveis de ambiente
export DSH_AUTO_REVIEW_RISK_RULES='[{"pattern":"rm -rf","policy":"never","field":"arguments"}]'
node bin/dsh-auto-review-mcp.mjs
# ou, após npm install: npx dsh-auto-review-mcp
```

Configuração por ambiente: `DSH_AUTO_REVIEW_RISK_RULES` (array JSON de `{pattern, policy, field?}`), `DSH_AUTO_REVIEW_TOOLS_POLICY` (JSON `{default?, overrides?}`), `DSH_AUTO_REVIEW_CACHE_TTL_MS`, `DSH_AUTO_REVIEW_CACHE_MAX_ENTRIES`.

Exemplo para o Claude Desktop (`claude_desktop_config.json`):

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

O servidor é somente-leitura e determinista: sem rede, sem modelo, sem gravações.

## Permissões e dados

- **Permissões**: o manifesto do workshop declara `session:append`, `approval:answer`, `subagent:spawn`, `command:register` e `tools:observe`.
- **Dados**: nada é gravado em disco; o buffer circular de relatórios fica em memória e é limitado. Sem requisições de rede próprias.
- **Log de sessão**: os eventos `autoReview/*` carregam identidade do revisor, veredito, razão, risco e duração — anexados com o marcador de envelope `ignorable: true` para que qualquer build carregue o log. Hosts cujo `Session.append` é anterior ao marcador (todas as linhas rc publicadas até `0.1.1-rc.2` — nenhuma versão o estampa ainda) são detectados antes do primeiro append (pré-checagem da versão do peer e, em seguida, sondagem do envelope retornado); os hosts `0.1.2-rc.1`, `0.1.3-alpha.2` e `0.1.5-rc.2` mantêm o campo `ignorable` no envelope, mas o `Session.append` não oferece nenhuma forma de estampá-lo (seu terceiro parâmetro é `SurfaceIntent`, apenas para eventos de superfície), e o caminho de leitura da persistência recusa tipos de evento desconhecidos sem marcação, então essas linhas — e versões irresolvíveis — também falham fechadas antes de qualquer append. A auditoria degrada para um espelho em memória com feedback sem marcador, mantendo as sessões carregáveis em qualquer lugar.

## Limites de segurança

- **O revisor é um modelo.** Seus vereditos são política consultiva, não um núcleo de segurança; prefira regras `human`/`never` para operações irreversíveis.
- **Falha fechada.** Todo caminho anômalo (provedor ausente, lacunas de capacidade, rejeição ao iniciar, timeout, razão de parada não `completed`, veredito ausente/malformado, falha de correlação de auditoria) se resolve via `fallbackPolicy`, padrão `rejected` — e a rejeição devolve uma razão auditável ao modelo. `allow-once` concede incondicionalmente; existe apenas para implantações desatendidas cujo administrador aceita esse risco.
- **Revisor somente leitura.** A lista de permissões `toolFilter` do revisor (`read`/`glob`/`grep`) não pode escrever, editar, executar bash, acessar a rede nem delegar (`maxDepth` = sua própria profundidade). Seu log de sessão é persistido e auditável.
- **Revisor isolado do contexto.** Os passos do filho revisor são filtrados na costura oficial `agent/pre-step`: apenas o seu próprio prompt e os resultados das suas próprias ferramentas somente leitura entram. Arquivos de instruções do workspace (`AGENTS.md` / `CLAUDE.md`) e plugins que injetam contexto são descartados nessa costura; **o instantâneo de contexto de execução do próprio harness é readmitido após `agent/pre-step`, o firewall não o remove e o revisor o vê.** Isso vale sob QUALQUER provedor de subagente — esses produtores injetam de novo em cada sessão de agente, então o que os fecha é o filtro, não a escolha do provedor. A lista de permissões é por ORIGEM da mensagem, então um plugin que declare uma origem nova também é descartado.
- **Argumentos sensíveis são redigidos** (correspondência por nome de chave: `token`, `password`, `api_key`, `Authorization`, credenciais, chaves privadas …) antes de entrar no prompt do revisor, e um argumento de texto livre passa ainda por uma heurística em linha que mascara as formas `KEY=VALUE` / `KEY: VALUE` / `--flag VALUE` e os esquemas `Bearer`/`Basic` — que é como um segredo costuma aparecer numa chamada de shell. O plugin nunca executa os argumentos revisados. Ambas as passadas são de melhor esforço, não um scanner de segredos: um segredo sem chave ao lado continua visível, então não revise com IA ferramentas cujos valores de argumento você não pode se dar ao luxo de mostrar a um modelo.
- **Desativações duras se explicam.** Uma ferramenta ou regra de risco `never` rejeita de forma determinística E registra um evento somente-log `autoReview/rejection`, e então injeta um marcador `[auto-review-never]` no resultado da ferramenta negada — o modelo aprende que a ação está duramente desativada em vez de tentar novamente (verificado por invariant: marcador ⟺ evento).
- **Disjuntor de rejeições.** Uma sequência de negações em um turno dispara o disjuntor (`consecutiveDenies` / `windowDenies` dentro de `windowSize`), registrada como um evento somente-log `autoReview/circuit`; solicitações posteriores seguem sua `action` (`delegate` / `reject` / `abort-turn`).
- **O contexto do revisor é transcrição apresentada.** `contextBudget` alimenta o revisor com conteúdo de sessão já apresentado. Com o modelo revisor da mesma rota por padrão, esse conteúdo permanece dentro de um provedor; configure `reviewerModel` para um provedor diferente apenas se você aceitar apresentar essa transcrição a ele.
- **`never` é unidirecional nesta camada.** Uma ferramenta ou regra de risco `never` rejeita antes que a cadeia humana veja a solicitação — um controle de bloqueio, não um padrão.

## Limitações conhecidas

- **Duas exposições diferentes, duas respostas diferentes — nenhuma substitui a outra.** O contexto *injetado* (arquivos de instruções do workspace, o instantâneo de contexto de execução, injeções de plugins de terceiros) é injetado de novo em cada sessão de agente, então chega ao revisor de forma idêntica com `reviewerProvider: fork` e com `reviewerProvider: spawn` — medido byte a byte idêntico em ambos na mesma requisição. O filtro por origem de `agent/pre-step` é o que o fecha, sob qualquer um dos provedores; **`spawn` sozinho NÃO impede que as instruções do workspace cheguem ao revisor.** À parte, `fork` semeia o filho com os turnos concluídos da sessão delegante: esse histórico já é o log do próprio filho, não uma mensagem entrando em um passo, então o filtro não o alcança e só `spawn` o evita, com a cerca de transcrição não confiável do prompt do revisor como mitigação intermediária. Nos dois traços acima a semeadura não produziu mensagens adicionais, então seu impacto prático não está quantificado.
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
pnpm test                   # vitest: 25 arquivos spec
pnpm run build              # declarações tsc + bundles tsdown (lib/, incluindo o bundle de cliente)
pnpm run verify:self-contained
pnpm pack                   # o tarball publicado
```

Layout do repositório: `src/index.ts` (contrato do plugin) · `src/config.ts` (esquema Schemastery + resolução) · `src/runtime.ts` (answerer, comando, injeção de razão de negação) · `src/review.ts` (orquestração do revisor, prompt, sanitização) · `src/events.ts` (vocabulário de eventos de sessão + dobras) · `src/projection.ts` + `src/projection-types.ts` (a projeção de sessão `autoReview`) · `src/invariant.ts` (companheiro invariant) · `src/eval/` (o motor dsh-eval) · `eval/` (composição de avaliação enviada) · `bin/dsh-eval.mjs` (lançador CLI) · `src/client/` (metade do navegador) · `test/` · `fixtures/`.

## Tópicos

`deepseek-harness`, `dsh`, `dsh-plugin`, `cordis`, `approval`, `auto-review`, `second-model`, `ai-safety`, `sandbox`, `subagent`

## Contribuidores

- [@PerryLink](https://github.com/PerryLink) — criador e mantenedor: o answerer de aprovação, o subagente revisor, a política de risco e o disjuntor, o painel de revisão por projeção de sessão, o companheiro invariant, o dsh-eval e a documentação em cinco idiomas.
- [@weipeng1999](https://github.com/weipeng1999) — propôs o roteamento independente de provedor/modelo do revisor ([#11](https://github.com/PerryLink/dsh-auto-review/issues/11), [discussão #12](https://github.com/PerryLink/dsh-auto-review/discussions/12)), que foi lançado como `reviewerProvider` / `reviewerModel`.
- [@alexchenzl](https://github.com/alexchenzl) — incluiu o plugin no diretório de plugins do DSH ([#10](https://github.com/PerryLink/dsh-auto-review/issues/10)).

## Licença

[Apache License 2.0](LICENSE) © 2026 dsh-auto-review contributors


## Interoperabilidade com outros plugins do DSH

Verificado contra **DSH `0.2.0-rc.2`** (o runtime para o qual este README é publicado) e o conjunto de plugins com mais estrelas pesquisado em 2026-10-05.

Este plugin **não interfere** em outros plugins, incluindo os de mais estrelas:

- **Sem colisão de nome de ferramenta.** Todas as ferramentas têm namespace; nenhuma ocupa um nome puro já pertencente a uma ferramenta embutida ou a outro plugin.
- **Sem colisão de chave de serviço.** Fornece apenas `autoReviewRuntime`; essa chave não é uma costura embutida nem é fornecida por nenhum plugin de mais estrelas.
- **Sem colisão de slot.** Não registra nenhuma chave de slot de cliente, então não disputa um assento `shadows-shipped-ui`.
- **Sem colisão de rota HTTP.** Não registra nenhum prefixo `webServer`.
- **Sem colisão na camada de patch.** O patch do bundle apenas faz `insert` da própria linha; nunca sobrescreve o `config` de uma linha embutida.
- **Sem mutação global.** Não altera protótipos, não reescreve `process.env` nem substitui o dispatcher global de fetch.

**Listeners de eventos compartilhados não interferem por construção.** Observa os eventos sensíveis à ordem `agent/pre-step`, `approval/request`, `tools/post-execute` com `ctx.on()` — o registro de difusão do Cordis, onde cada listener executa e nenhum pode privar outro do turno. **Todos os listeners aqui delegam via `next()`**, então a cadeia nunca é curto-circuitada:
  - `agent/pre-step` — also used by `dsh-routing-suite` (7000★, 7 listeners), `modlens` (4122★), `dsh-purge` (3317★), `dsh-agent-teams` (1923★), `dsh-context` (1849★).
  - `tools/post-execute` — also used by `cc-safety-net` (1576★).

Evidência estática: `dsh-plugin-doctor` K10–K13 retornam `pass` em todas as verificações deste repositório.

## PerryLink DSH Plugin Family

Este projeto faz parte da família de plugins do DeepSeek Harness da [PerryLink](https://github.com/PerryLink). O registro fica recolhido abaixo para que cada README mantenha uma primeira tela curta; expanda para ver cada linha e seu status.

<details>
<summary>Expandir todos os plugins</summary>

| Plugin | Status |
|---|---|
| **[dsh-aqua-input-check](https://github.com/PerryLink/dsh-aqua-input-check)** |  |
| **[dsh-archive-check](https://github.com/PerryLink/dsh-archive-check)** |  |
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** |  |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** |  |
| **[dsh-bid-ca-precheck](https://github.com/PerryLink/dsh-bid-ca-precheck)** |  |
| **[dsh-bid-qual-check](https://github.com/PerryLink/dsh-bid-qual-check)** |  |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** |  |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** |  |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** |  |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** |  |
| **[dsh-contract-stance](https://github.com/PerryLink/dsh-contract-stance)** |  |
| **[dsh-customs-doc-check](https://github.com/PerryLink/dsh-customs-doc-check)** |  |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** |  |
| **[dsh-demurrage-ledger](https://github.com/PerryLink/dsh-demurrage-ledger)** |  |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** |  |
| **[dsh-drill-script-check](https://github.com/PerryLink/dsh-drill-script-check)** |  |
| **[dsh-eia-guide-check](https://github.com/PerryLink/dsh-eia-guide-check)** |  |
| **[dsh-emergency-plan](https://github.com/PerryLink/dsh-emergency-plan)** |  |
| **[dsh-essay-rubric-check](https://github.com/PerryLink/dsh-essay-rubric-check)** |  |
| **[dsh-evidence-check](https://github.com/PerryLink/dsh-evidence-check)** |  |
| **[dsh-export-ctl-check](https://github.com/PerryLink/dsh-export-ctl-check)** |  |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** |  |
| **[dsh-fmea-table-check](https://github.com/PerryLink/dsh-fmea-table-check)** |  |
| **[dsh-forecast-penalty](https://github.com/PerryLink/dsh-forecast-penalty)** |  |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** |  |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** |  |
| **[dsh-gongwen-flow-check](https://github.com/PerryLink/dsh-gongwen-flow-check)** |  |
| **[dsh-gongwen-word-check](https://github.com/PerryLink/dsh-gongwen-word-check)** |  |
| **[dsh-guard-plan-qc](https://github.com/PerryLink/dsh-guard-plan-qc)** |  |
| **[dsh-hazchem-check](https://github.com/PerryLink/dsh-hazchem-check)** |  |
| **[dsh-hazplan-check](https://github.com/PerryLink/dsh-hazplan-check)** |  |
| **[dsh-hidden-risk-map](https://github.com/PerryLink/dsh-hidden-risk-map)** |  |
| **[dsh-hs-classify](https://github.com/PerryLink/dsh-hs-classify)** |  |
| **[dsh-icd-rule-check](https://github.com/PerryLink/dsh-icd-rule-check)** |  |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** |  |
| **[dsh-lawcite-adapter](https://github.com/PerryLink/dsh-lawcite-adapter)** |  |
| **[dsh-laya](https://github.com/PerryLink/dsh-laya)** |  |
| **[dsh-lc-doc-check](https://github.com/PerryLink/dsh-lc-doc-check)** |  |
| **[dsh-learning-gap-check](https://github.com/PerryLink/dsh-learning-gap-check)** |  |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** |  |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** |  |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** |  |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** |  |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** |  |
| **[dsh-medrec-qc](https://github.com/PerryLink/dsh-medrec-qc)** |  |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** |  |
| **[dsh-nsfc-form-check](https://github.com/PerryLink/dsh-nsfc-form-check)** |  |
| **[dsh-nurse-record-check](https://github.com/PerryLink/dsh-nurse-record-check)** |  |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** |  |
| **[dsh-origin-rvc-check](https://github.com/PerryLink/dsh-origin-rvc-check)** |  |
| **[dsh-ota-review-check](https://github.com/PerryLink/dsh-ota-review-check)** |  |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** |  |
| **[dsh-paper-doc-adapter](https://github.com/PerryLink/dsh-paper-doc-adapter)** |  |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** |  |
| **[dsh-permit-report-check](https://github.com/PerryLink/dsh-permit-report-check)** |  |
| **[dsh-pipeline-check](https://github.com/PerryLink/dsh-pipeline-check)** |  |
| **[dsh-pleading-draft](https://github.com/PerryLink/dsh-pleading-draft)** |  |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** |  |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** |  |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** |  |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** |  |
| **[dsh-policy-brief-draft](https://github.com/PerryLink/dsh-policy-brief-draft)** |  |
| **[dsh-power-loss-split](https://github.com/PerryLink/dsh-power-loss-split)** |  |
| **[dsh-power-ticket-check](https://github.com/PerryLink/dsh-power-ticket-check)** |  |
| **[dsh-ppap-check](https://github.com/PerryLink/dsh-ppap-check)** |  |
| **[dsh-protest-deadline](https://github.com/PerryLink/dsh-protest-deadline)** |  |
| **[dsh-railway-window](https://github.com/PerryLink/dsh-railway-window)** |  |
| **[dsh-repair-order-qc](https://github.com/PerryLink/dsh-repair-order-qc)** |  |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** |  |
| **[dsh-review-reply-check](https://github.com/PerryLink/dsh-review-reply-check)** |  |
| **[dsh-rulefile-check](https://github.com/PerryLink/dsh-rulefile-check)** |  |
| **[dsh-safety-brief-check](https://github.com/PerryLink/dsh-safety-brief-check)** |  |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** |  |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** |  |
| **[dsh-site-log-check](https://github.com/PerryLink/dsh-site-log-check)** |  |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** |  |
| **[dsh-soe-decision-check](https://github.com/PerryLink/dsh-soe-decision-check)** |  |
| **[dsh-soilwater-check](https://github.com/PerryLink/dsh-soilwater-check)** |  |
| **[dsh-sop-sync-check](https://github.com/PerryLink/dsh-sop-sync-check)** |  |
| **[dsh-spc-gbt-adapter](https://github.com/PerryLink/dsh-spc-gbt-adapter)** |  |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** |  |
| **[dsh-tender-extract](https://github.com/PerryLink/dsh-tender-extract)** |  |
| **[dsh-tender-matrix](https://github.com/PerryLink/dsh-tender-matrix)** |  |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** |  |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** |  |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** |  |
| **[dsh-warranty-calc](https://github.com/PerryLink/dsh-warranty-calc)** |  |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | 🧊 CONGELADO — ver o README do repositório |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | 🚫 RETIRADO — ver o README do repositório |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | 🚫 RETIRADO — ver o README do repositório |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | 🚫 RETIRADO — ver o README do repositório |

</details>
