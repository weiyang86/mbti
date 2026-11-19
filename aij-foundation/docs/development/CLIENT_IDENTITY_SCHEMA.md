# 通用客户身份Schema（AF-007）

2026-10-20 AF-025-A增量：五个客户模型定义不变，现已由唯一ClientAuthModule消费登录/会话签发及当前DB认证，真实HTTP/数据库测试通过；下文未迁运行时/未建表是AF-007历史。客户logout/撤销/改密/同意/注册/找回仍未实现，见[客户认证指南](CLIENT_AUTHENTICATION.md)。

2026-10-19 AF-008增量：另增6个配置/引用/审计模型，原12个管理/身份模型定义保持不变。下文“完整12模型”是AF-007阶段事实；当前完整18模型由AF-008校验，身份回归仍按原12项清单检查且保留全部断言。项目组织不成为客户身份/权限依赖，见[配置Schema](CONFIGURATION_SCHEMA.md)。

日期2026-10-19。实际模型名称沿用已核验来源及F00清单，逻辑Member/Session/OneTimeToken/Consent/RateBucket分别对应下列五模型；统一实现在`apps/api/prisma/schema.prisma`，owner为AIJ identity。管理员的SysUser/SysRole等七模型仍归AIJ core，定义保持不变，两组没有外键关联。

| 模型 / 映射表 | 通用定义与约束 |
| --- | --- |
| MemberUser / member_user | username/mobile/email可空且各自唯一；nickname必填；passwordHash可空、无默认密码；tokenVersion默认0；passwordChangedAt/emailVerifiedAt/lastLoginAt可空；status默认active及索引；仅authSessions/authTokens/consentRecords反向关系 |
| ClientAuthSession / client_auth_session | memberId必填外键；status、deviceHash/deviceSummary/ipHash、issuedAt/expiresAt/lastSeenAt；revokedAt/revokeReason可空；member/status/lastSeenAt组合索引和expiresAt索引 |
| ClientAuthOneTimeToken / client_auth_one_time_token | memberId/purpose/tokenHash/expiresAt必填，tokenHash唯一；consumedAt/revokedAt可空；member/purpose/createdAt及purpose/expiresAt索引；没有原始Token字段 |
| ClientConsentRecord / client_consent_record | memberId、consentType、granted、textVersion/textDigest、source必填；granted没有默认true；capturedAt默认now；member/type/capturedAt索引 |
| ClientAuthRateBucket / client_auth_rate_bucket | scope/keyHash复合唯一；attemptCount默认0；windowStartedAt/lastAttemptAt必填并默认now，blockedUntil可空；scope/blockedUntil及windowStartedAt索引；不依赖Member或Workspace外键 |

五模型保留来源cuid主键、createdAt/updatedAt/deletedAt、列映射、字符串状态和全部8个索引。三条member外键显式Restrict/Cascade，与来源Prisma6必需关系默认动作一致；删除仍有身份记录关联的Member须由未来服务明确处理，软删字段不会自动撤销会话或删除其他记录。MemberUser.passwordHash可空是来源定义，未来注册/密码登录须自行实施校验，SysUser.passwordHash仍必填；当前没有凭据或身份转换服务。

MemberUser的54条非本项反向关系已去掉，包括5条轻企组织关系、企业/诊断/建站/订单等业务关系及lifecycleRequests。后续通用Workspace须由独立组织任务接入；本项既不依赖旧Workspace/CompanyProfile，也不实现或承诺任何租户授权。ClientAccountLifecycleRequest按F00保留在原库，账号导出/注销的模型、接口、后台流程均未迁入。`deletedAt`不等于注销功能已实现。

单次令牌的消费/撤销时间、会话撤销、同意版本与摘要均具备存储字段；本项**没有**令牌生成/哈希/原子单次消费、过期判断、会话撤销逻辑、JWT/issuer校验、同意采集或限流算法。注册、登录、找回、邮件/短信、账号导出/注销、Controller/Service/DTO/Guard及产品页面都未实现。没有迁移/建表、Seed、产品账号、真实会员记录或DB查询，Schema/DMMF检查不能代替数据库约束与认证运行时测试。

在根目录执行：

```bash
pnpm --filter @aij/api prisma:validate
pnpm --filter @aij/api prisma:generate
pnpm run verify:task -- AF-007
pnpm run lint && pnpm run typecheck
```

复用AF-006的精确Prisma/client6.19.0、配置和离线包装器，没有新增依赖、镜像Schema、迁移/Seed钩子。包装器只允许validate/generate，去除真实URL/PG凭据/Node注入参数，使用无密码127.0.0.1:1编译URL，不作为dev/test连接配置。生成物只在本库忽略的node_modules中；未来实际数据库操作须接AF-004/005目标保护。

AF-007注册实际validate/generate、两份真实Node测试和生成类型检查。21项身份断言检查完整12模型集合、F00 owner、管理/客户关系边界、字段/唯一/外键/索引，并将三份非法Schema交真实Prisma验证，均断言P1012/exit1。原23项核心回归保留所有约束断言：核心模型按七项清单检查，业务关系检查覆盖完整Schema；没有把未来任务注册成空PASS。公开类型fixture含workspace/管理员角色/生命周期模型、缺同意值/缺令牌过期字段的5条反向编译断言，不实例化PrismaClient。

来源、hash与许可边界见[SOURCE_PROVENANCE第7节](../governance/SOURCE_PROVENANCE.md)；实际命令/退出码、证据、地址与人工步骤见[AF-007执行记录](../execution/AF-007.md)。本项没有产品登录入口、账号或prepare-manual钩子；**Trea待复核、人工待验**。
