// ── Auth Guard ──
const token = localStorage.getItem('bonah_token');
if (!token) { window.location.replace('/login.html'); }

let currentUser = JSON.parse(localStorage.getItem('bonah_user') || '{}');
let currentChat = null;
let conversations = [];
let socket = null;
let mediaRecorder = null;
let recInterval = null;
let recSeconds = 0;
let isRecording = false;
let typingTimer = null;

const API = '';
const isMobile = () => window.innerWidth <= 860;

// ── Init ──
async function init() {
  try {
    const res = await fetch(`${API}/api/profile`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (res.status === 401) { localStorage.clear(); window.location.replace('/login.html'); return; }
    currentUser = await res.json();
    localStorage.setItem('bonah_user', JSON.stringify(currentUser));

    renderMe();
    applyBackground(currentUser.background || '#FBF0F3');
    await loadConversations();
    connectSocket();
    hideLoading();
    registerServiceWorker();

    // Deep link: ?chat=userId
    const chatParam = new URLSearchParams(location.search).get('chat');
    if (chatParam) openChatById(chatParam);
  } catch (err) {
    console.error('Init error:', err);
    hideLoading();
  }
}

function hideLoading() {
  const ls = document.getElementById('loadingScreen');
  ls.classList.add('fade-out');
  setTimeout(() => ls.style.display = 'none', 400);
}

// ── Mobile sidebar toggle ──
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

// ── Render "me" in sidebar footer ──
function renderMe() {
  document.getElementById('meName').textContent = currentUser.name || 'Kamu';
  const stat = currentUser.onlineStatus;
  document.getElementById('meStat').textContent =
    stat === 'online' ? '● Online' : stat === 'away' ? '● Away' : stat === 'busy' ? '● Sibuk' : '● Offline';

  const meAv = document.getElementById('meAv');
  if (currentUser.profilePicture) {
    meAv.innerHTML = `<img src="${currentUser.profilePicture}" alt="Me">`;
  } else {
    meAv.textContent = currentUser.name ? currentUser.name[0].toUpperCase() : 'K';
  }
}

// ── Load conversations ──
async function loadConversations() {
  try {
    const res = await fetch(`${API}/api/messages/conversations`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    conversations = await res.json();
    renderConversations();
  } catch (e) {
    console.error('Load conv error:', e);
  }
}

function renderConversations() {
  const list = document.getElementById('chatList');
  if (conversations.length === 0) {
    list.innerHTML = `<div style="text-align:center;padding:24px 16px;font-size:12px;color:var(--text-hint);">Belum ada percakapan.<br>Cari teman untuk mulai chat ✿</div>`;
    return;
  }

  list.innerHTML = conversations.map((c) => {
    const isActive = currentChat && currentChat.userId === c.userId.toString();
    const avHtml = c.profilePicture
      ? `<img src="${c.profilePicture}" alt="${escHtml(c.name)}">`
      : c.name[0].toUpperCase();
    const online = c.onlineStatus === 'online';
    const timeStr = formatTime(c.lastMessageTime);

    return `
      <div class="chat-item${isActive ? ' active' : ''}" onclick="selectConv('${c.userId}','${escHtml(c.name).replace(/'/g,"\\'")}','${c.profilePicture || ''}','${c.onlineStatus}')" data-uid="${c.userId}">
        <div class="av${online ? ' av-online' : ''}">${avHtml}</div>
        <div class="ci">
          <div class="ci-row">
            <span class="ci-name">${escHtml(c.name)}</span>
            <span class="ci-time">${timeStr}</span>
          </div>
          <div class="ci-row2">
            <div class="ci-prev" style="flex:1">${escHtml(c.lastMessage)}</div>
            ${c.unread > 0 ? `<div class="badge">${c.unread}</div>` : ''}
          </div>
        </div>
      </div>`;
  }).join('');
}

// ── Select Conversation ──
async function selectConv(userId, name, pic, onlineStatus) {
  currentChat = { userId, name, profilePicture: pic };
  showChat();

  document.getElementById('chatHeader').classList.add('show');
  document.getElementById('emojiRow').classList.add('show');
  document.getElementById('inputBar').classList.add('show');
  document.getElementById('emptyState').style.display = 'none';

  const hAv = document.getElementById('hAv');
  hAv.className = 'av' + (onlineStatus === 'online' ? ' av-online' : '');
  hAv.innerHTML = pic ? `<img src="${pic}" alt="${escHtml(name)}">` : name[0].toUpperCase();

  document.getElementById('hName').textContent = name;
  document.getElementById('hStatus').textContent =
    onlineStatus === 'online' ? 'Sedang online' : onlineStatus === 'away' ? 'Away' :
    onlineStatus === 'busy' ? 'Sedang sibuk' : 'Terakhir dilihat baru-baru ini';

  document.querySelectorAll('.chat-item').forEach(el => {
    el.classList.toggle('active', el.dataset.uid === userId);
  });

  const conv = conversations.find(c => c.userId.toString() === userId);
  if (conv) conv.unread = 0;
  renderConversations();

  document.getElementById('msgArea').innerHTML = '';
  await loadMessages(userId);

  if (socket && conv) {
    socket.emit('mark-read', { conversationId: conv.conversationId, senderId: userId });
  }

  document.getElementById('chatInp').focus();
}

async function openChatById(userId) {
  try {
    const res = await fetch(`${API}/api/users/${userId}`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const u = await res.json();
    selectConv(u._id, u.name, u.profilePicture || '', u.onlineStatus);
  } catch (e) {}
}

async function loadMessages(userId) {
  try {
    const res = await fetch(`${API}/api/messages/${userId}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return;
    const messages = await res.json();
    const area = document.getElementById('msgArea');
    area.innerHTML = '';

    let lastDate = '';
    messages.forEach(msg => {
      const d = new Date(msg.createdAt).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' });
      if (d !== lastDate) {
        lastDate = d;
        area.innerHTML += `<div class="date-chip"><span>${d}</span></div>`;
      }
      area.appendChild(buildBubble(msg));
    });
    scrollBottom();
  } catch (e) {
    console.error('Load messages error:', e);
  }
}

// ── Build Message Bubble ──
function buildBubble(msg) {
  const myId = currentUser._id || currentUser.id;
  const senderId = msg.sender._id || msg.sender;
  const isMe = senderId.toString() === myId.toString();
  const time = new Date(msg.createdAt).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });

  const wrapper = document.createElement('div');
  wrapper.className = `mw ${isMe ? 'me' : 'other'}`;
  wrapper.dataset.msgId = msg._id;

  let content = '';
  if (msg.type === 'image' && msg.mediaUrl) {
    content = `<img class="msg-img" src="${msg.mediaUrl}" alt="Foto" onclick="openLightbox('${msg.mediaUrl}')">`;
    if (msg.content) content += `<div>${escHtml(msg.content)}</div>`;
  } else if (msg.type === 'voice' && msg.mediaUrl) {
    content = `<audio class="msg-audio" controls src="${msg.mediaUrl}"></audio>`;
  } else if (msg.type === 'video' && msg.mediaUrl) {
    content = `<video class="msg-video" controls src="${msg.mediaUrl}"></video>`;
  } else if (msg.type === 'file' && msg.mediaUrl) {
    content = `<a class="msg-file" href="${msg.mediaUrl}" target="_blank" download="${escHtml(msg.fileName || 'file')}">
      <i class="ti ti-file-download"></i><span>${escHtml(msg.fileName || 'File')}</span></a>`;
  } else {
    content = escHtml(msg.content);
  }

  const tick = isMe ? `<i class="ti ti-checks tick ${msg.isRead ? 'read' : 'me'}"></i>` : '';

  wrapper.innerHTML = `
    <div class="bubble ${isMe ? 'me' : 'other'}">${content}</div>
    <div class="b-meta">
      <span class="b-time ${isMe ? 'me' : 'ot'}">${time}</span>${tick}
    </div>`;
  return wrapper;
}

// ── Send Message ──
async function sendMsg() {
  const inp = document.getElementById('chatInp');
  const txt = inp.value.trim();
  if (!txt || !currentChat) return;

  inp.value = '';
  stopTypingSignal();

  try {
    const res = await fetch(`${API}/api/messages/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ receiverId: currentChat.userId, content: txt, type: 'text' })
    });
    if (!res.ok) throw new Error('Gagal');
    const msg = await res.json();
    document.getElementById('msgArea').appendChild(buildBubble(msg));
    scrollBottom();
    updateConvPreview(currentChat.userId, txt, msg.createdAt);
  } catch {
    showToast('Gagal mengirim pesan');
  }
}

// ── File upload ──
async function handleFileSelect(input) {
  const file = input.files[0];
  if (!file || !currentChat) return;

  const type = file.type.startsWith('image/') ? 'image'
    : file.type.startsWith('audio/') ? 'voice'
    : file.type.startsWith('video/') ? 'video' : 'file';

  const form = new FormData();
  form.append('media', file);
  form.append('receiverId', currentChat.userId);
  form.append('type', type);

  showToast('Mengunggah...');
  try {
    const res = await fetch(`${API}/api/messages/send`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
    if (!res.ok) throw new Error('Gagal');
    const msg = await res.json();
    document.getElementById('msgArea').appendChild(buildBubble(msg));
    scrollBottom();
    const preview = type === 'image' ? '📷 Foto' : type === 'video' ? '🎬 Video' : '📎 File';
    updateConvPreview(currentChat.userId, preview, msg.createdAt);
    showToast('Terkirim ✓');
  } catch {
    showToast('Upload gagal');
  }
  input.value = '';
}

// ── Voice Recording ──
async function startRecording() {
  if (isRecording || !currentChat) return;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const chunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.ondataavailable = e => chunks.push(e.data);
    mediaRecorder.onstop = async () => {
      const blob = new Blob(chunks, { type: 'audio/webm' });
      stream.getTracks().forEach(t => t.stop());
      if (blob.size > 500) await sendVoice(blob);
    };
    mediaRecorder.start();
    isRecording = true;
    recSeconds = 0;
    document.getElementById('micBtn').classList.add('recording');
    document.getElementById('recTimer').classList.add('show');
    recInterval = setInterval(() => {
      recSeconds++;
      const m = Math.floor(recSeconds / 60);
      const s = recSeconds % 60;
      document.getElementById('recTimer').textContent = `⏺ ${m}:${String(s).padStart(2, '0')}`;
    }, 1000);
  } catch {
    showToast('Izin mikrofon diperlukan');
  }
}

function stopRecording() {
  if (!isRecording) return;
  isRecording = false;
  clearInterval(recInterval);
  document.getElementById('micBtn').classList.remove('recording');
  document.getElementById('recTimer').classList.remove('show');
  document.getElementById('recTimer').textContent = '⏺ 0:00';
  if (mediaRecorder && mediaRecorder.state !== 'inactive') mediaRecorder.stop();
}

async function sendVoice(blob) {
  const form = new FormData();
  form.append('media', blob, 'voice-note.webm');
  form.append('receiverId', currentChat.userId);
  form.append('type', 'voice');
  try {
    const res = await fetch(`${API}/api/messages/send`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form
    });
    if (!res.ok) throw new Error('');
    const msg = await res.json();
    document.getElementById('msgArea').appendChild(buildBubble(msg));
    scrollBottom();
    updateConvPreview(currentChat.userId, '🎙️ Pesan suara', msg.createdAt);
  } catch {
    showToast('Gagal mengirim pesan suara');
  }
}

// ── Socket.IO ──
function connectSocket() {
  socket = io('/', { auth: { userId: currentUser._id || currentUser.id } });

  socket.on('connect', () => console.log('Socket connected'));

  socket.on('new-message', (msg) => {
    const myId = (currentUser._id || currentUser.id).toString();
    const senderId = (msg.sender._id || msg.sender).toString();
    const isFromCurrent = currentChat && senderId === currentChat.userId.toString();

    if (isFromCurrent) {
      document.getElementById('msgArea').appendChild(buildBubble(msg));
      scrollBottom();
      socket.emit('mark-read', {
        conversationId: [myId, currentChat.userId].sort().join('_'),
        senderId: currentChat.userId
      });
    }

    const preview = msg.type === 'image' ? '📷 Foto' : msg.type === 'voice' ? '🎙️ Pesan suara'
      : msg.type === 'video' ? '🎬 Video' : (msg.content || '');
    updateConvPreview(senderId, preview, msg.createdAt, !isFromCurrent);
  });

  socket.on('user-status', ({ userId, status }) => {
    if (currentChat && currentChat.userId === userId) {
      document.getElementById('hStatus').textContent = status === 'online' ? 'Sedang online' : 'Offline';
      document.getElementById('hAv').classList.toggle('av-online', status === 'online');
    }
    const item = document.querySelector(`.chat-item[data-uid="${userId}"] .av`);
    if (item) item.classList.toggle('av-online', status === 'online');
    const conv = conversations.find(c => c.userId.toString() === userId);
    if (conv) conv.onlineStatus = status;
  });

  socket.on('user-typing', ({ senderId }) => {
    if (currentChat && currentChat.userId === senderId) showTypingIndicator(true);
  });

  socket.on('user-stop-typing', ({ senderId }) => {
    if (currentChat && currentChat.userId === senderId) showTypingIndicator(false);
  });

  socket.on('messages-read', () => {
    document.querySelectorAll('.mw.me .tick').forEach(el => el.classList.add('read'));
  });

  // Handle notification clicks from service worker
  navigator.serviceWorker?.addEventListener('message', (e) => {
    if (e.data.type === 'notification-click') {
      const uid = new URL(e.data.url, location.origin).searchParams.get('chat');
      if (uid) openChatById(uid);
    }
  });
}

// ── Typing signal ──
function onTyping() {
  if (!currentChat || !socket) return;
  socket.emit('typing', { receiverId: currentChat.userId });
  clearTimeout(typingTimer);
  typingTimer = setTimeout(stopTypingSignal, 1500);
}

function stopTypingSignal() {
  if (currentChat && socket) socket.emit('stop-typing', { receiverId: currentChat.userId });
  clearTimeout(typingTimer);
}

function showTypingIndicator(show) {
  let ti = document.getElementById('typingIndicator');
  if (show) {
    if (ti) return;
    ti = document.createElement('div');
    ti.id = 'typingIndicator';
    ti.className = 'mw other';
    ti.innerHTML = `<div class="bubble other"><div class="typing-b"><div class="dot"></div><div class="dot"></div><div class="dot"></div></div></div>`;
    document.getElementById('msgArea').appendChild(ti);
    scrollBottom();
  } else if (ti) ti.remove();
}

// ── User Search ──
let searchTimeout;
document.getElementById('searchInp').addEventListener('input', (e) => {
  clearTimeout(searchTimeout);
  const q = e.target.value.trim();
  const results = document.getElementById('searchResults');

  if (q.length < 2) {
    results.classList.remove('show');
    document.getElementById('secLabel').textContent = 'Pesan Terbaru';
    renderConversations();
    return;
  }

  document.getElementById('secLabel').textContent = 'Hasil Pencarian';

  searchTimeout = setTimeout(async () => {
    try {
      const res = await fetch(`${API}/api/users/search?q=${encodeURIComponent(q)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const users = await res.json();
      if (users.length === 0) {
        results.innerHTML = `<div class="sr-item"><div style="font-size:12px;color:var(--text-hint);">Tidak ada pengguna ditemukan</div></div>`;
      } else {
        results.innerHTML = users.map(u => {
          const av = u.profilePicture
            ? `<img src="${u.profilePicture}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" alt="">`
            : u.name[0].toUpperCase();
          return `<div class="sr-item" onclick="
            selectConv('${u._id}','${escHtml(u.name).replace(/'/g,"\\'")}','${u.profilePicture || ''}','${u.onlineStatus}');
            document.getElementById('searchInp').value='';
            document.getElementById('searchResults').classList.remove('show');
            document.getElementById('secLabel').textContent='Pesan Terbaru';
          ">
            <div class="av av-sm">${av}</div>
            <div><div class="sr-name">${escHtml(u.name)}</div><div class="sr-email">${escHtml(u.email)}</div></div>
          </div>`;
        }).join('');
      }
      results.classList.add('show');
    } catch (e) { console.error(e); }
  }, 300);
});

// ── Push Notifications ──
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    const reg = await navigator.serviceWorker.register('/sw.js');
    const perm = Notification.permission;
    if (perm === 'default') showNotifBanner(reg);
    else if (perm === 'granted') subscribePush(reg);
  } catch (e) {
    console.warn('SW register failed:', e);
  }
}

function showNotifBanner(reg) {
  const banner = document.createElement('div');
  banner.className = 'notif-banner';
  banner.id = 'notifBanner';
  banner.innerHTML = `
    <span>Aktifkan notifikasi untuk pesan masuk</span>
    <button onclick="requestNotifPerm(this.closest('#notifBanner'))">Aktifkan</button>
    <button class="nb-close" onclick="this.closest('#notifBanner').remove()">✕</button>`;
  document.body.appendChild(banner);

  banner._reg = reg;
}

async function requestNotifPerm(banner) {
  const perm = await Notification.requestPermission();
  if (perm === 'granted' && banner && banner._reg) {
    await subscribePush(banner._reg);
  }
  banner && banner.remove();
}

async function subscribePush(reg) {
  try {
    const res = await fetch('/api/push/vapid-public-key');
    const { key } = await res.json();

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(key)
    });

    await fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription: sub.toJSON() })
    });
  } catch (e) {
    console.warn('Push subscribe failed:', e);
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)));
}

// ── Background ──
function applyBackground(bg) {
  document.getElementById('chatBg').style.background = bg;
  document.querySelectorAll('.bg-opt').forEach(el => {
    el.classList.toggle('sel', el.dataset.bg === bg);
  });
}

function toggleBgPanel() {
  document.getElementById('bgPanel').classList.toggle('show');
}

async function setBg(el) {
  const bg = el.dataset.bg;
  applyBackground(bg);
  document.querySelectorAll('.bg-opt').forEach(o => o.classList.remove('sel'));
  el.classList.add('sel');
  try {
    await fetch(`${API}/api/profile`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ background: bg })
    });
    currentUser.background = bg;
    localStorage.setItem('bonah_user', JSON.stringify(currentUser));
  } catch (e) {}
}

// ── Helpers ──
function addEmoji(emoji) {
  const inp = document.getElementById('chatInp');
  inp.value += emoji;
  inp.focus();
}

function onKey(e) {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(); }
}

function scrollBottom() {
  const area = document.getElementById('msgArea');
  area.scrollTop = area.scrollHeight;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const now = new Date();
  const diff = (now - d) / 1000;
  if (diff < 60) return 'baru saja';
  if (diff < 86400 && d.getDate() === now.getDate())
    return d.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  if (diff < 172800) return 'Kemarin';
  return d.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' });
}

function updateConvPreview(userId, preview, time, addUnread = false) {
  const idx = conversations.findIndex(c => c.userId.toString() === userId.toString());
  if (idx >= 0) {
    conversations[idx].lastMessage = preview;
    conversations[idx].lastMessageTime = time;
    if (addUnread) conversations[idx].unread = (conversations[idx].unread || 0) + 1;
    const [conv] = conversations.splice(idx, 1);
    conversations.unshift(conv);
    renderConversations();
  } else {
    loadConversations();
  }
}

function showToast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2500);
}

function openLightbox(src) {
  document.getElementById('lightboxImg').src = src;
  document.getElementById('lightbox').classList.add('open');
}

function closeLightbox() {
  document.getElementById('lightbox').classList.remove('open');
}

function logout() {
  if (!confirm('Yakin ingin keluar?')) return;
  localStorage.clear();
  window.location.replace('/login.html');
}

// ── Outside click handlers ──
document.addEventListener('click', (e) => {
  if (!e.target.closest('.search-wrap') && !e.target.closest('.search-results')) {
    document.getElementById('searchResults').classList.remove('show');
  }
  if (!e.target.closest('.bg-btn') && !e.target.closest('.bg-panel')) {
    document.getElementById('bgPanel').classList.remove('show');
  }
});

// ── Start ──
init();
