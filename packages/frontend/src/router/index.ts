import { debugLog } from '../composables/useDebugLog';
import { createRouter, createWebHistory, RouteRecordRaw } from 'vue-router';
import { useAuthStore } from '../stores/auth.store'; // 导入 Auth Store
import type { SystemRole } from '../stores/auth.store';
import { isAccountFeatureAvailable } from '../utils/runtimeConfig';

// 路由配置
const routes: Array<RouteRecordRaw> = [
  // 首页就是服务器页，其他内容通过服务器页上的浮层打开。
  {
    path: '/',
    name: 'Connections',
    component: () => import('../views/ConnectionsView.vue')
  },
  // 登录页面 (占位符)
  {
    path: '/login',
    name: 'Login',
    component: () => import('../views/LoginView.vue') // 指向实际的登录组件
  },
  // 代理管理页面
  {
    path: '/proxies',
    name: 'Proxies',
     component: () => import('../views/ProxiesView.vue')
   },
  // 兼容旧服务器页路径，统一回到首页服务器页。
  {
    path: '/connections',
    redirect: { name: 'Connections' },
  },
  // 兼容旧仪表盘路由命名。
  {
    path: '/dashboard',
    name: 'Dashboard',
    redirect: { name: 'Connections' },
  },
   // 移除：标签管理页面路由
   // {
   //   path: '/tags',
   //   name: 'Tags',
   //   component: () => import('../views/TagsView.vue')
   // },
   // 兼容旧入口：工作区终端已合并到服务器页右侧。
   {
    path: '/workspace', // 移除动态路由段
    name: 'Workspace',
    redirect: { name: 'Connections' },
  },
  // 设置页面
  {
    path: '/settings',
    name: 'Settings',
    redirect: { name: 'Connections', query: { settings: '1' } }
  },
  {
    path: '/admin',
    name: 'AdminCenter',
    redirect: to => ({ name: 'Connections', query: { ...to.query, admin: '1' } }),
    meta: { allowedRoles: ['super_admin', 'admin', 'auditor'] },
  },
  // 通知管理页面
  {
    path: '/notifications',
    name: 'Notifications',
    component: () => import('../views/NotificationsView.vue')
  },
  // 兼容旧审计日志入口。
  {
    path: '/audit-logs',
    name: 'AuditLogs',
    redirect: { name: 'AdminCenter', query: { section: 'auditLogs' } }
  },
  // 初始设置页面
  {
    path: '/setup',
    name: 'Setup',
    component: () => import('../views/SetupView.vue')
  },
  // 其他路由...
];

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL), // 使用 HTML5 History 模式
  routes,
});

// 添加全局前置守卫
router.beforeEach((to, from, next) => {
  if (!isAccountFeatureAvailable()) {
    if (to.name === 'Login' || to.name === 'Setup') {
      next({ name: 'Connections' });
      return;
    }
    next();
    return;
  }

  // 在守卫内部获取 store 实例，确保 Pinia 已初始化
  const authStore = useAuthStore();
  const adminOverlayRoles: SystemRole[] = ['super_admin', 'admin', 'auditor'];
  const allowedRoles = to.name === 'Connections' && to.query.admin === '1'
    ? adminOverlayRoles
    : to.meta.allowedRoles as SystemRole[] | undefined;

  // 定义不需要认证的路由名称列表
  // 定义不需要认证的路由名称列表 (现在包括 Setup)
  const publicRoutes = ['Login', 'Setup'];
  const requiresAuth = !publicRoutes.includes(to.name as string);

  // 假设有一个状态表示是否需要初始设置，这里暂时用一个变量模拟
  // 实际应用中，这个状态应该在应用启动时通过 API 获取
  const needsSetup = authStore.needsSetup; // 从 authStore 获取状态

  if (needsSetup && to.name !== 'Setup') {
    // 如果需要设置，但目标不是设置页面，则强制重定向到设置页面
    debugLog('路由守卫：需要初始设置，重定向到 /setup');
    next({ name: 'Setup' });
  } else if (!needsSetup && to.name === 'Setup') {
     // 如果不需要设置，但尝试访问设置页面，重定向到登录页或服务器页
     debugLog('路由守卫：不需要设置，从 /setup 重定向');
     next(authStore.isAuthenticated ? { name: 'Connections' } : { name: 'Login' });
  } else if (requiresAuth && !authStore.isAuthenticated && !needsSetup) {
    // 如果需要认证、用户未登录且不需要设置，重定向到登录页
    debugLog('路由守卫：未登录，重定向到 /login');
    next({ name: 'Login' });
  } else if (to.name === 'Login' && authStore.isAuthenticated && !needsSetup) {
    // 如果用户已登录、不需要设置且尝试访问登录页，重定向到服务器页
    debugLog('路由守卫：已登录，从 /login 重定向到 /');
    next({ name: 'Connections' });
  } else if (allowedRoles && (!authStore.user || !allowedRoles.includes(authStore.user.systemRole))) {
    next({ name: 'Connections' });
  } else {
    // 其他情况（例如访问公共页面，或已登录访问需认证页面）允许导航
    next();
  }
});

export default router;
