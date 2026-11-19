#!/usr/bin/env python3
"""Additional real-HTTP F1 checks; run the input package's smoke.py separately.

Python 3.9+, standard library only. Writes synthetic data to a dedicated dev API.
No service management, database access, fixtures, or token output.
"""

import argparse
import json
import os
import secrets
import stat
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path
from threading import Barrier
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


class Failure(Exception):
    pass


def need(condition, message):
    if not condition:
        raise Failure(message)


def string(body, key):
    value = body.get(key)
    need(isinstance(value, str) and bool(value), "missing string field: " + key)
    return value


def timestamp(value):
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    need(parsed.tzinfo is not None, "timestamp must include timezone")
    return parsed


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class Api:
    def __init__(self, base, timeout):
        self.base, self.timeout = base.rstrip("/"), timeout
        parts = urlsplit(self.base)
        need(parts.scheme in ("http", "https") and parts.hostname
             and parts.path.endswith("/api/v1") and not parts.query and not parts.fragment
             and parts.username is None and parts.password is None,
             "--base must be an HTTP(S) API URL ending in /api/v1 without credentials/query")

    def call(self, label, method, path, expected=200, token=None, payload=None):
        headers = {"Accept": "application/json"}
        if token is not None:
            headers["X-Guest-Token"] = token
        data = None
        if payload is not None:
            data = json.dumps(payload).encode("utf-8")
            headers["Content-Type"] = "application/json"
        req = Request(self.base + path, data=data, headers=headers, method=method)
        try:
            response = build_opener(NoRedirect).open(req, timeout=self.timeout)
        except HTTPError as exc:
            response = exc
        except (URLError, OSError) as exc:
            raise Failure(label + ": connection failed (" + type(exc).__name__ + ")") from None
        with response:
            status_code = response.getcode()
            raw = response.read(2 * 1024 * 1024 + 1)
        # Only caller-defined labels/method/status are logged, never URLs or bodies.
        print(f"HTTP {label}: {method} -> {status_code}", flush=True)
        allowed = (expected,) if isinstance(expected, int) else expected
        need(status_code in allowed, label + ": unexpected HTTP status")
        need(len(raw) <= 2 * 1024 * 1024, label + ": response exceeds 2 MiB")
        try:
            body = json.loads(raw)
        except (ValueError, UnicodeError):
            raise Failure(label + ": response is not JSON") from None
        need(isinstance(body, dict), label + ": response must be a bare JSON object")
        if status_code >= 400:
            string(body, "code")
            string(body, "message")
        return status_code, body


def session_path(session_id):
    return "/quiz/sessions/" + quote(session_id, safe="")


def detail(api, token, result_id):
    return api.call("result-detail", "GET", "/results/" + quote(result_id, safe=""), token=token)[1]


def save(api, token, session_id, answers, expected=200, label="save"):
    return api.call(label, "PUT", session_path(session_id) + "/answers", expected,
                    token, {"answers": answers})[1]


def answer_map(session):
    rows = session.get("answers")
    need(isinstance(rows, list) and all(isinstance(row, dict) for row in rows), "answers must be an array")
    mapping = {string(row, "question_id"): string(row, "option_id") for row in rows}
    need(len(mapping) == len(rows), "saved answers contain duplicate question IDs")
    return mapping


def page(api, token, limit, cursor=None, expected=200, label="list"):
    params = {"limit": limit}
    if cursor is not None:
        params["cursor"] = cursor
    return api.call(label, "GET", "/results?" + urlencode(params), expected, token)


def page_rows(body, limit, own_ids):
    rows = body.get("items")
    need(isinstance(rows, list) and all(isinstance(row, dict) for row in rows), "items must be an array")
    need(len(rows) <= limit, "list ignored limit")
    ids = [string(row, "id") for row in rows]
    need(len(ids) == len(set(ids)) and set(ids) <= own_ids, "list contains duplicate or foreign IDs")
    cursor = body.get("next_cursor")
    need(cursor is None or isinstance(cursor, str) and bool(cursor), "invalid next_cursor")
    return rows, cursor


def walk(api, token, own_ids, limit):
    rows, cursors, cursor, first_cursor = [], set(), None, None
    # Finite bound also catches a cursor that never terminates or empty-page loops.
    for _ in range(len(own_ids) + 2):
        _, body = page(api, token, limit, cursor)
        batch, next_cursor = page_rows(body, limit, own_ids)
        rows.extend(batch)
        if cursor is None:
            first_cursor = next_cursor
        if next_cursor is None:
            break
        need(batch and next_cursor not in cursors, "pagination did not advance")
        cursors.add(next_cursor)
        cursor = next_cursor
    else:
        raise Failure("pagination did not terminate")
    ids = [string(row, "id") for row in rows]
    need(len(ids) == len(set(ids)) and set(ids) == own_ids, "pagination lost or duplicated results")
    times = [timestamp(string(row, "submitted_at")) for row in rows]
    need(times == sorted(times, reverse=True), "results are not newest first")
    return rows, first_cursor


def pagination(api, token, results):
    own_ids = {string(row, "id") for row in results}
    full, _ = walk(api, token, own_ids, 100)
    expected_ids = [row["id"] for row in full]
    first_cursor = None
    for limit in (1, 2):
        rows, cursor = walk(api, token, own_ids, limit)
        need([row["id"] for row in rows] == expected_ids, "limit/cursor changed stable result order")
        if limit == 1:
            first_cursor = cursor
    repeated, _ = walk(api, token, own_ids, 1)
    need(repeated == full, "repeated pagination changed summaries/order")
    for row in full:
        snapshot = next(item for item in results if item["id"] == row["id"])
        for key in ("id", "source", "type_code", "question_bank_version", "submitted_at"):
            need(row.get(key) == snapshot.get(key), "list summary differs from result detail: " + key)
    print("PASS pagination: limits 1/2/100, stable order, no missing/duplicate/foreign rows")
    return full, first_cursor


def foreign_cursor(api, token, cursor, own_ids):
    need(cursor is not None, "test setup did not produce a continuation cursor")
    # The candidate does not define foreign-cursor rejection codes. Observe any 4xx;
    # if accepted, every returned row and continuation must still belong to caller.
    status_code, body = page(api, token, 1, cursor, (200, *range(400, 500)), "foreign-cursor")
    if status_code == 200:
        seen, visited = set(), {cursor}
        for _ in range(len(own_ids) + 2):
            rows, continuation = page_rows(body, 1, own_ids)
            ids = {row["id"] for row in rows}
            need(not seen.intersection(ids), "foreign cursor duplicated caller rows")
            seen.update(ids)
            if continuation is None:
                break
            need(rows and continuation not in visited, "foreign cursor continuation loop")
            visited.add(continuation)
            _, body = page(api, token, 1, continuation, label="foreign-cursor-continuation")
        else:
            raise Failure("foreign cursor pagination did not terminate")
    print(f"OBSERVED foreign-cursor HTTP {status_code}; rejection policy needs_human_review")


def create_session(api, token, version):
    _, session = api.call("new-session", "POST", "/quiz/sessions", 201, token,
                          {"question_bank_version": version})
    need(session.get("question_bank_version") == version and session.get("status") == "in_progress",
         "session did not bind requested version/status")
    return string(session, "id")


def make_result(api, token, version, answers):
    sid = create_session(api, token, version)
    save(api, token, sid, answers)
    _, result = api.call("setup-submit", "POST", session_path(sid) + "/submit", 201, token)
    return {"session_id": sid, "snapshot": detail(api, token, string(result, "id"))}


def forbidden_owner_actions(api, other, sid, result_id, answer):
    save(api, other, sid, [answer], 404, "foreign-write")
    api.call("foreign-submit", "POST", session_path(sid) + "/submit", 404, other)
    api.call("foreign-detail", "GET", "/results/" + quote(result_id, safe=""), 404, other)


def credentials(api, sid, result_id, version, answer):
    operations = [
        ("GET", "/quiz/versions/current", None),
        ("POST", "/quiz/sessions", {"question_bank_version": version}),
        ("PUT", session_path(sid) + "/answers", {"answers": [answer]}),
        ("POST", session_path(sid) + "/submit", None),
        ("GET", "/results?limit=1", None),
        ("GET", "/results/" + quote(result_id, safe=""), None),
    ]
    for token, label in ((None, "missing-token"), (secrets.token_urlsafe(32), "invalid-token")):
        for method, path, payload in operations:
            api.call(label, method, path, 401, token, payload)
    print("PASS credentials: all six protected F1 operations reject missing/invalid tokens")


def check(api):
    identities = []
    for _ in range(2):
        _, identity = api.call("new-guest", "POST", "/auth/guest", 201)
        string(identity, "guest_token")
        need(timestamp(string(identity, "expires_at")) > datetime.now(timezone.utc), "guest already expired")
        identities.append(identity)
    owner, other = [identity["guest_token"] for identity in identities]
    need(owner != other, "guest identities collided")
    _, bank = api.call("bank-for-test-data", "GET", "/quiz/versions/current", token=owner)
    version, questions = string(bank, "question_bank_version"), bank.get("questions")
    need(isinstance(questions, list) and len(questions) == 12, "test setup requires 12 questions")
    answers = [{"question_id": string(q, "id"), "option_id": string(q["options"][0], "id")} for q in questions]
    alternate = {"question_id": answers[0]["question_id"], "option_id": string(questions[0]["options"][1], "id")}
    sid = create_session(api, owner, version)
    save(api, other, sid, answers[:1], 404, "foreign-in-progress-write")
    api.call("foreign-in-progress-submit", "POST", session_path(sid) + "/submit", 404, other)
    save(api, owner, sid, answers[:1])
    partial = save(api, owner, sid, answers[1:2])
    need(answer_map(partial) == {row["question_id"]: row["option_id"] for row in answers[:2]},
         "incremental save erased an earlier answer")
    updated = save(api, owner, sid, [alternate])
    need(answer_map(updated) == {alternate["question_id"]: alternate["option_id"],
                                answers[1]["question_id"]: answers[1]["option_id"]},
         "upsert did not replace exactly one question")
    save(api, owner, sid, [{**answers[0], "option_id": "__invalid_option__"}], 422, "invalid-option")
    wrong_question_option = next((option["id"] for q in questions for option in q["options"]
                                  if option["id"] not in {o["id"] for o in questions[0]["options"]}), None)
    if wrong_question_option is not None:
        save(api, owner, sid, [{**answers[0], "option_id": wrong_question_option}], 422, "wrong-question-option")
    save(api, owner, sid, [{"question_id": "__unknown_question__", "option_id": answers[0]["option_id"]}],
         422, "unknown-question")
    unchanged = save(api, owner, sid, answers[1:2], label="state-after-rejection")
    need(answer_map(unchanged) == {alternate["question_id"]: alternate["option_id"],
                                  answers[1]["question_id"]: answers[1]["option_id"]},
         "rejected answer changed another stored answer")
    partial = save(api, owner, sid, answers[:-1])
    need(answer_map(partial) == {a["question_id"]: a["option_id"] for a in answers[:-1]},
         "rejected answers contaminated stored state")
    api.call("eleven-of-twelve-submit", "POST", session_path(sid) + "/submit", 422, owner)
    walk(api, owner, set(), 1)  # Rejection must not have created a result.
    completed = save(api, owner, sid, answers[-1:])
    need(answer_map(completed) == {a["question_id"]: a["option_id"] for a in answers},
         "last incremental save erased the other eleven answers")
    barrier = Barrier(2)

    def submit():
        barrier.wait(timeout=10)
        return api.call("simultaneous-submit", "POST", session_path(sid) + "/submit", (201, 409), owner)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(submit) for _ in range(2)]
        submissions = [future.result() for future in futures]
    need(sorted(status_code for status_code, _ in submissions) == [201, 409],
         "simultaneous submit must yield exactly one 201 and one 409")
    result = next(body for status_code, body in submissions if status_code == 201)
    snapshot = detail(api, owner, string(result, "id"))
    walk(api, owner, {snapshot["id"]}, 1)  # Detect duplicate DB results, not just response codes.
    save(api, owner, sid, [alternate], 409, "late-answer")
    api.call("submit-replay", "POST", session_path(sid) + "/submit", 409, owner)
    need(detail(api, owner, snapshot["id"]) == snapshot, "late write/replay changed submitted snapshot")
    forbidden_owner_actions(api, other, sid, snapshot["id"], answers[0])
    credentials(api, sid, snapshot["id"], version, answers[0])
    print("PASS answers/submit: incremental, invalid/incomplete 422, race 201+409, one immutable result")
    records = [[{"session_id": sid, "snapshot": snapshot}], []]
    # Only synthetic setup for nontrivial paging; golden scoring stays in smoke.py.
    for target, token, count in ((records[0], owner, 2), (records[1], other, 2)):
        target.extend(make_result(api, token, version, answers) for _ in range(count))
    summaries, cursors = [], []
    for token, own in zip((owner, other), records):
        rows, cursor = pagination(api, token, [r["snapshot"] for r in own])
        summaries.append(rows)
        cursors.append(cursor)
    for token, cursor, own in ((other, cursors[0], records[1]), (owner, cursors[1], records[0])):
        foreign_cursor(api, token, cursor, {r["snapshot"]["id"] for r in own})
    return {"schema": 1, "base": api.base, "created_at": datetime.now(timezone.utc).isoformat(),
            "identities": identities, "version": version, "answers": answers,
            "alternate": alternate, "records": records, "summaries": summaries}


def state_path(value, writing):
    path = Path(value).expanduser()
    need(not path.is_symlink(), "state file must not be a symlink")
    path = path.resolve()
    need(path.parent.is_dir(), "state parent directory must already exist")
    root = Path(__file__).resolve().parents[1]
    if path.is_relative_to(root):
        ignored = subprocess.run(["git", "-C", str(root), "check-ignore", "-q", "--", str(path)],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        need(ignored.returncode == 0, "state inside repository must be gitignored; use tmp/ or an external file")
    if writing:
        need(not path.exists(), "state file already exists; choose a new path")
    else:
        mode = path.stat().st_mode
        need(stat.S_ISREG(mode) and not mode & 0o077, "state must be a regular owner-only file (chmod 600)")
        need(path.stat().st_size <= 2 * 1024 * 1024, "state file exceeds 2 MiB")
    return path


def prepare(api, path):
    state = check(api)
    token = state["identities"][0]["guest_token"]
    sid = create_session(api, token, state["version"])
    saved = save(api, token, sid, state["answers"][:2])
    expected = {a["question_id"]: a["option_id"] for a in state["answers"][:2]}
    need(answer_map(saved) == expected, "restart draft setup failed")
    state["draft"] = {"session_id": sid, "answers": state["answers"][:2]}
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "w", encoding="utf-8") as handle:
        json.dump(state, handle, ensure_ascii=False)
        handle.flush()
        os.fsync(handle.fileno())
    print("PREPARED: secret state saved with mode 600; restart API via its owner, then run verify-restart")
    print("NOT_RUN: service restart / post-restart persistence (prepare alone is not proof)")


def verify(api, path):
    state = json.loads(path.read_text(encoding="utf-8"))
    need(state.get("schema") == 1 and state.get("base") == api.base, "state schema/base mismatch")
    need(all(isinstance(state.get(key), list) and len(state[key]) == 2
             for key in ("identities", "records", "summaries")), "state requires exactly two identities/result lists")
    need([len(records) for records in state["records"]] == [3, 2], "state result counts must be three and two")
    tokens = []
    for identity, records, original_rows in zip(state["identities"], state["records"], state["summaries"]):
        token = string(identity, "guest_token")
        tokens.append(token)
        need(timestamp(string(identity, "expires_at")) > datetime.now(timezone.utc),
             "stored guest expired; restart evidence requires an unexpired identity")
        for record in records:
            before = record["snapshot"]
            need(detail(api, token, before["id"]) == before, "persisted snapshot changed or disappeared")
            api.call("persisted-submit-replay", "POST", session_path(record["session_id"]) + "/submit", 409, token)
        rows, _ = pagination(api, token, [r["snapshot"] for r in records])
        need(rows == original_rows, "persisted list changed")
    draft = state["draft"]
    # F1 has no GET session endpoint: replay one identical answer, then require both.
    restored = save(api, tokens[0], draft["session_id"], draft["answers"][:1], label="persisted-draft")
    need(restored.get("question_bank_version") == state["version"] and restored.get("status") == "in_progress",
         "persisted draft version/status changed")
    need(answer_map(restored) == {a["question_id"]: a["option_id"] for a in draft["answers"]},
         "persisted draft lost the untouched answer")
    first = state["records"][0][0]
    save(api, tokens[0], first["session_id"], [state["alternate"]], 409, "persisted-late-answer")
    forbidden_owner_actions(api, tokens[1], first["session_id"], first["snapshot"]["id"], state["answers"][0])
    need(detail(api, tokens[0], first["snapshot"]["id"]) == first["snapshot"], "post-restart late write changed result")
    print("PASS verify-restart: original identities, session IDs, five result IDs, snapshots and draft survived")
    print("NOTE: attach service-owner stop/start evidence; this script does not independently prove a process restart")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base", required=True, help="actual dedicated dev API URL including /api/v1")
    parser.add_argument("--phase", choices=("check", "prepare-restart", "verify-restart"), default="check")
    parser.add_argument("--state", help="secret state file: gitignored within repo, or outside repo")
    parser.add_argument("--timeout", type=float, default=10, help="per-request timeout in seconds (0 < n <= 60)")
    args = parser.parse_args()
    need(0 < args.timeout <= 60, "--timeout must be greater than 0 and at most 60")
    need(bool(args.state) == (args.phase != "check"), "--state is required only for the two restart phases")
    api = Api(args.base, args.timeout)
    if args.phase == "check":
        check(api)
        print("PASS additional F1 HTTP checks; NOT_RUN service restart/persistence")
    elif args.phase == "prepare-restart":
        prepare(api, state_path(args.state, True))
    else:
        verify(api, state_path(args.state, False))


if __name__ == "__main__":
    try:
        main()
    except Failure as exc:
        print("FAIL: " + str(exc), file=sys.stderr)
        sys.exit(1)
    except Exception as exc:
        # Avoid exception values/tracebacks: a server response or state may contain secrets.
        print("FAIL: invalid response/state or local I/O (" + type(exc).__name__ + ")", file=sys.stderr)
        sys.exit(1)
