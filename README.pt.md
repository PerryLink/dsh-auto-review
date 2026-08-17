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
| Harness | DeepSeek Harness `0.1.0-rc.6` (peers fixados em `0.1.0-rc.6`) |
| Node | `^22.19.0 \|\| >=24.0.0` |
| Plataformas | Todas (answerer de host; painel web opcional via capacidade de projeção de sessão) |
| Modelo | Qualquer (o revisor herda a rota do agente da sessão; `reviewerModel` sobrescreve) |

## O que você recebe

O `dsh-auto-review` coloca um segundo modelo na cadeia de answerers de `approval/request`:

1. **Costura oficial** — um answerer que reivindica apenas as solicitações que lhe pertencem (política `ai`) e delega todo o resto via `next()`; o fluxo de aprovação humana nunca é curto-circuitado.
2. **Subagente revisor somente leitura** — um fork de uso único com lista de permissões de ferramentas `read`/`glob`/`grep` devolve um veredito estruturado `{ decision, reason, riskLevel }`.
3. **Falha fechada** — falha, timeout ou incompatibilidade de esquema do revisor se resolvem via `fallbackPolicy` (padrão `rejected`); um veredito de negação devolve a razão ao modelo chamador.
4. **Roteamento por configuração** — políticas por ferramenta (`ai`/`human`/`never`) mais regras de risco com regex, tudo modificável no cordis.yml.
5. **Trilha de auditoria completa** — eventos de sessão somente-log `autoReview/verdict` + `autoReview/rejection` (envelope `ignorable: true`) mais um companheiro invariant opcional.
6. **Controles de segurança** — disjuntor de rejeições, política por nível de risco, anulação de uso único `/auto-review approve` e uma desativação dura `never` que se explica ao modelo.

Cada decisão se reconstrói a partir do log da sessão: `approval/asked` → `autoReview/verdict` (ou `autoReview/rejection`) → `approval/decided`.

## Início rápido

```sh
# 1. instale o bundle no seu perfil
dsh plugin --profile web add "github:PerryLink/dsh-auto-review#main"

# ou pelo npm (versões publicadas)
dsh plugin --profile web add dsh-auto-review

# 2. reinicie e verifique a linha
dsh --profile web --dump-config | grep -A4 'id: auto-review'
```

Pronto para uso, o patch revisa com IA `bash` e `write`; todas as outras ferramentas delegam para a cadeia humana.

## Instalar e desinstalar

- **Canal git** (último `main`): `dsh plugin --profile web add "github:PerryLink/dsh-auto-review#main"` — o build isolado do `prepare` precisa da única chave `allowBuilds: { esbuild: true }` que o CLI do `dsh` imprime para o `dsh-auto-review`.
- **Canal npm** (versões publicadas): `dsh plugin --profile web add dsh-auto-review`.
- **Canal tarball**: `pnpm pack` neste repo e depois `dsh plugin --profile web add ./dsh-auto-review-<version>.tgz`.
- **Desinstalar**: `dsh plugin --profile web remove dsh-auto-review` (ou remova a linha do patch de perfil).

## Configuração

Todos os ajustes são campos Schemastery `Config` (alteráveis no cordis.yml). Uma anulação direcionada por id substitui a linha inteira — repita cada chave de que você precisa.

| Chave | Padrão | Significado |
|---|---|---|
| `enableByDefault` | `true` | Sessões começam com auto-review ativo; `/auto-review on\|off` grava uma anulação durável que prevalece |
| `toolsPolicy.default` | `human` | Política para ferramentas não listadas (delega ao answerer humano) |
| `toolsPolicy.overrides` | `{}` | Política por ferramenta: `ai` / `human` / `never` |
| `riskRules` | `[]` | `{pattern, policy, field?}` emparelhado antes da tabela de ferramentas; `field` escolhe `reason` (padrão), `toolName` ou `arguments` |
| `reviewerProvider` | `fork` | Provedor de subagente do revisor (backend fork em processo) |
| `reviewerModel` | *(herdado)* | Id do modelo revisor; se vazio, herda a rota do agente da sessão |
| `reviewerTimeoutMs` | `60000` | Prazo do veredito; ao expirar, aplica-se a política de fallback |
| `reviewerTools` | `[read, glob, grep]` | Lista de permissões de ferramentas do filho revisor (deve ser não vazia) |
| `fallbackPolicy` | `rejected` | Falha do revisor: `rejected` (falha fechada) / `delegate` / `allow-once` |
| `maxReviewsPerTurn` | `10` | Orçamento de vereditos de IA reais por turno aberto; além disso, delega |
| `maxFailuresPerTurn` | `10` | Orçamento de falhas do revisor por turno aberto |
| `reasonMaxChars` | `2000` | Limite para razões do revisor e a prévia de argumentos redigida |
| `reviewerGuidance` | *(nenhuma)* | Orientação opcional anexada ao prompt do revisor |
| `reviewerPolicyText` | *(nenhuma)* | Política Markdown injetada no prompt do revisor (estilo Codex) |
| `denyGuidance` | *(texto anti-elusão)* | Orientação anexada a cada razão de negação injetada |
| `contextBudget` | `{turns: 0, maxChars: 4000}` | Orçamento de transcrição compacta para o prompt do revisor; `turns: 0` desativa |
| `riskPolicy` | `{maxAutoAllow: high, onHighRisk: delegate}` | Vereditos `allow` acima de `maxAutoAllow` delegam ou negam |
| `circuitBreaker` | `{consecutiveDenies: 3, windowDenies: 6, windowSize: 10, action: delegate}` | Disjuntor de rejeições |
| `overrideTtlMs` | `300000` | Quanto tempo dura uma anulação de `/auto-review approve` |
| `language` | `en` | Idioma da UI da saída do comando `/auto-review` (`en` \| `zh`) |

## Ferramentas e superfícies

| Superfície | Tipo | Notas |
|---|---|---|
| `auto-review` | answerer | Answerer da cascata `approval/request` — reivindica solicitações de política `ai`, delega o resto via `next()` |
| `/auto-review` | comando | `on\|off\|status\|approve [n]` — anulação durável, orçamentos e estatísticas acumuladas |
| Injeção de razão de negação | listener | `tools/post-execute` — razões de veredito / fallback / `never` devolvidas ao resultado negado |
| `autoReview` | projeção de sessão | Dobrada a partir dos eventos somente-log `autoReview/*` |
| Painel web de revisão | cliente | Ação no cabeçalho da sessão: interruptor, orçamentos, estatísticas, vereditos recentes, aprovação de uso único |
| `dsh-eval` | CLI | Motor de avaliação de agentes baseado em YAML (`bin/dsh-eval.mjs`) |
| Companheiro invariant | invariant | `dsh-auto-review/invariant` (opcional; precisa do serviço `invariants`) |

## dsh-eval — motor de avaliação de agentes

Além do revisor de aprovação, o `dsh-auto-review` envia o `dsh-eval`: uma plataforma de avaliação de agentes baseada em YAML que roda sessões DSH headless reais (um agente isolado + workspace temporário por caso), coleta o rastro de chamadas de ferramenta do log de eventos da sessão e avalia asserções estruturadas mais uma revisão opcional de segundo modelo — a mesma costura do revisor de aprovação.

```sh
dsh-eval eval/cases --model deepseek-v4-flash --timeout-ms 240000 --out .eval-reports
```

Portão de CI: o processo sai com 0 somente quando todos os casos de todas as suítes passam. Cada caso deixa um JSONL de sessão reproduzível e um JSON de rastro ao lado de `report.md`/`report.json`.

## Permissões e dados

- **Permissões**: o manifesto do workshop declara `session:append`, `approval:answer`, `subagent:spawn`, `command:register` e `tools:observe`.
- **Dados**: nada é gravado em disco; o buffer circular de relatórios fica em memória e é limitado. Sem requisições de rede próprias.
- **Log de sessão**: os eventos `autoReview/*` carregam identidade do revisor, veredito, razão, risco e duração — anexados com o marcador de envelope `ignorable: true`.

## Limites de segurança

- **O revisor é um modelo.** Seus vereditos são política consultiva, não um núcleo de segurança; prefira regras `human`/`never` para operações irreversíveis.
- **Falha fechada.** Todo caminho anômalo se resolve via `fallbackPolicy`, padrão `rejected` — e a rejeição devolve uma razão auditável ao modelo.
- **Revisor somente leitura.** A lista branca `toolFilter` do revisor (`read`/`glob`/`grep`) não pode escrever, editar, executar bash, acessar a rede nem delegar.
- **Argumentos sensíveis são redigidos** (por nome de chave) antes de entrar no prompt do revisor; o plugin nunca executa os argumentos revisados.
- **`never` é unidirecional.** Uma ferramenta ou regra de risco `never` rejeita antes que a cadeia humana veja a solicitação.

## Limitações conhecidas

- O revisor precisa de uma rota LLM funcional (herdada por padrão); sem ela, cada revisão cai conforme `fallbackPolicy` — nunca uma concessão silenciosa.
- Os nomes em `reviewerTools` devem existir como ferramentas globais no perfil; um nome desconhecido faz o filho revisor falhar em voz alta.
- Regras de risco emparelham o `reason`, o `toolName` ou os `arguments` redigidos conforme seu `field`; outras condições pertencem a `toolsPolicy.overrides`.
- A anulação `/auto-review approve` autoriza a próxima revisão da mesma ferramenta, não a chamada histórica exata.
- Os eventos de veredito são somente-log; o painel web lê a projeção `autoReview` dobrada (o fluxo de eventos bruto nunca chega aos plugins do navegador).
- O companheiro invariant opcional precisa do serviço `invariants` (composições agent-spine); o perfil web plano não o fornece.

## Desenvolvimento

```sh
pnpm install                # node ^22.19 || >=24
pnpm run typecheck          # tsc: src + tests contra o checkout local do harness
pnpm test                   # vitest: 190 testes, 14 arquivos
pnpm run build              # declarações tsc + bundles tsdown (lib/, incluindo o bundle de cliente)
pnpm run verify:self-contained
pnpm pack                   # o tarball publicado
```

## Tópicos

`deepseek-harness`, `dsh`, `dsh-plugin`, `cordis`, `approval`, `auto-review`, `second-model`, `ai-safety`, `sandbox`, `subagent`

## Contribuidores

- [@PerryLink](https://github.com/PerryLink) — criador e mantenedor: o answerer de aprovação, o subagente revisor, a política de risco e o disjuntor, o painel de revisão por projeção de sessão, o companheiro invariant, o dsh-eval e a documentação em cinco idiomas.

## Licença

[Apache License 2.0](LICENSE) © 2026 dsh-auto-review contributors
