#!/usr/bin/env python3
"""Read-only source audit. Writes metadata only under this repository's docs/generated."""
import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import re
import socket
import subprocess
from datetime import datetime
from zoneinfo import ZoneInfo

TARGET = Path(__file__).resolve().parents[1]
EXPECTED_HEAD = "cd8d006ffd3f2830dd0bdb4e62d0288e059dd9eb"
EXPECTED_TREE = "628140f4b8ae85ccd69be2429431d89b3a6b3091d45b752be99df87ac1a1b955"
EXPECTED_INDEX = "af313d5da18ca523d856d3cf16881043d379ff505d3d7cfb34bbcb5cb3e07d59"


def git(root, *args):
    return subprocess.check_output(
        ["git", "--no-optional-locks", *args], cwd=root,
        env={**os.environ, "GIT_OPTIONAL_LOCKS": "0"}, stderr=subprocess.PIPE,
    )


def fingerprint(root):
    files = sorted(filter(None, git(root, "ls-files", "-z").split(b"\0")))
    digest = hashlib.sha256()
    for raw in files:
        path = root / os.fsdecode(raw)
        digest.update(raw + b"\0")
        digest.update(hashlib.sha256(path.read_bytes()).digest() if path.is_file() else b"MISSING")
    index = Path(os.fsdecode(git(root, "rev-parse", "--git-path", "index")).strip())
    if not index.is_absolute():
        index = root / index
    return {
        "tracked_files": len(files), "tracked_tree_sha256": digest.hexdigest(),
        "index_sha256": hashlib.sha256(index.read_bytes()).hexdigest(),
        "head": git(root, "rev-parse", "HEAD").decode().strip(),
        "branch": git(root, "branch", "--show-current").decode().strip(),
        "status": git(root, "status", "--porcelain=v1", "--untracked-files=all").decode(),
    }


CORE = set("SysUser SysRole SysPermission SysMenu SysUserRole SysRolePermission SysRoleMenu AuditLog SysConfig SysDict SysDictItem FileAsset Plugin PluginMenu PluginPermission PluginInstallLog".split())
CONFIG = set("OrganizationProfile ProjectProfile ScopedConfig ConfigurationChange".split())
RUNTIME = set("RuntimeOutbox RuntimeJob RuntimeSchedulerLock RuntimeIdempotency".split())
IDENTITY = set("MemberUser ClientAuthSession ClientAuthOneTimeToken ClientConsentRecord ClientAuthRateBucket".split())
ORG_NAMES = {
    "QingqiWorkspace": "Workspace", "QingqiPermission": "WorkspacePermission",
    "QingqiWorkspaceRole": "WorkspaceRole", "QingqiWorkspaceRolePermission": "WorkspaceRolePermission",
    "QingqiWorkspaceMembership": "WorkspaceMembership", "QingqiWorkspaceInvitation": "WorkspaceInvitation",
    "QingqiWorkspaceRoleHistory": "WorkspaceRoleHistory",
}


def model_owner(name):
    if name in CORE:
        return "platform/core", "AIJ core", name, "抽取定义；删除对保留业务模型的反向关系；不迁记录"
    if name in CONFIG:
        return "foundation/configuration", "AIJ configuration", name, "抽取定义；仅合成项目组织；不迁环境绑定"
    if name == "SecretReference":
        return "foundation/secret-center", "AIJ secret-center", name, "迁引用机制；不迁真实密钥/引用绑定"
    if name in RUNTIME:
        return "platform/runtime", "AIJ runtime", name, "抽取定义；不迁任务/锁/队列；移除业务 relation"
    if name.startswith("Integration"):
        return "foundation/integration", "AIJ integration", name, "抽取定义；不迁 Key/Webhook/文件/任务数据"
    if name in IDENTITY:
        return "qingqi-app/client-auth", "AIJ identity", name, "抽取定义；独立会话与凭据；移除业务 relation"
    if name in ORG_NAMES:
        return "qingqi-app", "AIJ organization", ORG_NAMES[name], "抽取通用租户定义并重命名；不迁企业档案/IP/成员记录"
    if name.startswith("Ai"):
        return "aij-ai", "AIJ aij-ai", name, "系统插件定义；业务工具/默认资产分拆；不迁调用与成本数据"
    if name.startswith("Notification"):
        return "aij-notification", "AIJ aij-notification", name, "系统插件定义；不迁消息/收件人/业务模板"
    if name.startswith("Payment"):
        return "aij-payment", "AIJ aij-payment", name, "系统插件定义；不迁商户绑定/凭据/交易"
    if name == "ClientAccountLifecycleRequest":
        return "client lifecycle（服务闭环待核对）", "原库保留；后续单独核对", "", "仅定义存在；本次不迁入"
    for prefix, owner in [("Qingqi", "qingqi-app"), ("Consultant", "qingqi-consultant"), ("Action", "qingqi-action"), ("Fde", "qingqi-fde"), ("Knowledge", "qingqi-knowledge"), ("Intelligence", "qingqi-intelligence"), ("PublicSearchCache", "qingqi-intelligence"), ("Site", "qingqi-site-builder"), ("Ip", "ip-automation"), ("CompanyOps", "company-ops"), ("Finance", "finance-accounts")]:
        if name.startswith(prefix):
            return owner, "原库保留", "", "业务模型不迁入；原定义/记录均保留"
    raise ValueError("Model owner missing: " + name)


# Inventory IDs correspond to the human-readable F00 migration table.
GROUPS = {
    "M01": ("后端组合根与工程", "AIJ assembly", "按选定依赖重写", "仅核心可启动；无静态业务 import；端口隔离"),
    "M02": ("混合管理服务", "AIJ core + aij-ai；Company Ops 留原库", "按方法/路由拆分", "核心 CRUD/RBAC/审计通过；无 CompanyOps；AI 管理独立"),
    "M03": ("管理员认证与通用 Guard", "AIJ core/auth", "复制并适配", "身份/audience/issuer 隔离；普通角色 API 越权拒绝"),
    "M04": ("Prisma 与健康适配", "AIJ database", "复制并适配", "只连 AIJ 空库；health 检查真实目标"),
    "M05": ("配置与项目组织", "AIJ configuration", "复制并适配", "scope 优先级、权限与敏感值验证通过"),
    "M06": ("密钥引用与脱敏", "AIJ secret-center", "复制并适配", "只存引用；错误/审计不泄露秘密"),
    "M07": ("异步运行时", "AIJ runtime", "复制并抽取注册端口", "真实 Outbox/Job/重试/幂等；无轻企 handler"),
    "M08": ("文件与集成", "AIJ integration/FileAsset", "复制并适配", "独立存储；Key/Webhook/租户权限与安全策略通过"),
    "M09": ("客户身份生命周期机制", "AIJ identity", "复制并适配", "注册/会话/撤销/Token 单次消费；跨产品隔离"),
    "M10": ("通用 Workspace 组织候选", "AIJ organization；企业/IP 留原库", "抽取重写", "Workspace/Membership/Role 不依赖 CompanyProfile；跨租户拒绝"),
    "M11": ("插件运行时白名单", "AIJ plugin-runtime", "拆分业务白名单", "禁用后路由/菜单/权限/handler 不可用；未知插件拒绝"),
    "M12": ("AI 通用系统插件", "AIJ aij-ai；Company Ops 工具留原库", "抽取通用服务与注册契约", "Model/Trace/Cost 唯一真值；无硬编码业务工具；失败闭合"),
    "M13": ("通知系统插件", "AIJ aij-notification", "复制并适配", "intent/投递/retry/inbox 闭环；不带原消息/模板"),
    "M14": ("支付系统插件", "AIJ aij-payment", "复制并适配", "回调验签/去重/退款/对账通过；不复制商业订单/商户数据"),
    "M15": ("前端入口与壳", "AIJ web", "拆分后重建入口", "仅后台壳；权限导航；统一 API；独立 Token key"),
    "M16": ("前端系统页面", "AIJ core web", "复制并适配", "登录、RBAC、配置/字典/文件/审计可用；无轻企产品导航"),
    "M17": ("前端系统插件页面", "AIJ system plugin web", "按启用插件定向复制", "启用状态/按钮权限/API 与 owner 一致"),
    "M18": ("Prisma Schema", "AIJ core/system plugins/organization；业务留原库", "按模型正向选取并重建", "模型/关系/enum/约束闭合；validate/generate 通过"),
    "M19": ("Prisma Seed", "AIJ seed；业务资产留原库", "重写最小分层 seed", "重复执行幂等；只含合成基础记录；密码来自新环境"),
    "M20": ("历史数据库迁移", "原库历史；AIJ 新库独立基线", "只读参考；不复制历史链", "新空库 initial migration 可部署；无原业务表/历史账本"),
    "M21": ("SDK 与底座包", "AIJ packages", "契约保留；实际实现另行抽取", "本地包公开导出可被宿主使用；build 成功不代替真实启动"),
    "M22": ("system-plugin descriptor 包", "AIJ system packages", "保留声明并补实际 adapter", "descriptor 配合真实模块；禁用机制通过；不发布"),
    "M23": ("分发工具/starter", "AIJ packaging；旧业务 manifest 留原库", "按需重写；不迁演示任务", "本地检验真实 build/migrate/test；不用打印成功代替实现"),
    "M24": ("测试证据与隔离 harness", "随各能力 owner", "选择性复制后适配", "测试只连接独立测试库；不带业务 fixture/原环境"),
    "M25": ("轻企业务与旧工作流", "原库各业务 owner / 原发布工程", "原库保留；不迁入", "新库无业务实现/自动发布/自动晋级依赖；原文件不变"),
}


def group_for(path):
    if path in {"package.json", "pnpm-workspace.yaml", "pnpm-lock.yaml", "docker-compose.yml", "eslint.config.mjs", ".prettierrc", "apps/api/package.json", "apps/api/tsconfig.json", "apps/api/nest-cli.json", "apps/web/package.json", "apps/web/tsconfig.json", "apps/web/next.config.mjs", "apps/api/src/app.module.ts", "apps/api/src/main.ts"}:
        return "M01"
    prefixes = [("apps/api/src/admin/", "M02"), ("apps/api/src/auth/", "M03"), ("apps/api/src/common/", "M03"), ("apps/api/src/audit-log/", "M03"), ("apps/api/src/prisma/", "M04"), ("apps/api/src/configuration/", "M05"), ("apps/api/src/secret-center/", "M06"), ("apps/api/src/async-runtime/", "M07"), ("apps/api/src/integration-center/", "M08"), ("apps/api/src/client-auth/", "M09"), ("apps/api/src/plugin-runtime/", "M11"), ("apps/api/src/ai/", "M12"), ("plugins/aij-ai/", "M12"), ("apps/api/src/plugins/aij-notification/", "M13"), ("plugins/aij-notification/", "M13"), ("apps/api/src/plugins/aij-payment/", "M14"), ("plugins/aij-payment/", "M14")]
    if path == "apps/api/src/health.controller.ts":
        return "M04"
    if path.startswith("apps/api/src/plugins/qingqi-app/"):
        candidates = {"qingqi-app-context.service.ts", "qingqi-app-context.guard.ts", "qingqi-app.module.ts"}
        return "M10" if "/qingqi-workspace" in path or Path(path).name in candidates else "M25"
    if path == "plugins/qingqi-app/contracts.ts":
        return "M10"
    for prefix, group in prefixes:
        if path.startswith(prefix):
            return group
    if path == "apps/api/prisma/schema.prisma":
        return "M18"
    if path == "apps/api/prisma/seed.ts":
        return "M19"
    if path.startswith("apps/api/prisma/migrations/"):
        return "M20"
    if path.startswith("apps/api/prisma/"):
        return "M25"
    if path.startswith(("packages/plugin-sdk/", "packages/foundation-")):
        return "M21"
    if path.startswith("packages/system-plugin-aij-"):
        return "M22"
    if path.startswith(("scripts/distribution/", "distribution/")):
        return "M23"
    if path.startswith(("apps/api/test/", "apps/web/test/")):
        return "M25" if any(x in path for x in ["qingqi", "commercial-pilot", "bocha", "ip-automation"]) else "M24"
    if path.startswith("apps/web/app/"):
        rel = path[len("apps/web/app/"):]
        if rel.startswith("plugins/aij-"):
            return "M17"
        if rel.startswith(("auth/", "login/", "admin/", "assets/", "members/", "notifications/", "system/")):
            return "M16"
        if rel.startswith(("components/", "lib/")) or rel in {"layout.tsx", "providers.tsx", "globals.css", "favicon.ico"}:
            return "M15"
    if path.startswith(("apps/api/src/", "apps/web/", "plugins/", "packages/", ".github/")):
        return "M25"
    return None


def target_path(path, group):
    if group == "M25":
        return "原库保留（不迁入）"
    if group == "M20":
        return "apps/api/prisma/migrations/<new-initial>/migration.sql（重建，不复制本文件）"
    if group == "M10":
        if path.startswith("plugins/"):
            return "packages/foundation-contracts/src/organization.ts（抽取通用定义）"
        return path.replace("plugins/qingqi-app/", "identity-organization/").replace("qingqi-workspace", "workspace").replace("qingqi-app-context", "organization-context").replace("qingqi-app.module", "identity-organization.module")
    if group == "M23":
        return "scripts/distribution/（需重写）；旧 starter/project 不直接迁入"
    return path


def write_csv(path, rows, fields):
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    args = parser.parse_args()
    source = args.source.resolve()
    if source == TARGET or source in TARGET.parents or TARGET in source.parents:
        raise SystemExit("Source and target must be independent directories")
    before = fingerprint(source)
    if (before["head"], before["tracked_tree_sha256"], before["index_sha256"]) != (EXPECTED_HEAD, EXPECTED_TREE, EXPECTED_INDEX) or before["status"]:
        raise SystemExit("Source differs from the F00 baseline; review before regenerating")
    tracked = [os.fsdecode(p) for p in git(source, "ls-files", "-z").split(b"\0") if p]
    schema = (source / "apps/api/prisma/schema.prisma").read_text()
    models = re.findall(r"^model\s+(\w+)\s*\{([\s\S]*?)^}", schema, re.M)
    names = {name for name, _ in models}
    access_names = {name[0].lower() + name[1:]: name for name in names}
    model_rows = []
    for name, body in models:
        owner, target_owner, target_name, method = model_owner(name)
        refs = [(field, kind) for field, kind in re.findall(r"^\s*(\w+)\s+(\w+)", body, re.M) if kind in names]
        model_rows.append({
            "source_model": name, "source_owner": owner, "target_owner": target_owner,
            "target_model": target_name, "target_path": "apps/api/prisma/schema.prisma" if target_name else "原库保留",
            "relations": "; ".join(field + ":" + kind for field, kind in refs),
            "relations_to_retained_business": "; ".join(field + ":" + kind for field, kind in refs if not model_owner(kind)[2]),
            "migration_method": method, "acceptance": "定义/关系/enum/约束/索引逐项审定；独立空库 validate/generate/migrate；不迁运行记录" if target_name else "新库不含此表与其业务依赖；原库文件/记录保留",
            "source_commit": EXPECTED_HEAD,
        })
    workspace_packages = {}
    for path in (source / "packages").glob("*/package.json"):
        workspace_packages[json.loads(path.read_text())["name"]] = str(path.relative_to(source))
    file_rows = []
    for rel in sorted(tracked):
        group = group_for(rel)
        path = source / rel
        # Catalog only tracked engineering files; never copy source text or env/runtime data.
        if group is None or any(part.startswith(".env") or part.startswith("._") for part in path.parts) or not path.is_file():
            continue
        blob = path.read_bytes()
        try:
            contents = blob.decode("utf-8")
        except UnicodeDecodeError:
            contents = ""
        dependencies = set()
        if path.suffix in {".ts", ".tsx", ".js", ".mjs", ".cjs"}:
            specifiers = re.findall(r"(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)[\"']([^\"']+)[\"']", contents)
            for specifier in specifiers:
                resolved = ""
                if specifier.startswith("."):
                    candidate = path.parent / specifier
                    for alternative in [candidate, *[Path(str(candidate) + ext) for ext in [".ts", ".tsx", ".mjs", ".js", ".json", ".d.ts", ".d.mts"]], candidate / "index.ts", candidate / "index.js"]:
                        if alternative.is_file():
                            resolved = str(alternative.resolve().relative_to(source))
                            break
                    if not resolved:
                        resolved = "静态路径未解析，待任务核对"
                elif specifier in workspace_packages:
                    resolved = workspace_packages[specifier]
                dependencies.add(specifier + (" -> " + resolved if resolved else ""))
        elif path.name == "package.json":
            pkg = json.loads(contents)
            for section in ["dependencies", "devDependencies", "peerDependencies"]:
                dependencies.update(section + ":" + name + "@" + value for name, value in pkg.get(section, {}).items())
        elif path.suffix == ".prisma":
            dependencies.add("Prisma/PostgreSQL；逐模型关系见 PRISMA_MODEL_OWNERSHIP.csv")
        elif path.name == "migration.sql":
            dependencies.update("REFERENCES:" + table for table in re.findall(r'REFERENCES\s+"([^"]+)"', contents))
        accesses = sorted({access_names[name] for name in re.findall(r"(?:prisma|tx)\.([a-zA-Z][a-zA-Z0-9]*)", contents) if name in access_names})
        capability, target_owner, method, acceptance = GROUPS[group]
        owners = sorted({model_owner(name)[0] for name in accesses})
        file_rows.append({
            "id": group, "source_file": rel, "capability": capability,
            "actual_dependencies": "; ".join(sorted(dependencies)) or "未发现字面量 import/manifest 依赖；仍需运行核对",
            "actual_prisma_models": "; ".join(accesses),
            "data_owner": "; ".join(owners) or "本文件无直接 Prisma 访问；按能力 owner 核对",
            "target_owner": target_owner, "target_path": target_path(rel, group),
            "migration_method": method, "acceptance": acceptance,
            "source_commit": EXPECTED_HEAD, "source_sha256": hashlib.sha256(blob).hexdigest(),
        })
    after = fingerprint(source)
    if before != after:
        raise SystemExit("Source changed during the audit; no output written")
    occupied = {}
    for port in [3655, 3656, 55432, 55433]:
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
            probe.settimeout(0.2)
            occupied[str(port)] = probe.connect_ex(("127.0.0.1", port)) == 0
    audit = {
        "task": "F00", "checked_at": datetime.now(ZoneInfo("Asia/Shanghai")).isoformat(),
        "source_root": str(source), "target_root": str(TARGET),
        "source_before": before, "source_after": after, "source_unchanged": before == after,
        "source_remotes": git(source, "remote", "-v").decode().splitlines(),
        "source_branches": git(source, "branch", "-avv").decode().splitlines(),
        "target_branch": git(TARGET, "branch", "--show-current").decode().strip(),
        "target_head": git(TARGET, "rev-parse", "HEAD").decode().strip(),
        "target_remotes": git(TARGET, "remote", "-v").decode().splitlines(),
        "network_fetch_performed": False, "runtime_started": False, "database_created_or_changed": False,
        "application_source_copied": False, "packages_published": False,
        "initial_target_untracked": ["._.git", "._.gitignore", "._README.md"],
        "target_git_known_warning": "AppleDouble .git/objects/pack/._pack-3be25b306583b4d070d11ff48565d4d47188f2db.idx; preserved",
        "localhost_ipv4_port_connectable": occupied,
        "port_check_note": "Loopback TCP read-only probe only; lsof separately checked all four ports. Recheck before startup.",
        "source_model_count": len(models), "source_migration_sql_count": sum(p.endswith("/migration.sql") and p.startswith("apps/api/prisma/migrations/") for p in tracked),
        "catalogued_files": len(file_rows), "catalogue_groups": {key: sum(row["id"] == key for row in file_rows) for key in GROUPS},
        "static_audit_limit": "字面量 import、manifest 依赖、Prisma 成员访问和模型字段类型；不证明 DI、动态装配、运行时或数据库一致性",
    }
    out = TARGET / "docs/generated"
    out.mkdir(parents=True, exist_ok=True)
    write_csv(out / "SOURCE_FILE_INVENTORY.csv", file_rows, list(file_rows[0]))
    write_csv(out / "PRISMA_MODEL_OWNERSHIP.csv", model_rows, list(model_rows[0]))
    (out / "F00_AUDIT.json").write_text(json.dumps(audit, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"source_unchanged": True, "catalogued_files": len(file_rows), "models": len(models), "migrations": audit["source_migration_sql_count"], "ports_connectable": occupied, "output_directory": str(out)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
