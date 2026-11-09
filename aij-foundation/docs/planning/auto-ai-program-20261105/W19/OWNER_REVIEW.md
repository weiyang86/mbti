# W19 负责人待审交付

状态：CODE_VERIFIED / OWNER_CHECK_PENDING。私有单文件Python Skill已形成源码/不可变版本→原Job→固定Linux隔离执行→原JSON FileAsset→实际HTTP/公共SDK闭环。生产默认关闭；当前只通过受信任宿主DI配置固定Docker路径与批准官方镜像digest，尚无管理员开启页面。4卡有限批次到此收口，停止自动续批，未代表负责人接收或完整底座目标通过。

| 卡片 | 实际验证 | 本地提交 |
| --- | --- | --- |
| AF208 登记私有脚本Skill执行并行批次 | run-GDNFwl PASS；冻结合同、910源码blob、实际Task依赖与范围 | 1629c56793e6142d492ec0a435cd61d49182e8cb |
| AF209 实现个人Python Skill不可变脚本版本 | run-BmcueY PASS2+13；44单元、9真实PG场景、旧prompt/Agent保护 | 411b91ceaa6725d3e1623b9633ba657afcee9af8 |
| AF210 接入私有Skill的受控异步脚本执行 | run-nQFcIQ PASS2+15；72单元、18真实Job/PG/Linux场景及原File/WordPDF/Jobnonce回归 | ed4d1dfd71c69d61f584a7a74edcf4e2cf643b8b |
| AF211 提供私有脚本执行API与公共SDK | run-zWnbhV PASS2+15；39单元、10真实HTTP场景/11TAP、外部实包85文件、原runtime18场景/19TAP、workflow13/WordPDF11/Agent34、61保护 | 包含本文件与AF-211执行记录的原名提交；实际SHA见本地Git与I211回执 |

三候选在各自登记Orca工作区只写独立新文件，均明确STOP并提交candidate；root确认910源码blob、各六路径delta后I209→I210→I211串行真实集成，独占共享文件、DB、Linux与重构建。真实任务I209 task_6637e360acfe、I210 task_c6fec6e42973已completed，I211 task_ac8e218b1859只在正式门禁、队列记录和本卡提交回读后完成。Orca Task只是候选/集成状态，不替代owner验收。编排使用[Orca orchestration](/Users/lei/.agents/skills/orchestration/SKILL.md)。

AF211真实HTTP证明七个公共方法在独立安装ESM/CJS/NodeNext下运行；同key并发一个Job，实际提交后响应丢失仅一次POST加显式GET恢复；默认关闭拒绝、当前身份/空间/权限/head/session/run到期拒绝，晚存储读取撤权清零，JSON附件来源头/字节/hash正确。原Job/File/认证/Skill owner唯一，AI Run/Trace/成本无新增。全部自有API/proxy/peer池和socket已关闭，owned容器已清理；测试库保留且可连接。没有常驻访问地址。

数据库影响：209新增不可变脚本源码扩展与范围/新原版本约束、脚本独立权限；210新增私有script-run来源/输入/一次attempt/原Job/原附件关系及持久清理围栏，输入为有界PostgreSQL json以无损支持JSON NUL。修改原Auth的实时到期复检、原Job生命周期锁序和原runner保留BOM供JSON严格拒绝；原文件owner新增JSON、无DB锁跨IO的清理与提交回读。211无新结构或权限，接线/API/SDK/说明书及回归测试时限修正。只在核验归属的本库隔离test实例创建新验收库执行迁移，不改源产品/dev/真实数据，不reset/drop。

首次Astra只读审查task_30a9432b5d16指出1P1+5P2，root修正并在最终210及211实测覆盖。再次独立回看task_fbf7b406f1e3因Codex CLI更新菜单停在agent_readiness，未执行；已按实际next释放终端，不全局升级、不盲重试、不据此宣称模型限额。修正后是root自查和真实门禁通过，不能称独立复核再次通过。所有旧FAIL和修正前较窄PASS原样保留；211前三次FAIL分别为回归fixture的2秒执行期限、持连接等待超5秒SQL限制、验收脚本三个未使用变量；已修正测试设置/清理未用声明并将完整lint前移，产品拒绝与限制均未放宽。

有效工程时间保守人工估计：AF208 0.75h、AF209 1.9h、AF210 3.2h、AF211 3.3h，合计9.15h<=批准11.5h（含root、审查、恢复、修正与验收；不是墙钟统计）。本地提交仅本卡可隔离diff；AF191/203与用户playbook、共享文件中的继承改动保留，不夹带提交。root来源冻结记录实际被验收的工作区字节（含已有AF203准入项）；单独索引的projection/staged.patch记录本卡提交字节并剔除继承项，二者不冒充同一份clean-checkout冻结。产品源文件一致，差异仅继承准入/记录，新的AF211准入独立保留。无push、远端Issue/PR、main合并、tag、发包或部署。

人工验收按[操作说明](../../../development/PERSONAL_SCRIPT_EXECUTION.md)准备本库独立环境和受信任执行配置：创建私有Skill新脚本版本，默认未配置提交503；启用后同key提交、等待原Job、显式恢复和下载比对摘要；撤销session/read/execute/manage或修改head，确认对应拒绝与无重复执行。页面/菜单未增加，日志不含源码/输入输出正文；真实账户/密钥保持空。

剩余：脚本执行网页、Agent可执行绑定、多文件/依赖包、输入附件、工具/网络/审批和公开付费市场，以及多步/条件/并行/循环/多Agent完整编排；AF191原生14场景/同Run独立前端与AF203原生导出验收尚未通过。40完整目标仍NOT_RUN_TARGET_ACCEPTANCE；vendor DEFERRED_NOT_PASSED；当前交付是限定切片，无完成率或全目标通过声明。下一有限批次须由负责人决定，本批Writer在提交与I回执后停止写入。
