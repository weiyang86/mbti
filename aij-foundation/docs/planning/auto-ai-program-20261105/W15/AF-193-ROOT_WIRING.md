# AF-193 root integration (candidate only)

Frozen source: root W15/CONTRACT.md, 2026-11-06. No real credentials or vendor calls; all external verification remains NOT_RUN. Integrate only the candidate delta; do not cherry-pick the bootstrap commit.

## Root-owned wiring

- ConfigurationModule: import/add `ExternalServicesController` to controllers and `ExternalServicesService` to providers. Existing RbacModule and SecretCenterModule supply ManagementAccessService and SecretRefPort. Host ConfigModule/PrismaModule remain unchanged. Export service if needed. Preserve existing configuration routes.
- SDK index: `export * from "./external-services.js";`; build contracts then SDK. Public exports: createExternalServicesApi, ExternalServicesApi, ExternalServiceCatalog, ExternalServiceProvider, ExternalServiceField, ExternalServiceSave, ExternalServiceView. ClientApi paths are app-relative `/admin/external-services`; base already ends in `/api`. AF-194 uses the real useAdmin request/CSRF adapter and catalog as the single schema owner.
- Root registers formal AF-193 verification and acceptance lease guards, composes UI in existing AdminConfiguration, runs API build/PG/browser and normal ScopedConfig/SecretRef regressions. Worker changes no module/index/schema/registry/queue/dependency/global files.

Routes: GET `/api/admin/external-services/catalog`, GET `/api/admin/external-services`, GET/PUT `/api/admin/external-services/:providerCode`. Every route requires admin.config.manage via host guards AND fresh transaction authorization. Reads also use ManagementAccessService.write's shared lock for consistency (14 providers only). Credential modifications additionally require admin.secret.manage. Missing/disabled project or organization/environment mismatch refuses; project ID comes exclusively from the server.

Body `{expectedVersion,fields,credentialRefs?}` only. Fields replace the entire dictionary. Missing credential dictionary/key preserves; null explicitly clears; nonempty strings must be existing configured owned refs. Empty fields/ref-free drafts persist. Version0 means never saved; exact no-op keeps version. Configuration+CAS+ConfigurationChange+audit share the transaction. Private disabled ScopedConfig rows use key external.services.<code>, project profile scopeId, pluginCode empty, valueType string, sensitive true, isPublic false. Generic config unknown-key projection redacts this JSON and unknown writes are rejected by the existing owner. Preserve that regression.

Keep the controller body parameter typed `object`: host's permissive global ValidationPipe would otherwise remove unknown DTO keys before the strict raw pipe can reject them. The actual DTO class has class validators; custom raw pipe and service provider parser repeat strict checks. Reject unknown/prototype/accessor keys, controls/CRLF, >16 fields, >8192 UTF8 bytes, per-field bounds, non-HTTPS URL/auth/query/hash, malformed mail host/address/port. No real value is resolved; configuredTrusted returns availability only. Errors/audit/views never contain references. Webhook URL is itself a ref because it can contain authentication. No runtime adapter reads these drafts.

`credentials_ready` means only this limited draft schema is complete and its refs available. Every view remains runtimeEnabled:false/externalVerification:not_run. This does not prove certificate validity, credentials correctness, recipient/template registration, SMTP TLS policy, storage privacy/allowlists, channel qualification, payment/notification/storage runtime operation or AF191/full40 success. Additional adapter fields and activation remain separate work.

## Official field references

Checked 2026-11-06; lengths/HTTPS-only rules are local draft limits, not vendor claims. CamelCase is a draft mapping, not literal vendor request encoding. Research fetched documentation only, no vendor API requests.

| Provider | Draft mapping | Official reference |
| --- | --- | --- |
| deepseek | baseUrl/model/apiKey ref | [First call](https://api-docs.deepseek.com/quick_start/agent_integrations/), [model](https://api-docs.deepseek.com/api/create-chat-completion/) |
| aliyun | OpenAI baseUrl/model/apiKey ref | [Model Studio compatibility](https://help.aliyun.com/zh/model-studio/compatibility-of-openai-with-dashscope) |
| qiniu | bucket/region/downloadOrigin; accessKey/secretKey refs | [Parameters](https://developer.qiniu.com/kodo/7450/the-third-party-plug-in-key-parameters), [region](https://developer.qiniu.com/kodo/4088/s3-access-domainname) |
| wechat-pay | appId←appid/merchantId←mchid/notifyUrl; APIv3Key/privateKey refs | [Official SDK JSAPI schema](https://github.com/wechatpay-apiv3/wechatpay-go/blob/main/services/payments/jsapi/models.go), [SDK setup](https://github.com/wechatpay-apiv3/wechatpay-go) |
| alipay | appId/notifyUrl; privateKey/alipayPublicKey refs | [Official Node SDK](https://github.com/alipay/alipay-sdk-nodejs-all/blob/master/README.md) |
| douyin-pay | appId; salt ref | [Payment preparation](https://developer.open-douyin.com/docs/resource/zh-CN/mini-app/open-capacity/business-monetization/guaranteed-payment/TE) |
| email | host/port/from; username/password refs | [SMTP](https://nodemailer.com/smtp), [sender](https://nodemailer.com/message) |
| sms | signName/templateCode; accessKeyId/accessKeySecret refs | [Aliyun SDK](https://help.aliyun.com/en/sms/developer-reference/using-java-openapi-example) |
| wechat-official | appId; appSecret ref | [Token](https://developers.weixin.qq.com/doc/offiaccount/Basic_Information/Get_access_token.html) |
| wechat-miniapp | appId; appSecret ref | [Token](https://developers.weixin.qq.com/miniprogram/dev/OpenApiDoc/mp-access-token/getAccessToken.html) |
| wecom | corpId/agentId; corpSecret ref | [Concepts](https://open.work.weixin.qq.com/api/doc/90000/90135/90665), [token](https://developer.work.weixin.qq.com/document/path/91039) |
| dingtalk | appKey; appSecret ref | [Internal app token](https://open.dingtalk.com/document/orgapp/obtain-the-access_token-of-an-internal-app) |
| feishu | appId; appSecret ref | [Official SDK credential setup](https://open.feishu.cn/document/server-side-sdk/python--sdk/handle-events) |
| webhook | entire webhookUrl ref, no public URL field | Product-local generic draft, [HTTP semantics](https://www.rfc-editor.org/rfc/rfc9110) |

Source limitation retained: official Weixin/miniapp/WeCom pages could not be retrieved (404/timeouts), Dingtalk HTML had no readable body and its Markdown timed out. Their minimal reference mappings require root readable official-document recheck before source validation can be called complete. No third-party tutorial substitutes as authority. No channel acceptance is inferred.

## Checks and root-only PG procedure

Worker unit command: `node --test scripts/verification/external-services.test.mjs`. It compiles actual source classes in memory, executes strict DTO/raw pipe, actual Nest controller with host global ValidationPipe, candidate SDK module behavior and strict targeted API/SDK compiler diagnostics. Transaction/authorization dependencies are synthetic; this is not PG acceptance. Worker SDK build covers existing exports only until root adds the candidate to index. No API/Web application build ran.

Root must first wire/export/build, register AF-193 in root-owned DB guards, create a **fresh AF-193 protected acceptance lease** and deploy approved migrations with existing DB tooling. Do not use a seeded/nonempty DB. Run only in root dev worktree:

```sh
AIJ_AF193_ROOT_ACCEPTANCE=true DATABASE_ACCEPTANCE_ID=<fresh-AF-193-lease> node --test scripts/verification/external-services-live.test.mjs
```

The script requires exact root/main-worktree/dev identity, matching protected lease, real compiled AppModule and built public SDK. Missing module/lease/opt-in FAILS, never SKIP. It does not create/adopt/reset/migrate/seed a DB. Only synthetic rows and in-memory random credentials are created. It checks actual HTTP guards/CSRF/current permissions, project scope/admin403/cross-product token refusal, empty draft persistence, unknown/raw-secret rejection, concurrent CAS, real PG audit-trigger rollback, preserve/clear/projection, disabled contexts, zero resolve/external calls and cleanup. Removes its rows, closes sockets/app/pools and restores environment/hooks. Lease remains for root-controlled cleanup. Worker only syntax/lint checks this script; PG/browser/vendor checks remain NOT_RUN.

No URL remains running. Manual owner flow: config-manager login → catalog → empty draft save/reload → edit/conflict preserves draft → secret-manager synthetic ref preserve/clear → ungranted403 → inspect safe views. Keep real credentials blank. Formal acceptance, SDK package export and downstream UI dependency require root integration Task ID; candidate Task is not CODE_VERIFIED.
