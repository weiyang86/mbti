# AF-020 菜单树与权限过滤API

AF-020已由负责人接收并提交b343329；当前AF-021人工API/PID与凭据步骤见[字典指南](DICTIONARY_API.md)，本篇旧PID/Schema/校验记录按历史保留，不用旧stop命令判断当前进程归属。

本轮仅API，不新增Web后台页面或插件安装。Controller/DTO/Service为`apps/api/src/menus/`；唯一权限解析仍属RbacModule，唯一数据连接属PrismaModule，写锁/事务/安全成功审计复用ManagementAccessService。定向来源为原AdminService菜单CRUD、父节点分组和递归树结构；适配说明见SOURCE_PROVENANCE第20节。

## 1. 接口与数据规则

全部路径前缀`/api`，响应沿用`{success,data,message}`和关联ID；成功/拒绝均`Cache-Control: no-store`。Auth关闭时不装配MenusModule。

| 方法/路径 | 服务端要求 | 结果 |
| --- | --- | --- |
| GET `/admin/menus/my` | 有效管理员JWT；仅本人 | 按当前DB权限、页面与插件可用性过滤的嵌套树 |
| GET `/admin/menus` | 当前有效`admin.menu.manage`；DB超级仍要求定义active | 管理树，包括停用草稿/空目录；同层sortOrder、id升序 |
| GET `/admin/menus/pages` | 同上 | 服务端实际页面目录；当前仅`/`、pluginCode=null、available=true |
| POST `/admin/menus` | 同上 | 创建，返回201 `{id}` |
| PATCH `/admin/menus/:id` | 同上；写锁后同事务重查操作者 | 修改标题/父节点/顺序/路径/权限/可见性/状态，返回200 `{id}` |
| DELETE `/admin/menus/:id` | 同上；有未删孩子409 | 软删并disabled，返回200 `{id,deleted:true}` |

创建必需title/path。type=`directory|menu`（默认menu），parentId默认null，sortOrder整数[-10000,10000]默认0，visible默认true，status=`active|disabled`默认active；icon只接受短标识，permissionCode/pluginCode/parentId可空。修改只覆盖明确传入字段，空更新400；多余字段、错误类型/null（非nullable项）400。最多500条未删记录、树深最多64层。不存在父节点404，父节点必须directory，循环/过深400；同写锁保证并发环不能提交。管理树不代表可导航。

- `directory`是结构节点，permissionCode必须null，个人树path=null且只随获准子节点显示。独立空目录不显示；不可通过目录获得权限。父级不可见/停用/不可用会阻断全部后代。
- `menu`必须绑定后端目录中的active权限码（GET `/admin/permissions/manage`仍有独立权限要求）。active菜单路径必须精确匹配服务端实际页面注册；当前只有工程入口`/`，`/auth/admin-users`、`/auth/roles`、`/auth/menus`、`/login`等页面尚未实现，启用均400。可先保存为disabled草稿，不能绕过启用检查。
- 只接受规范绝对站内路径；外部/协议相对/JavaScript URL、点段、百分号编码、反斜杠、查询、fragment、重复斜杠/尾斜杠均400。当前没有受控外链白名单，全部外链拒绝。
- 个人树使用同一RepeatableRead事务调用既有权限解析与读取菜单。普通用户仅有active用户/角色/权限关联才获准；空权限返回[]，客户端permission/workspaceId/超级标志不参与判权。DB超级可绕过角色grant，但菜单仍须active权限定义、真实页面、可见/启用父链和插件条件。
- 不缓存角色权限；撤权、停用角色/权限、菜单变化提交后下一请求生效，在途事务按其快照完成。只给菜单、不授API权限；所有admin API仍由统一JWT/RBAC强制判权。
- MenuAvailabilityService预留`pluginEnabled`和`pageAvailable`：插件必须运行时启用且精确注册页面。当前可迁入插件白名单和插件页面均为空；手工写入pluginCode或数据库enabled行不会伪造插件安装/装配。实际插件停用生命周期由后续独立任务接入本契约，不宣称已实现热切换。
- 软删保留唯一path占位及SysRoleMenu历史，不删用户/角色；不提供路径恢复或角色菜单分配API。个人树使用有效权限绑定，历史SysRoleMenu行不作为授权来源。
- 成功审计module=menus，action=`menu_created|menu_updated|menu_deleted`，同事务保存操作者、资源ID、关联ID和改变字段名；不保存title/path/密码/hash/Token等原始业务值。失败不生成成功审计；失败权限审计仍归既有RBAC owner。不是完整通用审计查询服务。

显式`pnpm run db:seed -- test --menus`只在通过目标保护及迁移检查的目标注册`admin.menu.manage`定义；不自动给既有角色授权、不恢复停用定义、不创建菜单。默认Seed仍七行。真实本地验收使用任务新合成库，不要将该示例命令用于已有库补数据。

## 2. 自动复核

```bash
pnpm run verify:task -- AF-020
pnpm run lint
pnpm run typecheck
```

普通verify包括真实Prisma编译、API构建、前序294项回归、两宿主和本项HTTP/数据库/真实main生命周期测试。测试注册见scripts/verification/registry.mjs，逐条命令与退出码见AF-020执行记录。不改源码，不运行verify:dev探针，不启停数据库容器；测试只能写登记的本地合成库和忽略证据/凭据/缓存。审计故障trigger/function只在本任务新库创建并finally移除，不DROP DATABASE/table或reset。

Writer可通过注册钩子`pnpm run verify:task -- AF-020 --prepare-manual`准备本任务三账号和本库API；Trea不运行prepare。重复准备不改密码/角色/菜单，初始菜单为空不是失败；PREPARED不等于人工验收。

## 3. 人工步骤（待负责人执行）

实际地址/PID/库名/凭据文件见下方现场记录。没有菜单页面；使用终端Node或API客户端。密码只从本机忽略文件读取到内存，不放命令参数或回显；Token仅内存持有，不贴入报告。

1. 读取`.artifacts/af-020/manual.json`记录；`initialPasswordFile`为aij-admin，`accounts[0].initialPasswordFile`按username查af020-manager/af020-reader。真实初始密码在各自JSON的password字段；若负责人已改密，文件只代表首次值，prepare不恢复它。不要读取/展示jwtKeyFile或数据库密码来登录API。
2. `POST /api/auth/login`用username/password获取内存Token。三账号均200；GET health/ready均200；不带Bearer的menus/my和menus为401。aij-admin与af020-manager调用管理树/页面目录200，af020-reader管理树403、本人树200/[]。
3. aij-admin创建目录`{title:"AF020人工目录",path:"/manual",type:"directory"}`（201），再创建`{title:"工程入口",path:"/",parentId:<目录id>,permissionCode:"aij.bootstrap.admin"}`（201）。仅实际`/`可启用。三账号本人树预期：超级管理员有目录/叶子；manager没有bootstrap权限返回[]；reader有bootstrap权限返回目录/叶子。目录path=null。reader直接GET `/api/admin/users`仍403，证明菜单不替代API授权。
4. PATCH叶子`{visible:false}`后reader树[]，改true恢复；PATCH目录`{status:"disabled"}`隐藏后代，改active恢复。修改目录sortOrder与其他新目录比较顺序；管理树包含空目录，个人树不显示它。
5. 使用已有角色/权限API在保持其余授权的情况下撤销/恢复reader的bootstrap权限：先GET `/api/admin/permissions/manage`与`/api/admin/roles`获取真实ID。root PUT `/api/admin/roles/:id/permissions`以ID集合替换。原JWT本人树应立即[]/恢复；不要给自己提权。停用reader角色同样隐藏，恢复后可见。不改fixture账号密码。
6. 尝试父目录parentId=self/后代→400，外部链接/点段→400，不存在启用页面→400，未知权限→400；reader调用菜单写接口→403，数据不变。可将未来页面保存disabled草稿，启用仍400；pluginCode=aij-ai的active菜单400，不需要安装插件。
7. 用当前test记录的databaseRole和databasePasswordFile在本机安全配置数据库客户端，连127.0.0.1:55433/现场合成库，只读查audit_log module=menus，核对操作者/资源/关联ID/fields及三种action。密码与hash不复制到报告。删除有孩子目录409；如软删叶子，则reader树[]，用户/角色不删、唯一path保持，后续重复人工创建可能409；prepare不清库，按现有记录继续观察。
8. 需要复跑普通verify前交回Writer，用`node scripts/verification/menus-manual.mjs stop`核验PID/PPID/CWD/命令/birth后只停记录API并确认零池。保留合成库/卷/凭据，不reset/drop/down -v。恢复由Writer再跑注册prepare；其他项目进程不操作。

安全调用示例（仅输出状态和菜单JSON，不输出登录响应）：

```js
// 在本库根目录 node --input-type=module 中执行；将credential选择为当前目标账号。
const fs = await import('node:fs');
const state = JSON.parse(fs.readFileSync('.artifacts/af-020/manual.json'));
const credential = JSON.parse(fs.readFileSync(state.initialPasswordFile));
const login = await fetch(state.loginUrl, {method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({username:credential.username,password:credential.password})});
if (login.status !== 200) throw Error('Login failed; no credential reset');
const token = (await login.json()).data.accessToken;
const call = async (path, method='GET', body) => {
  const response = await fetch('http://127.0.0.1:3656/api/'+path, {method,headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:body ? JSON.stringify(body) : undefined});
  console.log(response.status); return response.json();
};
console.log(await call('admin/menus/my'));
```

## 4. 本轮现场

以AF-020执行记录及`.artifacts/af-020/manual.json`为准；人工验收仍待执行。历史角色/管理员指南中的旧PID不是本任务入口。

本轮普通verify报告`.artifacts/verification/AF-020/run-I1zPsI/report.json`（exit0/PASS，312+2），注册prepare报告`.artifacts/verification/AF-020/run-kEQTqJ/report.json`（exit0/PREPARED）。人工API PID **72456**，启动Mon Oct 19 20:46:28 2026，CWD `/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/apps/api`，本机Node执行本库dist/main.js，仅127.0.0.1:3656，一条自有池；Web3655未启动。

- API：`http://localhost:3656/api/admin/menus`、`/api/admin/menus/my`、`/api/admin/menus/pages`；health/ready当前200，无Bearer菜单401。
- 合成库：`aij_foundation_af020_test_3f1d9f077d88af1d`，地址127.0.0.1:55433，角色`aij_foundation_test`。aij-admin为DB超级管理员；af020-manager有菜单/角色/权限管理；af020-reader仅bootstrap。三账号实际登录/me/本人树200，管理菜单200/200/403；初始树全部[]，需要负责人按步骤创建真实页面菜单。
- aij-admin初始密码文件：`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/seed/test/aij_foundation_af020_test_3f1d9f077d88af1d/initial-admin.json`。
- 另两账号按username取密码：`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/seed/test/aij_foundation_af020_test_3f1d9f077d88af1d/rbac-management-accounts.json`。数据库密码仅本机忽略文件`/Volumes/Lexar/日常工作/2026/aij底座/aij-foundation/.local-data/postgres/test/postgres-password`。不回显任何密码/hash/Token/key，不静默重置；无需读取JWT key即可操作API。
- 停止：`node scripts/verification/menus-manual.mjs stop`，只核验后停本库记录PID；保留库/卷/凭据。恢复：`pnpm run verify:task -- AF-020 --prepare-manual`。普通测试已实测停止与零池，当前为负责人有意保留API。

**Trea待复核、人工待验**；自动观察不代替负责人操作，未commit/push/发布/部署。
