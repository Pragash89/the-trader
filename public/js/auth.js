// Shared auth utilities (guards for pages that require login)
(function() {
  const token = localStorage.getItem('tt_token');
  const path = window.location.pathname;
  // If on dashboard without token, redirect to login
  if (path === '/dashboard' && !token) {
    window.location.href = '/login';
  }
  // If logged in and hitting login/register, skip to dashboard
  if ((path === '/login' || path === '/register') && token) {
    // Don't auto-redirect; let user choose
  }
})();
