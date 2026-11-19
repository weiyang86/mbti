# 插件 manifest 与静态 allowlist

AF-067 / G11-01 在 `apps/api/src/plugin-runtime/plugin-manifest.ts` 建立 API 侧的 manifest v2 校验 owner；`plugin-runtime.module.ts` 是唯一宿主装配点。实现定向适配只读来源 `packages/plugin-sdk/src/index.ts`，保留的原许可证声明见 `PLUGIN_SDK_LICENSE.txt` 与 [来源记录第 15 节](../governance/SOURCE_PROVENANCE.md)。来源标注 `All rights reserved`，本地适配不代表获得公开分发或发行权；没有创建插件 SDK 包，也没有发布任何包。

## 校验契约

- manifest 只接受已声明的 v2 字段；代码、名称、SemVer、核心 API 版本范围、依赖范围和必需的 `featureFlags` 声明都做结构校验。feature flag 必须默认关闭。版本范围当前支持精确版本、`^`、`~` 与空格分隔的比较器组合，不承诺完整 npm semver 范围语法。
- 权限码必须符合插件 `plugin.<plugin-code>.<module>.<action>` 命名空间，并与声明的模块/动作一致。manifest 只是插件权限目录元数据，不向任何角色授予权限，也不覆盖 RBAC Guard。
- 菜单与前端路由必须位于 `/plugins/<plugin-code>/` 下；API 路径仅可位于明确的插件 API 或安全公开 API 命名空间。外链、编码路径、路径穿越、重复入口和未声明权限均被拒绝。
- 敏感配置必须使用 `secretRef`，secretRef 不可有默认值；普通配置的默认值必须符合字段类型。密钥值不属于 manifest。
- 生命周期钩子只能写插件命名空间标识符；迁移只声明唯一 ID 与 SHA-256 校验和。此版本只验证声明，不执行钩子、Shell、任意路径或迁移。
- `validatePluginCatalog` 检查重复插件代码、与当前 `AIJ_PLUGIN_API_VERSION` 的兼容性和静态依赖图。必需依赖必须在可信 catalog 中存在且版本范围相符；可选依赖缺失可接受、存在时仍须版本相符。环会拒绝；`resolvePluginDependencyOrder` 产生确定的依赖优先顺序，不安装或执行插件代码。该能力由 [AF-071](../execution/AF-071.md) 验证。

## 运行时 allowlist

Nest `PluginRuntimeModule` 只接受编译期静态注册的 `PluginRegistration`（经验证的 manifest 加 Nest module class）。manifest 不包含可供 `import()` 的模块路径。当前生产注册表有意为空：默认没有系统插件启动；空启用列表返回空导入，配置了未注册或重复 code 则装配失败。

## G11-04 管理与运行态契约

- 后台路由位于 `/api/admin/plugins`：列表、安装、升级、启用、停用、操作历史和对失败操作的显式重试请求。API 只复用 `PluginLifecycleService`、`PluginCatalog`、Prisma `PluginInstallation/PluginOperation`、`ManagementAccessService` 与审计；没有第二个生命周期 Service。未知/未注册插件和非法版本在写入前拒绝。
- 管理列表显示宿主静态可信目录与当前项目安装记录。管理 API 不从数据库加载任意模块，不执行 manifest 中的路径、Shell 或生命周期 handler。重试只记录 pending intent；不表示插件代码已重跑。
- 插件 HTTP controller 必须逐 controller 或逐 handler 使用 `PluginRoute(code)`。守卫每次请求读取当前项目安装状态；非 enabled 返回不可用，不把前端菜单隐藏当作授权。
- 生命周期 Service 在事务内对相关插件按 code 顺序加锁。安装/升级前检查必需依赖已安装且版本匹配；启用前要求依赖已启用；依赖仍 enabled 时拒绝停用；升级不能令已安装依赖者变为版本不兼容。API 只校验和拒绝，不自动级联安装/停用。
- 插件异步任务写入前在持有生命周期事务锁时检查 enabled；worker 仅 claim 当前项目已启用插件的任务，并在执行时再检查。若 task 已 claim 后状态已关闭，handler 不运行，任务释放租约并置为 retry。已经开始运行的 handler 不会被强行中断；disable 影响状态提交后的新进入和可重验的已 claim 任务。
- 插件凭据只能通过 `SecretRefPort.resolveTrustedForPlugin(code, ref)` 服务端解析；必须有该插件自己的 project-scoped `secretRef` 配置绑定，且安装仍 enabled。禁用后新解析拒绝；普通 secret API 只返回引用和 configured 状态。
- 当前生产静态注册目录仍为空，没有任何真实插件 HTTP 路由、worker handler 或 plugin-scoped 凭据绑定，因此生产进程不会因本 API 自动启动插件。AF-070 的正向路径使用测试专用合成 catalog，并在独立 PostgreSQL acceptance DB 上运行，不构成真实系统插件发布/接入或许可证授权证明。

AF-067 原验证入口为 `pnpm run verify:task -- AF-067`，任务测试真实加载 manifest owner，见 [AF-067 执行记录](../execution/AF-067.md)。AF-067 本卡不新增 Schema、迁移、数据库记录、HTTP 路由、页面或角色授权。
