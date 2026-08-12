import { debugLog } from '../composables/useDebugLog';
import axios from 'axios';
import { expireAuthenticatedSession } from '../authentication-runtime';
import { resolveApiBaseUrl } from './runtimeConfig';

// 创建 axios 实例
const apiClient = axios.create({
  baseURL: resolveApiBaseUrl(), // 设置基础URL
  timeout: 10000, // 设置请求超时时间
  withCredentials: true, // 允许携带 cookie
});

// 响应拦截器
apiClient.interceptors.response.use(
  (response) => {
    // 对响应数据做点什么
    return response;
  },
  async (error) => {
    // 处理响应错误
    console.error('Response error:', error.response || error.message);

    if (error.response) {
      const { status } = error.response;
      // 处理常见的 HTTP 错误状态码
      switch (status) {
        case 401: // 未授权
          // 401 处理必须是纯本地失效；再次请求 /auth/logout 会形成递归 401 风暴。
          try {
            if (!await expireAuthenticatedSession('unauthorized')) {
              debugLog('Unauthorized access to protected route.');
            }
          } catch (invalidationError) {
            // 会话清理是附带行为，失败时仍须向调用方传播原始 HTTP 错误。
            console.error('Authentication invalidation failed:', invalidationError);
          }
          break;
        case 403: // 禁止访问
          // 可以显示一个权限不足的提示
          console.error('Forbidden access.');
          break;
        case 404: // 未找到
          console.error('Resource not found.');
          break;
        case 500: // 服务器内部错误
          console.error('Internal server error.');
          break;
        // 可以根据需要添加更多错误状态码的处理
        default:
          console.error(`Unhandled error status: ${status}`);
      }
    } else if (error.request) {
      // 请求已发出，但没有收到响应 (例如网络问题)
      console.error('Network error or no response received:', error.request);
    } else {
      // 发送请求时出了点问题
      console.error('Error setting up request:', error.message);
    }

    // 将错误继续抛出，以便调用方可以捕获并处理
    return Promise.reject(error);
  }
);

// Passkey Management
export const fetchPasskeys = () => {
  return apiClient.get('/auth/user/passkeys');
};

export const deletePasskey = (credentialID: string) => {
  return apiClient.delete(`/auth/user/passkeys/${credentialID}`);
};
export default apiClient;
