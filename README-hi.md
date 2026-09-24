<div align="center">

# 🤖 dsh-auto-review

**DeepSeek Harness के लिए द्वितीय-मॉडल AI अनुमोदन — एक केवल-पढ़ने वाला समीक्षक उप-एजेंट अनुमोदन श्रृंखला पर अनुमति/अस्वीकार का निर्णय करता है, डिफ़ॉल्ट रूप से विफल-बंद।**

*जब कोई क्रिया सैंडबॉक्स सीमा पार करती है, तो दूसरा मॉडल साक्ष्य पढ़ता है और कारण सहित निर्णय लौटाता है — ताकि मनुष्य कुछ भी स्वीकृत न करें और कुछ भी असुरक्षित छूट न जाए।*

> **आधिकारिक रिपॉज़िटरी।** यह PerryLink द्वारा अनुरक्षित dsh-auto-review का एकमात्र आधिकारिक रिपॉज़िटरी है। अन्य खातों के समान-नाम रिपॉज़िटरी इससे संबद्ध नहीं हैं।

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
[![dshfind](https://dshfind.com/api/badge/PerryLink/dsh-auto-review?metric=downloads&lang=hi)](https://dshfind.com/hi/plugins/PerryLink/dsh-auto-review?ref=badge)

[English](README.md) · [简体中文](README-zh.md) · [Español](README-es.md) · [Português](README-pt.md) · [हिन्दी](README-hi.md)

</div>

---

<!-- star-cta -->
## ⭐ 如果它帮到了你

यह प्लगइन [DSH प्लगइन परिवार](https://github.com/PerryLink) का हिस्सा है (40+ प्लगइन, सभी Apache-2.0)। अगर यह उपयोगी लगे, तो **एक स्टार दें** — इससे कोई सुविधा अनलॉक नहीं होती, पर अगला व्यक्ति इसे खोज में आसानी से पा लेता है।

*English:* part of a 40+ plugin family for DeepSeek Harness. If it is useful, **a star helps the next person find it** — nothing is gated behind it.

## अनुकूलता

| सतह | स्थिति |
|---|---|
| Harness | DeepSeek Harness `dsh-v0.1.7-rc.1` (2026-09-24 को सत्यापित)। दोहरी-लाइन npm समर्थन: dev पिन और रनटाइम निर्भरताएँ `0.1.7-rc.1`, peers `>=0.1.2-rc.1 <0.2.0 \|\| >=0.1.5-alpha.1 <0.2.0 \|\| >=0.1.6-0 <0.2.0 \|\| >=0.1.7-0 <0.2.0 \|\| >=0.1.7-0 <0.2.0` — प्लगइन कोड प्रकाशित होस्ट लाइनों को फ़ीचर-डिटेक्ट करता है और हर लाइन पूरी गेट श्रृंखला चलाती है; रनटाइम निर्भरताएँ होस्ट लाइन का पालन करती हैं ताकि प्रोफ़ाइल इंस्टॉल होस्ट के अपने ट्री को शैडो न करें। `pnpm-workspace.yaml` पूरे `@deepseek-ai/dsh-*` ग्राफ़ को उस लाइन पर पिन करता है, क्योंकि अन्यथा `autoInstallPeers` फ़्रोज़न `dsh-agent-spine-demo` सबग्राफ़ के `^0.1.1-rc.2` peers को ऐसे प्रीव्यू से भर देता है जिनमें 0.1.7 पैकेज जिन निर्यातों को import करते हैं वे नहीं हैं। alpha.2 लाइन पर eval फ़िक्स्चर `deepseek-flash` पिन करते हैं (हटाया गया `deepseek-v4-flash` अब `eval/` में नहीं है)। |
| Node | `^22.19.0 \|\| >=24.0.0` |
| प्लेटफ़ॉर्म | सभी (होस्ट answerer; सत्र-प्रोजेक्शन क्षमता के ज़रिए वैकल्पिक वेब समीक्षा पैनल) |
| मॉडल | कोई भी (समीक्षक सत्र एजेंट का मार्ग विरासत में लेता है; `reviewerModel` उसे बदल देता है) |

## आपको क्या मिलता है

`dsh-auto-review` `approval/request` answerer श्रृंखला पर दूसरा मॉडल रखता है:

1. **आधिकारिक सीम** — एक answerer जो केवल अपनी सीमा के अनुरोधों (`ai` नीति) को अपनाता है और बाकी सब `next()` से सौंप देता है; मानव अनुमोदन प्रवाह कभी शॉर्ट-सर्किट नहीं होता।
2. **केवल-पढ़ने वाला समीक्षक उप-एजेंट** — `read`/`glob`/`grep` टूल अनुमति-सूची वाला एक-बार का fork संरचित निर्णय `{ decision, reason, riskLevel }` लौटाता है। समीक्षक के अनुरोध पहचान से पहचाने जाते हैं और सौंप दिए जाते हैं; `maxDepth` + अनुमति-सूची समीक्षक को गैर-प्रत्यायोजक बनाए रखते हैं।
3. **विफल-बंद** — समीक्षक क्रैश, टाइमआउट या स्कीमा बेमेल `fallbackPolicy` (डिफ़ॉल्ट `rejected`) से हल होता है; अस्वीकृति निर्णय अपना कारण कॉल करने वाले मॉडल को लौटा देता है।
4. **कॉन्फ़िग-चालित रूटिंग** — प्रति-टूल नीतियाँ (`ai`/`human`/`never`) और regex जोखिम नियम, सब cordis.yml से बदले जा सकते हैं।
5. **अस्वीकृति कारण मॉडल तक पहुँचते हैं** — समीक्षक का कारण अस्वीकृत टूल परिणाम में इंजेक्ट किया जाता है (callId-लिंक्ड); fallback और `never`-नीति अस्वीकृतियाँ भी ऑडिट-योग्य मार्कर इंजेक्ट करती हैं (`[auto-review]` / `[auto-review-fallback]` / `[auto-review-never]`)।
6. **पूर्ण ऑडिट ट्रेल** — केवल-लॉग `autoReview/verdict` + `autoReview/rejection` सत्र घटनाएँ (लिफ़ाफ़ा `ignorable: true`) और एक वैकल्पिक invariant साथी जो मार्कर ⟺ घटना लागू करता है।
7. **सुरक्षा नियंत्रण** — अस्वीकृति सर्किट ब्रेकर (3 लगातार अस्वीकृतियाँ, या अंतिम 10 निर्णयों में से 6, प्रति टर्न), एक जोखिम-स्तर नीति, एक-बार का `/auto-review approve` ओवरराइड, और एक `never`-नीति कठोर अक्षमता जो मॉडल को स्वयं समझाती है।
8. **वैकल्पिक समीक्षक संदर्भ** — एक सीमित संक्षिप्त ट्रांसक्रिप्ट (`contextBudget`) और एक Codex-शैली Markdown निर्णय-नीति (`reviewerPolicyText`)।

हर निर्णय सत्र लॉग से पुनर्निर्मित होता है: `approval/asked` → `autoReview/verdict` (या `autoReview/rejection`) → `approval/decided`।

## नियमों के बजाय दूसरा मॉडल क्यों?

पैटर्न-आधारित स्वतः-अनुमोदक प्रेषण से पहले, बिना साक्ष्य के निर्णय लेते हैं। `dsh-auto-review` निर्णय एक **समीक्षक उप-एजेंट** को देता है जो वास्तविक वर्कस्पेस (अपने केवल-पढ़ने वाले टूल इंटरफ़ेस के ज़रिए), पहले से स्ट्रीम किए गए टूल-कॉल तर्क (संवेदनशील मान संशोधित), अनुरोध का कारण और आपके जोखिम नियम पढ़ता है — फिर संरचित निर्णय लौटाता है। अस्वीकृति निर्णय अपना **कारण कॉल करने वाले मॉडल को लौटा देता है**, ताकि एजेंट अंधाधुंध पुनः प्रयास करने के बजाय कारण सीखे।

## त्वरित शुरुआत

```sh
# 1. अपने प्रोफ़ाइल में बंडल इंस्टॉल करें
dsh plugin --profile web add "github:PerryLink/dsh-auto-review#main"

# या npm से (प्रकाशित रिलीज़)
dsh plugin --profile web add dsh-auto-review

# 2. पुनः प्रारंभ करें और पंक्ति सत्यापित करें
dsh --profile web --dump-config | grep -A4 'id: auto-review'
```

डिफ़ॉल्ट रूप से शिप किया गया पैच `bash` और `write` की AI समीक्षा करता है; बाकी सभी टूल (`edit` — इन-प्लेस संशोधन — सहित) मानव श्रृंखला को सौंप देते हैं। यदि आप लूप में बिना मानव के इन-प्लेस संपादन स्वीकार करते हैं तो स्पष्ट रूप से `edit: ai` जोड़ें।

## इंस्टॉल और अनइंस्टॉल

- **git चैनल** (नवीनतम `main`): `dsh plugin --profile web add "github:PerryLink/dsh-auto-review#main"` — पृथक `prepare` बिल्ड को वह एकल `allowBuilds: { esbuild: true }` कुंजी चाहिए जो `dsh` CLI `dsh-auto-review` के लिए छापता है।
- **npm चैनल** (प्रकाशित रिलीज़): `dsh plugin --profile web add dsh-auto-review`।
- **1024 स्टोर चैनल**: एक बार `npm i -g dsh1024`, फिर `dsh1024 plugin --profile web add dsh-auto-review` ([deepseek1024.com](https://deepseek1024.com) इंस्टॉल रैंकिंग में गिना जाता है)।
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
| `reviewerGuidance` | *(कोई नहीं)* | समीक्षक प्रॉम्प्ट में जोड़ा गया वैकल्पिक सलाहकार मार्गदर्शन |
| `reviewerPolicyText` | *(कोई नहीं)* | समीक्षक प्रॉम्प्ट में इंजेक्ट की गई Markdown निर्णय-नीति (Codex शैली) |
| `denyGuidance` | *(परिहार-विरोधी पाठ)* | हर इंजेक्ट किए गए अस्वीकृति कारण में जोड़ा गया मार्गदर्शन |
| `contextBudget` | `{turns: 2, maxChars: 4000}` | समीक्षक प्रॉम्प्ट का संक्षिप्त ट्रांसक्रिप्ट बजट (खुला टर्न और उससे पिछला); `turns: 0` इस खंड को अक्षम करता है — और बिना ट्रांसक्रिप्ट वाला समीक्षक उपयोगकर्ता-अधिकृत क्रियाओं को अस्वीकार करता है, इसलिए जब 0 किसी `ai` नीति के साथ आता है तो रनटाइम चेतावनी देता है। वर्ण बजट सबसे हालिया पंक्तियों पर खर्च होता है |
| `riskPolicy` | `{maxAutoAllow: high, onHighRisk: delegate}` | `maxAutoAllow` से ऊपर के `allow` निर्णय सौंपते या अस्वीकार करते हैं |
| `circuitBreaker` | `{consecutiveDenies: 3, windowDenies: 6, windowSize: 10, action: delegate}` | अस्वीकृति सर्किट ब्रेकर |
| `overrideTtlMs` | `300000` | `/auto-review approve` ओवरराइड कितनी देर उपयोगी रहता है |
| `verdictCacheTtlMs` | `60000` | समान `टूल + तर्क` फ़िंगरप्रिंट के लिए हालिया निर्णय पुनः उपयोग करें; `0` कैश बंद करता है। यह केवल `contextBudget.turns: 0` के साथ लागू होता है — ट्रांसक्रिप्ट पर निर्भर निर्णय केवल `टूल + तर्क` से दोहराया नहीं जा सकता |
| `verdictCacheMaxEntries` | `256` | सबसे पुराने को निकालने से पहले कैश किए गए फ़िंगरप्रिंट की अधिकतम संख्या |
| `language` | `en` | `/auto-review` कमांड आउटपुट की UI भाषा (`en` \| `zh`) |
| `allowUnmarkedAudit` | `false` | `ignorable` मार्कर छोड़ने वाले होस्ट पर सत्र-लॉग ऑडिट बलपूर्वक चालू करें (खतरनाक: बिना मार्कर वाली घटनाएँ अन्य होस्ट पर सत्र अप्राप्य बनाती हैं); डिफ़ॉल्ट पहचान-और-डिग्रेड है (2026-09-02 को अनुकूलित, 2026-09-11 को `0.1.5-rc.2` के विरुद्ध पुनः सत्यापित) |

उदाहरण (टिप्पणी-युक्त पूर्ण रूप: `fixtures/config/config-full.yaml`):

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

### कॉन्फ़िगरेशन असल में कहाँ से आता है

**`~/.dsh/settings.yaml` इस प्लगइन के लिए कॉन्फ़िग स्रोत नहीं है।** वहाँ लिखा `auto-review:` ब्लॉक न कोई असर करता है और न कोई चेतावनी देता है: हर DSH फ़ंक्शन-प्लगइन की तरह `dsh-auto-review` अपना `Config` उसी पंक्ति से पाता है जिससे लोडर उसे माउंट करता है — यानी प्रोफ़ाइल की cordis patch परत से। (कुछ अन्य DSH प्लगइन settings सेवा भी पढ़ते हैं, इसलिए यह असंगति आसानी से फँसा देती है, और लक्षण "समीक्षक ने बस मना कर दिया" से अलग नहीं दिखता।)

कॉन्फ़िगरेशन अपनी प्रोफ़ाइल के `cordis.patch.yml` में रखें। **id-लक्षित override पूरी config पंक्ति को बदल देता है**, इसलिए हर आवश्यक कुंजी दोबारा लिखें — `toolsPolicy` छोड़ने पर `bash`/`write` चुपचाप schema डिफ़ॉल्ट `human` पर लौट जाते हैं और समीक्षक चलना ही बंद कर देता है:

```yaml
- id: auto-review
  config:
    toolsPolicy:
      overrides: { bash: ai, write: ai }
    contextBudget: { turns: 4, maxChars: 8000 }
```

## उपकरण और सतहें

| सतह | प्रकार | नोट्स |
|---|---|---|
| `auto-review` | answerer | `approval/request` कैस्केड answerer — `ai`-नीति अनुरोध अपनाता है, बाकी `next()` से सौंपता है |
| `/auto-review` | कमांड | `on\|off\|status\|approve [n]` — टिकाऊ प्रति-सत्र ओवरराइड, बजट और संचयी आँकड़े |
| अस्वीकृति-कारण इंजेक्शन | श्रोता | `tools/post-execute` — निर्णय / fallback / `never` कारण अस्वीकृत टूल परिणाम को लौटाए जाते हैं |
| `autoReview` | सत्र प्रोजेक्शन | केवल-लॉग `autoReview/*` घटनाओं से मोड़ा गया |
| वेब समीक्षा पैनल | क्लाइंट | सत्र-शीर्षक क्रिया: स्विच, बजट, आँकड़े, हाल के निर्णय, एक-बार स्वीकृति |
| `dsh-eval` | CLI | YAML-चालित एजेंट मूल्यांकन इंजन (`bin/dsh-eval.mjs`) |
| invariant साथी | invariant | `dsh-auto-review/invariant` (वैकल्पिक; `invariants` सेवा चाहिए) |

## सत्र कमांड

```
/auto-review on|off|status|approve [n]
```

`on`/`off` टिकाऊ `autoReview/state` ओवरराइड जोड़ते हैं (मोड़ पुनः प्रारंभ/पुनः आरंभ के बाद भी बचा रहता है — पुनर्प्ले ही स्थिति है) और एक स्विच सूचना इंजेक्ट करते हैं जिसे मॉडल देखता है (एक `user/message` घटना के रूप में लॉग किया जाता है)। `status` प्रभावी स्थिति, दोनों प्रति-टर्न बजट (AI निर्णय और समीक्षक विफलताएँ), सक्रिय होने पर एक ट्रिप हुआ सर्किट ब्रेकर, और सत्र के संचयी आँकड़े (अनुमतियाँ/अस्वीकृतियाँ/fallbacks/`never` अस्वीकृतियाँ, औसत अवधि, हाल के निर्णय) बताता है। `approve [n]` n-वें सबसे हालिया अस्वीकृति (1 = सबसे हालिया) के लिए एकल-उपयोग `autoReview/override` दर्ज करता है: `overrideTtlMs` के भीतर उसी टूल की अगली समीक्षा समीक्षक संदर्भ के रूप में प्राधिकरण लेकर चलती है — समीक्षक फिर भी निर्णय करता है, और ओवरराइड उस समीक्षा द्वारा उसके परिणाम की परवाह किए बिना उपभोग कर लिया जाता है।

## वेब समीक्षा पैनल

वेब GUI (web प्रोफ़ाइल) में, पैकेज एक सत्र-शीर्षक क्रिया (**AI Review**) योगदान करता है जो सत्र की auto-review स्थिति वाला एक पैनल खोलती है: on/off बटन वाला स्विच (वे `/auto-review on|off` निष्पादित करते हैं), दोनों प्रति-टर्न बजट, संचयी आँकड़े (कठोर-अक्षमता अस्वीकृतियाँ सहित), सर्किट ट्रिप, हाल के निर्णय, और हाल की अस्वीकृतियों के लिए एक-बार **approve** बटन (वे `/auto-review approve [n]` निष्पादित करते हैं)।

यह कैसे जुड़ा है:

- होस्ट एक `autoReview` **सत्र प्रोजेक्शन** पंजीकृत करता है (केवल-लॉग `autoReview/*` घटनाओं से मोड़ा गया) और उसे सत्र-प्रोजेक्शन चैनल के ज़रिए प्रस्तुत करता है।
- ब्राउज़र वाला आधा हिस्सा एक **क्लाइंट मॉड्यूल** है (`dsh.client` घोषणा से स्वतः-खोजा गया) जो `conversation.session.header.actions` सीट पर पंजीकृत है।
- कोई अतिरिक्त पैच पंक्तियाँ आवश्यक नहीं: पैनल तब लोड होता है जब भी प्लगइन किसी ऐसे प्रोफ़ाइल में इंस्टॉल हो जिसका web बिल्ड सत्र-प्रोजेक्शन क्षमता प्रदान करता है (web प्रोफ़ाइल करता है)। उस क्षमता के बिना पैनल स्वयं को अनुपलब्ध बताता है; answerer अप्रभावित रहता है।

पैनल केवल संपूर्ण प्रोजेक्शन मान पढ़ता है — उसे कच्ची सत्र घटना धारा कभी नहीं मिलती।

## यह कैसे काम करता है

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

**रचना क्रम।** answerer कैस्केड में अपनी पंजीकरण स्थिति पर चलता है: यदि कोई मानव UI answerer `auto-review` पंक्ति से पहले रचा गया है, तो मानव पहले उत्तर देते हैं और समीक्षक केवल वही देखता है जो आगे सौंपा जाता है। `dsh --profile <name> --dump-config` से सत्यापित करें और जब आप चाहें कि ai-नीति टूल पहले समीक्षक को भेजे जाएँ तो `auto-review` पंक्ति को अपने मानव answerer पंक्तियों से पहले रखें।

## dsh-eval — एजेंट मूल्यांकन इंजन

अनुमोदन समीक्षक से परे, `dsh-auto-review` `dsh-eval` शिप करता है: एक YAML-चालित एजेंट मूल्यांकन मंच जो वास्तविक हेडलेस DSH सत्र चलाता है (प्रति केस एक पृथक एजेंट + अस्थायी वर्कस्पेस, आधारभूत सिस्टम प्रॉम्प्ट के रूप में आधिकारिक Minimal व्यक्तित्व), सत्र घटना लॉग से टूल-कॉल ट्रेस एकत्र करता है, और संरचित दावों तथा एक वैकल्पिक द्वितीय-मॉडल समीक्षा का मूल्यांकन करता है — वही समीक्षक सीम जो अनुमोदन answerer उपयोग करता है।

```yaml
# eval/cases/demo.yaml (संक्षिप्त)
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

इसे चलाएँ (वातावरण में एक DeepSeek API कुंजी होनी चाहिए):

```sh
dsh-eval eval/cases --model deepseek-flash --timeout-ms 240000 --out .eval-reports
```

## PerryLink DSH Plugin Family

This project is one of the **45 DeepSeek Harness plugins** maintained by [PerryLink](https://github.com/PerryLink). If this one helps you, the others likely will too:

| Plugin | One-liner |
|---|---|
| **[dsh-auto-review](https://github.com/PerryLink/dsh-auto-review)** | Second-model auto-review on the approval chain, fail-closed by default | |
| **[dsh-autotier](https://github.com/PerryLink/dsh-autotier)** | Automatic strong/cheap model-tier routing with deterministic risk guards and a `/tier` command | |
| **[dsh-background-agents](https://github.com/PerryLink/dsh-background-agents)** | Durable background child agents with a Web UI sidebar, messaging and interrupt | |
| **[dsh-budget](https://github.com/PerryLink/dsh-budget)** | Cost governance for DeepSeek Harness: budgets, carbon, and latency in one panel. | |
| **[dsh-catalog](https://github.com/PerryLink/dsh-catalog)** | DSH Desktop Market standard catalog source for the PerryLink family | |
| **[dsh-cert-mcp](https://github.com/PerryLink/dsh-cert-mcp)** | Read-only MCP server exposing the certification registry: grades, snapshots and five-dimension evidence | |
| **[dsh-checkpoint-rewind](https://github.com/PerryLink/dsh-checkpoint-rewind)** | Claude Code /rewind-equivalent: snapshots, session forks, one-shot restore | |
| **[dsh-claude-move](https://github.com/PerryLink/dsh-claude-move)** | Migrate Claude Code sessions, memory, skills and CLAUDE.md into DSH | |
| **[dsh-click](https://github.com/PerryLink/dsh-click)** | Cross-platform native desktop control for DeepSeek Harness — Windows first. | |
| **[dsh-composer-history](https://github.com/PerryLink/dsh-composer-history)** | Terminal-style input history for the web composer: arrows, Ctrl+R search | |
| **[dsh-data-quality](https://github.com/PerryLink/dsh-data-quality)** | Dataset quality checks and citation cross-checks (the optional numeric bridge consumed here) | |
| **[dsh-defend](https://github.com/PerryLink/dsh-defend)** | Prompt-injection, jailbreak, and secret-leak defense for DeepSeek Harness. | |
| **[dsh-doublecheck](https://github.com/PerryLink/dsh-doublecheck)** | Engineering-discipline guard: requirements grill, test gates, adversary review | |
| **[dsh-draw](https://github.com/PerryLink/dsh-draw)** | Unified static-image generation routing for DeepSeek Harness. | |
| **[dsh-fast](https://github.com/PerryLink/dsh-fast)** | Read-only performance diagnostics for DeepSeek Harness. | |
| **[dsh-fund-research](https://github.com/PerryLink/dsh-fund-research)** | Deterministic research reports for Chinese public mutual funds | |
| **[dsh-github](https://github.com/PerryLink/dsh-github)** | GitHub PR/issues integration for DSH, every write gated by approval | |
| **[dsh-industry-research](https://github.com/PerryLink/dsh-industry-research)** | Industry research orchestration that seals its deliverables through this plugin's `ctx.researchReport.assemble` | |
| **[dsh-laya](https://github.com/PerryLink/dsh-laya)** | Laya typed decisions (`noul`/`choice`/`score`) as a first-class Cordis service and model-visible tools | |
| **[dsh-library](https://github.com/PerryLink/dsh-library)** | Local document knowledge base for DeepSeek Harness. | |
| **[dsh-local-ai](https://github.com/PerryLink/dsh-local-ai)** | Local-model (Ollama) integration for DeepSeek Harness. | |
| **[dsh-lsp-actions](https://github.com/PerryLink/dsh-lsp-actions)** | LSP diagnostics, formatting, completion, code actions and rename over language servers | |
| **[dsh-mask](https://github.com/PerryLink/dsh-mask)** | PII masking middleware: anonymize at the model boundary, restore at the display layer | |
| **[dsh-mcp-panel](https://github.com/PerryLink/dsh-mcp-panel)** | Read-only MCP runtime panel: /mcp command + Settings tab with status, tools and errors | |
| **[dsh-memento](https://github.com/PerryLink/dsh-memento)** | Approval-gated cross-session memory: ctx.memory seam + SQLite + memory tool | |
| **[dsh-observe](https://github.com/PerryLink/dsh-observe)** | OpenTelemetry and Langfuse observability exporter for DeepSeek Harness. | |
| **[dsh-output-styles](https://github.com/PerryLink/dsh-output-styles)** | Claude Code outputStyles-equivalent runtime style switching | |
| **[dsh-permission-rules](https://github.com/PerryLink/dsh-permission-rules)** | Claude Code-style declarative allow/deny/ask permission rules with audit | |
| **[dsh-plugin-certification](https://github.com/PerryLink/dsh-plugin-certification)** | Community certification registry with repro-checkable grades and badges | |
| **[dsh-plugin-doctor](https://github.com/PerryLink/dsh-plugin-doctor)** | Zero-dependency static + sandbox smoke detector for DSH plugins | |
| **[dsh-plugin-guide](https://github.com/PerryLink/dsh-plugin-guide)** | Plugin-development knowledge base as an on-demand agent skill | |
| **[dsh-plugin-kit](https://github.com/PerryLink/dsh-plugin-kit)** | Shared zero-runtime-dependency toolkit for the PerryLink DSH plugins | |
| **[dsh-plugin-upgrade](https://github.com/PerryLink/dsh-plugin-upgrade)** | One-package, one-corridor-index plugin upgrade skill: routes a repository to the matching closed corridor card | |
| **[dsh-plugin-upgrade-015](https://github.com/PerryLink/dsh-plugin-upgrade-015)** | Merged `0.1.3-alpha.1` → `0.1.5-rc.1` upgrade corridor card plus a zero-dependency seam scanner | |
| **[dsh-reach](https://github.com/PerryLink/dsh-reach)** | Multi-channel approval/question bridge: WeChat/Telegram/Feishu, session console | |
| **[dsh-research-report](https://github.com/PerryLink/dsh-research-report)** | Verifiable research-report engine: content-addressed evidence ledger and sealed versions | |
| **[dsh-score](https://github.com/PerryLink/dsh-score)** | Multi-dimensional quality scoring for DeepSeek Harness plugins. | |
| **[dsh-session-pin](https://github.com/PerryLink/dsh-session-pin)** | Pin sessions in the Web sidebar with durable ordering | |
| **[dsh-session-sync](https://github.com/PerryLink/dsh-session-sync)** | Cross-device session sync for DeepSeek Harness — a dedicated git mirror of your session store. | |
| **[dsh-skill-pack-security](https://github.com/PerryLink/dsh-skill-pack-security)** | Security-audit skill pack: secret scan, dependency and supply-chain review | |
| **[dsh-talk](https://github.com/PerryLink/dsh-talk)** | Voice-first session loop for DeepSeek Harness: talk to it, hear it answer. | |
| **[dsh-team-rooms](https://github.com/PerryLink/dsh-team-rooms)** | Cross-session team rooms: shared message bus, task board and timeline | |
| **[dsh-test-drive](https://github.com/PerryLink/dsh-test-drive)** | Isolated install-and-smoke test drives for DeepSeek Harness plugins. | |
| **[dsh-ticktick](https://github.com/PerryLink/dsh-ticktick)** | TickTick/Dida365 task bridge: session-header panel + 11 tools | |
| **[dsh-translate](https://github.com/PerryLink/dsh-translate)** | Vendor parameter translation and deterministic JSON repair for DeepSeek Harness. | |


## MCP सर्वर (स्टैंडअलोन)

`dsh-auto-review` एक stdio **MCP सर्वर** (`dsh-auto-review-mcp`) भी देता है ताकि बाहरी MCP क्लाइंट (Claude, Codex, …) बिना harness के एक निर्धारक समीक्षा पथ का उपयोग कर सकें। यह newline-delimited JSON (NDJSON) पर JSON-RPC 2.0 बोलता है — प्रति पंक्ति एक JSON ऑब्जेक्ट, कोई `Content-Length` फ़्रेमिंग नहीं।

**सीमा।** पूर्ण reviewer को harness के subagent seam और दूसरे मॉडल की आवश्यकता होती है, जिसे एक अलग stdio प्रक्रिया नहीं पहुँच सकती। इसलिए स्टैंडअलोन सर्वर **निर्धारक नियम + कैश, कोई मॉडल समीक्षा नहीं** है:

- `review_action` समान-फ़िंगरप्रिंट वर्डिक्ट कैश (`src/cache.ts`) और जोखिम-नियम / टूल-नीति समाधान (`src/config.ts`) का पुनः उपयोग करता है: एक `never` नियम → `deny`; समान `tool + arguments` फ़िंगरप्रिंट पर कैश हिट उस वर्डिक्ट को दोहराता है; बाकी सब (`ai` को मॉडल चाहिए, `human` को मानव चाहिए) → fail-closed `deny` जिसका reason `"standalone path, no model"` है। यह कभी भी ऐसी कार्रवाई की अनुमति नहीं देता जिसे किसी मॉडल ने पहले से अनुमति न दी हो।
- `cache_stats` हिट/स्टोर गणना और TTL स्थिति की सूचना देता है।

| टूल | उद्देश्य |
|---|---|
| `review_action` | `{tool, args?, reason?}` → `{decision, reason, riskLevel}` — निर्धारक अस्वीकृति / कैश पुनरावृत्ति |
| `cache_stats` | `{}` → `{hits, stores, size, ttlMs, enabled}` |

सीधे चलाएँ:

```sh
# जोखिम नियम पर्यावरण चरों से आते हैं
export DSH_AUTO_REVIEW_RISK_RULES='[{"pattern":"rm -rf","policy":"never","field":"arguments"}]'
node bin/dsh-auto-review-mcp.mjs
# या, npm install के बाद: npx dsh-auto-review-mcp
```

पर्यावरण विन्यास: `DSH_AUTO_REVIEW_RISK_RULES` (`{pattern, policy, field?}` की JSON सरणी), `DSH_AUTO_REVIEW_TOOLS_POLICY` (JSON `{default?, overrides?}`), `DSH_AUTO_REVIEW_CACHE_TTL_MS`, `DSH_AUTO_REVIEW_CACHE_MAX_ENTRIES`।

Claude Desktop (`claude_desktop_config.json`) उदाहरण:

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

सर्वर केवल-पठन और निर्धारक है: कोई नेटवर्क नहीं, कोई मॉडल नहीं, कोई लेखन नहीं।

## अनुमतियाँ और डेटा

- **अनुमतियाँ**: workshop मेनिफ़ेस्ट `session:append`, `approval:answer`, `subagent:spawn`, `command:register` और `tools:observe` घोषित करता है।
- **डेटा**: डिस्क पर कुछ नहीं लिखा जाता; रिपोर्ट रिंग बफ़र मेमोरी में और सीमित है। अपनी ओर से कोई नेटवर्क अनुरोध नहीं।
- **सत्र लॉग**: `autoReview/*` घटनाएँ समीक्षक पहचान, निर्णय, कारण, जोखिम और अवधि रखती हैं — लिफ़ाफ़े के `ignorable: true` मार्कर के साथ जोड़ी जाती हैं ताकि कोई भी बिल्ड लॉग लोड कर सके। जिन होस्ट का `Session.append` मार्कर से पुराना है (`0.1.1-rc.2` तक की हर रिलीज़ rc लाइन — कोई रिलीज़ अभी मार्कर नहीं छापती) उन्हें पहले append से पहले ही पहचान लिया जाता है (peer संस्करण पूर्व-जाँच, फिर लौटे लिफ़ाफ़े की जाँच); होस्ट `0.1.2-rc.1`, `0.1.3-alpha.2` और `0.1.5-rc.2` लिफ़ाफ़े पर `ignorable` फ़ील्ड रखते हैं, लेकिन `Session.append` उसे स्टैम्प करने का कोई तरीका नहीं देता (इसका तीसरा पैरामीटर केवल सतही घटनाओं के लिए `SurfaceIntent` है), और पर्सिस्टेंस रीड पथ बिना-मार्क वाले अज्ञात घटना प्रकारों को अस्वीकार करता है, इसलिए वे लाइनें — और असमाधेय संस्करण — भी किसी भी append से पहले fail closed हो जाते हैं। ऑडिट बिना मार्कर वाले फीडबैक के साथ इन-मेमोरी मिरर में डिग्रेड हो जाता है — सत्र हर जगह लोड होने योग्य रहते हैं।

## सुरक्षा सीमाएँ

- **समीक्षक एक मॉडल है।** उसके निर्णय सलाहकार नीति हैं, सुरक्षा कर्नेल नहीं; अपरिवर्तनीय क्रियाओं के लिए `human`/`never` नियम चुनें।
- **विफल-बंद।** हर असामान्य मार्ग (प्रदाता अनुपस्थित, क्षमता अंतराल, प्रारंभ अस्वीकृति, टाइमआउट, गैर-`completed` स्टॉप कारण, अनुपस्थित/विकृत निर्णय, ऑडिट-सहसंबंध विफलता) `fallbackPolicy` से हल होता है, डिफ़ॉल्ट `rejected` — और अस्वीकृति मॉडल को एक ऑडिट-योग्य कारण लौटाती है। `allow-once` बिना शर्त अनुमति देता है; यह केवल उन अप्रबंधित परिनियोजनों के लिए है जिनका व्यवस्थापक उस जोखिम को स्वीकार करता है।
- **केवल-पढ़ने वाला समीक्षक।** समीक्षक की `toolFilter` अनुमति-सूची (`read`/`glob`/`grep`) लिख, संपादित, bash चला, नेटवर्क उपयोग या प्रत्यायोजन नहीं कर सकती (`maxDepth` = उसकी अपनी गहराई)। उसका सत्र लॉग स्थायी और ऑडिट-योग्य है।
- **संदर्भ-पृथक समीक्षक।** समीक्षक चाइल्ड के हर चरण को आधिकारिक `agent/pre-step` सीम पर छाना जाता है: केवल उसका अपना प्रॉम्प्ट और उसके अपने केवल-पढ़ने वाले टूल परिणाम ही भीतर आते हैं। वर्कस्पेस निर्देश फ़ाइलें (`AGENTS.md` / `CLAUDE.md`), हार्नेस का रनटाइम-संदर्भ स्नैपशॉट और संदर्भ इंजेक्ट करने वाला कोई भी प्लगइन लूप द्वारा जोड़े जाने से पहले हटा दिए जाते हैं, इसलिए रिपॉज़िटरी-नियंत्रित पाठ कभी उस घटक तक नहीं पहुँचता जो कॉल की अनुमति तय करता है। यह किसी भी subagent प्रदाता के साथ लागू होता है — ये उत्पादक हर नए एजेंट सत्र में नए सिरे से इंजेक्ट करते हैं, इसलिए इन्हें बंद करने वाला यही फ़िल्टर है, प्रदाता का चुनाव नहीं। अनुमति-सूची संदेश के स्रोत पर आधारित है, इसलिए नया स्रोत घोषित करने वाला प्लगइन भी हटा दिया जाता है।
- **संवेदनशील तर्क संशोधित किए जाते हैं** (कुंजी-नाम मिलान: `token`, `password`, `api_key`, `Authorization`, क्रेडेंशियल, निजी कुंजियाँ …) समीक्षक प्रॉम्प्ट में जाने से पहले; प्लगइन समीक्षित तर्कों को कभी निष्पादित नहीं करता। संशोधन कुंजी-आधारित है, सामग्री-आधारित नहीं — उन टूल की AI समीक्षा न करें जिनके तर्क मान आप किसी मॉडल को दिखाने का जोखिम नहीं उठा सकते।
- **कठोर अक्षमताएँ स्वयं को समझाती हैं।** एक `never` टूल या जोखिम नियम निर्धारक रूप से अस्वीकार करता है और एक केवल-लॉग `autoReview/rejection` घटना दर्ज करता है, फिर अस्वीकृत टूल परिणाम में एक `[auto-review-never]` मार्कर इंजेक्ट करता है — मॉडल सीखता है कि क्रिया कठोर रूप से अक्षम है बजाय उसे पुनः प्रयास करने के (invariant-जाँचा गया: मार्कर ⟺ घटना)।
- **अस्वीकृति सर्किट ब्रेकर।** एक टर्न में अस्वीकृतियों की एक शृंखला ब्रेकर को ट्रिप करती है (`windowSize` के भीतर `consecutiveDenies` / `windowDenies`), जो एक केवल-लॉग `autoReview/circuit` घटना के रूप में दर्ज होती है; बाद के अनुरोध उसकी `action` (`delegate` / `reject` / `abort-turn`) का पालन करते हैं।
- **समीक्षक संदर्भ प्रस्तुत ट्रांसक्रिप्ट है।** `contextBudget` समीक्षक को पहले से प्रस्तुत सत्र सामग्री खिलाता है। डिफ़ॉल्ट समान-मार्ग समीक्षक मॉडल के साथ वह सामग्री एक ही प्रदाता के भीतर रहती है; `reviewerModel` को किसी भिन्न प्रदाता पर तभी कॉन्फ़िगर करें जब आप उस ट्रांसक्रिप्ट को उसे प्रस्तुत करना स्वीकार करते हों।
- **`never` इस परत पर एक-तरफ़ा है।** एक `never` टूल या जोखिम नियम मानव श्रृंखला के अनुरोध देखने से पहले ही अस्वीकार कर देता है — एक लॉकडाउन नियंत्रण, डिफ़ॉल्ट नहीं।

## ज्ञात सीमाएँ

- **दो अलग-अलग एक्सपोज़र, दो अलग-अलग उपाय — कोई एक दूसरे का विकल्प नहीं।** *इंजेक्ट किया गया* संदर्भ (वर्कस्पेस निर्देश फ़ाइलें, रनटाइम-संदर्भ स्नैपशॉट, तृतीय-पक्ष प्लगइन इंजेक्शन) हर नए एजेंट सत्र में नए सिरे से इंजेक्ट होता है, इसलिए यह `reviewerProvider: fork` और `reviewerProvider: spawn` दोनों में समान रूप से समीक्षक तक पहुँचता है — एक ही अनुरोध पर दोनों में बाइट-दर-बाइट समान मापा गया। इसे बंद करने वाला `agent/pre-step` स्रोत फ़िल्टर है, दोनों प्रदाताओं के साथ; **केवल `spawn` अपनाने से वर्कस्पेस निर्देश समीक्षक तक पहुँचना बंद नहीं होते।** अलग से, `fork` चाइल्ड को प्रत्यायोजक सत्र के पूर्ण हुए टर्न से सीड करता है: वह इतिहास पहले से चाइल्ड का अपना लॉग है, किसी चरण में प्रवेश करता संदेश नहीं, इसलिए फ़िल्टर उस तक नहीं पहुँच सकता और केवल `spawn` उससे बचाता है — बीच में समीक्षक प्रॉम्प्ट की अविश्वसनीय-ट्रांसक्रिप्ट बाड़ शमन के रूप में रहती है। ऊपर की दोनों ट्रेस में सीडिंग से कोई अतिरिक्त संदेश नहीं बना, इसलिए उसका व्यावहारिक प्रभाव अपरिमाणित है।
- समीक्षक को एक कार्यशील LLM मार्ग चाहिए (डिफ़ॉल्ट रूप से विरासत); इसके बिना हर समीक्षा `fallbackPolicy` के अनुसार गिरती है — कभी मौन अनुमति नहीं।
- `reviewerTools` नाम प्रोफ़ाइल में वैश्विक टूल के रूप में मौजूद होने चाहिए; अज्ञात नाम समीक्षक चाइल्ड को सबसे पहले बिंदु पर ज़ोर से विफल करता है और fallback होता है।
- जोखिम नियम अपने `field` के अनुसार अनुरोध के `reason`, `toolName` या संशोधित कॉल `arguments` से मिलते हैं; बाकी शर्तें `toolsPolicy.overrides` में रखें।
- `/auto-review approve` ओवरराइड उसी टूल की अगली समीक्षा को अधिकृत करता है, उस सटीक ऐतिहासिक कॉल को नहीं; उसी टूल पर एक भिन्न क्रिया उसे उपभोग कर लेती है।
- निर्णय घटनाएँ केवल-लॉग हैं; वेब समीक्षा पैनल मुड़ा हुआ `autoReview` प्रोजेक्शन पढ़ता है (कच्ची घटना धारा ब्राउज़र प्लगइन तक कभी नहीं पहुँचती)।
- मार्कर का सम्मान करने वाले होस्ट पर `autoReview/state` और `autoReview/verdict` लिफ़ाफ़े के `ignorable: true` मार्कर के साथ जोड़े जाते हैं, ताकि कोई भी harness बिल्ड लॉग लोड करे — जो पाठक रेपो-बाहरी प्रकारों को नहीं जानते वे उन रिकॉर्ड को बस छोड़ देते हैं। रिलीज़ किए गए rc होस्ट (rc.1–rc.8) पर runtime छूटे मार्कर का पता लगाकर ये घटनाएँ कभी नहीं लिखता (इन-मेमोरी मिरर कमांड, बजट, ब्रेकर और `approve` को सत्र भर बनाए रखता है); 0.5.1 से पहले के संस्करणों से दूषित सत्र `dsh-permission-rules` के `scripts/repair-session-logs.mjs` से मरम्मत किए जा सकते हैं (इसका डिफ़ॉल्ट सेट सभी पाँच `autoReview/*` घटना प्रकारों को कवर करता है)।
- git चैनल को वह एकल `allowBuilds` कुंजी चाहिए जो `dsh` CLI स्वयं `dsh-auto-review` के लिए छापता है। रेपो अपना `pnpm-workspace.yaml` `allowBuilds: { esbuild: true }` के साथ शिप करता है; `typescript` + `tsdown` नियमित `dependencies` हैं।
- वैकल्पिक invariant साथी को `invariants` सेवा चाहिए (agent-spine रचनाएँ जैसे headless/ACP); सादा web प्रोफ़ाइल वह नहीं देता, इसलिए पंक्ति बंडल पैच में टिप्पणी-बंद शिप होती है।

## संबंधित कार्य

- [Andy8647/dsh-auto-approval](https://github.com/Andy8647/dsh-auto-approval) — `tools/pre-execute` कैस्केड पर फ़ाइल-लॉग ऑडिट के साथ दो-स्थिति allow/deny वर्गीकरणकर्ता। `dsh-auto-review` जान-बूझकर भिन्न है: आधिकारिक **answerer** श्रृंखला, हमेशा वही सौंपता है जो उसका नहीं है, संरचित निर्णय वाला केवल-पढ़ने वाला दूसरा मॉडल, अस्वीकृति कारण मॉडल को लौटाए जाते हैं, सत्र-लॉग ऑडिट।
- [ACP automation bridge](https://github.com/deepseek-ai/deepseek-harness/tree/master/packages/acp/acp) — अपने स्वयं के ACP-स्वामित्व वाले एजेंटों के लिए एक-बार मशीन निर्णय। `dsh-auto-review` इंटरैक्टिव harness के लिए सत्र- और टूल-नीति-दायरे वाला है; यह कभी टिकाऊ अनुदान नहीं निकालता।

## विकास

```sh
pnpm install                # node ^22.19 || >=24
pnpm run typecheck          # tsc: src + tests, स्थानीय harness checkout के विरुद्ध
pnpm test                   # vitest: 25 spec फ़ाइलें
pnpm run build              # tsc घोषणाएँ + tsdown बंडल (lib/, क्लाइंट बंडल सहित)
pnpm run verify:self-contained
pnpm pack                   # प्रकाशित tarball
```

रिपॉज़िटरी लेआउट: `src/index.ts` (प्लगइन अनुबंध) · `src/config.ts` (Schemastery स्कीमा + समाधान) · `src/runtime.ts` (answerer, कमांड, अस्वीकृति-कारण इंजेक्शन) · `src/review.ts` (समीक्षक ऑर्केस्ट्रेशन, प्रॉम्प्ट, स्वच्छता) · `src/events.ts` (सत्र-घटना शब्दावली + मोड़) · `src/projection.ts` + `src/projection-types.ts` (`autoReview` सत्र प्रोजेक्शन) · `src/invariant.ts` (invariant साथी) · `src/eval/` (dsh-eval इंजन) · `eval/` (शिप की गई मूल्यांकन रचना) · `bin/dsh-eval.mjs` (CLI लॉन्चर) · `src/client/` (ब्राउज़र आधा) · `test/` · `fixtures/`।

## विषय

`deepseek-harness`, `dsh`, `dsh-plugin`, `cordis`, `approval`, `auto-review`, `second-model`, `ai-safety`, `sandbox`, `subagent`

## योगदानकर्ता

- [@PerryLink](https://github.com/PerryLink) — निर्माता और अनुरक्षक: अनुमोदन answerer, समीक्षक उप-एजेंट, जोखिम नीति और सर्किट ब्रेकर, सत्र-प्रोजेक्शन समीक्षा पैनल, invariant साथी, dsh-eval, और पाँच-भाषा दस्तावेज़।
- [@weipeng1999](https://github.com/weipeng1999) — समीक्षक के स्वतंत्र प्रदाता/मॉडल रूटिंग का प्रस्ताव रखा ([#11](https://github.com/PerryLink/dsh-auto-review/issues/11), [चर्चा #12](https://github.com/PerryLink/dsh-auto-review/discussions/12)), जो `reviewerProvider` / `reviewerModel` के रूप में जारी हुआ।
- [@alexchenzl](https://github.com/alexchenzl) — DSH प्लगइन निर्देशिका में प्लगइन को सूचीबद्ध किया ([#10](https://github.com/PerryLink/dsh-auto-review/issues/10))।

### DSH Desktop मार्केट से इंस्टॉल करें

सभी PerryLink प्लगइन DSH Desktop के बिल्ट-इन मार्केट में देखे जा सकते हैं: **Market → Sources → add source → पेस्ट करें** `https://perrylink-dsh-catalog.perrylink.workers.dev/catalog-source.json` **→ चुनें**। इंस्टॉलेशन मार्केट के npm-identity सत्यापन और आपकी पुष्टि से ही होता है।

## लाइसेंस

[Apache License 2.0](LICENSE) © 2026 dsh-auto-review contributors
