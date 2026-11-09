(() => {
  'use strict'
  const payload = JSON.parse(document.getElementById('reference-data').textContent)
  const spec = payload.document
  const groups = payload.groups
  const $ = selector => document.querySelector(selector)
  const escape = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]))
  const pretty = value => JSON.stringify(value, null, 2)
  const operations = Object.entries(spec.paths).flatMap(([path, item]) => Object.entries(item).map(([method, operation]) => ({ ...operation, method: method.toUpperCase(), path, number: operation['x-requirement-number'], group: operation['x-delivery-wave'], availability: operation['x-availability'] }))).sort((a, b) => groups.findIndex(group => group.id === a.group) - groups.findIndex(group => group.id === b.group) || a.number - b.number)
  const byNumber = new Map(operations.map(operation => [operation.number, operation]))
  const snippets = new Map()
  let activeGroup = ''
  let currentBase = spec.servers[0].url
  let baseValid = true
  let toastTimer

  const notes = {
    2: '一个浏览器领取并持有自己的凭证，刷新复用；多个首次请求共享一次初始化。过期后明确处理，不自动换号重放写操作。',
    4: '返回冻结的 qb-v0.4-prototype-1 共12题。创建会话使用这次读取的版本，答题与恢复继续使用同一份题库。',
    6: '按会话和题目增量保存，未传题目保留。路径中的会话必须属于当前游客；交卷前需完成全部12题。',
    7: '答满且合法才生成不可变结果。同一会话并发或重放仅一个请求201，其余409；再次测评创建新会话。',
    8: '新游客返回空 items 和 next_cursor:null。列表只含本人，不能把上次游客的缓存作为当前响应。',
    11: '只比较本人可比快照。同题库版本可比；自选或跨版本等不可比情况返回422。',
    17: '使用返回的真实图片URL读取预览；它不是本机占位图或原始答题回放。渲染资源GET不属于此处41项业务操作计数。',
    48: 'Idempotency-Key按购买意图持久化。相同游客、键、result_id和product_code重试仍201且同订单；同键不同意图409。金额取服务端。当前真实支付通道未配置，订单可为pending且未解锁。',
    50: '此响应使用order_id表示下单时的id。金额等订单快照见本人订单列表；pending不代表已经支付或获得权益。',
    53: '待支付订单不授予权益。开发环境未配置真实支付，空items是有效响应，不能本地假解锁。',
    24: '本人私密读取与公开投影分开。新卡默认不公开，四项visibility为false；已有类型不随新测评或GET静默覆盖。',
    25: '局部保存；visibility按子键合并。类型需为合法16型，明确discoverable=true后整张名片才进入公开/发现。保存名片不修改历史测评。',
    26: '仅返回当前允许公开的字段。隐藏昵称/介绍为空、兴趣为空数组、manual省略；任向屏蔽或退出公开后旧ID也不可读。',
    28: '只列本人发起的active屏蔽，使用公开card ID和匿名管理字段；管理入口不会泄露被屏蔽方私密资料。',
    30: '屏蔽立即收紧双方读取/申请，并撤回有效交换与联系授权。解除只操作本人方向，不复活旧关系或旧授权。',
    33: '双方已有合法类型且明确公开才允许发起。首建201，同向相同pending重试200同ID，反向pending或已有accepted冲突409。名片交换本身不授予联系渠道。',
    34: '仅接收方可回应pending。发起方或终态冲突409，第三人404；不能由前端模拟对方同意。',
    35: '名片交换仅原发起方可撤回pending/accepted；接收方409、第三人404。原发起方对已revoked重复撤回204。',
    36: '只返回当前游客自己的渠道；没有渠道时为{}。这些值不进入公开名片、搭子或请求列表。',
    37: 'PUT为整份替换，未传或空串删除该项。实际改值增加版本并使旧pending/accepted失效；同值规范化保存可幂等。渠道示例为合成占位值。',
    38: '清除live引用及授权，重新填写不会恢复旧授权。无法收回此前已复制的内容；旧私密对象离线GC/物理擦除策略仍待审。',
    40: '申请对方当前提供的明确渠道，不是交换自己的渠道。需双方公开、无屏蔽且已有同一条有效基础名片交换。重复渠道422，缺请求渠道409；反向是独立申请，不自动互授。',
    41: '仅接收方pending可批准全部所选集合或拒绝。若需更小集合，可拒绝后重新申请；本轮不支持部分批准字段。',
    42: '联系方式申请/授权允许双方撤回pending或accepted；revoked重复204，declined冲突409。这与基础名片交换的撤回权限不同。',
    43: '仅已接受请求的原申请人读取确切批准集合。接收方应读/contacts/me；未批准、第三人、撤回/清除/改值/屏蔽/基础交换失效均404。每次重读重新校验，失败清空旧值。',
    44: '仅返回本人已存参与选择；缺记录为false，GET不会懒建参与或名片记录。',
    45: 'true需本人已存合法名片类型，私密名片也可主动参与；false始终允许退出。只保存参与选择，不改变名片公开范围或联系授权。',
    46: '真实聚合尚未开放。合法已参与返回count:null/status:unavailable/reason:location_source_not_configured；合法未参与reason:not_enrolled。缺本人类型422。三档范围不是已确认距离政策，数据缺失不能显示为0人或人数较少。',
  }

  function searchable(value, visited = new Set()) {
    if (value === null || value === undefined) return ''
    if (typeof value !== 'object') return String(value)
    if (value.$ref) {
      if (visited.has(value.$ref)) return ''
      visited.add(value.$ref)
      return searchable(resolve(value), visited)
    }
    return Object.entries(value).map(([name, child]) => `${name} ${searchable(child, visited)}`).join(' ')
  }
  const searchIndex = new Map(operations.map(operation => [operation.number, `${operation.number} ${operation.group} ${operation.method} ${operation.path} ${operation.summary} ${searchable(operation)} ${notes[operation.number] ?? ''}`.toLowerCase()]))

  function resolve(value) {
    const seen = new Set()
    while (value?.$ref) {
      const reference = value.$ref
      if (seen.has(reference)) return { description: '递归Schema，参见原始契约' }
      seen.add(reference)
      const target = reference.slice(2).split('/').reduce((node, name) => node?.[name.replace(/~1/g, '/').replace(/~0/g, '~')], spec)
      const { $ref: ignored, ...siblings } = value
      value = { ...target, ...siblings }
    }
    return value ?? {}
  }

  function schemaType(schema) {
    const value = resolve(schema)
    if (value.enum?.length === 1 && value.enum[0] === null) return 'null'
    if (value.oneOf || value.anyOf) return (value.oneOf ?? value.anyOf).map(schemaType).join(' | ')
    if (value.allOf) return value.allOf.map(schemaType).join(' & ')
    const type = Array.isArray(value.type) ? value.type.join(' | ') : value.type ?? (value.properties ? 'object' : '未限定')
    return value.type === 'array' ? `${schemaType(value.items)}[]` : type
  }

  function constraints(value) {
    return [
      value.format && `格式：${value.format}`,
      value.enum && `枚举：${value.enum.map(item => JSON.stringify(item)).join(' · ')}`,
      Object.hasOwn(value, 'default') && `默认：${JSON.stringify(value.default)}`,
      value.pattern && `匹配：${value.pattern}`,
      value.minimum !== undefined && `最小：${value.minimum}`,
      value.maximum !== undefined && `最大：${value.maximum}`,
      value.minLength !== undefined && `最短：${value.minLength}`,
      value.maxLength !== undefined && `最长：${value.maxLength}`,
      value.minItems !== undefined && `最少项数：${value.minItems}`,
      value.maxItems !== undefined && `最多项数：${value.maxItems}`,
      value.additionalProperties === false && '拒绝未知字段',
    ].filter(Boolean).map(text => `<span class="constraint">${escape(text)}</span>`).join('')
  }

  function schemaRows(schema, prefix = '', depth = 0, ancestors = new Set()) {
    if (!schema || depth > 6 || (schema.$ref && ancestors.has(schema.$ref))) return []
    const nextAncestors = new Set(ancestors)
    if (schema.$ref) nextAncestors.add(schema.$ref)
    const value = resolve(schema)
    if (value.allOf) return value.allOf.flatMap(child => schemaRows(child, prefix, depth, nextAncestors))
    if (value.oneOf || value.anyOf) return (value.oneOf ?? value.anyOf).flatMap((child, index) => schemaRows(child, `${prefix}${prefix ? '.' : ''}[分支${index + 1}]`, depth, nextAncestors))
    if (value.type === 'array') return schemaRows(value.items, `${prefix || '$'}[]`, depth + 1, nextAncestors)
    if (!value.properties) return prefix ? [] : [{ name: '$', schema: value, required: null }]
    return Object.entries(value.properties).flatMap(([name, child]) => {
      const property = resolve(child)
      const field = prefix ? `${prefix}.${name}` : name
      return [{ name: field, schema: property, required: (value.required ?? []).includes(name) }, ...schemaRows(child, field, depth + 1, nextAncestors)]
    })
  }

  function table(rows) {
    if (!rows.length) return '<p class="schema-empty">此候选未逐字段定义该Schema，请按原始契约与实际响应核对。</p>'
    return `<div class="table-scroll"><table><thead><tr><th>字段</th><th>类型</th><th>必填</th><th>说明 / 约束</th></tr></thead><tbody>${rows.map(row => `<tr><td class="field-name"><code>${escape(row.name)}</code>${row.location ? `<div class="field-extra">${escape(row.location)}</div>` : ''}</td><td class="field-type">${escape(schemaType(row.schema))}</td><td class="field-required">${row.required === null ? '—' : row.required ? '是' : '可选'}</td><td class="field-description">${escape(row.description ?? row.schema.description ?? '')}${constraints(row.schema)}</td></tr>`).join('')}</tbody></table></div>`
  }

  function example(schema, name = '', depth = 0, ancestors = new Set()) {
    if (!schema || depth > 8) return null
    if (schema.$ref && ancestors.has(schema.$ref)) return null
    const nextAncestors = new Set(ancestors)
    if (schema.$ref) nextAncestors.add(schema.$ref)
    const value = resolve(schema)
    if (value.example !== undefined) return value.example
    if (value.const !== undefined) return value.const
    if (value.default !== undefined) return value.default
    if (value.enum?.length) return value.enum[0]
    if (value.oneOf || value.anyOf) return example((value.oneOf ?? value.anyOf)[0], name, depth + 1, nextAncestors)
    if (value.allOf) return Object.assign({}, ...value.allOf.map(child => example(child, name, depth + 1, nextAncestors)))
    if (name === 'guest_token') return '<guest_token>'
    if (name === 'question_bank_version') return 'qb-v0.4-prototype-1'
    if (name === 'product_code') return 'studio_tier_1'
    if (name === 'wechat') return 'demo_wechat'
    if (name === 'qq') return '123456789'
    if (name === 'phone') return '19900000000'
    if (value.type === 'object' || value.properties) return Object.fromEntries(Object.entries(value.properties ?? {}).map(([key, child]) => [key, example(child, key, depth + 1, nextAncestors)]))
    if (value.type === 'array') return Array.from({ length: Math.min(value.minItems ?? 1, 20) }, () => example(value.items, name, depth + 1, nextAncestors))
    if (value.type === 'boolean') return false
    if (value.type === 'integer' || value.type === 'number') return value.minimum ?? 0
    if (Array.isArray(value.type) && value.type.includes('null')) return null
    if (value.format === 'date-time') return '2026-11-09T00:00:00.000Z'
    if (value.format === 'uuid') return '00000000-0000-4000-8000-000000000001'
    if (value.format === 'uri' || value.format === 'url') return 'https://example.invalid/replace-with-response-url'
    return /(^id$|_id$|Id$)/.test(name) ? `<${name}>` : '示例文本'
  }

  function requestExample(operation) {
    const body = resolve(operation.requestBody)
    const media = body.content?.['application/json']
    if (!media) return undefined
    if (operation.number === 45) return { enrolled: true }
    if (operation.number === 6) return { answers: payload.quizExample.questions.map(question => ({ question_id: question.id, option_id: question.options[0].id })) }
    return media.example ?? example(media.schema)
  }

  function responseExample(operation, code, response) {
    const media = response.content?.['application/json']
    if (!media) return undefined
    if (operation.number === 4 && code === '200') return payload.quizExample
    if (operation.number === 46 && code === '200') return { count: null, status: 'unavailable', reason: 'location_source_not_configured' }
    if (media.example !== undefined) return media.example
    const defined = Object.values(media.examples ?? {}).map(resolve).find(item => Object.hasOwn(item, 'value'))
    return defined ? defined.value : example(media.schema)
  }

  const shellQuote = value => `'${String(value).replace(/'/g, `'"'"'`)}'`
  function requestUrl(operation) {
    let path = operation.path
    for (const parameter of (operation.parameters ?? []).map(resolve)) if (parameter.in === 'path') path = path.replace(`{${parameter.name}}`, `<${parameter.name}>`)
    const query = (operation.parameters ?? []).map(resolve).filter(parameter => parameter.in === 'query' && parameter.required).map(parameter => `${encodeURIComponent(parameter.name)}=${encodeURIComponent(`<${parameter.name}>`)}`).join('&')
    return `${currentBase}${path}${query ? `?${query}` : ''}`
  }

  function snippet(operation, language) {
    const body = requestExample(operation)
    const headers = {}
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (operation.security?.length) headers['X-Guest-Token'] = '<guest_token>'
    for (const parameter of (operation.parameters ?? []).map(resolve)) if (parameter.in === 'header' && parameter.required) headers[parameter.name] = parameter.name === 'Idempotency-Key' ? 'mbti_example_intent_0001' : `<${parameter.name}>`
    if (language === 'curl') {
      const lines = [`curl -i -X ${operation.method} ${shellQuote(requestUrl(operation))}`]
      for (const [name, value] of Object.entries(headers)) lines.push(value === '<guest_token>' ? '-H "X-Guest-Token: $MBTI_GUEST_TOKEN"' : `-H ${shellQuote(`${name}: ${value}`)}`)
      if (body !== undefined) lines.push(`--data-raw ${shellQuote(pretty(body))}`)
      return lines.join(' \\\n  ')
    }
    const headerLines = Object.entries(headers).map(([name, value]) => `    ${JSON.stringify(name)}: ${value === '<guest_token>' ? 'guestToken' : JSON.stringify(value)}`).join(',\n')
    return `// guestToken 为当前浏览器已保存的游客凭证；替换自己的对象 ID\nconst response = await fetch(${JSON.stringify(requestUrl(operation))}, {\n  method: ${JSON.stringify(operation.method)},\n  headers: {\n${headerLines}\n  }${body === undefined ? '' : `,\n  body: JSON.stringify(${pretty(body)})`}\n});\nif (!response.ok) {\n  const error = await response.json();\n  throw new Error(error.message || \`HTTP \${response.status}\`);\n}\nconst data = response.status === 204 ? undefined : await response.json();`
  }

  function guestSnippet() {
    return `export MBTI_API_BASE=${shellQuote(currentBase)}\nexport MBTI_GUEST_TOKEN="$(\n  curl -fsS -X POST "$MBTI_API_BASE/auth/guest" |\n  python3 -c 'import json,sys; print(json.load(sys.stdin)["guest_token"])'\n)"\n# 后续请求使用同一变量；不要把凭证提交到 Git`
  }

  function codePanel(id, title, text) {
    snippets.set(id, text)
    return `<div class="code-panel"><div class="code-heading"><span>${escape(title)}</span><button type="button" class="copy-button" data-copy="${escape(id)}">复制</button></div><pre><code>${escape(text)}</code></pre></div>`
  }

  function responseMarkup(operation, code) {
    const response = resolve(operation.responses[code])
    const schema = response.content?.['application/json']?.schema
    const value = responseExample(operation, code, response)
    return `<p class="response-description">${escape(response.description ?? '')}</p>${code === '204' ? '<p class="schema-empty">204 No Content · 成功，没有响应体。</p>' : schema ? table(schemaRows(schema)) : '<p class="schema-empty">此状态的字段未在该候选逐项定义；参见原始契约。</p>'}${value === undefined ? '' : `<div class="response-example">${codePanel(`response-${operation.number}`, '响应结构示例 · 合成数据，不代表实际记录', pretty(value))}</div>`}`
  }

  function detailMarkup(operation) {
    const parameters = (operation.parameters ?? []).map(resolve)
    const request = resolve(operation.requestBody)
    const schema = request.content?.['application/json']?.schema
    const codes = Object.keys(operation.responses).sort((a, b) => Number(a) - Number(b))
    const code = codes.find(value => value.startsWith('2')) ?? codes[0]
    return `<div class="operation-intro"><h3>${escape(operation.summary)}</h3><span class="auth-label">${operation.security?.length ? '需要 X-Guest-Token' : '无需游客凭证'}</span></div>${notes[operation.number] ? `<p class="operation-note ${operation.availability === 'unavailable' ? 'caution' : ''}">${escape(notes[operation.number])}</p>` : ''}${operation.description ? `<p class="operation-description">${escape(operation.description)}</p>` : ''}${parameters.length ? `<h4>路径、查询与请求头参数</h4>${table(parameters.map(parameter => ({ name: parameter.name, location: parameter.in, schema: resolve(parameter.schema), required: !!parameter.required, description: parameter.description })))}` : ''}${schema ? `<h4>JSON 请求体 ${request.required ? '· 必填' : '· 可选'}</h4>${table(schemaRows(schema))}` : '<p class="schema-empty">无已定义的 JSON 请求体。</p>'}<div class="snippet-tabs" aria-label="请求示例语言"><button type="button" data-language="curl" aria-pressed="true">cURL</button><button type="button" data-language="js" aria-pressed="false">JavaScript</button></div><div class="request-snippet">${codePanel(`request-${operation.number}`, '请求示例 · 执行前替换自己的对象 ID', snippet(operation, 'curl'))}</div><div class="response-head"><h4>响应字段与状态码</h4><select aria-label="响应状态码" class="response-select" data-response>${codes.map(value => `<option value="${escape(value)}" ${value === code ? 'selected' : ''}>${escape(value)} ${value.startsWith('2') ? '成功' : '错误 / 拒绝'}</option>`).join('')}</select></div><div class="response-content">${responseMarkup(operation, code)}</div><div class="operation-source"><span>原需求 #${operation.number} · ${escape(operation.group)} · 内部候选</span><a href="https://github.com/weiyang86/mbti/blob/dev/${escape(operation['x-contract-source'])}" target="_blank" rel="noopener noreferrer">查看原始契约 ↗</a><a href="#op-${operation.number}" data-permalink>复制此接口链接</a></div>`
  }

  function showDetails(element) {
    if (element.dataset.rendered) return
    const operation = byNumber.get(Number(element.dataset.number))
    element.querySelector('.operation-body').innerHTML = detailMarkup(operation)
    element.dataset.rendered = 'true'
  }

  function updateNavigation() {
    $('#group-nav').innerHTML = [{ id: '', title: '全部接口', count: operations.length }, ...groups].map(group => `<button type="button" class="group-button" data-group="${escape(group.id)}" aria-current="${activeGroup === group.id}"><span class="group-id">${escape(group.id || 'ALL')}</span>${escape(group.title)}<span class="group-count">${group.count}</span></button>`).join('')
  }

  function render() {
    const query = $('#search').value.trim().toLowerCase()
    const method = $('#method-filter').value
    const availability = $('#availability-filter').value
    const matching = operations.filter(operation => (!activeGroup || operation.group === activeGroup) && (!method || operation.method === method) && (!availability || operation.availability === availability) && (!query || searchIndex.get(operation.number).includes(query)))
    $('#operation-list').innerHTML = groups.map(group => {
      const items = matching.filter(operation => operation.group === group.id)
      if (!items.length) return ''
      return `<section class="module"><div class="module-heading"><span>${escape(group.id)}</span><h3>${escape(group.title)}</h3><small>${items.length} 个操作</small></div>${items.map(operation => `<details class="operation" id="op-${operation.number}" data-number="${operation.number}"><summary><span class="operation-number">#${operation.number}</span><span class="method ${operation.method}">${operation.method}</span><span class="route-meta"><span class="endpoint-path">${escape(operation.path)}</span><span class="operation-title">${escape(operation.summary)}</span></span>${operation.availability === 'unavailable' ? '<span class="status-label">统计不可用</span>' : ''}</summary><div class="operation-body"></div></details>`).join('')}</section>`
    }).join('')
    $('#results-count').textContent = `显示 ${matching.length} / 41 个操作${activeGroup ? ` · ${activeGroup} ${groups.find(group => group.id === activeGroup).title}` : ''}`
    $('#empty').hidden = matching.length !== 0
    updateNavigation()
    for (const element of document.querySelectorAll('.operation')) element.addEventListener('toggle', () => { if (element.open) showDetails(element) })
  }

  function closeMenu() {
    $('#sidebar').classList.remove('open')
    $('#menu-toggle').setAttribute('aria-expanded', 'false')
    $('#scrim').hidden = true
  }

  function reset() {
    activeGroup = ''
    $('#search').value = ''
    $('#method-filter').value = ''
    $('#availability-filter').value = ''
    render()
  }

  function revealHash() {
    if (!/^#op-\d+$/.test(location.hash)) return
    const number = Number(location.hash.slice(4))
    if (!byNumber.has(number)) return
    if (!$(location.hash)) reset()
    const element = $(location.hash)
    element.open = true
    showDetails(element)
    element.scrollIntoView({ block: 'start' })
  }

  function notify(message) {
    $('#toast').textContent = message
    $('#toast').classList.add('visible')
    clearTimeout(toastTimer)
    toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 1900)
  }

  async function copy(text, button) {
    try {
      if (navigator.clipboard && window.isSecureContext) await navigator.clipboard.writeText(text)
      else {
        const area = document.createElement('textarea')
        area.value = text
        area.style.cssText = 'position:fixed;left:-10000px;top:0'
        document.body.append(area)
        area.select()
        const success = document.execCommand('copy')
        area.remove()
        if (!success) throw new Error('copy failed')
        button.focus({ preventScroll: true })
      }
      notify('已复制')
    } catch { notify('无法自动复制，请选中示例文本手动复制。') }
  }

  $('#group-nav').addEventListener('click', event => {
    const button = event.target.closest('[data-group]')
    if (!button) return
    activeGroup = button.dataset.group
    render()
    closeMenu()
    $('#endpoints').scrollIntoView({ block: 'start' })
  })
  for (const selector of ['#search', '#method-filter', '#availability-filter']) $(selector).addEventListener(selector === '#search' ? 'input' : 'change', render)
  $('#reset').addEventListener('click', reset)
  $('[data-reset]').addEventListener('click', reset)
  $('#menu-toggle').addEventListener('click', () => {
    const open = !$('#sidebar').classList.contains('open')
    $('#sidebar').classList.toggle('open', open)
    $('#menu-toggle').setAttribute('aria-expanded', String(open))
    $('#scrim').hidden = !open
  })
  $('#scrim').addEventListener('click', closeMenu)
  document.querySelector('.guide-nav').addEventListener('click', closeMenu)
  document.addEventListener('keydown', event => {
    if (event.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName ?? '')) { event.preventDefault(); $('#search').focus() }
    if (event.key === 'Escape') { closeMenu(); if (document.activeElement === $('#search')) reset() }
  })
  document.addEventListener('click', event => {
    const copyButton = event.target.closest('[data-copy]')
    if (copyButton) {
      if (!baseValid && (copyButton.dataset.copy === 'guest' || copyButton.dataset.copy.startsWith('request-'))) return notify('请先修正 API 基址。')
      return copy(snippets.get(copyButton.dataset.copy), copyButton)
    }
    const permalink = event.target.closest('[data-permalink]')
    if (permalink) { event.preventDefault(); return copy(`${location.href.split('#')[0]}${permalink.getAttribute('href')}`, permalink) }
    const operationLink = event.target.closest('a[href^="#op-"]')
    if (operationLink && operationLink.getAttribute('href') === location.hash) { event.preventDefault(); revealHash() }
    const language = event.target.closest('[data-language]')
    if (language) {
      const element = language.closest('.operation')
      const operation = byNumber.get(Number(element.dataset.number))
      for (const button of element.querySelectorAll('[data-language]')) button.setAttribute('aria-pressed', String(button === language))
      element.querySelector('.request-snippet').innerHTML = codePanel(`request-${operation.number}`, language.dataset.language === 'curl' ? 'cURL · 执行前替换自己的对象 ID' : 'JavaScript · guestToken 为当前游客凭证', snippet(operation, language.dataset.language))
    }
  })
  $('#operation-list').addEventListener('change', event => {
    if (!event.target.matches('[data-response]')) return
    const element = event.target.closest('.operation')
    const operation = byNumber.get(Number(element.dataset.number))
    element.querySelector('.response-content').innerHTML = responseMarkup(operation, event.target.value)
  })
  $('#api-base').addEventListener('input', () => {
    try {
      const url = new URL($('#api-base').value.trim().replace(/\/$/, ''))
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !url.pathname.endsWith('/api/v1')) throw new Error('invalid base')
      currentBase = url.href.replace(/\/$/, '')
      baseValid = true
      $('#base-error').hidden = true
      snippets.set('guest', guestSnippet())
      $('#guest-code').textContent = guestSnippet()
      for (const element of document.querySelectorAll('.operation[data-rendered]')) {
        const operation = byNumber.get(Number(element.dataset.number))
        const language = element.querySelector('[data-language][aria-pressed=true]').dataset.language
        element.querySelector('.request-snippet').innerHTML = codePanel(`request-${operation.number}`, '请求示例 · 执行前替换自己的对象 ID', snippet(operation, language))
      }
    } catch {
      baseValid = false
      $('#base-error').hidden = false
      $('#base-error').textContent = '请输入以 /api/v1 结尾的完整 HTTP(S) 地址，不含凭证、查询或片段。'
    }
  })
  $('#download').addEventListener('click', () => {
    if (!baseValid) return notify('请先修正 API 基址。')
    const download = { ...spec, servers: [{ url: currentBase, description: '所选联调环境' }] }
    const url = URL.createObjectURL(new Blob([pretty(download) + '\n'], { type: 'application/json' }))
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = 'mbti-webapi-candidate.openapi.json'
    anchor.click()
    setTimeout(() => URL.revokeObjectURL(url), 2000)
  })
  $('#sources-list').innerHTML = spec['x-sources'].map(source => `<div class="source-row"><strong>${escape(source.title)}</strong><div><a href="https://github.com/weiyang86/mbti/blob/dev/${escape(source.path)}" target="_blank" rel="noopener noreferrer">${escape(source.path)} ↗</a><code>${escape(source.version)} · OpenAPI ${escape(source.originalOpenapi)} · SHA256 ${source.sha256.slice(0, 16)}</code></div></div>`).join('')
  snippets.set('guest', guestSnippet())
  $('#guest-code').textContent = guestSnippet()
  render()
  window.addEventListener('hashchange', revealHash)
  revealHash()
})()
