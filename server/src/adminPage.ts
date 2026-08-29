export const ADMIN_MODERATION_PAGE = String.raw`<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>Here · 内容审核</title>
  <style>
    :root { color-scheme: dark; font-family: system-ui, -apple-system, "Segoe UI", sans-serif; }
    body { margin: 0; background: #0b0e23; color: #ede7f6; }
    main { width: min(1080px, calc(100% - 32px)); margin: 36px auto 80px; }
    h1 { color: #ffe3a3; margin: 0 0 8px; }
    h2 { margin-top: 34px; }
    .muted { color: #9993ad; }
    .panel, .card { border: 1px solid #393750; background: #14172d; border-radius: 16px; padding: 18px; }
    .panel { display: grid; gap: 12px; grid-template-columns: 1fr 1fr auto; }
    .toolbar { display: flex; gap: 10px; flex-wrap: wrap; align-items: end; }
    label { display: grid; gap: 6px; color: #bcb7cc; font-size: 13px; }
    input, select, textarea, button { font: inherit; }
    input, select, textarea { color: #ede7f6; background: #0d1025; border: 1px solid #44415b; border-radius: 10px; padding: 10px 12px; }
    button { color: #111426; background: #f5c26b; border: 0; border-radius: 10px; padding: 10px 15px; font-weight: 700; cursor: pointer; }
    button.secondary { color: #ede7f6; background: #343249; }
    button.danger { color: white; background: #a83f50; }
    button:disabled { opacity: .5; cursor: wait; }
    #pending { display: grid; gap: 16px; }
    .card { display: grid; gap: 14px; }
    .meta { display: flex; gap: 12px; flex-wrap: wrap; color: #aaa5bc; font-size: 13px; }
    .content { white-space: pre-wrap; line-height: 1.7; font-size: 16px; }
    .model { background: #0d1025; border-radius: 10px; padding: 12px; color: #cbc5d9; font-size: 13px; }
    .actions { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
    .actions input { flex: 1; min-width: 220px; }
    img, video { max-width: min(100%, 560px); max-height: 380px; border-radius: 12px; background: #080a18; }
    audio { width: min(100%, 560px); }
    table { width: 100%; border-collapse: collapse; background: #14172d; border-radius: 14px; overflow: hidden; }
    th, td { text-align: left; padding: 11px; border-bottom: 1px solid #302e45; font-size: 13px; }
    .error { color: #ff9cab; min-height: 22px; }
    @media (max-width: 700px) { .panel { grid-template-columns: 1fr; } table { display: block; overflow-x: auto; } }
  </style>
</head>
<body>
<main>
  <h1>Here · 内容审核</h1>
  <p class="muted">模型只负责初审；只有管理员确认驳回后才会累计违规和执行处罚。</p>
  <section class="panel" id="login">
    <label>管理员密钥<input id="secret" type="password" autocomplete="current-password" /></label>
    <label>审核员名称<input id="reviewer" value="admin" maxlength="64" /></label>
    <button id="connect">进入审核台</button>
  </section>
  <p class="error" id="error"></p>

  <div id="dashboard" hidden>
    <div class="toolbar">
      <button id="refresh" class="secondary">刷新</button>
      <button id="cleanup" class="secondary">重试媒体清理</button>
      <span id="count" class="muted"></span>
      <span id="cleanup-count" class="muted"></span>
    </div>
    <h2>等待复核</h2>
    <section id="pending"></section>

    <h2>设备处罚</h2>
    <section class="panel">
      <label>设备 ID<input id="ban-device" placeholder="dev-..." /></label>
      <label>处罚
        <select id="ban-mode"><option value="1d">1 天</option><option value="7d">7 天</option><option value="30d">30 天</option><option value="permanent">永久</option></select>
      </label>
      <button id="ban-device-button" class="danger">执行封禁</button>
    </section>
    <div id="bans"></div>
  </div>
</main>
<script>
(function () {
  var secretInput = document.getElementById('secret');
  var reviewerInput = document.getElementById('reviewer');
  var dashboard = document.getElementById('dashboard');
  var errorBox = document.getElementById('error');
  var pendingRoot = document.getElementById('pending');
  var bansRoot = document.getElementById('bans');
  secretInput.value = sessionStorage.getItem('here-admin-secret') || '';
  reviewerInput.value = sessionStorage.getItem('here-admin-reviewer') || 'admin';

  function setError(value) { errorBox.textContent = value || ''; }
  async function api(path, options) {
    var init = options || {};
    init.headers = Object.assign({}, init.headers || {}, {
      'content-type': 'application/json',
      'x-admin-secret': secretInput.value
    });
    var response = await fetch('/api/v1/admin' + path, init);
    var body = await response.json().catch(function () { return {}; });
    if (!response.ok) throw new Error(body.error || ('HTTP ' + response.status));
    return body;
  }
  function text(tag, value, className) {
    var node = document.createElement(tag);
    node.textContent = value == null ? '' : String(value);
    if (className) node.className = className;
    return node;
  }
  function mediaNode(item) {
    if (!item.media_url) return null;
    var node;
    if (item.media_type === 'image') node = document.createElement('img');
    else if (item.media_type === 'video') { node = document.createElement('video'); node.controls = true; }
    else if (item.media_type === 'audio') { node = document.createElement('audio'); node.controls = true; }
    if (node) { node.src = item.media_url; node.preload = 'metadata'; }
    return node || null;
  }
  async function decide(item, decision, card) {
    var reason = card.querySelector('[data-reason]').value.trim();
    var banMode = card.querySelector('[data-ban]').value;
    var buttons = card.querySelectorAll('button');
    buttons.forEach(function (button) { button.disabled = true; });
    try {
      await api('/moderation/' + encodeURIComponent(item.id) + '/' + decision, {
        method: 'POST',
        body: JSON.stringify({ reviewer_id: reviewerInput.value, reason: reason, ban_mode: banMode })
      });
      await refreshAll();
    } catch (error) {
      setError(error.message);
      buttons.forEach(function (button) { button.disabled = false; });
    }
  }
  function renderPending(items) {
    pendingRoot.replaceChildren();
    document.getElementById('count').textContent = items.length + ' 条待审';
    if (!items.length) { pendingRoot.append(text('p', '目前没有待审内容。', 'muted')); return; }
    items.forEach(function (item) {
      var card = document.createElement('article'); card.className = 'card';
      card.append(text('div', item.text, 'content'));
      var media = mediaNode(item); if (media) card.append(media);
      if (item.media_error) card.append(text('div', '媒体暂时无法读取，请谨慎复核或稍后重试。', 'error'));
      var meta = text('div', '', 'meta');
      meta.append(text('span', item.flower_name));
      meta.append(text('span', item.device_id));
      meta.append(text('span', new Date(item.created_at).toLocaleString()));
      meta.append(text('span', item.media_type));
      card.append(meta);
      var moderation = item.moderation || {};
      card.append(text('div', '模型：' + (moderation.model || '未完成') + ' · 结论：' + (moderation.verdict || '等待') + ' · 级别：' + (moderation.severity || '-') + '\n原因：' + (moderation.reason || '模型审核尚未完成') + '\n分类：' + ((moderation.categories || []).join('、') || '-'), 'model'));
      var actions = text('div', '', 'actions');
      var reason = document.createElement('input'); reason.dataset.reason = ''; reason.placeholder = '复核备注（可选）';
      var ban = document.createElement('select'); ban.dataset.ban = '';
      [['auto','自动处罚'],['none','只记违规，不禁言'],['1d','禁言 1 天'],['7d','禁言 7 天'],['30d','禁言 30 天'],['permanent','永久封禁']].forEach(function (entry) { var option = document.createElement('option'); option.value = entry[0]; option.textContent = entry[1]; ban.append(option); });
      var approve = text('button', '确认安全，放行');
      var reject = text('button', '确认违规，删除', 'danger');
      approve.addEventListener('click', function () { decide(item, 'approve', card); });
      reject.addEventListener('click', function () { if (confirm('将彻底删除这条内容，确认继续？')) decide(item, 'reject', card); });
      actions.append(reason, ban, approve, reject); card.append(actions); pendingRoot.append(card);
    });
  }
  function renderBans(items) {
    var table = document.createElement('table');
    var head = document.createElement('thead'); head.innerHTML = '<tr><th>设备</th><th>确认违规</th><th>状态</th><th>原因</th><th>操作</th></tr>'; table.append(head);
    var body = document.createElement('tbody');
    items.forEach(function (item) {
      var row = document.createElement('tr');
      row.append(text('td', item.device_id)); row.append(text('td', item.violation_count));
      row.append(text('td', item.permanent ? '永久' : item.active ? ('至 ' + new Date(item.banned_until).toLocaleString()) : '未封禁'));
      row.append(text('td', item.reason || '-'));
      var action = document.createElement('td'); var button = text('button', '解除', 'secondary');
      button.disabled = !item.active; button.addEventListener('click', async function () { await api('/bans/' + encodeURIComponent(item.device_id), { method: 'DELETE' }); await refreshAll(); });
      action.append(button); row.append(action); body.append(row);
    });
    table.append(body); bansRoot.replaceChildren(table);
  }
  async function refreshAll() {
    setError('');
    var results = await Promise.all([api('/moderation/pending'), api('/bans'), api('/moderation/cleanup')]);
    renderPending(results[0].list || []); renderBans(results[1].list || []);
    document.getElementById('cleanup-count').textContent = ((results[2].total || 0) + (results[2].abandoned_uploads_total || 0)) + ' 个媒体待清理';
  }
  document.getElementById('connect').addEventListener('click', async function () {
    sessionStorage.setItem('here-admin-secret', secretInput.value);
    sessionStorage.setItem('here-admin-reviewer', reviewerInput.value);
    try { await refreshAll(); dashboard.hidden = false; } catch (error) { dashboard.hidden = true; setError(error.message === 'unauthorized' ? '管理员密钥不正确。' : error.message); }
  });
  document.getElementById('refresh').addEventListener('click', function () { refreshAll().catch(function (error) { setError(error.message); }); });
  document.getElementById('cleanup').addEventListener('click', async function () {
    try { await api('/moderation/cleanup/retry', { method: 'POST' }); await refreshAll(); } catch (error) { setError(error.message); }
  });
  document.getElementById('ban-device-button').addEventListener('click', async function () {
    var device = document.getElementById('ban-device').value.trim();
    var mode = document.getElementById('ban-mode').value;
    if (!device) return setError('请输入设备 ID。');
    try { await api('/bans/' + encodeURIComponent(device), { method: 'POST', body: JSON.stringify({ ban_mode: mode, reason: '管理员手动封禁' }) }); await refreshAll(); } catch (error) { setError(error.message); }
  });
})();
</script>
</body>
</html>`;
