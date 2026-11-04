# 钟子涵 · 页面联调笔记

> **非权威文档。** 本目录只记录学员（钟子涵）跟着 UIhtml 原型做页面、对照 mock / 契约联调的过程与问题。
>
> - 接口契约以 [`../../api/`](../../api/) 为准，Owner = Remy；本目录**不定义**任何字段或业务规则。
> - 字段对不上、契约没写清 → 记到对应页面的「卡点 / 需拍板」，由日报或 Issue 带给 Remy。
> - 页面本身没跑通、PR 没提时，笔记不构成交付物。

## 索引

| # | 页面 | 源文件 | 笔记 |
|---|------|--------|------|
| 01 | 首页 | `web/src/pages/index/index.vue` | [01-首页.md](./01-首页.md) |
| 02 | 答题页 | `web/src/pages/quiz/quiz.vue` | [02-答题页.md](./02-答题页.md) |
| 03 | 自选类型 | `web/src/pages/self-select/self-select.vue` | [03-自选类型.md](./03-自选类型.md) |
| 04 | 结果页 | `web/src/pages/result/result.vue` | [04-结果页.md](./04-结果页.md) |
| 05 | 晒图预览 | `web/src/pages/share-preview/share-preview.vue` | [05-晒预览.md](./05-晒预览.md) |
| 06 | 阶段记录 · 列表 | `web/src/pages/history/list.vue` | [06-阶段记录-列表.md](./06-阶段记录-列表.md) |
| 07 | 阶段记录 · 详情 | `web/src/pages/history/detail.vue` | [07-阶段记录-详情.md](./07-阶段记录-详情.md) |

## 写法约定

每页四段，控制在 10 行内：

1. **基本信息**：页面路径、日期、对应 PR 分支
2. **调用接口**：用到的路径 + 是否走 mock
3. **字段核对**：逐项打勾，对不上的写在这里
4. **结论 / 卡点**：做完了什么；有哪些需要 Remy 拍板
