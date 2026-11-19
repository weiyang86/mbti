#!/usr/bin/env python3
"""Exercise the MBTI F1 or F2 contract against a dedicated development API."""
import argparse
import json
import re
import sys
from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen


class CheckFailed(Exception):
    pass


def require(condition, message):
    if not condition:
        raise CheckFailed(message)


class NoApiRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Credentials must stay on the configured API origin.
        return None


class Client:
    def __init__(self, base):
        self.base = base.rstrip("/")
        parsed = urlsplit(self.base)
        require(parsed.scheme in ("http", "https") and parsed.hostname,
                "开发基址须是完整的 HTTP(S) 地址")
        require(parsed.path.endswith("/api/v1") and not parsed.query and not parsed.fragment,
                "开发基址须以 /api/v1 结尾，不能含查询或片段")
        require(parsed.username is None and parsed.password is None, "开发基址不能带凭证")

    def call(self, method, path, expected, *, token=None, payload=None):
        headers = {"Accept": "application/json"}
        if token is not None:
            headers["X-Guest-Token"] = token
        data = None
        if payload is not None:
            data = json.dumps(payload).encode()
            headers["Content-Type"] = "application/json"
        request = Request(self.base + path, data=data, headers=headers, method=method)
        try:
            response = build_opener(NoApiRedirect).open(request, timeout=15)
        except HTTPError as exc:
            response = exc
        except (URLError, OSError) as exc:
            raise CheckFailed(f"{method} {path.split('?')[0]} 连接失败（{type(exc).__name__}）") from exc
        with response:
            status = response.getcode()
            raw = response.read(2097153)
        label = f"{method} {path} → {status}"
        print(label, flush=True)
        allowed = (expected,) if isinstance(expected, int) else expected
        require(status in allowed, f"{label}，期望 {allowed}")
        require(len(raw) <= 2097152, f"{label}，响应超过 2 MiB")
        if status == 204:
            require(not raw, f"{label} 应无响应体")
            return status, None
        try:
            body = json.loads(raw)
        except (ValueError, UnicodeError) as exc:
            raise CheckFailed(f"{label} 未返回 JSON") from exc
        require(isinstance(body, dict), f"{label} 应返回 JSON 对象")
        if status >= 400:
            require(isinstance(body.get("code"), str) and bool(body["code"]) and
                    isinstance(body.get("message"), str) and bool(body["message"]),
                    f"{label} 缺少 code/message")
        return status, body


def field(item, name):
    value = item.get(name)
    require(isinstance(value, str) and bool(value), f"响应缺少字符串字段 {name}")
    return value


def ident(item):
    return quote(field(item, "id"), safe="")


def items(body):
    values = body.get("items")
    require(isinstance(values, list) and all(isinstance(v, dict) for v in values),
            "响应应直接包含对象列表 items")
    return values


def guest(api):
    _, body = api.call("POST", "/auth/guest", 201)
    token = field(body, "guest_token")
    expires = datetime.fromisoformat(field(body, "expires_at").replace("Z", "+00:00"))
    require(expires.tzinfo is not None and expires > datetime.now(timezone.utc), "游客凭证应有未来的有效期")
    return token


def result_ids(api, token):
    _, body = api.call("GET", "/results?limit=50", 200, token=token)
    return [field(row, "id") for row in items(body)]


def get_bank(api, owner):
    _, body = api.call("GET", "/quiz/versions/current", 200, token=owner)
    version = field(body, "question_bank_version")
    questions = body.get("questions")
    require(isinstance(questions, list) and len(questions) == 12, "题库必须有 12 题")
    require(len({field(q, "id") for q in questions}) == 12, "题目 ID 重复")
    require({q.get("index") for q in questions} == set(range(1, 13)), "题号必须为 1–12")
    require(Counter(field(q, "dimension") for q in questions) == dict.fromkeys(("EI", "SN", "TF", "JP"), 3),
            "每个维度必须有 3 题")
    for q in questions:
        field(q, "prompt")
        options = q.get("options")
        require(isinstance(options, list) and len(options) >= 2, "每题至少两个选项")
        require(len({field(o, "id") for o in options}) == len(options), "同题选项 ID 重复")
        for option in options:
            field(option, "label")
    # When the backend declares this exact version it must serve the frozen content.
    fixture_path = Path(__file__).resolve().parent / "fixtures/quiz-candidate.json"
    fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
    golden = None
    if version == fixture["payload"]["question_bank_version"]:
        projected = [
            {**{k: q[k] for k in ("id", "index", "dimension", "prompt")},
             "options": [{"id": o["id"], "label": o["label"]} for o in q["options"]]}
            for q in questions
        ]
        require(projected == fixture["payload"]["questions"], "相同题库版本的题目、顺序或选项发生变化")
        golden = fixture["golden_cases"]
    return version, questions, golden


def take_quiz(api, owner, other, version, questions, option_index, golden):
    _, session = api.call("POST", "/quiz/sessions", 201, token=owner,
                          payload={"question_bank_version": version})
    session_id = ident(session)
    require(session.get("status") == "in_progress" and session.get("question_bank_version") == version,
            "新会话的状态或题库版本错误")
    require(session.get("answers") == [], "新会话应没有作答")
    base = "/quiz/sessions/" + session_id
    answers = [{"question_id": q["id"], "option_id": q["options"][option_index]["id"]} for q in questions]
    if option_index == 0:
        api.call("PUT", base + "/answers", 404, token=other, payload={"answers": answers[:1]})
        api.call("POST", base + "/submit", 404, token=other)
        api.call("POST", base + "/submit", 422, token=owner)
        invalid = {"question_id": answers[0]["question_id"], "option_id": "__not_an_option__"}
        api.call("PUT", base + "/answers", 422, token=owner, payload={"answers": [invalid]})
        for index in range(2):
            _, partial = api.call("PUT", base + "/answers", 200, token=owner,
                                  payload={"answers": [answers[index]]})
            saved = {(row["question_id"], row["option_id"]) for row in partial.get("answers", [])}
            needed = {(row["question_id"], row["option_id"]) for row in answers[:index+1]}
            require(needed.issubset(saved), "逐题保存覆盖了另一次写入")
    _, full = api.call("PUT", base + "/answers", 200, token=owner, payload={"answers": answers})
    stored = [(a["question_id"], a["option_id"]) for a in full.get("answers", [])]
    require(sorted(stored) == sorted((a["question_id"], a["option_id"]) for a in answers),
            "整批保存的答案不匹配")
    if option_index == 0:
        with ThreadPoolExecutor(max_workers=2) as workers:
            jobs = [workers.submit(api.call, "POST", base + "/submit", (201, 409), token=owner)
                    for _ in range(2)]
            submissions = [job.result() for job in jobs]
        require(sorted(status for status, _ in submissions) == [201, 409], "同会话并发提交应为 201 和 409")
        result = next(body for status, body in submissions if status == 201)
    else:
        _, result = api.call("POST", base + "/submit", 201, token=owner)
    result_id = field(result, "id")
    require(result.get("source") == "quiz" and result.get("question_bank_version") == version,
            "结果来源或版本错误")
    type_code = field(result, "type_code")
    require(re.fullmatch(r"[EI][SN][TF][JP]", type_code), "结果未返回四维合法类型")
    field(result, "submitted_at")
    counts = result.get("dimension_counts")
    require(isinstance(counts, dict), "测评结果应包含各维计数")
    pairs = ("EI", "SN", "TF", "JP")
    for pair in pairs:
        require(all(type(counts.get(c)) is int and 0 <= counts[c] <= 3 for c in pair), "无效的维度计数")
        require(sum(counts[c] for c in pair) == 3, "每一维的总票数必须为 3")
    require("".join(max(p, key=counts.get) for p in pairs) == type_code, "返回类型与计数不符")
    if golden is not None:
        expected = golden[option_index]
        require(type_code == expected["expected_type_code"] and counts == expected["expected_dimension_counts"],
                "服务端计分与固定答案样例不符")
    _, detail = api.call("GET", "/results/" + ident(result), 200, token=owner)
    require(all(detail.get(k) == result[k] for k in ("id", "source", "type_code", "question_bank_version",
                                                      "submitted_at", "dimension_counts")),
            "结果详情与交卷快照不一致")
    api.call("GET", "/results/" + ident(result), 404, token=other)
    return result_id


def check_image(url):
    parsed = urlsplit(url)
    require(parsed.scheme in ("http", "https") and parsed.hostname and not parsed.username and not parsed.password,
            "preview_url 应为可打开的 HTTP(S) 资源地址")
    request = Request(url, headers={"Accept": "image/*"})
    try:
        # Share URLs should work without an account. Never forward a guest token to an asset host.
        with urlopen(request, timeout=15) as response:
            mime = response.headers.get_content_type()
            head = response.read(2048)
            require(response.getcode() == 200 and mime.startswith("image/"), "预览 URL 未返回图片")
    except (URLError, OSError) as exc:
        raise CheckFailed(f"无法加载分享图片（{type(exc).__name__}）") from exc
    png = (head.startswith(b"\x89PNG\r\n\x1a\n") and len(head) >= 33 and head[12:16] == b"IHDR"
           and all(int.from_bytes(head[i:i+4], "big") > 0 for i in (16, 20)))
    jpeg = head.startswith(b"\xff\xd8\xff")
    gif = head.startswith((b"GIF87a", b"GIF89a"))
    webp = head.startswith(b"RIFF") and head[8:12] == b"WEBP"
    avif = head[4:8] == b"ftyp" and any(marker in head[:48] for marker in (b"avif", b"avis"))
    svg = mime == "image/svg+xml" and re.search(br"<svg(?:\s|>)", head, re.I)
    require(png or jpeg or gif or webp or avif or svg, "资源缺少可识别的图片签名")


def extended(api, owner, other, first, second, version):
    _, types = api.call("GET", "/types", 200, token=owner)
    expected_types = {a+b+c+d for a in "EI" for b in "SN" for c in "TF" for d in "JP"}
    listed = items(types)
    require(len(listed) == 16 and {field(t, "type_code") for t in listed} == expected_types,
            "16 型展示元数据不完整")
    for t in listed:
        field(t, "name_zh")
        field(t, "tagline")
    compare = "/results/compare?" + urlencode({"baseline_id": first, "target_id": second})
    _, comparison = api.call("GET", compare, 200, token=owner)
    require(comparison.get("baseline_id") == first and comparison.get("target_id") == second and
            comparison.get("question_bank_version") == version and isinstance(comparison.get("type_changed"), bool),
            "对比返回的快照、版本或变化标志无效")
    api.call("GET", compare, 404, token=other)
    _, chosen = api.call("POST", "/results", 201, token=owner, payload={"source": "self_select", "type_code": "INFP"})
    chosen_id = field(chosen, "id")
    require(chosen.get("source") == "self_select" and chosen.get("type_code") == "INFP", "自选快照无效")
    require(chosen_id not in (first, second) and not chosen.get("dimension_counts"), "自选快照 ID 或计分无效")
    api.call("GET", "/results/compare?" + urlencode({"baseline_id": first, "target_id": chosen_id}), 422,
             token=owner)
    share_body = {"result_id": chosen_id, "scene": "moments"}
    api.call("POST", "/share/preview", 404, token=other, payload=share_body)
    _, shared = api.call("POST", "/share/preview", 200, token=owner, payload=share_body)
    require(shared.get("status") == "ready", "同步预览未就绪")
    asset_url = field(shared, "preview_url")
    require(all(t not in asset_url for t in (owner, other)), "预览 URL 泄漏游客凭证")
    check_image(asset_url)
    api.call("DELETE", "/results/" + ident(chosen), 404, token=other)
    api.call("DELETE", "/results/" + ident(chosen), 204, token=owner)
    api.call("GET", "/results/" + ident(chosen), 404, token=owner)
    require(sorted(result_ids(api, owner)) == sorted([first, second]), "删除后列表与两条测评记录不一致")


def run(base, phase):
    api = Client(base)
    _, health = api.call("GET", "/health", 200)
    field(health, "status")
    api.call("GET", "/results", 401)
    owner, other = guest(api), guest(api)
    require(owner != other, "两人领到了相同游客凭证")
    require(result_ids(api, owner) == [] and result_ids(api, other) == [], "新游客的历史应为空")
    version, questions, golden = get_bank(api, owner)
    first, second = (take_quiz(api, owner, other, version, questions, i, golden) for i in range(2))
    require(first != second, "复测覆盖了第一次结果")
    require(sorted(result_ids(api, owner)) == sorted([first, second]), "A 的列表应恰好包含这两次测评")
    require(result_ids(api, other) == [], "B 的列表出现了 A 的数据")
    if phase == "F2":
        extended(api, owner, other, first, second, version)
    print(f"PASS {phase} | 题库 {version} | A 的两次结果 {first} / {second} | B 跨用户读取 404")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True, help="完整开发 API 地址，含 /api/v1")
    parser.add_argument("--phase", choices=["F1", "F2"], default="F1")
    args = parser.parse_args()
    try:
        run(args.base, args.phase)
    except (CheckFailed, KeyError, TypeError, AttributeError, ValueError, OSError) as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        sys.exit(1)
