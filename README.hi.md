<!-- भाषा लिंक -->
[English](README.md) · [中文](README.zh.md) · [Español](README.es.md) · [Português](README.pt.md) · [हिन्दी](README.hi.md)

<div align="center">

# 🤖 dsh-auto-review

**DeepSeek Harness के लिए द्वितीय-मॉडल AI स्वतः-समीक्षा** — Codex का `approvals_reviewer=auto_review` / Claude Code का *auto mode* पैटर्न, एक शुद्ध Cordis प्लगइन के रूप में।

जब एजेंट की कोई क्रिया sandbox की सीमा पार करती है, तो एक **केवल-पढ़ने वाला समीक्षक सबएजेंट** allow/deny का फ़ैसला करता है — कारण सहित — ताकि इंसान को कुछ भी स्वीकृत न करना पड़े और कुछ भी असुरक्षित चुपचाप न निकल जाए।

[![license](https://img.shields.io/badge/license-Apache%202.0-blue.svg)](LICENSE)
[![dsh](https://img.shields.io/badge/dsh-0.1.0--rc.6-4c51bf.svg)](https://www.npmjs.com/package/@deepseek-ai/dsh)
[![tests](https://img.shields.io/github/actions/workflow/status/PerryLink/dsh-auto-review/ci.yml?label=tests&logo=githubactions)](.github/workflows/ci.yml)
[![typescript](https://img.shields.io/badge/TypeScript-strict-3178c6.svg)](src)
[![type](https://img.shields.io/badge/type-cordis%20bundle-8a5cf6.svg)](cordis.patch.yml)
[![repo](https://img.shields.io/badge/repo-PerryLink%2Fdsh--auto--review-181717.svg)](https://github.com/PerryLink/dsh-auto-review)

**शून्य मानव हस्तक्षेप।** अनुरोध AI समीक्षक के पास जाता है, फ़ैसला allow/deny + कारण + जोखिम स्तर होता है, और हर निर्णय सत्र लॉग से पूरी तरह पुनर्निर्मित किया जा सकता है: `approval/asked` → `autoReview/verdict` → `approval/decided`।

<img src="docs/demo-auto-review.gif" alt="dsh-auto-review डेमो" width="720"/>

*एक वास्तविक साक्ष्य-रन (वास्तविक सर्वर, वास्तविक API कुंजी, दो वास्तविक मॉडल राउंड): AI समीक्षक workspace के अंदर escalated लेखन को **अनुमति** देता है (कम जोखिम, 5.2 s), फिर workspace के बाहर recursive विलोपन को **अस्वीकार** करता है (उच्च जोखिम, 8.9 s) — अस्वीकृति का कारण मॉडल को वापस दिया जाता है और ट्रांसक्रिप्ट में दिखाई देता है।*

</div>

## नियमों के बजाय दूसरा मॉडल क्यों?

पैटर्न-आधारित स्वतः-स्वीकर्ता dispatch से पहले, बिना साक्ष्य के फ़ैसला करते हैं। `dsh-auto-review` निर्णय एक **समीक्षक सबएजेंट** को सौंपता है जो वास्तविक workspace (अपने केवल-पढ़ने वाले टूल-सेट से), पहले से प्रस्तुत टूल-कॉल आर्गुमेंट (संवेदनशील मान हटाकर), अनुरोध का कारण और आपके जोखिम नियम पढ़ता है — फिर एक संरचित फ़ैसला लौटाता है। अस्वीकृति का **कारण कॉल करने वाले मॉडल को वापस** दिया जाता है, ताकि एजेंट अंधाधुंध दोबारा कोशिश करने के बजाय कारण सीखे।

## ✨ विशेषताएँ

| | |
|---|---|
| 🔌 **आधिकारिक seam** | `approval/request` waterfall पर एक answerer। जो अनुरोध उसके नहीं हैं वे `next()` से आगे भेजे जाते हैं — मानव स्वीकृति प्रवाह कभी नहीं रोका जाता। |
| 🧠 **द्वितीय-मॉडल फ़ैसला** | एक बार का fork सबएजेंट, केवल-पढ़ने वाली टूल अनुमति-सूची (`read`/`glob`/`grep`) और संरचित फ़ैसला schema `{ decision, reason, riskLevel }`। |
| 🛡️ **Fail closed** | समीक्षक का क्रैश, टाइमआउट या गलत schema कभी द्वार नहीं खोलता: `fallbackPolicy` लागू होती है, डिफ़ॉल्ट `rejected`। |
| 🧩 **कॉन्फ़िग-चालित रूटिंग** | प्रति-टूल नीतियाँ (`ai`/`human`/`never`) + regex जोखिम नियम, सब cordis.yml से बदले जा सकते हैं। |
| 💬 **अस्वीकृति के कारण मॉडल तक पहुँचते हैं** | समीक्षक का कारण अस्वीकृत टूल के परिणाम में (callId से जुड़ा) डाला जाता है, ताकि एजेंट खुद को ढाल सके। Fail-closed fallback अस्वीकृतियाँ एक ऑडिट-योग्य विफलता पाठ भी डालती हैं। |
| 📜 **पूर्ण ऑडिट शृंखला** | `autoReview/verdict` सत्र-ईवेंट (समीक्षक की पहचान, फ़ैसला, कारण, जोखिम, अवधि) + एक invariant companion जो *model-visible ⟺ logged* लागू करता है। |
| 🔁 **कोई पुनरावृत्ति नहीं** | समीक्षक के अपने अनुरोध पहचान से पहचाने जाते हैं और आगे भेजे जाते हैं; `maxDepth` + अनुमति-सूची समीक्षक को आगे delegation से रोकते हैं। |
| 🧯 **अस्वीकृति circuit breaker** | एक टर्न में 3 लगातार अस्वीकृतियाँ (या पिछले 50 फ़ैसलों में 10) breaker को ट्रिप कर देती हैं: बाद के अनुरोध सौंपे जाते हैं, अस्वीकार होते हैं या टर्न निरस्त होता है — अस्वीकृति का कोई अंतहीन चक्र नहीं। |
| 🎚️ **जोखिम-स्तर नीति** | एक `allow` फ़ैसला जिसका जोखिम `riskPolicy.maxAutoAllow` से ऊपर है, अनुरोध को कभी निपटाता नहीं: वह मानव को सौंपता है या अस्वीकार करता है। |
| ✋ **एक-बार मानव ओवरराइड** | `/auto-review approve [n]` हाल की एक अस्वीकृति के लिए एक बार पुनः-प्रयास अधिकृत करता है; अगली उसी-टूल समीक्षा उस अधिकार को समीक्षक संदर्भ के रूप में ले जाती है (समीक्षक फिर भी फ़ैसला करता है)। |
| 📜 **समीक्षक संदर्भ** | वैकल्पिक संक्षिप्त ट्रांसक्रिप्ट (हाल के संदेश और टूल परिणाम, सीमित) + एक Codex-शैली Markdown `reviewerPolicyText` निर्णय-नीति। |
| ⌨️ **सत्र कमांड** | `/auto-review on|off|status|approve [n]` — टिकाऊ प्रति-सत्र ओवरराइड जो restore के बाद भी बना रहता है और संचयी सत्र आँकड़े। |

## कैसे काम करता है

```text
                       approval/request waterfall (answerer शृंखला)
                        │
┌───────────────────────┴──────────────────────┐
│ dsh-auto-review answerer                     │
│  · सत्र सक्रिय?  · नीति = ai?               │   नहीं ── next() ──▶ मानव answerer (UI)
│  · जोखिम नियम → toolsPolicy → डिफ़ॉल्ट      │
└───────────────────────┬──────────────────────┘
                        │ हाँ
                        ▼
        ┌───────────────────────────────────┐
        │ समीक्षक सबएजेंट (fork, एक बार)     │
        │  · toolFilter: read/glob/grep     │
        │  · outputSchema: {decision,       │
        │    reason, riskLevel}             │
        │  · टाइमआउट + req.signal abort     │
        └───────────────┬───────────────────┘
                        │ फ़ैसला / विफलता (fail-closed fallback)
                        ▼
 allow → allowed-once        deny → rejected + कारण अस्वीकृत टूल के
                                       परिणाम में डाला जाता है
                        │
                        ▼
 ऑडिट: approval/asked → autoReview/verdict → approval/decided
        (सत्र-ईवेंट, log-only, invariant-जाँचित)
```

**संरचना क्रम।** उत्तरदाता waterfall में अपनी पंजीकरण-स्थिति पर चलता है: यदि कोई मानव UI उत्तरदाता `auto-review` पंक्ति से पहले संयोजित है, तो मानव पहले उत्तर देते हैं और समीक्षक केवल वही देखता है जो आगे सौंपा जाता है। `dsh --profile <name> --dump-config` से सत्यापित करें; यदि ai-नीति उपकरण पहले समीक्षक के पास जाने चाहिए, तो `auto-review` पंक्ति को मानव उत्तरदाता पंक्तियों से पहले रखें।

## 🚀 त्वरित शुरुआत

तीन इंस्टॉल चैनल; प्लगइन एक **bundle** है (`"dsh": { "bundle": { "patch": "./cordis.patch.yml" } }`)।

```sh
# 1. npm tarball (पहले से बने आर्टिफ़ैक्ट, बिल्ड अनुमति की ज़रूरत नहीं)
pnpm pack                       # → dsh-auto-review-<version>.tgz
dsh plugin --profile web add ./dsh-auto-review-<version>.tgz
dsh --profile web               # पुनः आरंभ करें

# 2. git स्रोत (commit पिन करें; self-contained `prepare` बिल्ड करता है)
#    pnpm ≥ 10 lifecycle बिल्ड रोकता है: पहले प्रिंट हुई allowBuilds कुंजी को
#    प्रोफ़ाइल के pnpm-workspace.yaml में जोड़ें।
dsh plugin --profile web add "github:PerryLink/dsh-auto-review#<commit>"

# 3. स्थानीय link (विकास)
dsh plugin --profile web add link:/path/to/dsh-auto-review
```

जाँचें:

```sh
dsh --profile web --dump-config | grep -A4 'id: auto-review'
```

डिफ़ॉल्ट पैच में `bash` और `write` AI समीक्षा से गुज़रते हैं; बाकी हर टूल (`edit` — स्थान-स्थान संशोधन — सहित) मानव शृंखला को सौंपा जाता है। यदि आप मानव के बिना स्थान-स्थान संपादन स्वीकार करते हैं तो `edit: ai` स्पष्ट रूप से जोड़ें।

## ⚙️ कॉन्फ़िगरेशन

सभी समायोज्य Schemastery `Config` फ़ील्ड हैं (cordis.yml से बदले जा सकते हैं)। `id`-आधारित ओवरराइड **पूरी config पंक्ति बदल देता है** — ज़रूरी हर कुंजी दोबारा लिखें।

| कुंजी | डिफ़ॉल्ट | अर्थ |
|---|---|---|
| `enableByDefault` | `true` | सत्र auto-review सक्रिय होकर शुरू होते हैं; `/auto-review on\|off` एक टिकाऊ ओवरराइड लिखता है जो इससे ऊपर होता है |
| `toolsPolicy.default` | `human` | सूची से बाहर के टूल की नीति (मानव answerer को सौंपना) |
| `toolsPolicy.overrides` | `{}` | प्रति-टूल नीति: `ai` (समीक्षक तय करे), `human` (मानव अनिवार्य), `never` (निश्चित अस्वीकृति) |
| `riskRules` | `[]` | `{pattern, policy, field?}` — टूल-तालिका से **पहले** मिलान (पहला मिलान जीतता है); `field` `reason` (डिफ़ॉल्ट), `toolName`, या `arguments` (प्रस्तुत redacted कॉल आर्गुमेंट) चुनता है |
| `reviewerProvider` | `fork` | समीक्षक के लिए सबएजेंट provider (इन-प्रोसेस fork बैकएंड) |
| `reviewerModel` | *(विरासत)* | समीक्षक मॉडल id; खाली रहने पर सत्र एजेंट की रूट विरासत में मिलती है |
| `reviewerTimeoutMs` | `60000` | फ़ैसले की समय-सीमा; समाप्त होने पर fallback नीति लागू |
| `reviewerTools` | `[read, glob, grep]` | समीक्षक बच्चे की टूल अनुमति-सूची (गैर-खाली होनी चाहिए) — बाकी सब वहाँ अदृश्य |
| `fallbackPolicy` | `rejected` | समीक्षक विफलता: `rejected` (fail closed), `delegate` (शृंखला जारी), `allow-once` (अनुमति — सुरक्षा देखें)। 0.2.0 में `allow-readonly` से नाम बदला; पुरानी वर्तनी ज़ोर से विफल होती है |
| `maxReviewsPerTurn` | `10` | प्रति खुले टर्न वास्तविक AI-फ़ैसला बजट; खत्म होने पर अनुरोध मानवों को सौंपे जाते हैं |
| `maxFailuresPerTurn` | `10` | प्रति खुले टर्न समीक्षक-विफलता बजट (टाइमआउट/अनुपलब्ध/schema, रद्दीकरण नहीं); खत्म होने पर अनुरोध दूसरा पूरा टाइमआउट चुकाने के बजाय मानवों को सौंपे जाते हैं। डिफ़ॉल्ट `maxReviewsPerTurn` के बराबर |
| `reasonMaxChars` | `2000` | समीक्षक के कारणों, अनुरोध के कारण और redacted आर्गुमेंट पूर्वावलोकन की सीमा |
| `reviewerGuidance` | *(कोई नहीं)* | समीक्षक prompt में जोड़ा जाने वाला वैकल्पिक मार्गदर्शन (सलाह, कठोर नियम नहीं) |
| `reviewerPolicyText` | *(कोई नहीं)* | समीक्षक prompt में डाली जाने वाली Markdown निर्णय-नीति (Codex-शैली; टेम्पलेट `fixtures/config/policy-template.md` पर) |
| `denyGuidance` | *(circumvention-विरोधी पाठ)* | हर डाले गए अस्वीकृति कारण के अंत में जोड़ा जाने वाला मार्गदर्शन |
| `contextBudget` | `{turns: 0, maxChars: 4000}` | समीक्षक prompt के लिए संक्षिप्त ट्रांसक्रिप्ट बजट; `turns: 0` निष्क्रिय करता है |
| `riskPolicy` | `{maxAutoAllow: high, onHighRisk: delegate}` | `maxAutoAllow` से ऊपर के `allow` फ़ैसले सौंपते हैं (`delegate`) या अस्वीकार करते हैं (`deny`) |
| `circuitBreaker` | `{consecutiveDenies: 3, windowDenies: 10, windowSize: 50, action: delegate}` | अस्वीकृति circuit breaker; `action`: `delegate` / `reject` / `abort-turn` |
| `overrideTtlMs` | `300000` | `/auto-review approve` ओवरराइड कितनी देर उपयोग-योग्य रहता है |
| `language` | `en` | `/auto-review` कमांड आउटपुट की UI भाषा (`en` \| `zh`) |

उदाहरण (टिप्पणी-सहित पूर्ण रूप: `fixtures/config/config-full.yaml`):

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
        circuitBreaker: { consecutiveDenies: 3, windowDenies: 10, windowSize: 50, action: delegate }
```

## ⌨️ सत्र कमांड

```
/auto-review on|off|status|approve [n]
```

`on`/`off` टिकाऊ `autoReview/state` ओवरराइड जोड़ते हैं (fold पुनः आरंभ/restore के बाद भी बना रहता है — रीप्ले ही स्थिति है) और मॉडल को दिखने वाला स्विच-नोटिस डालते हैं (`user/message` ईवेंट के रूप में दर्ज)। `status` प्रभावी स्थिति, दोनों प्रति-टर्न बजट (AI फ़ैसले और समीक्षक विफलताएँ) और सत्र के संचयी आँकड़े दिखाता है। `approve [n]` n-वीं सबसे हाल की अस्वीकृति (1 = सबसे हाल) के लिए एक बार उपयोग होने वाला `autoReview/override` दर्ज करता है: `overrideTtlMs` के भीतर अगली उसी-टूल समीक्षा उस अधिकार को समीक्षक संदर्भ के रूप में ले जाती है — समीक्षक फिर भी फ़ैसला करता है, और ओवरराइड उस समीक्षा द्वारा उपभोग हो जाता है चाहे उसका परिणाम कुछ भी हो।

## 🔒 सुरक्षा

- समीक्षक **केवल-पढ़ने वाले टूल-सेट** (`toolFilter` अनुमति-सूची) में चलता है। वह लिख, बदल, shell चला, नेटवर्क छू या आगे delegation नहीं कर सकता (`maxDepth` = उसकी अपनी गहराई)। उसका सत्र लॉग स्थायी और ऑडिट-योग्य है।
- **संवेदनशील आर्गुमेंट पहले हटाए जाते हैं** (कुंजी-नाम मिलान: `token`, `password`, `api_key`, `Authorization`, क्रेडेंशियल, निजी कुंजियाँ …) फिर समीक्षक prompt में जाते हैं; प्लगइन समीक्षित आर्गुमेंट कभी निष्पादित नहीं करता। यह कुंजी-आधारित redaction है, सामग्री-आधारित नहीं — जिन टूल के मान मॉडल को दिखाना जोखिम भरा हो, उन्हें AI समीक्षा में न डालें।
- **डिफ़ॉल्ट रूप से fail closed।** हर असामान्य रास्ता (provider गायब, क्षमता-अंतराल, start अस्वीकृत, टाइमआउट, गैर-`completed` stopReason, फ़ैसला गायब/विकृत, ऑडिट-सहसंबंध विफलता) `fallbackPolicy` से हल होता है, डिफ़ॉल्ट `rejected` — और अस्वीकृति सामान्य "user rejected" पाठ के बजाय एक ऑडिट-योग्य कारण मॉडल को वापस देती है। `allow-once` बिना शर्त अनुमति देता है — केवल उन अप्रबंधित परिनियोजनों के लिए जिनका व्यवस्थापक यह जोखिम स्वीकार करता है।
- **अस्वीकृति circuit breaker।** एक टर्न में अस्वीकृतियों का सिलसिला breaker को ट्रिप कर देता है (`windowSize` के भीतर `consecutiveDenies` / `windowDenies`), log-only `autoReview/circuit` ईवेंट के रूप में दर्ज; बाद के अनुरोध उसके `action` (`delegate` / `reject` / `abort-turn`) का पालन करते हैं। `abort-turn` मॉडल को दिखने वाली चेतावनी डालता है और एजेंट रद्द करता है।
- **समीक्षक संदर्भ प्रस्तुत ट्रांसक्रिप्ट है।** `contextBudget` पहले से प्रस्तुत सत्र सामग्री (संदेश, टूल परिणाम) समीक्षक को देता है। डिफ़ॉल्ट समान-रूट समीक्षक मॉडल के साथ वह सामग्री एक ही provider के भीतर रहती है; `reviewerModel` को किसी भिन्न provider पर तभी सेट करें जब आप उस ट्रांसक्रिप्ट को उसके सामने प्रस्तुत करना स्वीकार करते हों।
- **`never` इस परत पर एकतरफ़ा है।** `never` टूल या जोखिम नियम मानव शृंखला के अनुरोध देखने से पहले ही अस्वीकार कर देता है — यह ताला है, डिफ़ॉल्ट नहीं।
- **समीक्षक भी एक मॉडल है।** उसके फ़ैसले सलाहकार नीति हैं, सुरक्षा कर्नेल नहीं। अपरिवर्तनीय कार्यों के लिए `human`/`never` नियम रखें।

## ⚠️ ज्ञात सीमाएँ

- समीक्षक को एक कार्यशील LLM रूट चाहिए (डिफ़ॉल्ट में सत्र एजेंट से विरासत); उसके बिना हर समीक्षा `fallbackPolicy` पर गिरती है — कभी भी मौन अनुमति नहीं।
- `reviewerTools` के नाम प्रोफ़ाइल में वास्तविक वैश्विक टूल होने चाहिए; अज्ञात नाम समीक्षक बच्चे को सबसे पहले बिंदु पर ज़ोर से विफल करता है और fallback पर गिरता है।
- जोखिम नियम अपने `field` के अनुसार अनुरोध के `reason`, `toolName` या redacted कॉल `arguments` से मिलते हैं; बाकी शर्तें `toolsPolicy.overrides` में रखें।
- `/auto-review approve` ओवरराइड अगली उसी-टूल समीक्षा को अधिकृत करता है, सटीक ऐतिहासिक कॉल को नहीं; उसी टूल पर कोई भिन्न क्रिया उसे उपभोग कर लेती है।
- फ़ैसला ईवेंट log-only है; Web UI ऑडिट पैनल सत्र ईवेंट को जैसे-का-तैसा दिखाता है (समर्पित पैनल नहीं)।
- `autoReview/state` और `autoReview/verdict` एन्वेलप के `ignorable: true` मार्कर के साथ लिखे जाते हैं, इसलिए कोई भी harness बिल्ड लॉग लोड कर लेता है — जो पाठक इन आउट-ऑफ-रेपो प्रकारों को नहीं जानते वे सत्र अस्वीकार करने के बजाय केवल उन रिकॉर्ड्स को छोड़ देते हैं। (rc.6 होस्ट मार्कर को स्वीकार कर अनदेखा करते हैं, पहले जैसा ही व्यवहार बना रहता है; 0.1.1 से पहले के संस्करणों द्वारा लिखे सत्र `dsh-permission-rules` के `scripts/repair-session-logs.mjs` से एक बार मरम्मत किए जा सकते हैं।)
- git चैनल को केवल वही एक `allowBuilds` कुंजी चाहिए जो `dsh` CLI स्वयं `dsh-auto-review` के लिए प्रिंट करता है। रेपो अपना `pnpm-workspace.yaml` लेकर आता है जिसमें `allowBuilds: { esbuild: true }` है, ताकि अलग-थलग prepare वातावरण esbuild के (हानिरहित प्लेटफ़ॉर्म-बाइनरी सत्यापन) postinstall पर विफल न हो; `typescript` + `tsdown` नियमित `dependencies` हैं ताकि उस वातावरण में बिल्ड टूल हमेशा मौजूद रहें।
- वैकल्पिक invariant companion (`dsh-auto-review/invariant`) को `invariants` सेवा चाहिए (agent-spine संयोजन जैसे headless/ACP); सामान्य web प्रोफ़ाइल उसे नहीं देती, इसलिए वह पंक्ति bundle पैच में टिप्पणी रूप में जाती है।

## 🏷️ GitHub टॉपिक

प्रकाशन पर सुझावित: `dsh` · `dsh-plugin` · `deepseek-harness` · `deepseek` · `cordis` · `ai-safety` · `approval` · `sandbox` · `subagent` · `llm`

## 🔗 संबंधित कार्य

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) — `tools/pre-execute` waterfall पर दो-अवस्था allow/deny क्लासिफ़ायर, फ़ाइल-लॉग ऑडिट के साथ। `dsh-auto-review` जानबूझकर अलग है: आधिकारिक **answerer** शृंखला, जो उसका नहीं उसे हमेशा आगे भेजता है, संरचित फ़ैसले वाला केवल-पढ़ने वाला दूसरा मॉडल, अस्वीकृति के कारण मॉडल को वापस, सत्र-लॉग ऑडिट।
- [ACP automation bridge](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/acp/acp) — अपने ACP एजेंटों के लिए एक बार के मशीन निर्णय। `dsh-auto-review` इंटरैक्टिव harness की सत्र और टूल-नीति परिधि के लिए है; यह कभी स्थायी अनुमतियाँ नहीं मानता।

## 🧑‍💻 विकास

```sh
pnpm install                # node ^22.19 || >=24
pnpm run typecheck          # tsc, src + टेस्ट
pnpm test                   # vitest: 61 टेस्ट, 6 सुइट
pnpm run build              # tsc डिक्लेरेशन + tsdown बंडल (lib/)
pnpm run verify:self-contained
pnpm pack                   # प्रकाशन आर्टिफ़ैक्ट
```

रेपो संरचना (plugin-template संरचना): `src/index.ts` (प्लगइन अनुबंध) · `src/config.ts` (Schemastery schema + रिज़ॉल्यूशन) · `src/runtime.ts` (answerer, कमांड, अस्वीकृति-कारण इंजेक्शन) · `src/review.ts` (समीक्षक ऑर्केस्ट्रेशन, prompt, redaction) · `src/events.ts` (सत्र-ईवेंट शब्दावली + folds) · `src/invariant.ts` (invariant companion) · `test/` · `fixtures/`।

## 📄 लाइसेंस

[Apache License 2.0](LICENSE)
