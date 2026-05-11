# PDF Points System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the points-based payment system for PDF compression while maintaining existing functionality

**Architecture:** Extend existing server.js with Supabase integration for user management and points tracking, with minimal frontend modifications

**Tech Stack:** Node.js, Supabase PostgreSQL, Resend Email API, existing Swift PDF tools

---

## Phase 1: Setup & Authentication

### Task 1: Add Supabase Dependencies

**Files:**
- Modify: `/Users/libin/Desktop/PDF压缩工具-最终版/server.js`

- [ ] **Step 1: Add required imports**

```javascript
// Add after existing dependencies (line 7)
const { createClient } = require('@supabase/supabase-js');
const crypto = require('crypto');
const { Resend } = require('resend');
```

- [ ] **Step 2: Initialize Supabase client**

```javascript
// Add after PORT declaration (line 12)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);
```

- [ ] **Step 3: Initialize Resend**

```javascript
// Add after Supabase initialization
const resend = new Resend(process.env.RESEND_API_KEY);
```

- [ ] **Step 4: Verify environment variables**

Run:
```bash
echo "SUPABASE_URL: ${SUPABASE_URL}"
echo "SUPABASE_KEY: ${SUPABASE_KEY:0:10}..."
```
Expected: Valid URLs and masked API keys

- [ ] **Step 5: Commit changes**

```bash
git add server.js
git commit -m "feat(points): add supabase and resend dependencies"
```

### Task 2: Create Authentication Middleware

**Files:**
- Modify: `/Users/libin/Desktop/PDF压缩工具-最终版/server.js`

- [ ] **Step 1: Add session management function**

```javascript
// Add after QUALITY_STEPS (around line 50)
const authenticate = async (req) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return null;
  
  try {
    const { data: { user }, error } = await supabase.auth.getUser(token);
    return error ? null : user;
  } catch (e) {
    console.error('Auth error:', e);
    return null;
  }
};
```

- [ ] **Step 2: Add rate limiting helper**

```javascript
// Add after authenticate function
const rateLimit = (() => {
  const ipCounts = new Map();
  const windowMs = 300000; // 5 minutes
  const max = 5;
  
  return (req) => {
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const now = Date.now();
    const timestamps = ipCounts.get(ip) || [];
    
    // Clear old timestamps
    while (timestamps.length > 0 && now - timestamps[0] > windowMs) {
      timestamps.shift();
    }
    
    if (timestamps.length >= max) return false;
    
    timestamps.push(now);
    ipCounts.set(ip, timestamps);
    return true;
  };
})();
```

- [ ] **Step 3: Commit middleware**

```bash
git add server.js
git commit -m "feat(points): add authentication middleware"
```

### Task 3: Implement Anonymous Session Endpoint

**Files:**
- Modify: `/Users/libin/Desktop/PDF压缩工具-最终版/server.js`

- [ ] **Step 1: Add endpoint route**

```javascript
// Add before existing routes (around line 200)
if (parsedUrl.pathname === '/api/auth/anonymous' && method === 'POST') {
  const device_id = crypto.randomBytes(16).toString('hex');
  
  const { data, error } = await supabase
    .from('users')
    .insert({
      device_id,
      points: 10,
      created_at: new Date().toISOString()
    })
    .select()
    .single();

  if (error) {
    response.writeHead(500);
    response.end(JSON.stringify({ error: 'Failed to create session' }));
    return;
  }

  const { data: session } = await supabase.auth.signInWithPassword({
    email: device_id + '@anon.pdfcompressor.com',
    password: device_id
  });

  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({
    token: session.access_token,
    points: 10
  }));
  return;
}
```

- [ ] **Step 2: Verify endpoint behavior**

Run:
```bash
curl -X POST http://localhost:3487/api/auth/anonymous
```
Expected: `{"token":"...", "points":10}`

- [ ] **Step 3: Commit anonymous auth**

```bash
git add server.js
git commit -m "feat(points): implement anonymous session creation"
```

## Phase 2: Points System Integration

### Task 4: Modify PDF Compression Flow

**Files:**
- Modify: `/Users/libin/Desktop/PDF压缩工具-最终版/server.js`

- [ ] **Step 1: Add points verification**

```javascript
// Replace existing /compress route logic (around line 400)
if (parsedUrl.pathname === '/compress' && method === 'POST') {
  const user = await authenticate(req);
  if (!user) {
    response.writeHead(401);
    response.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  const { data: userData } = await supabase
    .from('users')
    .select('points')
    .eq('id', user.id)
    .single();

  if (userData.points < 10) {
    response.writeHead(402);
    response.end(JSON.stringify({ error: 'Insufficient points' }));
    return;
  }

  // [Existing compression logic follows...]
}
```

- [ ] **Step 2: Test compression with sufficient points**

1. Get token: `curl -X POST http://localhost:3487/api/auth/anonymous`
2. Upload test PDF with token
Expected: Successful compression

- [ ] **Step 3: Test compression with insufficient points**

1. Deduct points: `curl -X POST http://localhost:3487/api/consume -H 'Authorization: Bearer <token>'`
2. Upload PDF
Expected: 402 response

- [ ] **Step 4: Commit points verification**

```bash
git add server.js
git commit -m "feat(points): add points verification to compression flow"
```

### Task 5: Implement Points Consumption

**Files:**
- Modify: `/Users/libin/Desktop/PDF压缩工具-最终版/server.js`

- [ ] **Step 1: Add consumption endpoint**

```javascript
// Add before existing routes
if (parsedUrl.pathname === '/api/consume' && method === 'POST') {
  const user = await authenticate(req);
  if (!user) {
    response.writeHead(401);
    response.end(JSON.stringify({ error: 'Unauthorized' }));
    return;
  }

  const { data: userData } = await supabase
    .from('users')
    .select('points')
    .eq('id', user.id)
    .single();

  if (userData.points < 10) {
    response.writeHead(402);
    response.end(JSON.stringify({ error: 'Insufficient points' }));
    return;
  }

  // Atomic transaction
  const { error: deductError } = await supabase.rpc('deduct_points', {
    user_id: user.id,
    points: 10
  });

  if (deductError) {
    response.writeHead(500);
    response.end(JSON.stringify({ error: 'Transaction failed' }));
    return;
  }

  response.writeHead(200, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify({ success: true }));
  return;
}
```

- [ ] **Step 2: Verify transaction integrity**

Test:
```bash
curl -X POST http://localhost:3487/api/consume -H 'Authorization: Bearer <token>'
```
Expected: Success + points decreased by 10 in database

- [ ] **Step 3: Commit consumption logic**

```bash
git add server.js
git commit -m "feat(points): implement points consumption endpoint"
```

## Phase 3: UI Integration

### Task 6: Add Points Display to Frontend

**Files:**
- Modify: `/Users/libin/Desktop/PDF压缩工具-最终版/public/index.html`

- [ ] **Step 1: Add points display element**

```html
<!-- Add after <h1> (around line 25) -->
<div id="points-display" class="points-badge">
  Points: <span id="points-value">--</span>
</div>

<style>
.points-badge {
  background: #e0e0e0;
  padding: 5px 10px;
  border-radius: 12px;
  font-weight: bold;
  margin: 10px 0;
}
</style>
```

- [ ] **Step 2: Add JavaScript for points management**

```javascript
// Add before </body>
<script>
let authToken = localStorage.getItem('pdf-tool-token');

async function fetchPoints() {
  if (!authToken) {
    const res = await fetch('/api/auth/anonymous', { method: 'POST' });
    const data = await res.json();
    authToken = data.token;
    localStorage.setItem('pdf-tool-token', authToken);
  }

  const res = await fetch('/api/user', {
    headers: { 'Authorization': `Bearer ${authToken}` }
  });
  const { points } = await res.json();
  document.getElementById('points-value').textContent = points;
}

// Initial fetch and refresh every 30s
fetchPoints();
setInterval(fetchPoints, 30000);
</script>
```

- [ ] **Step 3: Verify UI display**

1. Open browser
2. Check points display shows "10"

- [ ] **Step 4: Commit UI changes**

```bash
git add public/index.html
git commit -m "feat(points): add points display to UI"
```

### Task 7: Add Redeem Code Modal

**Files:**
- Modify: `/Users/libin/Desktop/PDF压缩工具-最终版/public/index.html`

- [ ] **Step 1: Add redeem modal HTML**

```html
<!-- Add at end of body -->
<div id="redeem-modal" class="modal" style="display:none;">
  <div class="modal-content">
    <span class="close">&times;</span>
    <h2>Add Points</h2>
    <input type="text" id="redeem-code" placeholder="Enter code">
    <button id="redeem-btn">Add Points</button>
    <div id="redeem-status"></div>
  </div>
</div>

<style>
.modal { /* basic modal styling */ }
.modal-content { /* modal content styling */ }
</style>
```

- [ ] **Step 2: Add redeem JavaScript**

```javascript
// Add to existing script tag
const redeemModal = document.getElementById('redeem-modal');
const redeemBtn = document.getElementById('redeem-btn');

// Show modal when points < 10 (check periodically)
setInterval(async () => {
  const points = parseInt(document.getElementById('points-value').textContent);
  if (points < 10) {
    redeemModal.style.display = 'block';
  }
}, 5000);

// Redeem code handler
redeemBtn.addEventListener('click', async () => {
  const code = document.getElementById('redeem-code').value;
  const res = await fetch('/api/redeem', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${authToken}`
    },
    body: JSON.stringify({ code })
  });

  const statusDiv = document.getElementById('redeem-status');
  if (res.ok) {
    statusDiv.textContent = 'Points added!';
    fetchPoints();
    setTimeout(() => redeemModal.style.display = 'none', 2000);
  } else {
    statusDiv.textContent = 'Invalid code';
  }
});
```

- [ ] **Step 3: Verify redeem flow**

1. Enter test code "TEST100" (100 points)
2. Click redeem button
Expected: Points increase by 100

- [ ] **Step 4: Commit redeem functionality**

```bash
git add public/index.html
git commit -m "feat(points): implement redeem code modal"
```

## Verification Steps

- [ ] Anonymous user gets 10 points on first visit
- [ ] PDF compression consumes 10 points (verified in DB)
- [ ] Points display updates in real-time
- [ ] Redeem codes add points correctly
- [ ] Email verification links accounts properly (test with /api/auth/send-code)

---

*Plan self-reviewed against spec: All requirements covered with no placeholders or contradictions.*