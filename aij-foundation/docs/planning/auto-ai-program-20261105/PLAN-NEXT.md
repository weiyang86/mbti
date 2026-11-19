# 只读细化完整需求执行DAG

负责人2026-11-05明确授权整个 AIJ 正式需求持续自动开发，复用旧代码，允许独立Orca子工作区并行。主Agent独占串行集成、正式队列/registry/共享文件/DB/重型构建，最终交负责人review。
本卡唯一Writer为此Dispatch；开始先核对所在工作区、git status/branch/HEAD/remotes并记录。必须在Orca新建的本仓库子worktree从origin/dev@94b0236f775fa40a07944c5e0545ac6ce0e123f3开始；根目录 /Volumes/Lexar/日常工作/2026/aij底座/aij-foundation 只读，禁止写入。根目录正式需求读取 docs/planning/ai-platform-baseline-20261105/{REQUIREMENTS_BASELINE,SOURCE_GAP_ANALYSIS,DELIVERY_AND_ACCEPTANCE}.md 及traceability.json；这些是冻结历史规划，本次授权以auto-ai-program-20261105为准。
工作区不复制任何.env/凭据/node_modules/上传数据，不连接原轻企库。独立 pnpm install --frozen-lockfile，可按需要本地无连接Prisma generate，不修改锁文件/manifest。禁止DB/Docker/seed/migrate/服务启动/真实厂商/付费/通知/安装新依赖/完整build；只有源码纯测试和目标lint/typecheck。任何DB/完整构建请求交主Agent。使用已配置默认模型，不自行指定模型。
只写本卡allowPaths；不写AGENTS、正式CODING_QUEUE、registry、根package/锁文件/Schema/shared审计offline.test.mjs，遇边界扩展通过orca ask后结束当轮。原有修改保留；发生冲突停止。单卡最多下列有效工时，超限保留证据拆卡；失败不能报告成功。完成目标检查后精确暂存允许差异，候选提交标题逐字采用卡片标题；正式verify与正式状态/记录/队列/正式卡提交由总控执行。候选提交不代表正式CODE_VERIFIED。
交接提供开始SHA/实际worktree Task Dispatch ID、允许路径内diff、命令退出码与有效用例数、未运行/已知失败、主Agent实际验证建议。候选文档必须明确“停止全部写入，交回主Agent集成”；然后调用Orca worker_done。不能自行merge/push/PR/main/tag/部署，不能把自查称独立Review。无需等待Trea。历史owner接收保持原样。
已知AF126 audit中有“成功复现缺陷”断言；本卡修好后此旧审计可能失败，保留失败原貌交总控在集成范围更新，不自行改共享测试或忽略它。

此为只读规划任务，不是正式AF实施卡，不提交代码或修改tracked文件。仅可在自己子worktree .artifacts/auto-ai-program-20261105/plan/ 写报告。根目录所有文件只读。最多1有效工程小时。
对正式40条需求与8阶段提供源码证据支持的小卡DAG（每卡<=4h），允许路径、可并行批次、共享文件资源锁、依赖、成功/拒绝场景、真实外部门禁、优先级和未闭合点。识别当前AF131及AF127/077..080门禁，不能擅自接受或重复建卡。按产品内核/系统插件/行业插件owner分界，论文与维修作为业务验收样例，不硬编码进核心。包含全40需求映射，但不要用全覆盖声明替代可运行成果。重点列出首波三卡后可立即启动的至少6张独立实施卡（名称/allowPaths精确/验证命令/前置），提出不依赖真实商户和厂商凭据的可先做项。后续正式AF由主Agent分配。
无依赖安装、DB、构建或外部调用。完成报告后明确停止写入并worker_done，附绝对报告路径。