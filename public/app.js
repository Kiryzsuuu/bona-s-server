// ── Auth Guard ──
const token = localStorage.getItem('bonah_token');
if (!token) window.location.replace('/login.html');

let currentUser   = JSON.parse(localStorage.getItem('bonah_user') || '{}');
let currentChat   = null;   // { type:'personal'|'group', id, name, picture }
let conversations = [];
let socket        = null;
let mediaRecorder = null;
let recInterval   = null;
let recSeconds    = 0;
let isRecording   = false;
let typingTimer   = null;
let selectedGroupMembers = [];  // for create-group modal
let activeGroupData = null;     // full group object when in group chat

const isMobile = () => window.innerWidth <= 640;

// ══════════════════════════════════════
//  INIT
// ══════════════════════════════════════
async function init() {
  try {
    const res = await fetch('/api/profile', { headers: auth() });
    if (res.status === 401) { localStorage.clear(); window.location.replace('/login.html'); return; }
    currentUser = await res.json();
    localStorage.setItem('bonah_user', JSON.stringify(currentUser));

    renderMe();
    applyBg(currentUser.background || '#FBF0F3');
    await loadConversations();
    connectSocket();
    registerSW();
    buildEmojiPicker();
    hideLoading();

    const p = new URLSearchParams(location.search);
    if (p.get('chat'))  openById('personal', p.get('chat'));
    if (p.get('group')) openById('group', p.get('group'));
  } catch (e) {
    console.error(e);
    hideLoading();
  }
}

function auth() { return { Authorization: `Bearer ${token}` }; }
function hideLoading() {
  const ls = document.getElementById('loadingScreen');
  ls.classList.add('fade-out');
  setTimeout(() => ls.style.display = 'none', 400);
}

// ── Mobile ──
function showSidebar() {
  document.querySelector('.sidebar').classList.remove('hidden-mob');
  document.querySelector('.main').classList.remove('show-mob');
}
function showChat() {
  if (isMobile()) {
    document.querySelector('.sidebar').classList.add('hidden-mob');
    document.querySelector('.main').classList.add('show-mob');
  }
}

// ── Render "Me" ──
function renderMe() {
  document.getElementById('meName').textContent = currentUser.name || 'Kamu';
  const s = currentUser.onlineStatus;
  document.getElementById('meStat').textContent =
    s === 'online' ? '● Online' : s === 'away' ? '● Away' : s === 'busy' ? '● Sibuk' : '● Offline';
  const av = document.getElementById('meAv');
  if (currentUser.profilePicture) av.innerHTML = `<img src="${currentUser.profilePicture}" alt="">`;
  else av.textContent = (currentUser.name || 'K')[0].toUpperCase();
}

// ══════════════════════════════════════
//  CONVERSATIONS (personal + groups)
// ══════════════════════════════════════
async function loadConversations() {
  try {
    const [cr, gr] = await Promise.all([
      fetch('/api/messages/conversations', { headers: auth() }),
      fetch('/api/groups', { headers: auth() })
    ]);
    const convs  = cr.ok ? await cr.json() : [];
    const groups = gr.ok ? await gr.json() : [];

    const personal = convs.map(c => ({ type: 'personal', id: c.userId, ...c }));
    const grpItems = groups.map(g => ({
      type: 'group', id: g._id, name: g.name,
      profilePicture: g.picture,
      lastMessage: g.lastMessage || 'Grup dibuat',
      lastMessageTime: g.lastMessageAt,
      unread: g.unreadCount || 0,
      memberCount: g.members?.length || 0
    }));

    conversations = [...personal, ...grpItems]
      .sort((a, b) => new Date(b.lastMessageTime) - new Date(a.lastMessageTime));

    renderConversations();
  } catch (e) { console.error(e); }
}

function renderConversations() {
  const list = document.getElementById('chatList');
  if (!conversations.length) {
    list.innerHTML = `<div style="text-align:center;padding:24px 16px;font-size:12px;color:var(--text-hint);">Belum ada percakapan.<br>Cari teman atau buat grup baru ✿</div>`;
    return;
  }
  list.innerHTML = conversations.map(c => {
    const active = currentChat && currentChat.id === (c.id?.toString?.() ?? c.id);
    const isGroup = c.type === 'group';
    const online  = !isGroup && c.onlineStatus === 'online';
    const avHtml  = c.profilePicture
      ? `<img src="${c.profilePicture}" alt="">`
      : (c.name || '?')[0].toUpperCase();
    const avClass = isGroup ? 'av av-group' : `av${online ? ' av-online' : ''}`;
    const sub     = isGroup ? `${c.memberCount || ''} anggota` : '';
    const badge   = c.unread > 0 ? `<div class="badge">${c.unread}</div>` : '';
    const grpBadge= isGroup ? `<div class="group-badge"><i class="ti ti-users" style="font-size:7px;"></i></div>` : '';

    return `<div class="chat-item${active?' active':''}" data-uid="${c.id}" data-type="${c.type}"
      onclick="selectConv('${c.type}','${c.id}','${escHtml(c.name)}','${c.profilePicture||''}','${c.onlineStatus||''}')">
      <div class="${avClass}" style="position:relative">${avHtml}${grpBadge}</div>
      <div class="ci">
        <div class="ci-row">
          <span class="ci-name">${escHtml(c.name)}</span>
          <span class="ci-time">${formatTime(c.lastMessageTime)}</span>
        </div>
        <div class="ci-row2">
          <div class="ci-prev" style="flex:1">${escHtml(c.lastMessage || sub)}</div>
          ${badge}
        </div>
      </div>
    </div>`;
  }).join('');
}

// ══════════════════════════════════════
//  SELECT CONVERSATION
// ══════════════════════════════════════
async function selectConv(type, id, name, pic, onlineStatus) {
  currentChat = { type, id, name, profilePicture: pic };
  activeGroupData = null;
  showChat();

  ['chatHeader','emojiRow','inputBar'].forEach(x => document.getElementById(x)?.classList.add('show'));
  document.getElementById('emptyState').style.display = 'none';
  closeEmojiPicker();

  // Header
  const hAv = document.getElementById('hAv');
  const isGroup = type === 'group';
  hAv.className = isGroup ? 'av av-group' : ('av' + (onlineStatus==='online'?' av-online':''));
  hAv.innerHTML = pic ? `<img src="${pic}" alt="">` : (name||'?')[0].toUpperCase();
  document.getElementById('hName').textContent = name;

  const hIcon = document.getElementById('hInfoIcon');
  if (isGroup) {
    hIcon.style.display = '';
    document.getElementById('hStatus').textContent = 'Grup chat';
    document.getElementById('hInfoClick').style.cursor = 'pointer';
    document.getElementById('hInfoClick').onclick = openGroupInfo;
  } else {
    hIcon.style.display = 'none';
    document.getElementById('hStatus').textContent =
      onlineStatus==='online'?'Sedang online':onlineStatus==='away'?'Away':onlineStatus==='busy'?'Sibuk':'Offline';
    document.getElementById('hInfoClick').onclick = null;
    document.getElementById('hInfoClick').style.cursor = 'default';
  }

  document.querySelectorAll('.chat-item').forEach(el =>
    el.classList.toggle('active', el.dataset.uid === id.toString()));

  // Clear unread
  const conv = conversations.find(c => c.id?.toString() === id.toString());
  if (conv) conv.unread = 0;
  renderConversations();

  document.getElementById('msgArea').innerHTML = '';
  if (isGroup) await loadGroupMessages(id);
  else         await loadMessages(id);

  // Mark read
  if (socket && conv && !isGroup) {
    socket.emit('mark-read', { conversationId: conv.conversationId, senderId: id });
  }

  document.getElementById('chatInp').focus();
}

async function openById(type, id) {
  if (type === 'personal') {
    const res = await fetch(`/api/users/${id}`, { headers: auth() });
    if (!res.ok) return;
    const u = await res.json();
    selectConv('personal', u._id, u.name, u.profilePicture||'', u.onlineStatus);
  } else {
    const res = await fetch(`/api/groups/${id}`, { headers: auth() });
    if (!res.ok) return;
    const g = await res.json();
    selectConv('group', g._id, g.name, g.picture||'', '');
  }
}

// ══════════════════════════════════════
//  LOAD MESSAGES
// ══════════════════════════════════════
async function loadMessages(userId) {
  const res = await fetch(`/api/messages/${userId}`, { headers: auth() });
  if (!res.ok) return;
  const msgs = await res.json();
  const area = document.getElementById('msgArea');
  let lastDate = '';
  msgs.forEach(m => {
    const d = fmtDate(m.createdAt);
    if (d !== lastDate) { lastDate = d; area.innerHTML += `<div class="date-chip"><span>${d}</span></div>`; }
    area.appendChild(buildBubble(m, false));
  });
  scrollBottom();
}

async function loadGroupMessages(groupId) {
  const res = await fetch(`/api/groups/${groupId}/messages`, { headers: auth() });
  if (!res.ok) return;
  const msgs = await res.json();
  const area = document.getElementById('msgArea');
  let lastDate = '';
  msgs.forEach(m => {
    if (m.type === 'system') { area.innerHTML += systemMsg(m.content); return; }
    const d = fmtDate(m.createdAt);
    if (d !== lastDate) { lastDate = d; area.innerHTML += `<div class="date-chip"><span>${d}</span></div>`; }
    area.appendChild(buildBubble(m, true));
  });
  scrollBottom();
}

// ── Build bubble ──
function buildBubble(msg, isGroup) {
  const myId    = (currentUser._id || currentUser.id)?.toString();
  const sendId  = (msg.sender?._id || msg.sender)?.toString();
  const isMe    = sendId === myId;
  const time    = new Date(msg.createdAt).toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});

  const wrap = document.createElement('div');
  wrap.className = `mw ${isMe?'me':'other'}`;

  let body = '';
  if (msg.type==='image' && msg.mediaUrl) {
    body = `<img class="msg-img" src="${msg.mediaUrl}" alt="Foto" onclick="openLightbox('${msg.mediaUrl}')">`;
    if (msg.content) body += `<div>${escHtml(msg.content)}</div>`;
  } else if (msg.type==='voice' && msg.mediaUrl) {
    body = buildVoicePlayer(msg.mediaUrl, isMe);
  } else if (msg.type==='video' && msg.mediaUrl) {
    body = `<video class="msg-video" controls src="${msg.mediaUrl}"></video>`;
  } else if (msg.type==='file' && msg.mediaUrl) {
    body = `<a class="msg-file" href="${msg.mediaUrl}" download="${escHtml(msg.fileName||'file')}" target="_blank"><i class="ti ti-file-download"></i><span>${escHtml(msg.fileName||'File')}</span></a>`;
  } else {
    body = escHtml(msg.content);
  }

  const senderLine = isGroup && !isMe
    ? `<div class="m-sender">${escHtml(msg.sender?.name||'')}</div>` : '';
  const tick = isMe ? `<i class="ti ti-checks tick ${msg.isRead?'read':'me'}"></i>` : '';

  // Voice player sudah punya tampilannya sendiri, tidak butuh .bubble wrapper
  if (msg.type === 'voice' && msg.mediaUrl) {
    wrap.innerHTML = `${senderLine}${body}
      <div class="b-meta"><span class="b-time ${isMe?'me':'ot'}">${time}</span>${tick}</div>`;
  } else {
    wrap.innerHTML = `${senderLine}<div class="bubble ${isMe?'me':'other'}">${body}</div>
      <div class="b-meta"><span class="b-time ${isMe?'me':'ot'}">${time}</span>${tick}</div>`;
  }
  return wrap;
}

function systemMsg(text) {
  return `<div class="sys-msg"><span>${escHtml(text)}</span></div>`;
}

// ── Custom voice note player ──
function buildVoicePlayer(src, isMe) {
  // Generate waveform bars with pseudo-random heights
  const bars = Array.from({length: 28}, (_, i) => {
    const h = 20 + Math.round(Math.abs(Math.sin(i * 0.7 + 1.2) * 55) + Math.abs(Math.cos(i * 1.1) * 25));
    return `<div class="vp-bar" style="height:${h}%" data-h="${h}"></div>`;
  }).join('');

  return `<div class="voice-player ${isMe ? 'vp-me' : 'vp-other'}">
    <button class="vp-play-btn" onclick="toggleVoicePlay(this)">
      <i class="ti ti-player-play-filled"></i>
    </button>
    <div class="vp-body">
      <div class="vp-bars">${bars}</div>
      <span class="vp-dur">0:00</span>
    </div>
    <audio src="${src}" preload="metadata" style="display:none"></audio>
  </div>`;
}

function toggleVoicePlay(btn) {
  const vp    = btn.closest('.voice-player');
  const audio = vp.querySelector('audio');
  const icon  = btn.querySelector('i');
  const dur   = vp.querySelector('.vp-dur');
  const bars  = vp.querySelectorAll('.vp-bar');

  // Stop all other players
  document.querySelectorAll('.voice-player').forEach(other => {
    if (other === vp) return;
    const a = other.querySelector('audio');
    if (!a.paused) {
      a.pause();
      other.classList.remove('playing');
      other.querySelector('i').className = 'ti ti-player-play-filled';
      other.querySelectorAll('.vp-bar').forEach(b => b.classList.remove('played'));
    }
  });

  const updateBars = () => {
    if (!audio.duration) return;
    const pct = audio.currentTime / audio.duration;
    const played = Math.round(pct * bars.length);
    bars.forEach((b, i) => b.classList.toggle('played', i < played));
  };

  if (audio.paused) {
    audio.play().catch(() => showToast('Format audio tidak didukung browser ini'));
    icon.className = 'ti ti-player-pause-filled';
    vp.classList.add('playing');

    audio.ontimeupdate = () => {
      const t = audio.currentTime;
      dur.textContent = `${Math.floor(t/60)}:${String(Math.floor(t%60)).padStart(2,'0')}`;
      updateBars();
    };
    audio.onended = () => {
      icon.className = 'ti ti-player-play-filled';
      vp.classList.remove('playing');
      dur.textContent = '0:00';
      bars.forEach(b => b.classList.remove('played'));
    };
  } else {
    audio.pause();
    icon.className = 'ti ti-player-play-filled';
    vp.classList.remove('playing');
  }

  // Show duration when metadata loads
  if (audio.readyState >= 1 && isFinite(audio.duration)) {
    const d = audio.duration;
    dur.textContent = `${Math.floor(d/60)}:${String(Math.floor(d%60)).padStart(2,'0')}`;
  } else {
    audio.onloadedmetadata = () => {
      const d = audio.duration;
      if (isFinite(d)) dur.textContent = `${Math.floor(d/60)}:${String(Math.floor(d%60)).padStart(2,'0')}`;
    };
  }
}

// ══════════════════════════════════════
//  SEND MESSAGE
// ══════════════════════════════════════
async function sendMsg() {
  const inp = document.getElementById('chatInp');
  const txt = inp.value.trim();
  if (!txt || !currentChat) return;
  inp.value = '';
  stopTypingSignal();
  closeEmojiPicker();

  const isGroup = currentChat.type === 'group';
  const url = isGroup ? `/api/groups/${currentChat.id}/messages` : '/api/messages/send';
  const body = isGroup
    ? { content: txt, type: 'text' }
    : { receiverId: currentChat.id, content: txt, type: 'text' };

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) throw new Error('Gagal');
    const msg = await res.json();
    document.getElementById('msgArea').appendChild(buildBubble(msg, isGroup));
    scrollBottom();
    updatePreview(currentChat.id, txt, msg.createdAt);
  } catch { showToast('Gagal mengirim pesan'); }
}

// ── File upload ──
async function handleFileSelect(input) {
  const file = input.files[0];
  if (!file || !currentChat) return;
  const isGroup = currentChat.type === 'group';

  const t = file.type.startsWith('image/')  ? 'image'
          : file.type.startsWith('audio/')  ? 'voice'
          : file.type.startsWith('video/')  ? 'video' : 'file';

  const form = new FormData();
  form.append('media', file);
  form.append('type', t);
  if (!isGroup) form.append('receiverId', currentChat.id);

  showToast('Mengunggah...');
  try {
    const url = isGroup ? `/api/groups/${currentChat.id}/messages` : '/api/messages/send';
    const res = await fetch(url, { method:'POST', headers: auth(), body: form });
    if (!res.ok) throw new Error('');
    const msg = await res.json();
    document.getElementById('msgArea').appendChild(buildBubble(msg, isGroup));
    scrollBottom();
    const prev = t==='image'?'📷 Foto':t==='video'?'🎬 Video':t==='voice'?'🎙️ Suara':'📎 File';
    updatePreview(currentChat.id, prev, msg.createdAt);
    showToast('Terkirim ✓');
  } catch { showToast('Upload gagal'); }
  input.value = '';
}

// ── Voice recording ──
let _recStream  = null;
let _recChunks  = [];
let _cancelRec  = false;
let _recMime    = '';

function getSupportedAudioMime() {
  // Order matters: prefer mp4/aac for iOS Safari compatibility
  const types = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/ogg'];
  return types.find(t => { try { return MediaRecorder.isTypeSupported(t); } catch { return false; } }) || '';
}

async function startRecording() {
  if (isRecording || !currentChat) return;
  try {
    _recStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    _recChunks = []; _cancelRec = false;
    _recMime = getSupportedAudioMime();

    mediaRecorder = new MediaRecorder(_recStream, _recMime ? { mimeType: _recMime } : {});
    mediaRecorder.ondataavailable = e => { if (e.data.size > 0) _recChunks.push(e.data); };
    mediaRecorder.onstop = async () => {
      _recStream.getTracks().forEach(t => t.stop());
      if (!_cancelRec && _recChunks.length) {
        const mime = _recMime || mediaRecorder.mimeType || 'audio/webm';
        const blob = new Blob(_recChunks, { type: mime });
        if (blob.size > 500) await sendVoice(blob, mime);
      }
      _recStream = null; _recChunks = [];
    };
    mediaRecorder.start(250); // collect chunks every 250ms
    isRecording = true; recSeconds = 0;

    document.getElementById('micBtn').style.display = 'none';
    document.getElementById('sendBtn').style.display = 'none';
    document.getElementById('recControls').style.display = 'flex';
    document.getElementById('recTimer').classList.add('show');

    recInterval = setInterval(() => {
      recSeconds++;
      const m = Math.floor(recSeconds/60), s = recSeconds%60;
      document.getElementById('recTimer').textContent = `⏺ ${m}:${String(s).padStart(2,'0')}`;
    }, 1000);
  } catch { showToast('Izin mikrofon diperlukan'); }
}

function stopRecording() {
  if (!isRecording) return;
  _cancelRec = false;
  _finishRecording();
}

function cancelRecording() {
  if (!isRecording) return;
  _cancelRec = true;
  _finishRecording();
  showToast('Rekaman dibatalkan');
}

function _finishRecording() {
  isRecording = false;
  clearInterval(recInterval);
  document.getElementById('micBtn').style.display = '';
  document.getElementById('sendBtn').style.display = '';
  document.getElementById('recControls').style.display = 'none';
  document.getElementById('recTimer').classList.remove('show');
  document.getElementById('recTimer').textContent = '⏺ 0:00';
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}

async function sendVoice(blob, mime) {
  const isGroup = currentChat.type === 'group';
  const ext = (mime||'').includes('mp4') ? 'm4a' : (mime||'').includes('ogg') ? 'ogg' : 'webm';
  const form = new FormData();
  form.append('media', blob, `voice.${ext}`);
  form.append('type', 'voice');
  if (!isGroup) form.append('receiverId', currentChat.id);
  try {
    const url = isGroup ? `/api/groups/${currentChat.id}/messages` : '/api/messages/send';
    const res = await fetch(url, { method:'POST', headers: auth(), body: form });
    if (!res.ok) throw new Error('');
    const msg = await res.json();
    document.getElementById('msgArea').appendChild(buildBubble(msg, isGroup));
    scrollBottom();
    updatePreview(currentChat.id, '🎙️ Pesan suara', msg.createdAt);
  } catch { showToast('Gagal kirim pesan suara'); }
}

// ══════════════════════════════════════
//  SOCKET.IO
// ══════════════════════════════════════
function connectSocket() {
  socket = io('/', { auth: { userId: currentUser._id || currentUser.id } });

  socket.on('new-message', msg => {
    const myId    = (currentUser._id || currentUser.id)?.toString();
    const senderId = (msg.sender?._id || msg.sender)?.toString();
    const isCur   = currentChat?.type==='personal' && senderId === currentChat.id?.toString();
    if (isCur) {
      document.getElementById('msgArea').appendChild(buildBubble(msg, false));
      scrollBottom();
      socket.emit('mark-read', {
        conversationId: [myId, currentChat.id].sort().join('_'),
        senderId: currentChat.id
      });
    } else showToast('Pesan baru dari ' + (msg.sender?.name || 'seseorang'));
    const prev = msg.type==='image'?'📷 Foto':msg.type==='voice'?'🎙️ Suara':(msg.content||'');
    updatePreview(senderId, prev, msg.createdAt, !isCur);
  });

  socket.on('new-group-message', msg => {
    const myId   = (currentUser._id || currentUser.id)?.toString();
    const sendId = (msg.sender?._id || msg.sender)?.toString();
    const gid    = (msg.groupId || msg.group)?.toString();
    const isCur  = currentChat?.type==='group' && currentChat.id?.toString() === gid;
    if (isCur) {
      if (msg.type === 'system') {
        document.getElementById('msgArea').innerHTML += systemMsg(msg.content);
      } else {
        document.getElementById('msgArea').appendChild(buildBubble(msg, true));
      }
      scrollBottom();
    } else if (sendId !== myId) showToast(`Pesan baru di grup`);
    const prev = msg.type==='image'?'📷 Foto':msg.type==='voice'?'🎙️ Suara':(msg.content||'');
    updatePreview(gid, prev, msg.createdAt, !isCur && sendId !== myId);
  });

  socket.on('group-added', grp => {
    showToast(`Kamu ditambahkan ke grup "${grp.name}"`);
    loadConversations();
  });

  socket.on('group-updated', grp => {
    if (activeGroupData && activeGroupData._id?.toString() === grp._id?.toString()) {
      activeGroupData = { ...activeGroupData, ...grp };
      renderGroupInfoPanel();
    }
    loadConversations();
  });

  socket.on('group-member-removed', ({ userId }) => {
    const myId = (currentUser._id || currentUser.id)?.toString();
    if (userId?.toString() === myId) {
      showToast('Kamu dikeluarkan dari grup');
      if (currentChat?.type === 'group') {
        currentChat = null;
        ['chatHeader','emojiRow','inputBar'].forEach(x => document.getElementById(x)?.classList.remove('show'));
        document.getElementById('emptyState').style.display = '';
      }
      loadConversations();
    }
  });

  socket.on('user-status', ({ userId, status }) => {
    if (currentChat?.type==='personal' && currentChat.id === userId) {
      document.getElementById('hStatus').textContent = status==='online'?'Sedang online':'Offline';
      document.getElementById('hAv').classList.toggle('av-online', status==='online');
    }
    const el = document.querySelector(`.chat-item[data-uid="${userId}"] .av`);
    if (el) el.classList.toggle('av-online', status==='online');
  });

  socket.on('user-typing', ({ senderId }) => {
    if (currentChat?.type==='personal' && currentChat.id === senderId) showTyping(true);
  });
  socket.on('user-stop-typing', ({ senderId }) => {
    if (currentChat?.type==='personal' && currentChat.id === senderId) showTyping(false);
  });
  socket.on('messages-read', () => {
    document.querySelectorAll('.mw.me .tick').forEach(el => el.classList.add('read'));
  });

  navigator.serviceWorker?.addEventListener('message', e => {
    if (e.data?.type === 'notification-click') {
      const u = new URL(e.data.url, location.origin);
      if (u.searchParams.get('chat'))  openById('personal', u.searchParams.get('chat'));
      if (u.searchParams.get('group')) openById('group', u.searchParams.get('group'));
    }
  });
}

function onTyping() {
  if (!currentChat || !socket || currentChat.type==='group') return;
  socket.emit('typing', { receiverId: currentChat.id });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTypingSignal, 1500);
}
function stopTypingSignal() {
  if (currentChat && socket) socket.emit('stop-typing', { receiverId: currentChat.id });
  clearTimeout(typingTimer);
}
function showTyping(show) {
  let ti = document.getElementById('typingIndicator');
  if (show) {
    if (ti) return;
    ti = document.createElement('div');
    ti.id = 'typingIndicator'; ti.className = 'mw other';
    ti.innerHTML = `<div class="bubble other"><div class="typing-b"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>`;
    document.getElementById('msgArea').appendChild(ti);
    scrollBottom();
  } else if (ti) ti.remove();
}

// ══════════════════════════════════════
//  USER SEARCH
// ══════════════════════════════════════
let searchTO;
document.getElementById('searchInp').addEventListener('input', e => {
  clearTimeout(searchTO);
  const q = e.target.value.trim();
  const results = document.getElementById('searchResults');
  if (q.length < 2) {
    results.classList.remove('show');
    document.getElementById('secLabel').textContent = 'Pesan Terbaru';
    renderConversations();
    return;
  }
  document.getElementById('secLabel').textContent = 'Hasil Pencarian';
  searchTO = setTimeout(async () => {
    const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, { headers: auth() });
    const users = await res.json();
    if (!users.length) {
      results.innerHTML = `<div class="sr-item"><div style="font-size:12px;color:var(--text-hint)">Tidak ada pengguna ditemukan</div></div>`;
    } else {
      results.innerHTML = users.map(u => {
        const av = u.profilePicture
          ? `<img src="${u.profilePicture}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">`
          : u.name[0].toUpperCase();
        return `<div class="sr-item" onclick="selectConv('personal','${u._id}','${escHtml(u.name)}','${u.profilePicture||''}','${u.onlineStatus}');document.getElementById('searchInp').value='';document.getElementById('searchResults').classList.remove('show');document.getElementById('secLabel').textContent='Pesan Terbaru';">
          <div class="av av-sm">${av}</div>
          <div><div class="sr-name">${escHtml(u.name)}</div><div class="sr-email">${escHtml(u.email)}</div></div>
        </div>`;
      }).join('');
    }
    results.classList.add('show');
  }, 300);
});

// ══════════════════════════════════════
//  CREATE GROUP MODAL
// ══════════════════════════════════════
function openCreateGroupModal() {
  selectedGroupMembers = [];
  document.getElementById('groupName').value = '';
  document.getElementById('groupDesc').value = '';
  document.getElementById('memberSearch').value = '';
  document.getElementById('memberResults').innerHTML = '';
  document.getElementById('memberResults').classList.remove('show');
  document.getElementById('selectedMembers').innerHTML = '';
  document.getElementById('groupPicPreview').innerHTML = '<i class="ti ti-camera"></i><span>Foto Grup</span>';
  document.getElementById('groupPicInput').value = '';
  document.getElementById('createGroupModal').classList.add('open');
}
function closeCreateGroupModal() {
  document.getElementById('createGroupModal').classList.remove('open');
}

function previewGroupPic(input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = e => {
    document.getElementById('groupPicPreview').innerHTML = `<img src="${e.target.result}" alt="" style="width:100%;height:100%;object-fit:cover;border-radius:50%;">`;
  };
  reader.readAsDataURL(file);
}

let memberSearchTO;
async function searchMembersForGroup(q) {
  clearTimeout(memberSearchTO);
  const el = document.getElementById('memberResults');
  if (q.length < 2) { el.classList.remove('show'); return; }
  memberSearchTO = setTimeout(async () => {
    const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, { headers: auth() });
    const users = await res.json();
    const filtered = users.filter(u => !selectedGroupMembers.find(m => m._id === u._id));
    if (!filtered.length) { el.innerHTML = `<div class="msri"><div class="msri-email">Tidak ditemukan</div></div>`; }
    else {
      el.innerHTML = filtered.map(u => {
        const av = u.profilePicture
          ? `<img src="${u.profilePicture}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">`
          : u.name[0].toUpperCase();
        return `<div class="msri" onclick="addGroupMember(${JSON.stringify(u).replace(/"/g,'&quot;')})">
          <div class="av av-sm">${av}</div>
          <div><div class="msri-name">${escHtml(u.name)}</div><div class="msri-email">${escHtml(u.email)}</div></div>
        </div>`;
      }).join('');
    }
    el.classList.add('show');
  }, 300);
}

function addGroupMember(u) {
  if (selectedGroupMembers.find(m => m._id === u._id)) return;
  selectedGroupMembers.push(u);
  renderSelectedMembers();
  document.getElementById('memberSearch').value = '';
  document.getElementById('memberResults').classList.remove('show');
}

function removeGroupMember(id) {
  selectedGroupMembers = selectedGroupMembers.filter(m => m._id !== id);
  renderSelectedMembers();
}

function renderSelectedMembers() {
  document.getElementById('selectedMembers').innerHTML = selectedGroupMembers.map(u => {
    const av = u.profilePicture
      ? `<img src="${u.profilePicture}" alt="" style="width:100%;height:100%;border-radius:50%;object-fit:cover">`
      : u.name[0].toUpperCase();
    return `<div class="sel-member-chip">
      <div class="av-xs">${av}</div>
      <span>${escHtml(u.name)}</span>
      <span class="rm" onclick="removeGroupMember('${u._id}')">×</span>
    </div>`;
  }).join('');
}

async function submitCreateGroup() {
  const name = document.getElementById('groupName').value.trim();
  if (!name) { showToast('Nama grup wajib diisi'); return; }

  const btn = document.getElementById('createGroupBtn');
  btn.disabled = true; btn.textContent = 'Membuat...';

  try {
    const res = await fetch('/api/groups', {
      method: 'POST',
      headers: { ...auth(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        description: document.getElementById('groupDesc').value,
        memberIds: selectedGroupMembers.map(m => m._id)
      })
    });
    const grp = await res.json();
    if (!res.ok) throw new Error(grp.message);

    // Upload group pic if selected
    const picFile = document.getElementById('groupPicInput').files[0];
    if (picFile) {
      const form = new FormData();
      form.append('picture', picFile);
      await fetch(`/api/groups/${grp._id}/picture`, { method:'POST', headers: auth(), body: form });
    }

    closeCreateGroupModal();
    await loadConversations();
    selectConv('group', grp._id, grp.name, grp.picture||'', '');
  } catch (e) {
    showToast(e.message || 'Gagal membuat grup');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="ti ti-users"></i> Buat Grup';
  }
}

// ══════════════════════════════════════
//  GROUP INFO PANEL
// ══════════════════════════════════════
async function openGroupInfo() {
  if (!currentChat || currentChat.type !== 'group') return;
  const res = await fetch(`/api/groups/${currentChat.id}`, { headers: auth() });
  if (!res.ok) return;
  activeGroupData = await res.json();
  renderGroupInfoPanel();
  document.getElementById('groupInfoPanel').classList.add('open');
}

function closeGroupInfo() {
  document.getElementById('groupInfoPanel').classList.remove('open');
}

function renderGroupInfoPanel() {
  const g   = activeGroupData;
  const myId = (currentUser._id || currentUser.id)?.toString();
  const me   = g.members?.find(m => (m.user?._id || m.user)?.toString() === myId);
  const isAdmin = me?.role === 'admin';

  const pic = document.getElementById('gipPic');
  if (g.picture) pic.innerHTML = `<img src="${g.picture}" alt="">`;
  else pic.textContent = g.name[0].toUpperCase();

  document.getElementById('gipPicEdit').style.display = isAdmin ? '' : 'none';
  document.getElementById('gipName').textContent = g.name;
  document.getElementById('gipDesc').textContent = g.description || '';
  document.getElementById('gipMeta').textContent = `${g.members?.length || 0} anggota · Dibuat ${fmtDate(g.createdAt)}`;
  document.getElementById('gipAddMember').style.display = isAdmin ? '' : 'none';

  const membersEl = document.getElementById('gipMembers');
  membersEl.innerHTML = (g.members || []).map(m => {
    const u = m.user;
    const uid = (u?._id || u)?.toString();
    const av = u?.profilePicture
      ? `<img src="${u.profilePicture}" style="width:100%;height:100%;border-radius:50%;object-fit:cover" alt="">`
      : (u?.name||'?')[0].toUpperCase();
    const removeBtn = isAdmin && uid !== myId
      ? `<i class="ti ti-user-minus gip-member-remove" onclick="removeMember('${uid}')"></i>` : '';
    return `<div class="gip-member-item">
      <div class="av av-sm">${av}</div>
      <div class="gip-member-info">
        <div class="gip-member-name">${escHtml(u?.name||'?')}</div>
        ${m.role==='admin'?'<div class="gip-member-role">Admin</div>':''}
      </div>${removeBtn}
    </div>`;
  }).join('');
}

async function uploadGroupPic(input) {
  const file = input.files[0];
  if (!file || !activeGroupData) return;
  const form = new FormData();
  form.append('picture', file);
  const res = await fetch(`/api/groups/${activeGroupData._id}/picture`, { method:'POST', headers: auth(), body: form });
  const data = await res.json();
  if (res.ok) {
    activeGroupData.picture = data.picture;
    document.getElementById('gipPic').innerHTML = `<img src="${data.picture}" alt="">`;
    document.getElementById('hAv').innerHTML = `<img src="${data.picture}" alt="">`;
    showToast('Foto grup diperbarui ✓');
  }
}

function showAddMemberInPanel() {
  const wrap = document.getElementById('gipAddWrap');
  wrap.style.display = wrap.style.display === 'none' ? '' : 'none';
}

let panelMemberTO;
async function searchMembersInPanel(q) {
  clearTimeout(panelMemberTO);
  const el = document.getElementById('gipMemberResults');
  if (q.length < 2) { el.innerHTML = ''; return; }
  panelMemberTO = setTimeout(async () => {
    const res = await fetch(`/api/users/search?q=${encodeURIComponent(q)}`, { headers: auth() });
    const users = await res.json();
    const existingIds = (activeGroupData?.members || []).map(m => (m.user?._id || m.user)?.toString());
    const filtered = users.filter(u => !existingIds.includes(u._id));
    el.innerHTML = filtered.map(u => `<div class="msri" onclick="addMemberToGroup('${u._id}','${escHtml(u.name)}')">
      <div class="av av-sm">${u.name[0].toUpperCase()}</div>
      <div><div class="msri-name">${escHtml(u.name)}</div></div>
    </div>`).join('');
  }, 300);
}

async function addMemberToGroup(userId, userName) {
  const res = await fetch(`/api/groups/${activeGroupData._id}/members`, {
    method: 'POST', headers: { ...auth(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ userId })
  });
  const data = await res.json();
  showToast(res.ok ? `${userName} ditambahkan ✓` : data.message);
  if (res.ok) {
    document.getElementById('gipMemberSearch').value = '';
    document.getElementById('gipMemberResults').innerHTML = '';
    document.getElementById('gipAddWrap').style.display = 'none';
    const r2 = await fetch(`/api/groups/${activeGroupData._id}`, { headers: auth() });
    if (r2.ok) { activeGroupData = await r2.json(); renderGroupInfoPanel(); }
  }
}

async function removeMember(userId) {
  if (!confirm('Keluarkan anggota ini?')) return;
  const res = await fetch(`/api/groups/${activeGroupData._id}/members/${userId}`, { method:'DELETE', headers: auth() });
  const data = await res.json();
  showToast(data.message);
  if (res.ok) {
    const r2 = await fetch(`/api/groups/${activeGroupData._id}`, { headers: auth() });
    if (r2.ok) { activeGroupData = await r2.json(); renderGroupInfoPanel(); }
  }
}

async function leaveGroup() {
  if (!confirm('Yakin ingin keluar dari grup ini?')) return;
  const res = await fetch(`/api/groups/${activeGroupData._id}/leave`, { method:'POST', headers: auth() });
  const data = await res.json();
  showToast(data.message);
  if (res.ok) {
    closeGroupInfo();
    currentChat = null; activeGroupData = null;
    ['chatHeader','emojiRow','inputBar'].forEach(x => document.getElementById(x)?.classList.remove('show'));
    document.getElementById('emptyState').style.display = '';
    await loadConversations();
  }
}

// ══════════════════════════════════════
//  EMOJI PICKER
// ══════════════════════════════════════
let currentEmojiCat = 0;

function buildEmojiPicker() {
  const catsEl = document.getElementById('epCats');
  const gridEl = document.getElementById('epGrid');

  EMOJI_CATS.forEach((cat, i) => {
    const btn = document.createElement('button');
    btn.className = 'ep-cat-btn' + (i===0?' active':'');
    btn.textContent = cat.icon;
    btn.title = cat.label;
    btn.onclick = () => {
      document.querySelectorAll('.ep-cat-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentEmojiCat = i;
      renderEmojiGrid(i);
    };
    catsEl.appendChild(btn);
  });

  renderEmojiGrid(0);
}

function renderEmojiGrid(catIndex) {
  const gridEl = document.getElementById('epGrid');
  gridEl.innerHTML = '';
  EMOJI_CATS[catIndex].emojis.forEach(emoji => {
    const btn = document.createElement('button');
    btn.className = 'ep-emoji';
    btn.textContent = emoji;
    btn.onclick = () => insertEmoji(emoji);
    gridEl.appendChild(btn);
  });
}

function insertEmoji(emoji) {
  const inp = document.getElementById('chatInp');
  const start = inp.selectionStart;
  const end   = inp.selectionEnd;
  inp.value = inp.value.slice(0, start) + emoji + inp.value.slice(end);
  inp.selectionStart = inp.selectionEnd = start + emoji.length;
  inp.focus();
}

function toggleEmojiPicker() {
  document.getElementById('emojiPickerPanel').classList.toggle('open');
}
function closeEmojiPicker() {
  document.getElementById('emojiPickerPanel').classList.remove('open');
}

// ══════════════════════════════════════
//  BACKGROUND
// ══════════════════════════════════════
function applyBg(bg) {
  document.getElementById('chatBg').style.background = bg;
  document.querySelectorAll('.bg-opt').forEach(el => el.classList.toggle('sel', el.dataset.bg === bg));
}
function toggleBgPanel() { document.getElementById('bgPanel').classList.toggle('show'); }
async function setBg(el) {
  const bg = el.dataset.bg;
  applyBg(bg);
  document.querySelectorAll('.bg-opt').forEach(o => o.classList.remove('sel'));
  el.classList.add('sel');
  try {
    await fetch('/api/profile', { method:'PUT', headers:{...auth(),'Content-Type':'application/json'}, body:JSON.stringify({background:bg}) });
    currentUser.background = bg;
    localStorage.setItem('bonah_user', JSON.stringify(currentUser));
  } catch {}
}

// ══════════════════════════════════════
//  PUSH NOTIFICATIONS / SERVICE WORKER
// ══════════════════════════════════════
async function registerSW() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    if (Notification.permission === 'default') showNotifBanner(reg);
    else if (Notification.permission === 'granted') subscribePush(reg);
  } catch {}
}
function showNotifBanner(reg) {
  const b = document.createElement('div');
  b.className = 'notif-banner'; b.id = 'notifBanner';
  b.innerHTML = `<span>Aktifkan notifikasi pesan</span>
    <button onclick="reqNotif(this.closest('#notifBanner'))">Aktifkan</button>
    <button class="nb-close" onclick="this.closest('#notifBanner').remove()">✕</button>`;
  b._reg = reg; document.body.appendChild(b);
}
async function reqNotif(banner) {
  const p = await Notification.requestPermission();
  if (p === 'granted' && banner?._reg) await subscribePush(banner._reg);
  banner?.remove();
}
async function subscribePush(reg) {
  try {
    const { key } = await (await fetch('/api/push/vapid-public-key')).json();
    const sub = await reg.pushManager.subscribe({ userVisibleOnly:true, applicationServerKey: urlB64(key) });
    await fetch('/api/push/subscribe', { method:'POST', headers:{...auth(),'Content-Type':'application/json'}, body:JSON.stringify({subscription:sub.toJSON()}) });
  } catch {}
}
function urlB64(b64) {
  const pad = '='.repeat((4 - b64.length%4)%4);
  const raw = atob((b64+pad).replace(/-/g,'+').replace(/_/g,'/'));
  return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));
}

// ══════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════
function updatePreview(id, preview, time, addUnread = false) {
  const idx = conversations.findIndex(c => c.id?.toString() === id?.toString());
  if (idx >= 0) {
    conversations[idx].lastMessage = preview;
    conversations[idx].lastMessageTime = time;
    if (addUnread) conversations[idx].unread = (conversations[idx].unread||0)+1;
    const [c] = conversations.splice(idx,1);
    conversations.unshift(c);
    renderConversations();
  } else loadConversations();
}

function scrollBottom() {
  const a = document.getElementById('msgArea');
  a.scrollTop = a.scrollHeight;
}
function onKey(e) { if (e.key==='Enter'&&!e.shiftKey){e.preventDefault();sendMsg();} }
function escHtml(s) {
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatTime(d) {
  if (!d) return '';
  const dt = new Date(d), now = new Date(), diff = (now-dt)/1000;
  if (diff<60) return 'baru saja';
  if (diff<86400 && dt.getDate()===now.getDate()) return dt.toLocaleTimeString('id-ID',{hour:'2-digit',minute:'2-digit'});
  if (diff<172800) return 'Kemarin';
  return dt.toLocaleDateString('id-ID',{day:'numeric',month:'short'});
}
function fmtDate(d) {
  return new Date(d).toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric'});
}
function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.classList.add('show');
  setTimeout(()=>t.classList.remove('show'),2500);
}
function openLightbox(src) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightbox').classList.add('open');
}
function closeLightbox() { document.getElementById('lightbox').classList.remove('open'); }
function logout() {
  if (!confirm('Yakin ingin keluar?')) return;
  localStorage.clear(); window.location.replace('/login.html');
}

// ── Outside click handlers ──
document.addEventListener('click', e => {
  if (!e.target.closest('.search-wrap') && !e.target.closest('.search-results'))
    document.getElementById('searchResults').classList.remove('show');
  if (!e.target.closest('.bg-btn') && !e.target.closest('.bg-panel'))
    document.getElementById('bgPanel').classList.remove('show');
  if (!e.target.closest('.ep-toggle-btn') && !e.target.closest('.emoji-picker-panel'))
    closeEmojiPicker();
  if (!e.target.closest('.modal-card') && e.target.closest('#createGroupModal'))
    closeCreateGroupModal();
});

// ── Start ──
init();
