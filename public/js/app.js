function redirectToDashboard(role) {
  if (role === 'Student') window.location.href = '/student-dashboard.html';
  else if (role === 'Staff') window.location.href = '/staff-dashboard.html';
  else if (role === 'Admin') window.location.href = '/admin-dashboard.html';
  else window.location.href = '/login.html';
}

function logoutUser() {
  fetch('/api/logout', { method: 'POST' })
    .finally(() => {
      window.location.href = '/login.html';
    });
}

async function fetchSession() {
  const response = await fetch('/api/session');
  return response.json();
}

async function ensureAuthenticated() {
  const user = await fetchSession();
  if (!user) {
    window.location.href = '/login.html';
    return null;
  }
  return user;
}

async function apiRequest(url, options = {}) {
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();

  if (!response.ok) {
    throw new Error(typeof data === 'string' ? data : (data.message || 'The request failed.'));
  }

  return data;
}

function statusBadgeClass(status) {
  const map = {
    New: 'blue',
    Assigned: 'amber',
    'In Progress': 'purple',
    'Pending Student': 'orange',
    Resolved: 'green',
    Closed: 'gray'
  };
  return map[status] || 'blue';
}

function roleBadgeClass(role) {
  const map = {
    Student: 'blue',
    Staff: 'purple',
    Admin: 'green'
  };
  return map[role] || 'gray';
}

function renderUserTable(rows, mountNode) {
  if (!rows.length) {
    mountNode.innerHTML = '<tr><td colspan="4"><div class="empty-state">No users found.</div></td></tr>';
    return;
  }

  mountNode.innerHTML = rows.map((user) => `
    <tr>
      <td>${escapeHtml(user.name)}</td>
      <td>${escapeHtml(user.email)}</td>
      <td><span class="badge ${roleBadgeClass(user.role)}">${escapeHtml(user.role)}</span></td>
      <td>
        <button type="button" class="ghost-btn small-btn" data-action="edit" data-user-id="${user.id}">Edit</button>
        <button type="button" class="danger-btn small-btn" data-action="delete" data-user-id="${user.id}">Delete</button>
      </td>
    </tr>
  `).join('');
}

function priorityClass(priority) {
  const map = {
    Low: 'low',
    Medium: 'medium',
    High: 'high',
    Critical: 'critical'
  };
  return map[priority] || 'medium';
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-GB', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(date);
}

function renderTicketTable(rows, mountNode, role) {
  if (!rows.length) {
    mountNode.innerHTML = '<tr><td colspan="9"><div class="empty-state">No tickets available.</div></td></tr>';
    return;
  }

  mountNode.innerHTML = rows.map((ticket) => {
    const slaClass = ticket.isSlaBreached ? 'breach' : 'ok';
    const assignedName = ticket.assigned_staff_name || 'Unassigned';
    const studentName = ticket.student_name || 'Unknown student';

    return `
      <tr>
        <td>#${ticket.id}</td>
        <td>
          <div class="ticket-subject"><a href="/ticket-detail.html?id=${ticket.id}">${ticket.subject}</a></div>
          <small>${ticket.category}</small>
        </td>
        <td>${studentName}</td>
        <td>${assignedName}</td>
        <td><span class="badge ${priorityClass(ticket.priority)}">${ticket.priority}</span></td>
        <td><span class="badge ${statusBadgeClass(ticket.status)}">${ticket.status}</span></td>
        <td>${formatDate(ticket.created_at)}</td>
        <td>${formatDate(ticket.sla_due_at)}</td>
        <td><span class="sla-pill ${slaClass}">${ticket.isSlaBreached ? 'Breach' : 'On Time'}</span></td>
      </tr>
    `;
  }).join('');
}

function renderRecentTickets(rows, mountNode) {
  if (!rows.length) {
    mountNode.innerHTML = '<div class="empty-state">No recent tickets found.</div>';
    return;
  }

  mountNode.innerHTML = rows.map((ticket) => `
    <div class="list-item">
      <div>
        <h4>#${ticket.id} ${ticket.subject}</h4>
        <p>${ticket.category} · ${ticket.student_name || 'Student'} · ${formatDate(ticket.created_at)}</p>
      </div>
      <div class="flex-right">
        <span class="badge ${priorityClass(ticket.priority)}">${ticket.priority}</span>
        <span class="badge ${statusBadgeClass(ticket.status)}">${ticket.status}</span>
      </div>
    </div>
  `).join('');
}

function renderSummaryCards(statsMap) {
  const cards = document.querySelectorAll('[data-stat]');
  cards.forEach((card) => {
    const key = card.dataset.stat;
    const value = statsMap[key] ?? 0;
    if (card && card.textContent !== undefined) {
      card.textContent = value;
    }
  });
}

function showToast(message, isError = false) {
  const toast = document.getElementById('toast');
  if (!toast) return;
  toast.textContent = message;
  toast.classList.toggle('error', isError);
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2600);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
