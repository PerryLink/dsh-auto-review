<div align="center">

# 🤖 dsh-auto-review

**DeepSeek Harness के लिए द्वितीय-मॉडल AI अनुमोदन — एक केवल-पढ़ने वाला समीक्षक उप-एजेंट अनुमोदन श्रृंखला पर अनुमति/अस्वीकार का निर्णय करता है, डिफ़ॉल्ट रूप से विफल-बंद।**

*जब कोई क्रिया सैंडबॉक्स सीमा पार करती है, तो दूसरा मॉडल साक्ष्य पढ़ता है और कारण सहित निर्णय लौटाता है — ताकि मनुष्य कुछ भी स्वीकृत न करें और कुछ भी असुरक्षित छूट न जाए।*

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

## अनुकूलता

| सतह | स्थिति |
|---|---|
| Harness | DeepSeek Harness `0.1.0-rc.6` (peers `0.1.0-rc.6` पर पिन किए गए) |
| Node | `^22.19.0 \|\| >=24.0.0` |
| प्लेटफ़ॉर्म | सभी (होस्ट answerer; सत्र-प्रोजेक्शन क्षमता के ज़रिए वैकल्पिक वेब समीक्षा पैनल) |
| मॉडल | कोई भी (समीक्षक डिफ़ॉल्ट रूप से सत्र एजेंट का मार्ग लेता है; `reviewerModel` उसे बदल देता है) |

## आपको क्या मिलता है

`dsh-auto-review` `approval/request` answerer श्रृंखला पर दूसरा मॉडल रखता है:

1. **आधिकारिक सीम** — एक answerer जो केवल अपनी सीमा के अनुरोधों (`ai` नीति) को अपनाता है और बाकी सब `next()` से सौंप देता है; मानव अनुमोदन प्रवाह कभी शॉर्ट-सर्किट नहीं होता।
2. **केवल-पढ़ने वाला समीक्षक उप-एजेंट** — `read`/`glob`/`grep` टूल अनुमति-सूची वाला एक-बार का fork संरचित निर्णय `{ decision, reason, riskLevel }` लौटाता है।
3. **विफल-बंद** — समीक्षक क्रैश, टाइमआउट या स्कीमा बेमेल `fallbackPolicy` (डिफ़ॉल्ट `rejected`) से हल होता है; अस्वीकृति निर्णय अपना कारण कॉल करने वाले मॉडल को लौटा देता है।
4. **कॉन्फ़िग-चालित रूटिंग** — प्रति-टूल नीतियाँ (`ai`/`human`/`never`) और regex जोखिम नियम, सब cordis.yml से बदले जा सकते हैं।
5. **पूर्ण ऑडिट ट्रेल** — केवल-लॉग `autoReview/verdict` + `autoReview/rejection` सत्र घटनाएँ (लिफ़ाफ़ा `ignorable: true`) और एक वैकल्पिक invariant साथी।
6. **सुरक्षा नियंत्रण** — अस्वीकृति सर्किट ब्रेकर, जोखिम-स्तर नीति, एक-बार का `/auto-review approve` ओवरराइड, और एक `never`-नीति कठोर अक्षमता जो मॉडल को स्वयं समझाती है।

हर निर्णय सत्र लॉग से पुनर्निर्मित होता है: `approval/asked` → `autoReview/verdict` (या `autoReview/rejection`) → `approval/decided`।

## त्वरित शुरुआत

```sh
# 1. अपने प्रोफ़ाइल में बंडल इंस्टॉल करें
dsh plugin --profile web add "github:PerryLink/dsh-auto-review#main"

# या npm से (प्रकाशित रिलीज़)
dsh plugin --profile web add dsh-auto-review

# 2. पुनः प्रारंभ करें और पंक्ति सत्यापित करें
dsh --profile web --dump-config | grep -A4 'id: auto-review'
```

डिफ़ॉल्ट पैच `bash` और `write` की AI समीक्षा करता है; बाकी सभी टूल मानव श्रृंखला को सौंपे जाते हैं।

## इंस्टॉल और अनइंस्टॉल

- **git चैनल** (नवीनतम `main`): `dsh plugin --profile web add "github:PerryLink/dsh-auto-review#main"` — पृथक `prepare` बिल्ड को वह एकल `allowBuilds: { esbuild: true }` कुंजी चाहिए जो `dsh` CLI `dsh-auto-review` के लिए छापता है।
- **npm चैनल** (प्रकाशित रिलीज़): `dsh plugin --profile web add dsh-auto-review`।
- **tarball चैनल**: इस रेपो में `pnpm pack`, फिर `dsh plugin --profile web add ./dsh-auto-review-<version>.tgz`।
- **अनइंस्टॉल**: `dsh plugin --profile web remove dsh-auto-review` (या प्रोफ़ाइल पैच से पंक्ति हटाएँ)।

## कॉन्फ़िगरेशन

सभी ट्यूनेबल Schemastery `Config` फ़ील्ड हैं (cordis.yml से बदले जा सकते हैं)। id-लक्षित ओवरराइड पूरी पंक्ति बदल देता है — हर ज़रूरी कुंजी दोबारा लिखें।

| कुंजी | डिफ़ॉल्ट | अर्थ |
|---|---|---|
| `enableByDefault` | `true` | सत्र auto-review सक्षम होकर शुरू होते हैं; `/auto-review on\|off` एक टिकाऊ ओवरराइड लिखता है जो इस पर भारी पड़ता है |
| `toolsPolicy.default` | `human` | असूचीबद्ध टूल की नीति (मानव answerer को सौंपना) |
| `toolsPolicy.overrides` | `{}` | प्रति-टूल नीति: `ai` / `human` / `never` |
| `riskRules` | `[]` | टूल तालिका से पहले मिलाया गया `{pattern, policy, field?}`; `field` चुनता है `reason` (डिफ़ॉल्ट), `toolName` या `arguments` |
| `reviewerProvider` | `fork` | समीक्षक का उप-एजेंट प्रदाता (इन-प्रोसेस fork बैकएंड) |
| `reviewerModel` | *(विरासत)* | समीक्षक मॉडल id; खाली होने पर सत्र एजेंट का मार्ग लेता है |
| `reviewerTimeoutMs` | `60000` | निर्णय की समय-सीमा; समाप्ति पर fallback नीति लागू होती है |
| `reviewerTools` | `[read, glob, grep]` | समीक्षक चाइल्ड की टूल अनुमति-सूची (गैर-रिक्त होनी चाहिए) |
| `fallbackPolicy` | `rejected` | समीक्षक विफलता: `rejected` (विफल-बंद) / `delegate` / `allow-once` |
| `maxReviewsPerTurn` | `10` | प्रति खुले टर्न वास्तविक AI-निर्णय बजट; इससे अधिक पर अनुरोध सौंप दिए जाते हैं |
| `maxFailuresPerTurn` | `10` | प्रति खुले टर्न समीक्षक-विफलता बजट |
| `reasonMaxChars` | `2000` | समीक्षक कारणों और संशोधित तर्क पूर्वावलोकन की सीमा |
| `reviewerGuidance` | *(कोई नहीं)* | समीक्षक प्रॉम्प्ट में जोड़ा गया वैकल्पिक मार्गदर्शन |
| `reviewerPolicyText` | *(कोई नहीं)* | समीक्षक प्रॉम्प्ट में इंजेक्ट की गई Markdown निर्णय-नीति (Codex शैली) |
| `denyGuidance` | *(परिहार-विरोधी पाठ)* | हर इंजेक्ट किए गए अस्वीकृति कारण में जोड़ा गया मार्गदर्शन |
| `contextBudget` | `{turns: 0, maxChars: 4000}` | समीक्षक प्रॉम्प्ट का संक्षिप्त ट्रांसक्रिप्ट बजट; `turns: 0` अक्षम करता है |
| `riskPolicy` | `{maxAutoAllow: high, onHighRisk: delegate}` | `maxAutoAllow` से ऊपर के `allow` निर्णय सौंपते या अस्वीकार करते हैं |
| `circuitBreaker` | `{consecutiveDenies: 3, windowDenies: 6, windowSize: 10, action: delegate}` | अस्वीकृति सर्किट ब्रेकर |
| `overrideTtlMs` | `300000` | `/auto-review approve` ओवरराइड कितनी देर उपयोगी रहता है |
| `language` | `en` | `/auto-review` कमांड आउटपुट की UI भाषा (`en` \| `zh`) |

## उपकरण और सतहें

| सतह | प्रकार | नोट्स |
|---|---|---|
| `auto-review` | answerer | `approval/request` कैस्केड answerer — `ai`-नीति अनुरोध अपनाता है, बाकी `next()` से सौंपता है |
| `/auto-review` | कमांड | `on\|off\|status\|approve [n]` — टिकाऊ सत्र ओवरराइड, बजट और संचयी आँकड़े |
| अस्वीकृति-कारण इंजेक्शन | श्रोता | `tools/post-execute` — निर्णय / fallback / `never` कारण अस्वीकृत टूल परिणाम को लौटाए जाते हैं |
| `autoReview` | सत्र प्रोजेक्शन | केवल-लॉग `autoReview/*` घटनाओं से मोड़ा गया |
| वेब समीक्षा पैनल | क्लाइंट | सत्र-शीर्षक क्रिया: स्विच, बजट, आँकड़े, हाल के निर्णय, एक-बार स्वीकृति |
| `dsh-eval` | CLI | YAML-चालित एजेंट मूल्यांकन इंजन (`bin/dsh-eval.mjs`) |
| invariant साथी | invariant | `dsh-auto-review/invariant` (वैकल्पिक; `invariants` सेवा चाहिए) |

## dsh-eval — एजेंट मूल्यांकन इंजन

अनुमोदन समीक्षक से परे, `dsh-auto-review` `dsh-eval` भेजता है: एक YAML-चालित एजेंट मूल्यांकन मंच जो वास्तविक हेडलेस DSH सत्र चलाता है (प्रति केस एक पृथक एजेंट + अस्थायी वर्कस्पेस), सत्र घटना लॉग से टूल-कॉल ट्रेस एकत्र करता है, और संरचित दावों तथा एक वैकल्पिक द्वितीय-मॉडल समीक्षा का मूल्यांकन करता है — वही समीक्षक सीम जो अनुमोदन answerer उपयोग करता है।

```sh
dsh-eval eval/cases --model deepseek-v4-flash --timeout-ms 240000 --out .eval-reports
```

CI द्वार: प्रक्रिया केवल तभी 0 से निकलती है जब हर सुइट का हर केस पास हो। हर केस `report.md`/`report.json` के पास एक पुनः-चलाने योग्य सत्र JSONL और एक ट्रेस JSON छोड़ता है।

## अनुमतियाँ और डेटा

- **अनुमतियाँ**: workshop मेनिफ़ेस्ट `session:append`, `approval:answer`, `subagent:spawn`, `command:register` और `tools:observe` घोषित करता है।
- **डेटा**: डिस्क पर कुछ नहीं लिखा जाता; रिपोर्ट रिंग बफ़र मेमोरी में और सीमित है। अपनी ओर से कोई नेटवर्क अनुरोध नहीं।
- **सत्र लॉग**: `autoReview/*` घटनाएँ समीक्षक पहचान, निर्णय, कारण, जोखिम और अवधि रखती हैं — लिफ़ाफ़े के `ignorable: true` मार्कर के साथ जोड़ी जाती हैं।

## सुरक्षा सीमाएँ

- **समीक्षक एक मॉडल है।** उसके निर्णय सलाहकार नीति हैं, सुरक्षा कर्नेल नहीं; अपरिवर्तनीय क्रियाओं के लिए `human`/`never` नियम चुनें।
- **विफल-बंद।** हर असामान्य मार्ग `fallbackPolicy` से हल होता है, डिफ़ॉल्ट `rejected` — और अस्वीकृति मॉडल को एक ऑडिट-योग्य कारण लौटाती है।
- **केवल-पढ़ने वाला समीक्षक।** समीक्षक की `toolFilter` अनुमति-सूची (`read`/`glob`/`grep`) लिख, संपादित, bash चला, नेटवर्क उपयोग या प्रत्यायोजन नहीं कर सकती।
- **संवेदनशील तर्क संशोधित किए जाते हैं** (कुंजी-नाम मिलान से) उसके बाद समीक्षक प्रॉम्प्ट में जाते हैं; प्लगइन समीक्षित तर्कों को कभी निष्पादित नहीं करता।
- **`never` एक-तरफ़ा है।** `never` टूल या जोखिम नियम मानव श्रृंखला के अनुरोध देखने से पहले ही अस्वीकार कर देता है।

## ज्ञात सीमाएँ

- समीक्षक को एक कार्यशील LLM मार्ग चाहिए (डिफ़ॉल्ट रूप से विरासत); इसके बिना हर समीक्षा `fallbackPolicy` के अनुसार गिरती है — कभी मौन अनुमति नहीं।
- `reviewerTools` के नाम प्रोफ़ाइल में वैश्विक टूल के रूप में मौजूद होने चाहिए; अज्ञात नाम समीक्षक चाइल्ड को ज़ोर से विफल करता है।
- जोखिम नियम अपने `field` के अनुसार `reason`, `toolName` या संशोधित `arguments` से मिलते हैं; बाकी शर्तें `toolsPolicy.overrides` में रखें।
- `/auto-review approve` ओवरराइड उसी टूल की अगली समीक्षा को अधिकृत करता है, उस ऐतिहासिक कॉल को नहीं।
- निर्णय घटनाएँ केवल-लॉग हैं; वेब समीक्षा पैनल मुड़ा हुआ `autoReview` प्रोजेक्शन पढ़ता है (कच्ची घटना धारा ब्राउज़र प्लगइन तक कभी नहीं पहुँचती)।
- वैकल्पिक invariant साथी को `invariants` सेवा चाहिए (agent-spine रचनाएँ); सादा web प्रोफ़ाइल वह नहीं देता।

## विकास

```sh
pnpm install                # node ^22.19 || >=24
pnpm run typecheck          # tsc: src + tests, स्थानीय harness checkout के विरुद्ध
pnpm test                   # vitest: 190 परीक्षण, 14 फ़ाइलें
pnpm run build              # tsc घोषणाएँ + tsdown बंडल (lib/, क्लाइंट बंडल सहित)
pnpm run verify:self-contained
pnpm pack                   # प्रकाशित tarball
```

## विषय

`deepseek-harness`, `dsh`, `dsh-plugin`, `cordis`, `approval`, `auto-review`, `second-model`, `ai-safety`, `sandbox`, `subagent`

## योगदानकर्ता

- [@PerryLink](https://github.com/PerryLink) — निर्माता और अनुरक्षक: अनुमोदन answerer, समीक्षक उप-एजेंट, जोखिम नीति और सर्किट ब्रेकर, सत्र-प्रोजेक्शन समीक्षा पैनल, invariant साथी, dsh-eval, और पाँच-भाषा दस्तावेज़।

## लाइसेंस

[Apache License 2.0](LICENSE) © 2026 dsh-auto-review contributors
