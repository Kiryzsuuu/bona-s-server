// ── Auth guard ──
const token = localStorage.getItem('bonah_token');
if (!token) { window.location.replace('/login.html'); }

const API = '';
let currentUser = JSON.parse(localStorage.getItem('bonah_user') || '{}');
let selectedBg = currentUser.background || '#FBF0F3';

// ── Apply theme immediately (no flash) ──
const THEMES = [
  { id:'bonah',    name:'Bonah',    sidebar:'#FDF5F7', chat:'#FBF0F3', me:'#C4788A',    other:'#FDF0F3', dots:['#C4788A','#FDF8F5','#9B8EC4'] },
  { id:'dark',     name:'Dark',     sidebar:'#211F26', chat:'#141218', me:'#BB86FC',    other:'#2B2930', dots:['#BB86FC','#1C1B1F','#03DAC6'] },
  { id:'ios',      name:'iOS',      sidebar:'#F2F2F7', chat:'#F2F2F7', me:'#007AFF',    other:'#E9E9EB', dots:['#007AFF','#FFFFFF','#34C759'] },
  { id:'pacman',   name:'Pac-Man',  sidebar:'#080818', chat:'#000000', me:'#FFE000',    other:'#12122A', dots:['#FFE000','#000000','#FF0000'] },
  { id:'ocean',    name:'Ocean',    sidebar:'#E0F7FA', chat:'#D6F4FD', me:'#0077B6',    other:'#CAF0F8', dots:['#0077B6','#F0FDFF','#00B4D8'] },
  { id:'forest',   name:'Forest',   sidebar:'#E8F5E9', chat:'#D8F3DC', me:'#2D6A4F',    other:'#D8F3DC', dots:['#2D6A4F','#F0FFF4','#52B788'] },
  { id:'sunset',   name:'Sunset',   sidebar:'#FFF5E8', chat:'#FFEDE0', me:'#E85D04',    other:'#FFEDE0', dots:['#E85D04','#FFFAF5','#F48C06'] },
  { id:'midnight', name:'Midnight', sidebar:'#161B22', chat:'#010409', me:'#0D47A1',    other:'#161B22', dots:['#4FC3F7','#0D1117','#CE93D8'] },
  { id:'sakura',   name:'Sakura',   sidebar:'#FFF0F6', chat:'#FFE4EE', me:'#E91E63',    other:'#FCE4EC', dots:['#E91E63','#FFF8FC','#F8BBD0'] },
];

function applyTheme(themeId) {
  document.documentElement.setAttribute('data-theme', themeId || 'bonah');
  localStorage.setItem('bonah_theme', themeId || 'bonah');
}
applyTheme(currentUser.theme || localStorage.getItem('bonah_theme') || 'bonah');

// ── Load profile ──
async function loadProfile() {
  try {
    const res = await fetch(`${API}/api/profile`, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) { localStorage.clear(); window.location.replace('/login.html'); return; }
    const u = await res.json();
    currentUser = u;
    localStorage.setItem('bonah_user', JSON.stringify(u));
    renderProfile(u);
  } catch (e) {
    console.error('Load profile error', e);
  }
}

function renderProfile(u) {
  document.getElementById('pfName').textContent = u.name;
  document.getElementById('pfEmail').textContent = u.email;
  document.getElementById('pfStatusBadge').textContent =
    u.onlineStatus === 'online' ? 'Online' : u.onlineStatus === 'away' ? 'Away' : u.onlineStatus === 'busy' ? 'Sibuk' : 'Offline';

  const av = document.getElementById('pfAvatar');
  if (u.profilePicture) {
    av.innerHTML = `<img src="${u.profilePicture}" alt="Foto Profil">`;
  } else {
    av.innerHTML = u.name ? u.name[0].toUpperCase() : 'U';
  }

  // Fill forms
  document.getElementById('infoName').value = u.name || '';
  document.getElementById('infoOnlineStatus').value = u.onlineStatus || 'online';
  document.getElementById('statusText').value = u.status || '';
  document.getElementById('aboutText').value = u.about || '';
  document.getElementById('emailNew').value = u.email || '';

  // Background
  selectedBg = u.background || '#FBF0F3';
  document.querySelectorAll('.bg-swatch').forEach(el => {
    el.classList.toggle('sel', el.dataset.bg === selectedBg);
  });
}

// ── Tab navigation ──
function showTab(name, el) {
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.pf-nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  (el || event?.currentTarget)?.classList.add('active');
  // On mobile, scroll right panel into view
  if (window.innerWidth <= 640) {
    document.getElementById('pfRight')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

// ── Toggle password eye ──
function toggleEye(el, inputId) {
  const inp = document.getElementById(inputId);
  inp.type = inp.type === 'password' ? 'text' : 'password';
  el.className = inp.type === 'password' ? 'ti ti-eye eye' : 'ti ti-eye-off eye';
}

// ── Helper: show alert ──
function showAlert(id, msg, isOk) {
  const el = document.getElementById(id);
  el.textContent = msg;
  el.className = 'alert ' + (isOk ? 'ok' : 'err') + ' show';
  setTimeout(() => el.classList.remove('show'), 4000);
}

function setLoading(btn, loading, label) {
  btn.disabled = loading;
  btn.innerHTML = loading ? `<span class="spinner"></span>${label}` : label;
}

// ── Profile picture upload ──
document.getElementById('picInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  const form = new FormData();
  form.append('picture', file);

  try {
    const res = await fetch(`${API}/api/profile/picture`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: form
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    currentUser.profilePicture = data.profilePicture;
    localStorage.setItem('bonah_user', JSON.stringify(currentUser));
    renderProfile(currentUser);
  } catch (err) {
    alert('Gagal unggah foto: ' + err.message);
  }
});

// ── Form: Profil Info ──
document.getElementById('infoForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('infoBtn');
  setLoading(btn, true, 'Menyimpan...');

  try {
    const res = await fetch(`${API}/api/profile`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: document.getElementById('infoName').value.trim(),
        onlineStatus: document.getElementById('infoOnlineStatus').value
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    currentUser = { ...currentUser, ...data.user };
    localStorage.setItem('bonah_user', JSON.stringify(currentUser));
    renderProfile(currentUser);
    showAlert('infoOk', '✓ ' + data.message, true);
  } catch (err) {
    showAlert('infoErr', err.message, false);
  } finally {
    setLoading(btn, false, 'Simpan Perubahan');
  }
});

// ── Form: Status & About ──
document.getElementById('statusForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('statusBtn');
  setLoading(btn, true, 'Menyimpan...');

  try {
    const res = await fetch(`${API}/api/profile`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        status: document.getElementById('statusText').value,
        about: document.getElementById('aboutText').value
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    currentUser = { ...currentUser, ...data.user };
    localStorage.setItem('bonah_user', JSON.stringify(currentUser));
    showAlert('statusOk', '✓ Status dan about berhasil disimpan', true);
  } catch (err) {
    showAlert('statusErr', err.message, false);
  } finally {
    setLoading(btn, false, 'Simpan');
  }
});

// ── Form: Email ──
document.getElementById('emailForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('emailBtn');
  setLoading(btn, true, 'Memperbarui...');

  try {
    const res = await fetch(`${API}/api/profile/email`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: document.getElementById('emailNew').value.trim(),
        password: document.getElementById('emailPass').value
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    currentUser.email = document.getElementById('emailNew').value.trim();
    localStorage.setItem('bonah_user', JSON.stringify(currentUser));
    document.getElementById('pfEmail').textContent = currentUser.email;
    document.getElementById('emailPass').value = '';
    showAlert('emailOk', '✓ ' + data.message, true);
  } catch (err) {
    showAlert('emailErr', err.message, false);
  } finally {
    setLoading(btn, false, 'Update Email');
  }
});

// ── Form: Password ──
document.getElementById('passForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = document.getElementById('passBtn');
  const newPass = document.getElementById('passNew').value;
  const confirm = document.getElementById('passConfirm').value;

  if (newPass !== confirm) {
    showAlert('passErr', 'Password baru dan konfirmasi tidak cocok', false);
    return;
  }

  setLoading(btn, true, 'Memperbarui...');

  try {
    const res = await fetch(`${API}/api/profile/password`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        currentPassword: document.getElementById('passCurrent').value,
        newPassword: newPass
      })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    document.getElementById('passForm').reset();
    showAlert('passOk', '✓ ' + data.message, true);
  } catch (err) {
    showAlert('passErr', err.message, false);
  } finally {
    setLoading(btn, false, 'Update Password');
  }
});

// ── Background ──
function selectBg(el) {
  document.querySelectorAll('.bg-swatch').forEach(s => s.classList.remove('sel'));
  el.classList.add('sel');
  selectedBg = el.dataset.bg;
}

async function saveBg() {
  const btn = document.getElementById('bgBtn');
  setLoading(btn, true, 'Menyimpan...');
  try {
    const res = await fetch(`${API}/api/profile`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ background: selectedBg })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message);
    currentUser.background = selectedBg;
    localStorage.setItem('bonah_user', JSON.stringify(currentUser));
    showAlert('bgOk', '✓ Background chat berhasil disimpan', true);
  } catch (err) {
    alert(err.message);
  } finally {
    setLoading(btn, false, 'Simpan Background');
  }
}

// ── Theme Grid ──
function buildThemeGrid() {
  const grid = document.getElementById('themeGrid');
  if (!grid) return;
  const current = currentUser.theme || localStorage.getItem('bonah_theme') || 'bonah';

  grid.innerHTML = THEMES.map(t => `
    <div class="theme-card${t.id === current ? ' sel' : ''}" data-theme="${t.id}" onclick="selectTheme('${t.id}',this)">
      <div class="tc-preview">
        <div class="tc-sidebar" style="background:${t.sidebar}">
          <div class="tc-item"></div>
          <div class="tc-item tc-active" style="background:${t.me}33"></div>
          <div class="tc-item"></div>
        </div>
        <div class="tc-chat" style="background:${t.chat}">
          <div class="tc-bubble tc-other" style="background:${t.other}"></div>
          <div class="tc-bubble tc-me" style="background:${t.me}"></div>
        </div>
      </div>
      <div class="tc-name">${t.name}</div>
      <div class="tc-dots">
        ${t.dots.map(c => `<span style="background:${c}"></span>`).join('')}
      </div>
    </div>`).join('');
}

async function selectTheme(themeId, el) {
  document.querySelectorAll('.theme-card').forEach(c => c.classList.remove('sel'));
  el.classList.add('sel');
  applyTheme(themeId);

  try {
    const res = await fetch(`${API}/api/profile`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme: themeId })
    });
    const data = await res.json();
    if (res.ok) {
      currentUser.theme = themeId;
      localStorage.setItem('bonah_user', JSON.stringify(currentUser));
      showAlert('themeOk', `✓ Tema "${THEMES.find(t=>t.id===themeId)?.name}" diterapkan`, true);
    }
  } catch {}
}

// ── Init ──
loadProfile();
buildThemeGrid();
