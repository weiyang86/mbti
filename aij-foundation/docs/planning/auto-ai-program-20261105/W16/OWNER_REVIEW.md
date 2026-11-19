# W16 负责人待验

本波CODE_VERIFIED，出口OWNER_CHECK_PENDING；4卡保守有效工程工时8.25h（预算11.75h，含root）。没有push、远端PR、main合并、版本发布或持久部署。用户持续授权在有限批次内自动继续，负责人接收仍独立于代码验证。

| 卡片 | 实际交付与验证 | 正式记录 |
| --- | --- | --- |
| AF196 | 843源码bootstrap、真实Task/I依赖和隔离分工；仅治理 | run-zWIKWV，local9b414a5 |
| AF197 | 真实有界纯文本Word/PDF、固定中文字体/缺字拒绝、Linux固定CLI、离线依赖闭包与私有清理能力；7实际格式安全+45原回归、独立阅读器/全部6页视觉、types/build/audit0/lint | run-LueteM，localcc840b9，I197 task_7e8a792ce72f已完成 |
| AF198 | 原始AI transport真实HTTP/PG同任务唯一POST/Run/Job/Trace，上游仅自有合成HTTP；四类真实启动故障，5租约CLOSED/池0/socket0/恢复可连接 | run-fercpH，local0075ab6，I198 task_753e493b8c33已完成 |
| AF199 | 默认关闭的内部Docker文档执行器与受控镜像构建；27单测、真实Linux测试1（含8场景）零跳过，2格式独立解析、真实资源/OOM/Running后超时取消/协议/输出上限、5新镜像精确删除、执行容器无残留、原生成器7回归/types/build/lint | run-xiSXBn，本文件所在原名卡片提交；I199 task_7e0bbf3cd528在本地提交后完成 |

AF197新增21精确锁节点并逐包核官方tarball/实际安装声明，旧792未动；Noto字体与完整OFL来源登记。brotli/dfa/fontkit npm包没有独立LICENSE，发布者MIT声明不是公开分发授权；这条限制保留在来源收据，不用全绿测试替代。其他卡无新增npm依赖或业务迁移。

AF199最终私有Linux证据由 `.artifacts/auto-ai-program-20261105/W16/AF-199-linux-latest.json` 指向。最终本地只读验证fixture image为sha256:b2322ac98afa484dd6722fc3e19775fca9c0bc8e360e9843b9dd0da663a602c1；没有启用应用，预检/较早成功镜像保留为本卡私有验证缓存，不宣称镜像缓存全删除。5个每次运行新建的故障探针镜像均按prebuild清单与双随机label核实后精确删除；没有扫其他镜像/容器。工具准备与QA宿主也已关闭；保留审计资料、合成样本及数据库租约记录。

实际风险修复保留失败：197伪造marker清理漏洞退回原Writer绑定内存能力+inode；199独立只读review提出真实Running/无swap/新镜像所有权/独立cleanup，原Writer修复；operations canonical默认根/临时父目录再次退回并加实文件系统测试。root正式全仓lint发现控制字符正则及finally throw，只等价改码点校验/错误汇总，重新整门禁成功。未抑制规则或省略Linux场景。root后续集成自查不冒充最终独立复核。

当前尚未交付：文档版本与导出附件绑定、下载API/公共SDK/网页入口、AI章节生成/编辑恢复、图表编辑；原AF191真实工作台+外部实包SDK同任务原生14场景仍待闭环。底层生成和执行器均不是完整REQ022或全部40目标完成；其他行业/市场/触发器/支付结算/备份等按正式完整基线继续。厂商账号/密钥空，DEFERRED_NOT_PASSED；真实厂商、商户审核及负责人接收不能由本卡合成上游/文件代替。

人工验收：先看[生成器说明](../../../development/PLAIN_DOCUMENT_RENDERER.md)、[AF199执行记录](../../../execution/AF-199.md)及ops/document-export/README，再按各自注册verify:task准备隔离测试环境，核对真实文件、全部页面与Linux资源/清理回执。没有常驻访问地址；不要在现有网页中期待尚未接入的导出按钮。下一波优先接入文档导出可用链路及AF191原生验收；无人工密钥的独立工作继续自动进行。
