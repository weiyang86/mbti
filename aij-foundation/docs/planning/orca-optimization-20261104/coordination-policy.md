# ORCA-B01 协作与资源约束

2026-11-04 负责人授权四卡、总预算12有效工程小时。AF-125/GOV 2h、AF-126/DELTA 3h、AF-127/GEN 4h、AF-128/CI 3h，含集成验证成本；单卡超过4h先保留成果并拆卡。正式编号扫描 docs/scripts 无125..128占用。原规划基线仅为历史；本次起始 dev/origin/dev 均为8546cbc3ff44e91aeb020d0566cd972759c3cbf3，工作区干净。

允许本仓库已注册 Orca 子 Worktree 独立开发；每卡只有一个 Writer，dev 仅总控集成。原轻企仓库继续只读，不修改其文件、分支、数据库或进程。主工作区唯一总控；旧 barracuda 不可作为任务基线。许可/发布与负责人历史验收均不改变。

正式 Run 与8个开发/集成 Task 的实际ID见 [运行映射](ORCA-B01-runtime.json)。候选节点并不代表DEV_INTEGRATED。其余三张卡的开发节点均依赖GOV集成节点 task_04c12ee99f6d。后续新代码依赖仅使用 I-* 集成 Task 的真实ID；GOV必须先验证、提交、推送并核对远端SHA，再标集成完成、启动三个Worker。派发时总控和Worker各核对最新已验证 origin/dev 的起始SHA，写入运行映射；沿用默认模型，不传model/effort。

总控独占 dev、AGENTS、CURRENT_STATE、队列、registry、package.json、锁文件及共享契约。Worker严格按模板各自独立文件范围开发，只提交精确共享文件请求。需要修复时退回原Writer；只有原Writer明确停止并交接后总控才能应用候选差异。禁止reset/clean/stash覆盖他人工作，不宽泛暂存，不改main/tag/PR，不强推。

资源租约：数据库验收并发1，重型构建并发1，均由总控在原dev串行执行。Worker禁止建库/迁移/Seed或Next全构建；尚未验证子工作区目标保护时，不开放任何DB操作。测试只用本库受保护隔离测试库、合成数据和loopback离线Provider；不调用收费AI/支付，不做生产操作或部署。常规纯检查可各自并行；候选积压超过2张先集成，不增派。

每个Worker使用独立node_modules/.artifacts/存储，不链接其他工作区可变目录，不复制真实.env或凭据。以setup skip创建，Worker实际运行pnpm install --frozen-lockfile，成功后才开始；只共享pnpm下载缓存。环境失败先报告，不能绕过目录/数据库保护，不停止无关进程。

交接必须提供起始SHA/remote/分支、候选SHA或可分离补丁、实际命令/退出码/证据、未运行项、数据库/接口/页面/权限/日志影响、共享文件请求、实际有效耗时和明确停止写入。通过Orca ask/reply/send/worker_done协作，不通过终端注入，不轮询check抢走信件。非零默认失败；DELTA捕获失败可完成审计，但对应产品功能不能标PASS。

总控接收后逐卡精确应用、登记verify:task、执行适用门禁和真实成功/拒绝路径、保留失败证据、更新执行/队列，按任务原标题一次正式提交并快进推送dev。回读远端SHA相等后才将I-*标completed。自查不冒充独立复核，CODE_VERIFIED、DEV_INTEGRATED、OWNER_ACCEPTED分开。批次完成、预算到达或硬阻塞即停，统一Review出口为OWNER_CHECK_PENDING，不自动续批。

核验：Node24/pnpm10与原dev已有隔离环境；本卡只检查治理文件、计划DAG、范围/预算与实际ID映射，不执行或宣称产品DB/HTTP/build通过。后续环境/数据库失败准确保留，不以历史.artifacts替代本次验收。
